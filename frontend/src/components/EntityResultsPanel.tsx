import { useMemo } from "react";
import type { InactivityRecord } from "../types";
import { PICK } from "./EntityFilterBar";
import type { EntityCriteria } from "./EntityFilterBar";
import FilteredResultsPanel from "./FilteredResultsPanel";

interface Props {
  records: InactivityRecord[];
  criteria: EntityCriteria | null;
  onClear: () => void;
}

/**
 * Renders the result of an applied LHO/RM/DC filter INLINE, in the normal page
 * flow — not a popup. Sits alongside the rest of the dashboard's panels so the
 * chart and table can be viewed together with everything else, scrolled and
 * compared rather than hidden behind a modal.
 */
export default function EntityResultsPanel({ records, criteria, onClear }: Props) {
  const matches = useMemo(() => {
    if (!criteria) return [];
    return records
      .filter((r) => {
        if (criteria.lho && PICK.LHO(r).trim().toLowerCase() !== criteria.lho.key) return false;
        if (criteria.rm && PICK.RM(r).trim().toLowerCase() !== criteria.rm.key) return false;
        if (criteria.dc && PICK.DC(r).trim().toLowerCase() !== criteria.dc.key) return false;
        return true;
      })
      .sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
  }, [records, criteria]);

  if (!criteria) return null;

  const title = [
    criteria.lho && `LHO: ${criteria.lho.label}`,
    criteria.rm && `RM: ${criteria.rm.label}`,
    criteria.dc && `DC: ${criteria.dc.label}`,
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <FilteredResultsPanel
      title={title}
      records={matches}
      emptyMessage="No CSPs match this combination."
      onClear={onClear}
    />
  );
}
