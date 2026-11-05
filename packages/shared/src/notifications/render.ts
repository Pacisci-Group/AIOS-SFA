import { isNotificationType, type NotificationType } from './catalog';

/**
 * Rendering a notification's text from its `type` + `data` (PAC-154).
 *
 * ## Pure, and in `@sfa/shared`, on purpose
 *
 * The worker calls this **once, at write time**, and stores the result on the
 * row — so the in-app list, the SSE toast, the push payload and the email all
 * show the same words, and a wording change never leaves three channels
 * disagreeing about one event. It takes no dates, no services and no database:
 * everything it needs must already be in `data`, which is also what lets a
 * client render a draft from the same inputs later without a round trip.
 *
 * `href` is a **path**, never a URL. The SPA navigates to it as-is; the email
 * channel prefixes the tenant host through `TenantUrlService.baseUrlFor`
 * (AGENTS.md §11), which is the only place that knows which host a recipient
 * may sign in on.
 */
export interface RenderedNotification {
  title: string;
  body: string;
  /** App-relative path, starting with a single `/`. */
  href: string;
}

/** Free-form per-type payload, shaped by the producer and read by the renderer. */
export type NotificationData = Record<string, unknown>;

type NotificationRenderer = (data: NotificationData) => RenderedNotification;

/** A non-empty trimmed string, or null — `data` is untyped at this boundary. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** A finite number, or null. */
function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** `'2026-11-12'` → `{ month: 'Nov', day: 12, year: 2026 }`, read as written — no `Date`, no zone. */
function dayParts(value: unknown): { month: string; day: number; year: number } | null {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? { month, day: Number(match[3]), year: Number(match[1]) } : null;
}

/** `Nov 12, 2026` · `Nov 12 – 14, 2026` · `Dec 30, 2026 – Jan 2, 2027`. */
function dayRange(first: unknown, last: unknown): string | null {
  const from = dayParts(first);
  const to = dayParts(last) ?? from;
  if (!from || !to) return null;
  if (from.year !== to.year) {
    return `${from.month} ${from.day}, ${from.year} – ${to.month} ${to.day}, ${to.year}`;
  }
  if (from.month !== to.month) {
    return `${from.month} ${from.day} – ${to.month} ${to.day}, ${to.year}`;
  }
  if (from.day !== to.day) return `${from.month} ${from.day} – ${to.day}, ${to.year}`;
  return `${from.month} ${from.day}, ${from.year}`;
}

function hoursLabel(value: unknown): string | null {
  const hours = numeric(value);
  return hours === null ? null : `${Math.abs(hours)} h`;
}

/** The words every time off notification shares. */
function timeOffWords(data: NotificationData) {
  const range = dayRange(data.firstDay, data.lastDay);
  const policy = text(data.policyName);
  const requestId = text(data.requestId);
  return {
    employee: text(data.employeeName) ?? 'Someone',
    actor: text(data.actorName) ?? 'A reviewer',
    /** "PTO request" / "time off request". */
    request: policy ? `${policy} request` : 'time off request',
    leave: policy ? `${policy} leave` : 'leave',
    policy: policy ?? 'time off',
    /** " for Nov 12 – 14, 2026", or nothing. */
    forRange: range ? ` for ${range}` : '',
    hours: hoursLabel(data.totalHours),
    note: text(data.note),
    // A 24-hex id only: this becomes a path segment.
    href:
      requestId && /^[a-f0-9]{24}$/i.test(requestId)
        ? `/time-off/requests/${requestId}`
        : '/time-off',
  };
}

/** `Body.` → `Body. "The note"` when there is one. */
function withNote(body: string, note: string | null): string {
  return note ? `${body} “${note}”` : body;
}

