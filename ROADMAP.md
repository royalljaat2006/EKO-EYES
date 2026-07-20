# Eko Dekho — Proposed Changes & Add-ons

Status: **proposal only — nothing here is implemented.**
Written 2026-07-15, against the system as it stands today.

Ordered by leverage: P0 items block the agent from working at all; P1 items make it
genuinely autonomous; P2 items are what actually move inactivity toward the 2% target.

---

## P0 — Blockers (the agent cannot send a single alert today)

| # | Change | Why it matters | Effort |
|---|--------|----------------|--------|
| 0.1 | **Fill in RM/DC contacts** (`backend/data/RM_DC_Contacts.xlsx`) | The Calling Sheet has RM/DC *names only* — no emails or mobiles exist anywhere in the workbook. Without this, every alert has nobody to send to. 18 rows of typing. | Manual (yours) |
| 0.2 | **Real SMTP + WhatsApp credentials** in `.env` | Currently placeholders. Nothing has ever actually been dispatched. | 30 min |
| 0.3 | **Assign the "TBA" District Coordinator** | One DC is literally named `TBA`. Those CSPs can never be alerted until a real person is assigned. | Manual (yours) |

> **Nothing below matters until P0 is done.** A more sophisticated agent that still
> can't send an email is not more useful.

---

## P1 — Automation gaps (things a human still has to do by hand)

### 1.1 Live data source — kill the manual file copy
**The problem:** someone must manually drop `Calling Sheet.xlsx` into `backend/data/`.
If they forget, the agent runs on **yesterday's data and reports stale numbers with
total confidence** — worse than failing, because nobody notices.

**Options, best first:**
- **(a) Read the Google Sheet live.** If the Calling Sheet lives in Drive (the file
  is named "Copy of…", which suggests it does), the agent pulls it every morning with
  zero human involvement. The `DATA_SOURCE=google` code path already exists — it needs
  the real sheet's column mapping.
- **(b) Watch a shared folder / SharePoint / OneDrive path.** Whoever exports the sheet
  saves it there; the agent picks up new files automatically.
- **(c) Email-attachment ingestion.** Sheet gets mailed to a dedicated inbox; agent reads it.

**Decision needed from you:** is the Google Sheet the system of record, or is Excel?
That answer picks (a) vs (b).

### 1.2 Staleness guard — do this regardless of 1.1
If the source file's modified date is older than ~24h, the agent should **refuse to run
and shout**, rather than quietly alerting on stale data. Cheap, and it closes the single
most dangerous silent-failure mode.

### 1.3 Retries + dead-letter queue
Today a transient SMTP 503 or WhatsApp 429 is logged as "failed" and **forgotten — that
person never gets their alert**. Needs:
- Exponential backoff retry (3 attempts) on transient failures
- A **dead-letter list** of messages that exhausted retries, surfaced on the dashboard
- Distinguish *transient* (retry) from *permanent* (bad address — escalate to a human)

### 1.4 Job heartbeat — who watches the watcher?
If the server crashes at 3am, **no alerts go out and nobody finds out.** Needs:
- A heartbeat record on every successful run
- If no successful run in 25 hours → email the admin
- Consider moving the schedule out-of-process (Windows Task Scheduler / cron calling
  `npm run job:run-once`) so a crashed web server doesn't silently kill alerting

### 1.5 Layout-change resilience
The Excel adapter reads columns **by position** (it must — "Calling Status" appears 13
times, so name-matching would grab the wrong column). It throws loudly if the layout
shifts, which is correct — but that error should **notify the admin**, not just sit in a log.

---

## P2 — Closing the loop (this is what actually reaches 2%)

Today the agent **broadcasts**. It has no idea whether anyone acted. That is the ceiling
on how much it can help.

### 2.1 Acknowledgement + auto-escalation  ⭐ highest-leverage item on this list
- Every alert carries an **"I've actioned this"** link
- RM clicks it, picks a reason (CSP contacted / terminal issue / CSP shifted / unreachable)
- **No acknowledgement within 24h → auto-escalate a rung**
- Converts a notification into an **accountability record**. This is the strongest
  remaining lever, because it changes RM *behaviour* rather than just informing them.

