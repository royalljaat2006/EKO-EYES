import { useMemo, useState } from "react";
import type { InactivityRecord } from "../types";
import FilteredResultsPanel from "./FilteredResultsPanel";

interface Props {
  records: InactivityRecord[];
}

function matchesQuery(r: InactivityRecord, q: string): boolean {
  return (
    r.cspCode.toLowerCase().includes(q) ||
    r.targetPersonName.toLowerCase().includes(q) ||
    r.rmName.toLowerCase().includes(q) ||
    r.dcName.toLowerCase().includes(q) ||
    r.lhoName.toLowerCase().includes(q) ||
    r.cspMobile.toLowerCase().includes(q) ||
    r.terminalStatus.toLowerCase().includes(q) ||
    (r.rm?.email ?? "").toLowerCase().includes(q) ||
    (r.rm?.mobile ?? "").toLowerCase().includes(q) ||
    (r.dc?.email ?? "").toLowerCase().includes(q) ||
    (r.dc?.mobile ?? "").toLowerCase().includes(q)
  );
}

/**
 * One search box that reaches across the whole roster — CSP code/name,
 * RM/DC/LHO name, any mobile, any email, terminal status — regardless of
 * which day-range or LHO/RM/DC filter is currently active elsewhere on the
 * page. Results render inline right below the box as they're typed, in the
 * same style as the LHO/RM/DC results (FilteredResultsPanel) — no popup.
 */
export default function UniversalSearchBar({ records }: Props) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!q) return [];
    return records.filter((r) => matchesQuery(r, q)).sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
  }, [records, q]);

  const clear = () => setQuery("");

  return (
    <div className="universal-search">
      <div className="universal-search__bar">
        <span className="universal-search__icon" aria-hidden="true">
          &#128269;
        </span>
        <input
          type="search"
          className="universal-search__input"
          placeholder="Search any CSP code, name, RM, DC, LHO, mobile, or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Universal search across all CSPs"
        />
        {query && (
          <button
            type="button"
            className="universal-search__clear"
            onClick={clear}
            aria-label="Clear search"
          >
            &#10005;
          </button>
        )}
      </div>

      {q && (
        <FilteredResultsPanel
          title={`Search: "${query.trim()}"`}
          records={matches}
          emptyMessage="No CSPs match this search."
          onClear={clear}
        />
      )}
    </div>
  );
}
