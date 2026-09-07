import type { CarrierOption } from './carrier';

/**
 * Carrier appointments (PAC-93).
 *
 * ## What an appointment is
 *
 * An insurance carrier *appoints* an agency and issues it an **agency code**.
 * A captive agency has exactly one — Smith Family Agency is an Allstate
 * exclusive agent and its code, `A0B9049`, is literally the local part of the
 * agency's `@allstate.com` address in a mailer file. An independent agency is
 * appointed by several carriers and holds **one code per carrier**.
 *
 * The consequence that shapes every type here: **a code is only meaningful
 * inside its carrier.** Two carriers can issue the same string to different
 * agencies, so `carrierId` is part of every key, every lookup and the
 * uniqueness rule. This replaced `Agency.allstateAgencyId`, which hard-wired
 * one carrier into the tenant model.
 *
 * ## Formats are not normalized
 *
 * Allstate's code is 7 alphanumerics; other carriers issue numeric or longer
 * ones. We do not know each carrier's format and inventing one fails closed, so
 * {@link CarrierAppointmentView.carrierAgencyCode} is stored exactly as issued
 * and {@link appointmentCodeKey} derives a separate matching key.
 */

/**
 * The matching form of a carrier agency code: trimmed and upper-cased.
 *
 * ⚠ **This lives in `shared` on purpose, and both sides must call it.** An
 * appointment's `codeKey` is derived from what an operator types; the mailer
 * pipeline derives the same key from a vendor file's `agencyid` column
 * (`mailer-row.mapper.ts`). PAC-71 matches one against the other to decide
 * which tenant a mailer row belongs to. If the two normalizations ever drift,
 * the match silently misses and a file lands in nobody's tenant — a failure
 * with no error and no obvious symptom. One exported function, cited from both
 * sides, is what prevents that.
 *
 * Casing only. It deliberately does **not** strip punctuation or whitespace
 * inside the code: that would be a format assumption, and see the note above
 * about not making those.
 */
export function appointmentCodeKey(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * One appointment as a client submits it.
 *
 * `carrierAgencyCode` is **optional**, because the code is optional at every
 * point it can be entered — the Super Admin picks the carriers when onboarding
 * a tenant and may leave the codes for the owner, who supplies them during
 * first-run setup or later under Workspace Settings. A row with no code is
 * dropped rather than stored: an appointment without a code is not an
 * appointment, and persisting one would break the uniqueness index (every such
 * row would collide on `(carrier, null)`).
 */
export interface CarrierAppointmentInput {
  carrierId: string;
  carrierAgencyCode?: string;
  isPrimary?: boolean;
  active?: boolean;
}

/**
 * One appointment as the API returns it.
 *
 * `carrierName` is resolved server-side from the carrier catalog so no reader
 * has to join, and so a UI can render an appointment whose carrier was since
 * deactivated in the catalog.
 */
export interface CarrierAppointmentView {
  carrierId: string;
  carrierName: string;
  carrierAgencyCode: string;
  isPrimary: boolean;
  active: boolean;
  appointedAt: string | null;
}

/** `GET /agency/carrier-appointments`. */
export interface CarrierAppointmentsResponse {
  appointments: CarrierAppointmentView[];
  /**
   * The carriers an appointment may target — the platform-global catalog.
   *
   * Returned with the appointments rather than left to `GET /carriers` because
   * that route is gated on the `deal_audits` / `crm_service` **modules**, so an
   * agency with neither enabled would get a settings page whose picker 403s.
   * It also guarantees the picker offers exactly the set the server validates
   * against.
   */
  carrierOptions: CarrierOption[];
}