const RENDERERS: Record<NotificationType, NotificationRenderer> = {
  'bug_report.filed': (data) => {
    const reporter = text(data.reporterName) ?? 'Someone';
    const summary = text(data.summary);
    return {
      title: 'New bug report',
      body: summary ? `${reporter}: ${summary}` : `${reporter} filed a bug report.`,
      // The queue page has no per-report URL yet; the newest report is at the
      // top of its default view, which is where this lands the reader.
      href: '/admin/bugs',
    };
  },

  'time_off.submitted': (data) => {
    const w = timeOffWords(data);
    const amount = w.hours ? `${w.hours} of ${w.policy}` : w.policy;
    return {
      title: data.resubmitted === true ? 'Time off request resent' : 'Time off request to review',
      body: withNote(`${w.employee} requested ${amount}${w.forRange}.`, w.note),
      href: w.href,
    };
  },
  'time_off.changes_requested': (data) => {
    const w = timeOffWords(data);
    return {
      title: 'Changes requested on your time off',
      body: withNote(`${w.actor} asked for changes to your ${w.request}${w.forRange}.`, w.note),
      href: w.href,
    };
  },
  'time_off.approved': (data) => {
    const w = timeOffWords(data);
    return {
      title: 'Time off approved',
      body:
        data.automatic === true
          ? `Your ${w.request}${w.forRange} was approved automatically.`
          : withNote(`${w.actor} approved your ${w.request}${w.forRange}.`, w.note),
      href: w.href,
    };
  },
  'time_off.auto_approved_notice': (data) => {
    const w = timeOffWords(data);
    return {
      title: 'Time off approved automatically',
      body: `${w.employee}’s ${w.request}${w.forRange} met the policy’s rules. No action needed.`,
      href: w.href,
    };
  },
  'time_off.declined': (data) => {
    const w = timeOffWords(data);
    return {
      title: 'Time off declined',
      body: withNote(`${w.actor} declined your ${w.request}${w.forRange}.`, w.note),
      href: w.href,
    };
  },
  'time_off.approval_cancelled': (data) => {
    const w = timeOffWords(data);
    return {
      title: 'Approved time off cancelled',
      body:
        data.cancelledBy === 'employee'
          ? `${w.employee} cancelled their approved ${w.leave}${w.forRange}.`
          : withNote(`${w.actor} cancelled your approved ${w.leave}${w.forRange}.`, w.note),
      href: w.href,
    };
  },
  'time_off.recorded': (data) => {
    const w = timeOffWords(data);
    const amount = w.hours ? `${w.hours} of ${w.policy}` : w.policy;
    return {
      title: 'Time off recorded for you',
      body: withNote(`${w.actor} recorded ${amount} for you${w.forRange}.`, w.note),
      href: w.href,
    };
  },
  'time_off.balance_adjusted': (data) => {
    const hours = numeric(data.hours);
    const amount = hoursLabel(data.hours);
    const policy = text(data.policyName) ?? 'time off';
    const actor = text(data.actorName) ?? 'An HR admin';
    const change =
      hours === null || amount === null
        ? `adjusted your ${policy} balance`
        : hours >= 0
          ? `added ${amount} to your ${policy} balance`
          : `removed ${amount} from your ${policy} balance`;
    return {
      title: 'Time off balance adjusted',
      body: withNote(`${actor} ${change}.`, text(data.reason)),
      href: '/time-off',
    };
  },
};

/**
 * Thrown for a type the catalog does not know, or a renderer that produced an
 * `href` that is not a path. Both are programming errors on the producer's
 * side, not transient conditions — the worker maps this to a non-retriable
 * failure rather than retrying something that cannot succeed.
 */
export class NotificationRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotificationRenderError';
  }
}

export function renderNotification(
  type: string,
  data: NotificationData,
): RenderedNotification {
  if (!isNotificationType(type)) {
    throw new NotificationRenderError(`Unknown notification type "${type}".`);
  }
  const rendered = RENDERERS[type](data);
  if (!rendered.href.startsWith('/') || rendered.href.startsWith('//')) {
    throw new NotificationRenderError(
      `Notification type "${type}" rendered an href that is not an app path: "${rendered.href}".`,
    );
  }
  return rendered;
}
