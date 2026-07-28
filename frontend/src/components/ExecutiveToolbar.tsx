interface Props {
  healthyCount: number;
  rmCount: number;
  nonResponsiveCount: number;
  lastRefreshed: string;
  onHealthyClick: () => void;
  onRmClick: () => void;
  onNonResponsiveClick: () => void;
  /** Pre-composed, real facts — see App.tsx for how each is computed. */
  tickerItems: string[];
}

/**
 * Consolidates the top stat tiles into one dense executive-style bar, plus a
 * live ticker banner of real daily facts underneath (not a marquee — a
 * simple wrapped row; scrolling text is an accessibility anti-pattern for
 * something this information-dense).
 */
export default function ExecutiveToolbar({
  healthyCount,
  rmCount,
  nonResponsiveCount,
  lastRefreshed,
  onHealthyClick,
  onRmClick,
  onNonResponsiveClick,
  tickerItems,
}: Props) {
  return (
    <div className="exec-toolbar">
      <div className="exec-toolbar__stats">
        <button type="button" className="exec-stat" onClick={onHealthyClick}>
          <span className="exec-stat__value">{healthyCount}</span>
          <span className="exec-stat__label">Healthy CSPs</span>
        </button>
        <button type="button" className="exec-stat" onClick={onRmClick}>
          <span className="exec-stat__value">{rmCount}</span>
          <span className="exec-stat__label">RMs affected</span>
        </button>
        <button type="button" className="exec-stat exec-stat--warn" onClick={onNonResponsiveClick}>
          <span className="exec-stat__value">{nonResponsiveCount}</span>
          <span className="exec-stat__label">Non-Responsive</span>
        </button>
        <div className="exec-stat exec-stat--muted">
          <span className="exec-stat__value exec-stat__value--small">{lastRefreshed}</span>
          <span className="exec-stat__label">Last refreshed</span>
        </div>
      </div>

      {tickerItems.length > 0 && (
        <div className="exec-ticker" role="status">
          <span aria-hidden="true">⚡</span>
          <span className="exec-ticker__items">{tickerItems.join("  ·  ")}</span>
        </div>
      )}
    </div>
  );
}
