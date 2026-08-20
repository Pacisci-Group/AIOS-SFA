import { inviteTemplate } from './invite.template';
import type { Template } from './template.types';

/**
 * Every email template, by key.
 *
 * The key is what `emailMessages.templateKey` records, so it is a stored value:
 * renaming one is a data migration, not a refactor.
 *
 * `satisfies` rather than a type annotation on purpose — it enforces the shape
 * while keeping each entry's payload type precise, so `EMAIL_TEMPLATES.invite`
 * is still `Template<InviteRequestedData>` and not a widened
 * `Template<unknown>`.
 */
export const EMAIL_TEMPLATES = {
  invite: inviteTemplate,
} satisfies Record<string, Template<never>>;

export type TemplateKey = keyof typeof EMAIL_TEMPLATES;

/** Payload type a given template renders from. */
export type TemplateData<K extends TemplateKey> =
  (typeof EMAIL_TEMPLATES)[K] extends Template<infer TData> ? TData : never;
