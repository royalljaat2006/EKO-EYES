import { ALL_RANGES, RANGE_FILTER_OPTIONS, RANGE_FILTER_LABELS } from "../rangeOptions";
import type { RangeFilter } from "../rangeOptions";

interface Props {
  value: RangeFilter;
  onChange: (value: RangeFilter) => void;
}

export default function FilterBar({ value, onChange }: Props) {
  return (
    <div className="filter-bar" role="group" aria-label="Inactivity time frequency filter">
      {RANGE_FILTER_OPTIONS.map((opt) => {
        const selected = opt === value;
        const isAll = opt === ALL_RANGES;
        return (
          <button
            key={opt}
            type="button"
            className={`filter-chip${selected ? " filter-chip--selected" : ""}${isAll ? " filter-chip--all" : ""}`}
            aria-pressed={selected}
            title={isAll ? "View every inactivity-day range at once" : undefined}
            onClick={() => onChange(opt)}
          >
            {selected && <span className="filter-chip__check">✓</span>}
            {RANGE_FILTER_LABELS[opt]}
          </button>
        );
      })}
    </div>
  );
}
