/** The two parts every email must have. */
export interface RenderedBody {
  html: string;
  /**
   * Plain-text alternative.
   *
   * Non-negotiable: a message with no text part is materially more likely to be
   * filtered as spam. `templates.unit-spec.ts` asserts it is non-empty across
   * the whole registry so a new template physically cannot forget.
   */
  text: string;
}

/**
 * A template is a **pure function of its payload**.
 *
 * No injected services, no database access, no `Date.now()`. That is what makes
 * every template testable with a plain object and no test harness, and it is
 * the same discipline the codebase already applies to `intake.normalize.ts`.
 * The corollary is that anything a template needs must be on the event payload
 * — which is exactly the contract `mail.types.ts` documented for
 * `InviteEmailPayload` ("templates should never be able to reach back into the
 * database").
 */
export interface Template<TData> {
  readonly key: string;
  readonly subject: (data: TData) => string;
  readonly render: (data: TData) => RenderedBody;
}
