/**
 * Minimal SmartSuite REST client for the migration.
 * Mirrors the auth + list semantics of the legacy SFA `lib/smartsuite.ts`:
 *   - Authorization: Token <SMARTSUITE_API_TOKEN>
 *   - Account-Id: <SMARTSUITE_ACCOUNT_ID>
 *   - POST /applications/{tableId}/records/list/?limit&offset with { filter, sort, hydrated }
 */

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
}

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

  return { apiToken: apiToken!, accountId: accountId!, solutionId, baseUrl };
}

export class SmartSuiteClient {
  constructor(private readonly config: SmartSuiteConfig) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Token ${this.config.apiToken}`,
      'Account-Id': this.config.accountId,
      'Content-Type': 'application/json',
    };
  }

  /** Single page of records. */
  async listPage(
    tableId: string,
    body: SmartSuiteListBody,
    limit: number,
    offset: number,
  ): Promise<{ items: SmartSuiteRecord[]; total: number }> {
    const url = `${this.config.baseUrl}/applications/${tableId}/records/list/?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ hydrated: true, ...body }),
    });
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

  /** Fetch every record for a table, paging through offsets. */
  async listAll(
    tableId: string,
    body: SmartSuiteListBody = {},
    pageSize = 500,
  ): Promise<SmartSuiteRecord[]> {
    const all: SmartSuiteRecord[] = [];
    let offset = 0;
    for (;;) {
      const { items, total } = await this.listPage(
        tableId,
        body,
        pageSize,
        offset,
      );
      all.push(...items);
      offset += items.length;
      if (
        items.length === 0 ||
        all.length >= total ||
        items.length < pageSize
      ) {
        break;
      }
    }
    return all;
  }

  /** Count only (limit 1) — used by the reconciliation report for source totals. */
  async count(tableId: string, body: SmartSuiteListBody = {}): Promise<number> {
    const { total } = await this.listPage(tableId, body, 1, 0);
    return total;
  }
}
