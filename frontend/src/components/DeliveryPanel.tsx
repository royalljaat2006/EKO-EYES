import { useState } from "react";
import type { DeliveryStatus, DeliverySummary } from "../types";
import { usePagination } from "../usePagination";
import Panel from "./Panel";
import Pager from "./Pager";

const STATUS_META: Record<DeliveryStatus, { label: string; icon: string; className: string }> = {
  delivered: { label: "Delivered", icon: "✓", className: "status--delivered" },
  partial: { label: "Partial", icon: "!", className: "status--partial" },
  failed: { label: "Failed", icon: "✕", className: "status--failed" },
};

const PAGE_SIZE = 25;

interface Props {
  summary: DeliverySummary;
}

export default function DeliveryPanel({ summary }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { page, pageCount, visible, setPage } = usePagination(summary.people, PAGE_SIZE);

  if (summary.jobRunId === null) {
    return (
      <Panel title="Alert delivery">
        <p className="empty-state">
          No alert run has executed yet. Alerts are sent automatically each day, or you can
          trigger a run manually.
        </p>
      </Panel>
    );
  }

  const email = summary.byChannel.find((c) => c.channel === "email");
  const whatsapp = summary.byChannel.find((c) => c.channel === "whatsapp");

  return (
    <Panel
      title="Alert delivery"
      focusable
      subtitle={`Last run ${summary.runAt ? new Date(summary.runAt).toLocaleString() : "—"}`}
    >
      <div className="delivery-stats">
        <div className="delivery-stat">
          <span className="delivery-stat__value">{summary.peopleAlerted}</span>
          <span className="delivery-stat__label">People alerted on</span>
        </div>
        <div className="delivery-stat">
          <span className="delivery-stat__value delivery-stat__value--good">
            {summary.messagesSent}
          </span>
          <span className="delivery-stat__label">Messages sent</span>
        </div>
        <div className="delivery-stat">
          <span
            className={`delivery-stat__value${
              summary.messagesFailed > 0 ? " delivery-stat__value--bad" : ""
            }`}
          >
            {summary.messagesFailed}
          </span>
          <span className="delivery-stat__label">Messages failed</span>
        </div>
        <div className="delivery-stat">
          <span className="delivery-stat__value delivery-stat__value--small">
            {email?.sent ?? 0}/{(email?.sent ?? 0) + (email?.failed ?? 0)} email
            <br />
            {whatsapp?.sent ?? 0}/{(whatsapp?.sent ?? 0) + (whatsapp?.failed ?? 0)} WhatsApp
          </span>
          <span className="delivery-stat__label">By channel</span>
        </div>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Target Person</th>
              <th>Days</th>
              <th>Status</th>
              <th>Sent</th>
              <th>Failed</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((person) => {
              const meta = STATUS_META[person.status];
              const isOpen = expanded === person.personName;
              return [
                <tr key={person.personName}>
                  <td>{person.personName}</td>
                  <td className="num">{person.days}</td>
                  <td>
                    <span className={`status-pill ${meta.className}`}>
                      <span aria-hidden="true">{meta.icon}</span> {meta.label}
                    </span>
                  </td>
                  <td className="num">{person.sent}</td>
                  <td className="num">{person.failed}</td>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      aria-expanded={isOpen}
                      onClick={() => setExpanded(isOpen ? null : person.personName)}
                    >
                      {isOpen ? "Hide" : "Recipients"}
                    </button>
                  </td>
                </tr>,
                isOpen && (
                  <tr key={`${person.personName}-detail`} className="detail-row">
                    <td colSpan={6}>
                      <ul className="attempt-list">
                        {person.attempts.map((a, i) => (
                          <li key={i} className={a.success ? "attempt--ok" : "attempt--fail"}>
                            <span aria-hidden="true">{a.success ? "✓" : "✕"}</span>
                            <span className="attempt__role">{a.role}</span>
                            <span className="attempt__channel">{a.channel}</span>
                            <span className="attempt__recipient">{a.recipient}</span>
                            {!a.success && a.error && (
                              <span className="attempt__error">{a.error}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ),
              ];
            })}
            {summary.people.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-state">
                  The last run matched nobody over the threshold, so no alerts were sent.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager
        page={page}
        pageCount={pageCount}
        visibleCount={visible.length}
        totalCount={summary.people.length}
        onPrev={() => setPage(page - 1)}
        onNext={() => setPage(page + 1)}
      />
    </Panel>
  );
}
