import { useCallback } from "react";
import { useUrlState } from "@/hooks/useUrlState";

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const SLUG = /^[a-z0-9_-]{1,60}$/i;

/**
 * Param names mirror `ListPlatformUsersParams` one-for-one, so a URL reads the
 * same as the request it produces. Frozen at module scope so `useUrlState`'s
 * memo dependencies stay stable across renders.
 */
const DEFAULTS = {
  q: "",
  agencyIds: [] as string[],
  roleSlugs: [] as string[],
  page: "",
};

const ALLOWED = {
  agencyIds: (value: string) => OBJECT_ID.test(value),
  roleSlugs: (value: string) => SLUG.test(value),
  page: (value: string) => /^[1-9]\d*$/.test(value),
} as const;

export interface PlatformUsersUrlState {
  q: string;
  agencyIds: string[];
  roleSlugs: string[];
  /** 1-based; `?page=1` is left out of the URL. */
  page: number;
  setQ: (value: string) => void;
  setAgencyIds: (value: string[]) => void;
  setRoleSlugs: (value: string[]) => void;
  setPage: (page: number) => void;
}

/**
 * The user directory's search, filters and page, held in the URL (PAC-70).
 *
 * Same reasoning as `useLeadsUrlState`: the URL is the single source of truth,
 * so the view survives a refresh and can be pasted to a colleague. Every
 * change to *what* is being asked for resets to page 1 in the same write, so
 * a narrower result never strands the operator on a page that no longer
 * exists.
 */
export function usePlatformUsersUrlState(): PlatformUsersUrlState {
  const [values, setValues] = useUrlState({
    defaults: DEFAULTS,
    allowed: ALLOWED,
  });

  const setQ = useCallback(
    (q: string) => setValues({ q, page: "" }),
    [setValues],
  );
  const setAgencyIds = useCallback(
    (agencyIds: string[]) => setValues({ agencyIds, page: "" }),
    [setValues],
  );
  const setRoleSlugs = useCallback(
    (roleSlugs: string[]) => setValues({ roleSlugs, page: "" }),
    [setValues],
  );
  const setPage = useCallback(
    (page: number) => setValues({ page: page <= 1 ? "" : String(page) }),
    [setValues],
  );

  return {
    q: values.q,
    agencyIds: values.agencyIds,
    roleSlugs: values.roleSlugs,
    page: Number(values.page) || 1,
    setQ,
    setAgencyIds,
    setRoleSlugs,
    setPage,
  };
}
