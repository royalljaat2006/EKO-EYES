export type QuickFilterId = "all" | "needsAttention" | "nonResponsive" | "topCritical" | "atRiskRelapses";

const PRESETS: { id: QuickFilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needsAttention", label: "Need Attention Today" },
  { id: "nonResponsive", label: "Non-Responsive" },
  { id: "topCritical", label: "Top Critical" },
  { id: "atRiskRelapses", label: "At-Risk Relapses" },
];

interface Props {
  active: QuickFilterId | null;
  onSelect: (id: QuickFilterId) => void;
  counts: Partial<Record<QuickFilterId, number>>;
}

/**
 * One-click jumps to the lists operators actually act on, instead of
 * re-picking range/entity dropdowns each time. Each preset (other than
 * "All") opens the same shared cardDetail slot every other click-to-view
 * card uses — no new display mechanism.
 */
export default function QuickFilterBar({ active, onSelect, counts }: Props) {
  return (
    <div className="quick-filters" role="group" aria-label="Quick filters">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`quick-filter-chip${active === p.id ? " quick-filter-chip--active" : ""}`}
          onClick={() => onSelect(p.id)}
        >
          {p.label}
          {counts[p.id] !== undefined && <span className="quick-filter-chip__count">{counts[p.id]}</span>}
        </button>
      ))}
    </div>
  );
}
