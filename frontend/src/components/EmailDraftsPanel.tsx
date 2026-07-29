import { useEffect, useState } from "react";
import { fetchEmailDrafts } from "../api/client";
import type { EmailDraft } from "../types";
import { usePagination } from "../usePagination";
import Panel from "./Panel";
import Pager from "./Pager";

const PAGE_SIZE = 15;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Every email composed while "Email draft-only mode" (Settings) was on —
 * exactly what would have gone out, saved instead of sent. Nothing here was
 * ever attempted for real delivery, so these are NOT part of Alert delivery
 * or Message reach — this is purely a "does the wording look right before I
 * flip it back to live sending" check.
 */
export default function EmailDraftsPanel() {
  const [drafts, setDrafts] = useState<EmailDraft[] | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    fetchEmailDrafts()
      .then(setDrafts)
      .catch(() => setError(true));
  }, []);

  const { page, pageCount, visible, setPage } = usePagination(drafts ?? [], PAGE_SIZE);

  if (error) return null;
  if (!drafts) return null;

  return (
    <Panel
      title={
        <>
          <span aria-hidden="true">🧪</span> Email drafts
        </>
      }
      focusable
      subtitle={`Composed while draft-only mode was on — never sent · ${drafts.length} total`}
    >
      {drafts.length === 0 ? (
        <p className="empty-state empty-state--muted">
          No drafts yet. Turn on &ldquo;Email draft-only mode&rdquo; in Settings, then trigger or wait
          for a run — every email that would have gone out shows up here instead.
        </p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Role</th>
                  <th>Subject</th>
                  <th>CSPs</th>
                  <th>Composed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => {
                  const isOpen = expanded === d.id;
                  return [
                    <tr key={d.id}>
                      <td>{d.recipientName || "—"}</td>
                      <td>{d.role}</td>
                      <td>{d.subject}</td>
                      <td className="num">{d.cspCount}</td>
                      <td className="num">{formatWhen(d.createdAt)}</td>
                      <td>
                        <button
                          type="button"
                          className="link-button"
                          aria-expanded={isOpen}
                          onClick={() => setExpanded(isOpen ? null : d.id)}
                        >
                          {isOpen ? "Hide" : "Read"}
                        </button>
                      </td>
                    </tr>,
                    isOpen && (
                      <tr key={`${d.id}-detail`} className="detail-row">
                        <td colSpan={6}>
                          <div className="email-draft-preview">
                            <div className="email-draft-preview__meta">
                              <span>
                                <strong>To:</strong> {d.recipientName || d.recipient} &lt;{d.recipient}&gt;
                              </span>
                              <span>
                                <strong>Subject:</strong> {d.subject}
                              </span>
                            </div>
                            <pre className="email-draft-preview__body">{d.body}</pre>
                          </div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
          <Pager
            page={page}
            pageCount={pageCount}
            visibleCount={visible.length}
            totalCount={drafts.length}
            onPrev={() => setPage(page - 1)}
            onNext={() => setPage(page + 1)}
          />
        </>
      )}
    </Panel>
  );
}
