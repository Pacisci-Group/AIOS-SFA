import type {
  CreateLeadResponse,
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
