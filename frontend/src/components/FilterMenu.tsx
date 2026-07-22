import { useEffect, useRef, useState } from "react";
import FilterBar from "./FilterBar";
import EntityFilterBar from "./EntityFilterBar";
import type { EntityCriteria } from "./EntityFilterBar";
import { RANGE_FILTER_LABELS } from "../rangeOptions";
import type { RangeFilter } from "../rangeOptions";
import type { InactivityRecord } from "../types";

interface Props {
  range: RangeFilter;
  onRangeChange: (value: RangeFilter) => void;
  /** Full roster, for the LHO/RM/DC dropdowns inside the panel. Empty while still loading. */
  records: InactivityRecord[];
  /** Applying just forwards the selection up to App.tsx — it combines with the day-range filter and search to determine what the top cards/graph/table show. */
  onApplyEntity: (criteria: EntityCriteria) => void;
  onClearEntity: () => void;
}

/**
 * One entry point for every dashboard filter — the day-range chips (which
 * drive the table/charts/KPI panel) and the LHO/RM/DC browse dropdowns — so
 * they don't sit scattered across the header. Click to open, click outside
 * or Escape to close. The day-range choice still flows through exactly the
 * same onRangeChange callback FilterBar always used; nothing about how
 * filtering works changed, only where the controls live.
 */
export default function FilterMenu({
  range,
  onRangeChange,
  records,
  onApplyEntity,
  onClearEntity,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the panel once a result is applied — it renders inline on the page
  // below, so leaving the dropdown open would just sit in the way of it.
  const applyEntity = (criteria: EntityCriteria) => {
    onApplyEntity(criteria);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="filter-menu" ref={rootRef}>
      <button
        type="button"
        className="filter-menu__trigger"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">☰</span> Filters
        <span className="filter-menu__active">{RANGE_FILTER_LABELS[range]}</span>
      </button>

      {open && (
        <div className="filter-menu__panel" role="group" aria-label="All dashboard filters">
          <div className="filter-menu__section">
            <span className="filter-menu__section-label">Inactivity range</span>
            <FilterBar value={range} onChange={onRangeChange} />
          </div>
          <div className="filter-menu__section">
            <span className="filter-menu__section-label">Browse by LHO / RM / DC</span>
            <EntityFilterBar records={records} onApply={applyEntity} onClear={onClearEntity} />
          </div>
        </div>
      )}
    </div>
  );
}
