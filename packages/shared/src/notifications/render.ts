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
  'reconciliation.row_assigned': (data) => {
    const rowId =
      typeof data.rowId === 'string' && /^[a-f0-9]{24}$/.test(data.rowId)
        ? data.rowId
        : null;
    const details = [
      text(data.policyNumber),
      text(data.customerName),
      text(data.tabLabel),
    ].filter((part): part is string => part !== null);
    return {
      title: 'Dash policy assigned to you',
      body: details.length
        ? details.join(' · ')
        : 'A line from the Dash report needs you.',
      // The assignee's page opens the row named in `row`.
      href: rowId
        ? `/reconciliation/assigned?row=${rowId}`
        : '/reconciliation/assigned',
    };
  },
  'payouts.run_ready': (data) => {
    const month =
      typeof data.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(data.month)
        ? data.month
        : null;
    const label = text(data.monthLabel) ?? month;
    const count =
      typeof data.statements === 'number' && Number.isInteger(data.statements)
        ? data.statements
        : null;
    return {
      title: label ? `Pay statements drafted for ${label}` : 'Pay statements drafted',
      body:
        count === null
          ? 'The statements are ready to review.'
          : `${count} statement${count === 1 ? ' is' : 's are'} ready to review.`,
      href: month ? `/payouts?month=${month}` : '/payouts',
    };
  },
  'payouts.statement_sent': (data) => {
    const statementId =
      typeof data.statementId === 'string' &&
      /^[a-f0-9]{24}$/.test(data.statementId)
        ? data.statementId
        : null;
    const month =
      typeof data.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(data.month)
        ? data.month
        : null;
    const label = text(data.monthLabel) ?? month;
    const reissued =
      typeof data.version === 'number' &&
      Number.isInteger(data.version) &&
      data.version > 1;
    const sender = text(data.senderName);
    const subject = label
      ? `Your commission statement for ${label}`
      : 'Your commission statement';
    return {
      title: `${subject} ${reissued ? 'has been reissued' : 'is ready'}`,
      body: sender
        ? `${sender} sent it. Open it to review it.`
        : 'Open it to review it.',
      href: statementId ? `/payouts/statements/${statementId}` : '/my-pay',
    };
  },
  'payouts.statement_rejected': (data) => {
    const answer = statementAnswer(data);
    return {
      title: answer.who
        ? `${answer.who} disputed their commission statement`
        : 'A commission statement was disputed',
      body: answer.label
        ? `The ${answer.label} statement needs correcting before it is sent again.`
        : 'It needs correcting before it is sent again.',
      href: answer.href,
    };
  },
  'payouts.statement_accepted': (data) => {
    const answer = statementAnswer(data);
    return {
      title: answer.who
        ? `${answer.who} accepted their commission statement`
        : 'A commission statement was accepted',
      body: answer.label
        ? `The ${answer.label} statement is signed.`
        : 'It is signed.',
      href: answer.href,
    };
  },
};

/** What the two sign-off renderers (PAC-182) read from `data`. */
function statementAnswer(data: NotificationData): {
  who: string | null;
  label: string | null;
  href: string;
} {
  const statementId =
    typeof data.statementId === 'string' &&
    /^[a-f0-9]{24}$/.test(data.statementId)
      ? data.statementId
      : null;
  const month =
    typeof data.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(data.month)
      ? data.month
      : null;
  return {
    who: text(data.employeeName),
    label: text(data.monthLabel) ?? month,
    // A reviewer reads them on the statement; the Payouts page otherwise.
    href: statementId ? `/payouts/statements/${statementId}` : '/payouts',
  };
}

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