### 2.2 Two-way WhatsApp (reply capture)
RM replies "done" or "CSP shifted" in WhatsApp; a webhook captures it automatically.
No dashboard visit required — meets people where they already are.

### 2.3 Recovery feedback ("nice work")
Recoveries are already *detected* but nobody is *told*. When a CSP comes back active,
message the RM: "Kavita is active again — nice work." Positive feedback is what keeps
people reading the alerts instead of filtering them.

### 2.4 RM leaderboard / weekly leadership digest
Auto-emailed weekly: inactivity rate by RM, recovery rate by RM, trend vs 2% target.
What gets measured gets managed — and it makes the escalation rungs real.

---

## P3 — Data quality (the agent should police its own inputs)

### 3.1 Resolve the 63 "No transaction data" rows  ⚠ decision needed
Currently treated as **unknown** — excluded from the rate denominator, surfaced as its
own tile. **You have not yet told me what they actually mean.** They could be your worst
cases (never onboarded, terminal dead) or genuinely irrelevant. Counting them as healthy
would report 4.93% instead of 5.54% — flattering, and false.
**This is a business decision, not a code decision.**

### 3.2 Auto-flag corrupt CSP mobiles
14 mobile numbers are corrupt in the source (20–30 digits, e.g.
`+708059155185280679238707427390`) and 34 are blank. Excel mangled them; the originals
are **not recoverable from the file**. The agent should flag these for correction at
source rather than silently carrying junk.

### 3.3 Contacts sync from a directory
Instead of a hand-maintained xlsx, sync RM/DC contacts from HR / Active Directory /
Google Workspace, so leavers and joiners are handled automatically.

### 3.4 Unassigned-CSP detection
Flag any CSP with no RM or no DC — they are structurally un-alertable and will quietly
rot forever.

---

## P4 — Operational hardening

| # | Change | Why |
|---|--------|-----|
| 4.1 | **Dashboard authentication** | It currently has none. It exposes names, mobiles, and performance data for 568 people. Do not put this on a public URL as-is. |
| 4.2 | **Quiet hours / send window** | Don't fire WhatsApp at 3am. Respect working hours. |
| 4.3 | **Rate limiting** | Meta and Twilio both throttle. A burst of 100+ messages needs pacing. |
| 4.4 | **Dry-run mode** | `DRY_RUN=true` renders every message and logs recipients without sending — essential for testing against real data without spamming real people. |
| 4.5 | **Structured audit export** | CSV/Excel export of the alert log for compliance and for RM one-on-ones. |
| 4.6 | **Timezone correctness** | Cron is `Asia/Kolkata`; confirm the source sheet's "days" are computed in the same timezone, or counts drift by one at the boundary. |

---

## P5 — Dashboard add-ons

- **Drill-down by RM** — click a bar, see that RM's CSPs
- **Backlog burn-down chart** — the 20 critical CSPs are the whole game; chart them going to zero
- **Ageing buckets** — how long has each CSP been inactive *continuously*
- **Export current view** to Excel
- **Mobile-friendly layout** — RMs will read this on a phone, not a desktop

---

## Suggested sequence

1. **P0** — unblock sending (yours: contacts, credentials, TBA)
2. **1.4 + 1.3** — heartbeat and retries (self-contained, protects everything else)
3. **1.2** — staleness guard (cheap, kills the worst silent failure)
4. **1.1** — live data source (needs your Google-vs-Excel decision)
5. **2.1** — acknowledgement loop (the big behavioural lever)
6. **4.1 + 4.4** — auth and dry-run, before this touches real people at scale
7. Everything else

---

## Open questions for you

1. **Is the Calling Sheet a Google Sheet, or is Excel the system of record?** (decides 1.1)
2. **What does "No transaction data" actually mean?** (decides 3.1 — and it moves your headline number)
3. **Who are the Manager and Leadership escalation contacts?** The ladder's top two rungs
   are currently empty, which means escalation has no teeth.
4. **Will this dashboard be exposed beyond your machine?** If yes, 4.1 (auth) becomes P0.
