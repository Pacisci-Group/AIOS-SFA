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
  'hr.holidays_proposed': (data) => {
    const year = typeof data.year === 'number' ? data.year : null;
    const count = typeof data.count === 'number' ? data.count : null;
    const country = text(data.countryName);
    const region = text(data.regionName);
    const where = country ? (region ? `${country}, ${region}` : country) : null;
    const yearLabel = year ? String(year) : 'next year';
    const body =
      count !== null && where
        ? `${count} suggested holiday${count === 1 ? '' : 's'} for ${yearLabel} from ${where}. Review and confirm them in HR settings.`
        : `Suggested holidays for ${yearLabel} are ready. Review and confirm them in HR settings.`;
    return {
      title: `${yearLabel}'s holidays are ready to confirm`,
      body,
      href: year
        ? `/settings/hr?tab=calendar&proposal=${year}`
        : '/settings/hr?tab=calendar',
    };
  },
  'hr.onboarding_pending': (data) => {
    const name = text(data.employeeName) ?? text(data.email) ?? 'A new employee';
    const branch = text(data.branchName);
    const roles = Array.isArray(data.roleNames)
      ? data.roleNames.filter((r): r is string => typeof r === 'string')
      : [];
    const who = roles.length > 0 ? `${name} (${roles.join(', ')})` : name;
    const where = branch ? ` in ${branch}` : '';
    const userId = text(data.userId);
    return {
      title: `${name} needs HR onboarding`,
      body: `${who} was invited${where} without a leave policy. Pick their policy, schedule and start date to activate them.`,
      href: userId
        ? `/hr/onboardings?user=${encodeURIComponent(userId)}`
        : '/hr/onboardings',
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
