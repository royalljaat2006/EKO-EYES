import { useState } from "react";
import type { ReactNode } from "react";

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Extra controls in the header, e.g. a chart's window/frequency toggle. */
  headerExtra?: ReactNode;
  /** Every panel can collapse; default on. */
  collapsible?: boolean;
  /** Only chart/table-shaped panels opt into full-screen focus mode. */
  focusable?: boolean;
  defaultCollapsed?: boolean;
  children: ReactNode;
}

/**
 * The shared chrome every panel on the dashboard uses: title/subtitle
 * header, an optional collapse toggle, and (for chart/table panels) a
 * full-screen focus toggle for review meetings. Repositions the SAME panel
 * element to fixed/full-screen via CSS rather than teleporting children
 * into a second overlay tree — so a panel with its own internal fetch
 * (GeoHeatMap, RmDcPerformancePanel, etc.) never double-mounts or
 * double-fetches when focus mode toggles.
 */
export default function Panel({
  title,
  subtitle,
  headerExtra,
  collapsible = true,
  focusable = false,
  defaultCollapsed = false,
  children,
}: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [focused, setFocused] = useState(false);

  return (
    <>
      <div className={`panel${focused ? " panel--focused" : ""}`}>
        <div className="panel__header">
          <div className="panel__header-titles">
            <h2>{title}</h2>
            {subtitle && <span className="panel__subtitle">{subtitle}</span>}
          </div>
          <div className="panel__header-actions">
            {headerExtra}
            {focusable && (
              <button
                type="button"
                className="panel__icon-btn"
                title={focused ? "Exit focus mode" : "Focus mode (full screen)"}
                onClick={() => setFocused((f) => !f)}
              >
                {focused ? "✕" : "⤢"}
              </button>
            )}
            {collapsible && (
              <button
                type="button"
                className="panel__icon-btn"
                title={collapsed ? "Expand" : "Collapse"}
                onClick={() => setCollapsed((c) => !c)}
              >
                {collapsed ? "▸" : "▾"}
              </button>
            )}
          </div>
        </div>
        {!collapsed && <div className="panel__body">{children}</div>}
      </div>
      {focused && <div className="panel-focus-backdrop" onClick={() => setFocused(false)} />}
    </>
  );
}
