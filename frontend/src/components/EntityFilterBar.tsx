import { useMemo, useState } from "react";
import type { InactivityRecord } from "../types";

export type EntityType = "LHO" | "RM" | "DC";

export interface EntityOption {
  /** Case-insensitive dedupe key. */
  key: string;
  /** Original casing, as it first appeared in the sheet. */
  label: string;
}

/** The applied combination — whichever of the three were picked when "View results" was clicked. */
export interface EntityCriteria {
  lho: EntityOption | null;
  rm: EntityOption | null;
  dc: EntityOption | null;
}

export const PICK: Record<EntityType, (r: InactivityRecord) => string> = {
  LHO: (r) => r.lhoName,
  RM: (r) => r.rmName,
  DC: (r) => r.dcName,
};

/**
 * Unique options for a dropdown, deduped case-insensitively — the source sheet
 * has the same LHO spelled with different casing in places (e.g. "Maharashtra"
 * vs "maharashtra"), which would otherwise split one region into two entries.
 */
function optionsFor(records: InactivityRecord[], type: EntityType): EntityOption[] {
  const byKey = new Map<string, EntityOption>();
  for (const r of records) {
    const label = PICK[type](r).trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, { key, label });
  }
  return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label));
}

interface Props {
  records: InactivityRecord[];
  /** Fires when "View results" is pressed — the results themselves render elsewhere, on the page. */
  onApply: (criteria: EntityCriteria) => void;
  onClear: () => void;
}

/**
 * LHO, RM, and DC are picked together — nothing filters until "View results"
 * is pressed, so all three (or just one or two) can be set before applying.
 * Whichever are set combine with AND: an LHO + a DC picked together shows only
 * CSPs matching BOTH, not either. This component is just the picker; the
 * result of applying it is rendered inline on the page by EntityResultsPanel,
 * not in a popup.
 */
export default function EntityFilterBar({ records, onApply, onClear }: Props) {
  const [lhoKey, setLhoKey] = useState("");
  const [rmKey, setRmKey] = useState("");
  const [dcKey, setDcKey] = useState("");

  const lhoOptions = useMemo(() => optionsFor(records, "LHO"), [records]);
  const rmOptions = useMemo(() => optionsFor(records, "RM"), [records]);
  const dcOptions = useMemo(() => optionsFor(records, "DC"), [records]);

  const anySelected = Boolean(lhoKey || rmKey || dcKey);

  const clearAll = () => {
    setLhoKey("");
    setRmKey("");
    setDcKey("");
    onClear();
  };

  const apply = () => {
    if (!anySelected) return;
    onApply({
      lho: lhoOptions.find((o) => o.key === lhoKey) ?? null,
      rm: rmOptions.find((o) => o.key === rmKey) ?? null,
      dc: dcOptions.find((o) => o.key === dcKey) ?? null,
    });
  };

  return (
    <div className="entity-filter-bar" role="group" aria-label="Filter CSPs by LHO, RM, and DC together">
      <label className="entity-filter">
        <span className="entity-filter__label">LHO</span>
        <select value={lhoKey} onChange={(e) => setLhoKey(e.target.value)} aria-label="LHO">
          <option value="">Select an LHO&hellip; ({lhoOptions.length})</option>
          {lhoOptions.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="entity-filter">
        <span className="entity-filter__label">RM</span>
        <select value={rmKey} onChange={(e) => setRmKey(e.target.value)} aria-label="RM">
          <option value="">Select a RM&hellip; ({rmOptions.length})</option>
          {rmOptions.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="entity-filter">
        <span className="entity-filter__label">DC</span>
        <select value={dcKey} onChange={(e) => setDcKey(e.target.value)} aria-label="DC">
          <option value="">Select a DC&hellip; ({dcOptions.length})</option>
          {dcOptions.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className="entity-filter__actions">
        <button
          type="button"
          className="trigger-button trigger-button--confirm"
          disabled={!anySelected}
          onClick={apply}
        >
          View results
        </button>
        {anySelected && (
          <button type="button" className="entity-filter__clear" onClick={clearAll}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
