import type {
  CreateLeadResponse,
  LeadPolicyOfInterestInput,
  PolicyReplacementReason,
  PublicLeadFormInfo,
  PublicLeadSubmitResponse,
  ReplacementLeadLookup,
  ShareLinkRow,
} from "@sfa/shared";
import { apiFetch, publicFetch } from "@/lib/api-client";

export type {
  CreateLeadResponse,
  PublicLeadFormInfo,
  ReplacementLeadLookup,
  ShareLinkRow,
};

interface LeadIntakePayload {
  primaryContact: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    phone: string;
    email: string;
  };
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  members: {
    firstName: string;
    lastName: string;
    dateOfBirth?: string;
    role: string;
  }[];
  /**
   * What the submitter wants quoted — canonical labels, item counts, and each
   * property row's own dwelling address (PAC-56 #14).
   *
   * Optional because only the public form asks (PAC-56 #2); the API defaults it
   * to `[]`. Omitted rather than sent empty, so "not asked" and "asked, none
   * chosen" stay distinguishable at the call site.
   */
  policiesOfInterest?: LeadPolicyOfInterestInput[];
  submissionToken?: string;
}

export interface CreateLeadPayload extends LeadIntakePayload {
  leadSourceId: string;
  /**
   * Pin the lead to a household the producer already has open — the Household
   * page's "Start Quote" dialog.
   *
   * On `CreateLeadPayload` rather than `LeadIntakePayload` on purpose: the
   * public route's schema does not accept it, so it must not be reachable from
   * `submitPublicLead`, which takes the base type.
   */
  householdId?: string;
  /**
   * Create this lead to replace a policy — a Cancel Rewrite or a Company
   * Transfer (PAC-126).
   *
   * The **policy** is named, not the household: the server derives the household
   * from it, so a caller cannot aim a replacement at a book it does not own. It
   * also re-runs the replaceable guards, so a policy that went inactive while
   * the rep was filling in the form fails here rather than two forms later.
   *
   * On `CreateLeadPayload` rather than the base type, like `householdId` and for
   * a stronger version of the same reason: the public route must never be able
   * to queue a cancellation on somebody's coverage.
   */
  replacementIntent?: {
    policyId: string;
    reason: PolicyReplacementReason;
  };
}

/**
 * `GET /leads/for-replacement` — where a replacement should start.
 *
 * The one call an entry point makes before routing. Three answers in one read:
 * `blockedReason` set (this policy cannot be replaced), `leadId` set (a lead was
 * already created and abandoned — resume at the Sold form), or both null
 * (nothing started — create the lead first).
 *
 * Gated on `deal_audits:write`, matching the Sold form it leads to, so a caller
 * who passes this can finish the chain.
 */
export function getReplacementLead(
  policyId: string,
  reason: PolicyReplacementReason,
) {
  const params = new URLSearchParams({ policyId, reason });
  return apiFetch<ReplacementLeadLookup>(
    `/leads/for-replacement?${params.toString()}`,
  );
}

/** `POST /leads` — authenticated New Lead form. */
export function createLead(payload: CreateLeadPayload) {
  return apiFetch<CreateLeadResponse>("/leads", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** `GET /public/lead-form/:token` — unauthenticated. */
export function getPublicLeadForm(token: string) {
  return publicFetch<PublicLeadFormInfo>(
    `/public/lead-form/${encodeURIComponent(token)}`,
  );
}

/** `POST /public/leads/:token` — unauthenticated. Returns no record details. */
export function submitPublicLead(token: string, payload: LeadIntakePayload) {
  return publicFetch<PublicLeadSubmitResponse>(
    `/public/leads/${encodeURIComponent(token)}`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export function listShareLinks() {
  return apiFetch<{ items: ShareLinkRow[] }>("/leads/share-links");
}

export function createShareLink(label?: string) {
  return apiFetch<ShareLinkRow>("/leads/share-links", {
    method: "POST",
    body: JSON.stringify(label ? { label } : {}),
  });
}

export function revokeShareLink(id: string) {
  return apiFetch<ShareLinkRow>(`/leads/share-links/${id}/revoke`, {
    method: "PATCH",
  });
}
