import { useQuery } from "@tanstack/react-query";
import { getLeadSources, leadSourcesKey } from "@/lib/lead-sources-api";

/**
 * The agency's selectable lead sources (PAC-135).
 *
 * A hook rather than a `useQuery` at each call site because every consumer — the
 * lead form, the detail page's inline select, the Leads filter, the Owner
 * dashboard's filter — wants the same thing with the same freshness, and four
 * copies of a `staleTime` drift.
 *
 * `enabled: false` is for the **public** share-link form: it is unauthenticated,
 * never shows the field, and would only earn a 401.
 */
export function useLeadSources({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: leadSourcesKey,
    queryFn: getLeadSources,
    staleTime: 30 * 60_000,
    enabled,
  });
}
