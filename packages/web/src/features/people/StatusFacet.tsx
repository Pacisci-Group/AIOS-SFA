import type { PeopleStatus } from "@sfa/shared";
import { FacetChips } from "@/components/common/FacetChips";
import { STATUS_BADGE, STATUS_FACET_ORDER } from "./person-display";

const OPTIONS = STATUS_FACET_ORDER.map((status) => ({
  value: status,
  label: STATUS_BADGE[status].label,
}));

/**
 * The Status facet of the People list (PAC-162): four toggle chips, ORed,
 * applied as they are clicked. None selected means everyone. The chips
 * themselves are the shared `FacetChips`.
 */
export function StatusFacet({
  value,
  onChange,
}: {
  value: PeopleStatus[];
  onChange: (next: PeopleStatus[]) => void;
}) {
  return (
    <FacetChips label="Filter by status" options={OPTIONS} value={value} onChange={onChange} />
  );
}
