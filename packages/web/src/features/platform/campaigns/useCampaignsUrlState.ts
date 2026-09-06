import { useCallback } from "react";
import type { MailerCampaignStatus } from "@sfa/shared";
import { useUrlState } from "@/hooks/useUrlState";
import { CAMPAIGN_STATUSES } from "./campaign-format";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * Param names mirror `ListCampaignsParams` one-for-one, so a URL reads the same
 * as the request it produces. Frozen at module scope so `useUrlState`'s memo
 * dependencies stay stable across renders.
 */
const DEFAULTS = {
  q: "",
  status: "",
  agencyId: "",
  page: "",
};

const ALLOWED = {
  status: CAMPAIGN_STATUSES as readonly string[],
  agencyId: (value: string) => OBJECT_ID.test(value),
  page: (value: string) => /^[1-9]\d*$/.test(value),
} as const;

export interface CampaignsUrlState {
  q: string;
  status: MailerCampaignStatus | "";
  agencyId: string;
  /** 1-based; `?page=1` is left out of the URL. */
  page: number;
  setQ: (value: string) => void;
  setStatus: (value: MailerCampaignStatus | "") => void;
  setAgencyId: (value: string) => void;
  setPage: (page: number) => void;
}

/**
 * The campaigns list's search, filters and page, held in the URL (PAC-71).
 *
 * Same reasoning as `usePlatformUsersUrlState`: the URL is the single source of
 * truth, so the view survives a refresh and can be pasted to a colleague. Every
 * change to *what* is being asked for resets to page 1 in the same write, so a
 * narrower result never strands the operator on a page that no longer exists.
 *
 * ⚠ `agencyId` is a single value, not a list — the API filters on one agency,
 * because "campaigns this agency can see" includes every `all` campaign and
 * OR-ing several of those together answers no question anyone asks.
 */
export function useCampaignsUrlState(): CampaignsUrlState {
  const [values, setValues] = useUrlState({
    defaults: DEFAULTS,
    allowed: ALLOWED,
  });

  const setQ = useCallback(
    (q: string) => setValues({ q, page: "" }),
    [setValues],
  );
  const setStatus = useCallback(
    (status: MailerCampaignStatus | "") => setValues({ status, page: "" }),
    [setValues],
  );
  const setAgencyId = useCallback(
    (agencyId: string) => setValues({ agencyId, page: "" }),
    [setValues],
  );
  const setPage = useCallback(
    (page: number) => setValues({ page: page <= 1 ? "" : String(page) }),
    [setValues],
  );

  return {
    q: values.q,
    status: values.status as MailerCampaignStatus | "",
    agencyId: values.agencyId,
    page: Number(values.page) || 1,
    setQ,
    setStatus,
    setAgencyId,
    setPage,
  };
}
