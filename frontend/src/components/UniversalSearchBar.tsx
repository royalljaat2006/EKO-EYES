import type { InactivityRecord } from "../types";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function matchesQuery(r: InactivityRecord, q: string): boolean {
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
 * RM/DC/LHO name, any mobile, any email, terminal status. Purely an input:
 * the query lives in App.tsx and combines with the day-range and LHO/RM/DC
 * filters to determine what the TOP cards/graph show — this component no
 * longer renders its own results panel, so there's only ever one place on
 * the page showing "what's currently filtered."
 */
export default function UniversalSearchBar({ value, onChange }: Props) {
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
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Universal search across all CSPs"
        />
        {value && (
          <button
            type="button"
            className="universal-search__clear"
            onClick={() => onChange("")}
            aria-label="Clear search"
          >
            &#10005;
          </button>
        )}
      </div>
    </div>
  );
}
