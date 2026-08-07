import type {
  CreateLeadResponse,
  LeadPolicyOfInterestInput,
  PublicLeadFormInfo,
  PublicLeadSubmitResponse,
  ShareLinkRow,
} from "@sfa/shared";
import { apiFetch, publicFetch } from "@/lib/api-client";

export type { CreateLeadResponse, PublicLeadFormInfo, ShareLinkRow };

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
  leadSourceCode: string;
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
