/**
 * Minimal SmartSuite REST client for the migration.
 * Mirrors the auth + list semantics of the legacy SFA `lib/smartsuite.ts`:
 *   - Authorization: Token <SMARTSUITE_API_TOKEN>
 *   - Account-Id: <SMARTSUITE_ACCOUNT_ID>
 *   - POST /applications/{tableId}/records/list/?limit&offset with { filter, sort, hydrated }
 *
 * Every request goes through `fetchWithRetry`. A full migration makes hundreds
 * of calls over several minutes, so a single DNS blip or dropped socket used to
 * throw `TypeError: fetch failed` and discard every table still to come — the
 * operator's only recourse being to re-run the whole step. Transient failures
 * are retried with backoff instead; only a genuinely permanent answer (bad
 * token, wrong table id) still stops the run.
 */

import { Logger } from '@nestjs/common';

import { tableLabel } from './table-ids';

export interface SmartSuiteFilterField {
  field: string;
  comparison: string;
  value: unknown;
}

export interface SmartSuiteListBody {
  filter?: { operator: 'and' | 'or'; fields: SmartSuiteFilterField[] };
  sort?: { field: string; direction: 'asc' | 'desc' }[];
  hydrated?: boolean;
}

export type SmartSuiteRecord = Record<string, unknown>;

