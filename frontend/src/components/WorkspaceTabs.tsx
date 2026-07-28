export type WorkspaceTab = "overview" | "insights" | "analytics" | "system";

const TABS: { value: WorkspaceTab; icon: string; label: string }[] = [
  { value: "overview", icon: "📊", label: "Overview" },
  { value: "insights", icon: "🤖", label: "Smart Insights" },
  { value: "analytics", icon: "📈", label: "Analytics & Performance" },
  { value: "system", icon: "⚙️", label: "System Control & Audit" },
];

interface Props {
  active: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
}

/**
 * Groups the ~15 stacked panels into 4 purpose-built workspaces so the page
 * isn't one endless scroll. Only the active tab's panels mount — switching
 * tabs unmounts the others (they refetch on return), trading a little
 * network chatter for not keeping 15 components' worth of state/DOM alive
 * at once. Rendered as a left sidebar (a vertical queue), not a top tab
 * strip — full height, one workspace per row.
 */
export default function WorkspaceTabs({ active, onChange }: Props) {
  return (
    <nav className="workspace-tabs" role="tablist" aria-label="Dashboard workspace" aria-orientation="vertical">
      <span className="workspace-tabs__heading">Workspace</span>
      {TABS.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={active === t.value}
          className={`workspace-tabs__btn${active === t.value ? " workspace-tabs__btn--active" : ""}`}
          onClick={() => onChange(t.value)}
        >
          <span className="workspace-tabs__icon" aria-hidden="true">{t.icon}</span>
          <span className="workspace-tabs__label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
