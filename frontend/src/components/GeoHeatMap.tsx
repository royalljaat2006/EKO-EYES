import { useEffect, useState } from "react";
import { fetchGeoBreakdown } from "../api/client";
import type { GeoBreakdown, GeoBucket } from "../types";
import { usePagination } from "../usePagination";
import Panel from "./Panel";
import Pager from "./Pager";

type Dimension = "states" | "districts";

const PAGE_SIZE = 20;

/**
 * A "heat map" as a ranked bar list, not a literal geographic map — no
 * reliable India state/district boundary GeoJSON is wired up, and for an
 * internal ops list, rank + magnitude communicates the same thing a colored
 * shape would. Sequential encoding: one hue (the app's existing --critical
 * red), light to dark, by inactivity rate — never a rainbow.
 */
export default function GeoHeatMap() {
  const [data, setData] = useState<GeoBreakdown | null>(null);
  const [dimension, setDimension] = useState<Dimension>("states");
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchGeoBreakdown()
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const all = data ? data[dimension] : [];
  const { page, pageCount, visible, setPage, resetPage } = usePagination(all, PAGE_SIZE);
  // Bar widths are relative to the WHOLE dimension's worst rate, not just this
  // page's — otherwise a page of comparatively mild rows would each stretch
  // to look as bad as the worst row overall.
  const maxRate = Math.max(1, ...all.map((r) => r.rate));

  // Switching State <-> District swaps to a different, differently-sized
  // list — start back at page 1 rather than clamping to whatever page number
  // happened to still exist in the new list.
  useEffect(() => {
    resetPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimension]);

  if (error) return null;
  if (!data) return null;

  return (
    <Panel
      title="Inactivity heat map"
      focusable
      subtitle={`Ranked by inactivity rate — darker = worse · ${all.length} ${dimension}`}
      headerExtra={
        <div className="chart-controls">
          <div className="chart-controls__group" role="group" aria-label="Heat map dimension">
            <button
              type="button"
              className={`chart-controls__btn${dimension === "states" ? " chart-controls__btn--active" : ""}`}
              onClick={() => setDimension("states")}
            >
              State
            </button>
            <button
              type="button"
              className={`chart-controls__btn${dimension === "districts" ? " chart-controls__btn--active" : ""}`}
              onClick={() => setDimension("districts")}
            >
              District
            </button>
          </div>
        </div>
      }
    >
      {all.length === 0 ? (
        <p className="empty-state empty-state--muted">No {dimension} data in the sheet yet.</p>
      ) : (
        <>
          <ul className="heat-list">
            {visible.map((r: GeoBucket) => {
              const intensity = r.rate / maxRate;
              return (
                <li key={r.key} className="heat-list__row">
                  <span className="heat-list__label">{r.label}</span>
                  <span className="heat-list__bar-track">
                    <span
                      className="heat-list__bar"
                      style={{
                        width: `${Math.max(2, (r.rate / maxRate) * 100)}%`,
                        background: `color-mix(in srgb, var(--critical) ${20 + intensity * 65}%, var(--row-stripe))`,
                      }}
                    />
                  </span>
                  <span className="heat-list__value">
                    {r.rate}% <span className="heat-list__value-sub">({r.inactive}/{r.total})</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <Pager
            page={page}
            pageCount={pageCount}
            visibleCount={visible.length}
            totalCount={all.length}
            onPrev={() => setPage(page - 1)}
            onNext={() => setPage(page + 1)}
          />
        </>
      )}
    </Panel>
  );
}