export interface SmartSuiteConfig {
  apiToken: string;
  accountId: string;
  /** solution/application id — validated for parity with legacy client, not sent per-request. */
  solutionId?: string;
  baseUrl: string;
  /**
   * Per-request timeout. A hung socket must not stall the migration forever;
   * the largest observed page (500 hydrated records) lands in well under 10s,
   * so the default leaves a wide margin over a slow-but-working connection.
   */
  timeoutMs?: number;
  /** Attempts *after* the first, for transient failures. 0 disables retrying. */
  maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 4;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 15_000;

/**
 * Statuses worth another attempt. Anything not listed — 401 (bad token), 404
 * (wrong table id), 400 (malformed filter) — answers the same way on every
 * attempt, so retrying would only delay the error the operator has to act on.
 */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * undici's `TypeError: fetch failed` carries nothing an operator can act on —
 * the syscall that actually failed (ENOTFOUND, ECONNRESET, UND_ERR_CONNECT_TIMEOUT)
 * is on `cause`. Unwrap it so both the retry log line and the final throw name
 * the real problem.
 */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause: unknown = (err as { cause?: unknown }).cause;
  return cause instanceof Error
    ? `${err.message}: ${cause.message}`
    : err.message;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function loadSmartSuiteConfig(): SmartSuiteConfig {
  const apiToken = process.env.SMARTSUITE_API_TOKEN;
  const accountId = process.env.SMARTSUITE_ACCOUNT_ID;
  const solutionId =
    process.env.SMARTSUITE_SOLUTION_ID ?? process.env.SMARTSUITE_APPLICATION_ID;
  const baseUrl =
    process.env.SMARTSUITE_BASE_URL ?? 'https://app.smartsuite.com/api/v1';

  const missing: string[] = [];
  if (!apiToken) missing.push('SMARTSUITE_API_TOKEN');
  if (!accountId) missing.push('SMARTSUITE_ACCOUNT_ID');
  if (!solutionId)
    missing.push('SMARTSUITE_SOLUTION_ID (or SMARTSUITE_APPLICATION_ID)');
  if (missing.length) {
    throw new Error(
      `SmartSuite config incomplete. Set: ${missing.join(', ')} in AIOS-SFA/.env`,
    );
  }

  return {
    apiToken: apiToken!,
    accountId: accountId!,
    solutionId,
    baseUrl,
    timeoutMs: envInt('SMARTSUITE_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    maxRetries: envInt('SMARTSUITE_MAX_RETRIES', DEFAULT_MAX_RETRIES),
  };
}

export class SmartSuiteClient {
  private readonly logger = new Logger('SmartSuite');
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(private readonly config: SmartSuiteConfig) {
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Token ${this.config.apiToken}`,
      'Account-Id': this.config.accountId,
      'Content-Type': 'application/json',
    };
  }

  /** Exponential backoff with jitter, so parallel callers don't retry in lockstep. */
  private backoffMs(attempt: number): number {
    const capped = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);
    return Math.round(capped * (0.5 + Math.random() / 2));
  }

  /** `Retry-After` in ms when the server sent a usable one (seconds or HTTP date). */
  private retryAfterMs(res: FetchResponse): number | undefined {
    const header = res.headers.get('retry-after');
    if (!header) return undefined;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0)
      return Math.min(seconds * 1000, RETRY_MAX_MS);
    const at = Date.parse(header);
    if (Number.isNaN(at)) return undefined;
    return Math.min(Math.max(at - Date.now(), 0), RETRY_MAX_MS);
  }

  /**
   * One request, retried while the failure still looks transient.
   *
   * A retryable *status* on the final attempt is returned rather than thrown,
   * so the caller renders its own error with the response body intact.
   */
  private async fetchWithRetry(
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
    describe: string,
  ): Promise<FetchResponse> {
    for (let attempt = 1; ; attempt++) {
      const isLast = attempt > this.maxRetries;
      let waitMs: number;
      try {
        const res = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.ok || !RETRYABLE_STATUSES.has(res.status) || isLast) return res;
        waitMs = this.retryAfterMs(res) ?? this.backoffMs(attempt);
        this.logger.warn(
          `${describe} failed (HTTP ${res.status}) — retrying in ${waitMs}ms ` +
            `(attempt ${attempt}/${this.maxRetries + 1})`,
        );
      } catch (err) {
        // fetch only throws for transport failures: DNS, reset socket, timeout.
        if (isLast) {
          throw new Error(
            `SmartSuite request failed for ${describe} after ${attempt} ` +
              `attempt(s): ${describeError(err)}`,
            { cause: err },
          );
        }
        waitMs = this.backoffMs(attempt);
        this.logger.warn(
          `${describe} failed (${describeError(err)}) — retrying in ${waitMs}ms ` +
            `(attempt ${attempt}/${this.maxRetries + 1})`,
        );
      }
      await sleep(waitMs);
    }
  }

  /** Single page of records. */
  async listPage(
    tableId: string,
    body: SmartSuiteListBody,
    limit: number,
    offset: number,
  ): Promise<{ items: SmartSuiteRecord[]; total: number }> {
    const url = `${this.config.baseUrl}/applications/${tableId}/records/list/?limit=${limit}&offset=${offset}`;
    const res = await this.fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ hydrated: true, ...body }),
      },
      `${tableLabel(tableId)} (offset ${offset})`,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `SmartSuite list failed (${res.status}) for table ${tableId}: ${text.slice(0, 500)}`,
      );
    }
    const data = (await res.json()) as {
      items?: SmartSuiteRecord[];
      results?: SmartSuiteRecord[];
      data?: SmartSuiteRecord[];
      total?: number;
      count?: number;
    };
    return {
      items: data.items ?? data.results ?? data.data ?? [],
      total: data.total ?? data.count ?? 0,
    };
  }

  /**
   * Fetch every record for a table, paging through offsets.
   *
   * Each page is logged as it lands. A table of 4,500 hydrated records is ~30s
   * of otherwise silent work, which is indistinguishable from a hung socket in
   * a log file — the page lines are what tell an operator the run is moving,
   * and which offset it was on if it later dies.
   */
  async listAll(
    tableId: string,
    body: SmartSuiteListBody = {},
    pageSize = 500,
  ): Promise<SmartSuiteRecord[]> {
    const label = tableLabel(tableId);
    const all: SmartSuiteRecord[] = [];
    const started = Date.now();
    let offset = 0;
    for (let page = 1; ; page++) {
      const pageStarted = Date.now();
      const { items, total } = await this.listPage(
        tableId,
        body,
        pageSize,
        offset,
      );
      all.push(...items);
      offset += items.length;
      this.logger.log(
        `${label}: page ${page} — ${all.length}/${total || all.length} ` +
          `records (+${items.length} in ${Date.now() - pageStarted}ms)`,
      );
      if (
        items.length === 0 ||
        all.length >= total ||
        items.length < pageSize
      ) {
        break;
      }
    }
    this.logger.log(
      `${label}: fetched ${all.length} records in ${Date.now() - started}ms`,
    );
    return all;
  }

  /** Count only (limit 1) — used by the reconciliation report for source totals. */
  async count(tableId: string, body: SmartSuiteListBody = {}): Promise<number> {
    const { total } = await this.listPage(tableId, body, 1, 0);
    return total;
  }
}
