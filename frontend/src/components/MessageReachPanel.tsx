import { useEffect, useState } from "react";
import { fetchMessageReach } from "../api/client";
import type { MessageReach, ReachedRecipient } from "../types";
import { usePagination } from "../usePagination";
import Panel from "./Panel";
import Pager from "./Pager";

type Tab = "csp" | "rm" | "dc";
const PAGE_SIZE = 15;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * "Who did the run actually reach" — a different cut of the same run
 * DeliveryPanel shows, grouped by ROLE instead of by CSP: how many CSPs got
 * a direct message, and how many DISTINCT RMs/DCs were reached (each counted
 * once no matter how many CSPs they cover — the digest fans out to one row
 * per CSP under them, see messageReach.service.ts). Drill down to see
 * exactly which CSPs sit behind any RM/DC's count.
 */
export default function MessageReachPanel() {
  const [data, setData] = useState<MessageReach | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>("csp");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetchMessageReach()
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const cspPagination = usePagination(data?.csp.people ?? [], PAGE_SIZE);
  const rmPagination = usePagination(data?.rm.entries ?? [], PAGE_SIZE);
  const dcPagination = usePagination(data?.dc.entries ?? [], PAGE_SIZE);

  if (error) return null;
  if (!data) return null;

  if (data.jobRunId === null) {
    return (
      <Panel title="Message reach">
        <p className="empty-state">
          No alert run has executed yet. Alerts are sent automatically each day, or you can trigger a run
          manually.
        </p>
      </Panel>
    );
  }

  const active = tab === "csp" ? cspPagination : tab === "rm" ? rmPagination : dcPagination;

  return (
    <Panel
      title="Message reach"
      focusable
      subtitle={`Last run ${formatWhen(data.runAt!)} — who was actually reached, by role`}
    >
      <div className="reach-stat-grid">
        <button
          type="button"
          className={`reach-stat-card${tab === "csp" ? " reach-stat-card--active" : ""}`}
          onClick={() => setTab("csp")}
        >
          <span className="reach-stat-card__icon" aria-hidden="true">
            💬
          </span>
          <span className="reach-stat-card__value">
            {data.csp.reached}
            <span className="reach-stat-card__of"> / {data.csp.attempted}</span>
          </span>
          <span className="reach-stat-card__label">CSPs messaged</span>
        </button>

        <button
          type="button"
          className={`reach-stat-card${tab === "rm" ? " reach-stat-card--active" : ""}`}
          onClick={() => setTab("rm")}
        >
          <span className="reach-stat-card__icon" aria-hidden="true">
            👤
          </span>
          <span className="reach-stat-card__value">
            {data.rm.reached}
            <span className="reach-stat-card__of"> / {data.rm.attempted}</span>
          </span>
          <span className="reach-stat-card__label">RMs reached</span>
        </button>

        <button
          type="button"
          className={`reach-stat-card${tab === "dc" ? " reach-stat-card--active" : ""}`}
          onClick={() => setTab("dc")}
        >
          <span className="reach-stat-card__icon" aria-hidden="true">
            🧑‍💼
          </span>
          <span className="reach-stat-card__value">
            {data.dc.reached}
            <span className="reach-stat-card__of"> / {data.dc.attempted}</span>
          </span>
          <span className="reach-stat-card__label">DCs reached</span>
        </button>
      </div>

      {tab === "csp" ? (
        cspPagination.visible.length === 0 ? (
          <p className="empty-state empty-state--muted">No CSPs were messaged directly on this run.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>CSP</th>
                  <th>Days</th>
                  <th>Channel</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {cspPagination.visible.map((p, i) => (
                  <tr key={`${p.personName}-${i}`}>
                    <td>{p.personName}</td>
                    <td className="num">{p.days}</td>
                    <td>{p.channel}</td>
                    <td>
                      <span className={`status-pill ${p.success ? "status--delivered" : "status--failed"}`}>
                        <span aria-hidden="true">{p.success ? "✓" : "✕"}</span> {p.success ? "Sent" : "Failed"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <RoleTable
          entries={active.visible as ReachedRecipient[]}
          expanded={expanded}
          onToggle={(contact) => setExpanded(expanded === contact ? null : contact)}
          emptyMessage={`No ${tab === "rm" ? "RMs" : "DCs"} were involved in this run.`}
        />
      )}

      <Pager
        page={active.page}
        pageCount={active.pageCount}
        visibleCount={active.visible.length}
        totalCount={tab === "csp" ? data.csp.people.length : tab === "rm" ? data.rm.entries.length : data.dc.entries.length}
        onPrev={() => active.setPage(active.page - 1)}
        onNext={() => active.setPage(active.page + 1)}
      />
    </Panel>
  );
}

function RoleTable({
  entries,
  expanded,
  onToggle,
  emptyMessage,
}: {
  entries: ReachedRecipient[];
  expanded: string | null;
  onToggle: (contact: string) => void;
  emptyMessage: string;
}) {
  if (entries.length === 0) {
    return <p className="empty-state empty-state--muted">{emptyMessage}</p>;
  }

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Contact</th>
            <th>CSPs covered</th>
            <th>Sent</th>
            <th>Failed</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {entries.map((r) => {
            const isOpen = expanded === r.contact;
            return [
              <tr key={r.contact}>
                <td>{r.name || "—"}</td>
                <td>{r.contact}</td>
                <td className="num">
                  {r.cspsCovered} / {r.cspsAttempted}
                </td>
                <td className="num">{r.sent}</td>
                <td className="num">{r.failed}</td>
                <td>
                  <button
                    type="button"
                    className="link-button"
                    aria-expanded={isOpen}
                    onClick={() => onToggle(r.contact)}
                  >
                    {isOpen ? "Hide" : "CSPs"}
                  </button>
                </td>
              </tr>,
              isOpen && (
                <tr key={`${r.contact}-detail`} className="detail-row">
                  <td colSpan={6}>
                    <ul className="attempt-list">
                      {r.csps.map((c, i) => (
                        <li key={i} className={c.success ? "attempt--ok" : "attempt--fail"}>
                          <span aria-hidden="true">{c.success ? "✓" : "✕"}</span>
                          <span className="attempt__role">{c.personName}</span>
                          <span className="attempt__channel">{c.days}d</span>
                          <span className="attempt__recipient">{c.channel}</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
