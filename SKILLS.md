# SKILLS.md — Reusable Patterns & Gotchas

This is a knowledge base of the engineering patterns, conventions, and hard-won
gotchas from building **E.Y.E.S. (EKO Yield & Escalation System)**. It exists so
the next piece of work — by a human or an AI assistant — can reuse what already
works instead of rediscovering it. Read this before making structural changes.

---

## 1. Core architecture (backend)

**Pipeline shape:** ingest → tier → guardrail → notify → persist → snapshot.
Every daily run (`backend/src/jobs/dailyJob.ts`) follows this exact order:

1. `fetchRecords(true)` — force-refresh from the data source (Excel or Google
   Sheets, both normalized by `callingSheet.parser.ts` so the two sources
   produce identical `InactivityRecord[]`).
2. `detectRecoveries` — anyone who dropped out of every tier since last run.
3. `evaluateAll` — tier everyone (`escalation.service.ts`), decide who's
   actually due today based on cadence (`resendEveryDays` per tier).
4. `decideNudge` (`cspEngagement.service.ts`) — CSP-specific guardrails: dead
   terminal → route to support, not nagged; nudge cap reached → needs a human
   call, not another message; cooldown/already-replied → skip.
5. `buildDigests` / `findUnreachable` — fan out into ONE digest per recipient
   (not one message per CSP), and record RM/DC-with-no-contact as an explicit
   failure rather than silently dropping them.
6. `sendDigests` — actually send (email via SMTP/Gmail API, WhatsApp via
   Meta/Twilio/Goinfinito).
7. Persist `person_state` (drives next run's cadence) and a `kpi_snapshot` row
   (drives the dashboard's trend charts).

**Reuse this shape** for any new "evaluate the roster and act on it" job — the
separation of tiering/guardrails/sending into distinct steps is what makes each
piece independently testable and auditable.

### Fast raw refresh, slow-cadence logic

Two independent knobs, deliberately not the same:

- **`SHEET_REFRESH_CRON`** (default every 1 minute as of 2026-07-23, was 20)
  + **`SHEET_CACHE_TTL_MS`** (kept in step, default 60_000ms) — how fast the
    RAW sheet data / dashboard numbers catch up to an edit in the Calling
    Sheet. Purely a read: re-fetch, refresh the cache, log tier counts for
    monitoring. Safe to make as tight as the data source tolerates (Excel:
    a local file read; Google Sheets: comfortably under quota at 1/min).
- **`DAILY_JOB_CRON`** (noon IST, unchanged) — the only cadence that runs
  `detectRecoveries`/`evaluateAll`, writes to `recovery_log` /
  `inactivity_onset_log` / `person_state`, re-evaluates adaptive tuning, and
  sends real messages.

Don't collapse these into one interval. Running the STATE-COMPARISON logic
(recovered vs. newly-inactive, person_state writes, adaptive tuning) on the
fast cadence would let a single person flip active→inactive→active several
times in one day as the sheet gets edited back and forth, producing
duplicate onset/recovery log entries and repeatedly resetting their nudge
count — noise in exactly the tables the adaptive-tuning loop above learns
from. The anti-nagging cadence guardrail (`resendEveryDays`) also assumes
"once a day" is the unit of comparison. If a future request wants the
dashboard to feel more real-time, tighten `SHEET_REFRESH_CRON`/
`SHEET_CACHE_TTL_MS` — leave `DAILY_JOB_CRON` alone unless the request is
specifically about changing send frequency or state-comparison granularity
(a much bigger, riskier change — would need the anti-nagging guardrail and
adaptive-tuning sampling re-thought at the same time).

### Adaptive tuning — a bounded feedback loop, not self-modifying code

`backend/src/services/adaptiveTuning.service.ts` adjusts the CSP nudge cap
(`CSP_MAX_NUDGES`, normally a static env var) once per daily job run, based
on how many nudges CSPs had already received when they recovered
(`recovery_log.nudge_count_at_recovery`, captured in `dailyJob.ts` via
`getNudgeCount()` BEFORE `resetEngagement()` wipes it). If this pattern
comes up again — someone asks for "self-learning," "adaptive," or "the
system should improve itself" — reuse this shape rather than reaching for
anything that edits its own source or redeploys itself:

- **Clamp the parameter to a fixed safety range** (`MIN_CAP`/`MAX_CAP` here
  are 2–6) — it can never drift to something absurd or unsafe (e.g. 0
  nudges, or 50).
- **Move at most one step per evaluation** (`currentCap ± 1`) — no wild
  jumps from one day's data.
- **Require a minimum sample size** (`MIN_SAMPLE`) before acting at all —
  otherwise it "adjusts" to noise.
- **Log every evaluation, including no-ops**, to an audit table
  (`tuning_adjustments`) with the reasoning that produced it — never a
  silent parameter change. `getTuningReport()` / `GET /api/adaptive-tuning`
  / `AdaptiveTuningPanel.tsx` surface that history on the dashboard itself,
  same transparency principle as `DailyChangesPanel`.
- **The runtime value lives in a `tuning_state` table**, read via
  `getEffectiveMaxNudges()` — `env.CSP_MAX_NUDGES` is only the starting
  point before any tuning history exists. `cspEngagement.service.ts`'s
  `decideNudge()` calls the tuned getter, not the env var, directly.

To test this kind of loop, insert synthetic rows straight into the local
dev SQLite file and call the service function directly (or via a throwaway
`ts-node` script) — do NOT hit `POST /api/job-runs/trigger` to test it. That
endpoint runs the real send pipeline and messages actual CSPs/RMs/DCs; it
is not a dry-run and has no test mode.

### Two named audit logs, same shape

`recovery_log` (who went inactive→active) has a twin: `inactivity_onset_log`
(who went active→inactive), written by
`backend/src/services/dailyChangeLog.service.ts` and populated from
`dailyJob.ts` step 3 (`evaluated.filter(e => e.reason === "entered-tier")`).
Both are per-person, per-day, named rows — not just aggregate counts — so the
dashboard's "Today's changes" panel (`DailyChangesPanel.tsx`, backed by
`GET /api/daily-changes[?day=YYYY-MM-DD]`) can list exactly who, not just how
many. If a future job needs a third "who changed state today" feed, follow
this same pattern rather than inventing a new shape.

### The anti-nagging cadence guardrail

Every escalation tier has `resendEveryDays` (currently 1 for all tiers). A
person is only notified when they **enter** a tier or **escalate** to a higher
one, or when `resendEveryDays` has elapsed since their last notification.
**This means running the pipeline twice in one day is expected to send nothing
the second time** — that's correct behavior, not a bug. When someone says
"nothing sent," check `person_state.last_notified_at` and the job's own log
line (`Evaluated escalation tiers: flagged/notifying/suppressedByCadence`)
before assuming something's broken.

### WhatsApp template constraint (Goinfinito)

Goinfinito does **not** send free text — every message goes through ONE
approved template with 3 variables, matched by a regex on this exact shape:

```
Hello {{1}}, we noticed your CSP terminal ({{2}}) has not been used for {{3}} days
```

A message that doesn't match this shape silently falls back to empty
`{{2}}`/`{{3}}` — the API **accepts it and returns a message ID** (so it logs
as "sent"), but Meta **drops it silently**. `success: true` only means "the
gateway accepted it," never "it was delivered." Any new WhatsApp-sending code
path MUST either conform to this exact template shape, or get a new template
approved first. This is why RM/DC WhatsApp is "one message per CSP" instead of
one aggregate digest — an aggregate summary can't fit the single-CSP template.

---

## 2. Data model patterns (shared frontend/backend)

### The two filter "shapes"

- **`RangeOption`** (`3-7 | 7-15 | 15-30 | 30-60 | 60-90 | 90+`) — discrete,
  non-overlapping day buckets, `[min, max)`. Defined once in
  `backend/src/config/inactivityRanges.ts` and mirrored in
  `frontend/src/rangeOptions.ts`. `RangeFilter` extends it with `"all"` (union
  of every bucket).
- **`Status`** (`inactive | at-risk | healthy | unknown`) — a coarser, 4-way
  bucket used for chart/status coloring (`frontend/src/statusOptions.ts`).
  Different axis from `RangeOption` — don't conflate the two.
- **`Tier`** (`self | breach | escalated | critical`) — the REAL escalation
  ladder, `[min, max]` INCLUSIVE both ends (unlike `RangeOption`'s exclusive
  max) — self 3-7, breach 8-15, escalated 16-23, critical 24+. Backend source
  of truth: `backend/src/config/escalation.ts`. Mirrored on the frontend in
  `frontend/src/tierOptions.ts` (same duplication pattern as `RangeOption`)
  purely so the dashboard's tier-strip clicks can filter client-side without
  a round-trip. Three different taxonomies over the same `days` number —
  don't assume any two of them share boundaries.
- **Two dashboard-display variants of "is this CSP in bucket X," both live in
  `rangeOptions.ts`**: `inRangeFilter` (pure — unmeasurable/`days === null`
  never matches anything) and `inRangeFilterFolded` (unmeasurable folds into
  `"90+"`/`"all"`). The folded variant is DASHBOARD DISPLAY ONLY — the real
  alerting pipeline always uses the pure one and still correctly refuses to
  guess a day count before nudging anyone. Don't let the folded variant leak
  into anything that decides who gets a message.
- **`isIgnoredBucket`** (also `rangeOptions.ts`) goes one step further: the
  90+ bucket (real or unmeasurable) is excluded from the "Inactive" headline
  under `"all"` specifically, because nobody is actively working those CSPs —
  they still count toward `totalCount` (Total CSPs), and clicking the 90+
  chip directly still reveals them (App.tsx's `visibleRecords` only applies
  this extra filter when `range === "all"`). Same display-only scope as
  `inRangeFilterFolded` — doesn't touch the alerting pipeline or
  `AllCspsTable`'s independent controls.

### Keep frontend/backend enums mirrored, not imported

`RangeOption`/`RANGE_BOUNDS`/`inRange` are duplicated (not shared via a
monorepo package) between `backend/src/config/inactivityRanges.ts` and
`frontend/src/rangeOptions.ts`. If you add a bucket or change a boundary,
**update both files** — there's no build-time check that they stay in sync.

### "All" combined with per-bucket trend data

When a UI needs a chart to react to `range` including the `"all"` value, and
the backend stores **per-bbucket** daily snapshots (`kpi_snapshot.range_counts`
as JSON), compute the "all" series by **summing all buckets for that day**
(see `sumRangeCounts` in `kpi.service.ts`) rather than adding a separate
stored column. Skip a day entirely if any bucket is missing from that day's
stored JSON — never fabricate a partial sum.

### Never fake missing history as zero

Every trend chart in this project (`kpi.rangeTrend`, the daily-change chart)
follows the same rule: a day with no recorded data for that metric is
**omitted from the series**, not shown as `0`. A UI reading "0" would look
like a real, alarming drop; omission correctly reads as "no data yet." Do this
for any future time-series addition too — it's cheap and prevents a
particularly nasty class of "why does the graph show it dropped to zero"
confusion.

---

## 3. Frontend UI patterns

### Inline results, not popups

Every "pick a filter → see matching CSPs" flow in this dashboard renders
results **inline in the normal page flow** (a `.panel`, same visual language
as every other dashboard section), never a `.modal-overlay`. This was an
explicit, twice-repeated user requirement. The one legitimate exception is
`TriggerRunButton`'s confirm dialog — a real yes/no confirmation before an
irreversible action (sending real alerts) is what modals are *for*; a filtered
data view is not. When adding a new "show me X" feature, default to inline;
only reach for a modal if it's genuinely a blocking confirmation.

### Shared rendering, not copy-paste

`FilteredResultsPanel.tsx` is the single "status chart + CSP table" renderer.
It takes an already-filtered `records[]` and a `title` and renders — it never
computes its own filter. As of the unification below, its one caller is
`App.tsx`'s single `cardDetail` state (set by clicking any top card/chip); if
a new "show me a filtered slice of the roster" feature is needed, make it
produce a `records[]` and either feed `cardDetail` or reuse this component
directly — don't write a second copy of the chart+table JSX.

### ONE unified filter, not several independent ones (important — this reversed an earlier version of this file)

Early on, LHO/RM/DC and the universal search bar each had their OWN "you
picked something → here's a separate results panel with its own count and
chart" flow (`EntityResultsPanel.tsx` existed for this). **That was
explicitly reversed** — the user's framing: "don't create a separate number
display set anywhere, just reflect the data in the top numbers section," and
"the graph section also changes with the filter applied, don't make a
separate section." `EntityResultsPanel.tsx` is deleted;
`UniversalSearchBar.tsx` is now a pure controlled input.

The correct shape: **range + LHO/RM/DC + search all combine (AND) into ONE
filtered record set**, computed once in `App.tsx`
(`denominatorRecords`/`visibleRecords`), which is the ONLY thing that drives
the top stat cards, the KPI %, the Trends graph, and the main table/chart. No
UI element gets to show its own independently-filtered number — if it shows a
count, that count comes from the one shared computation. Clicking a card is
NOT a second filter mechanism — it just opens `FilteredResultsPanel` with
whatever `visibleRecords`/tier-slice that specific card already represents.

Interaction model per control still varies, deliberately:
- **Combine-then-apply** (LHO/RM/DC dropdowns): nothing filters until "View
  results," since they're meant to be combined with AND before you see
  anything — live-filtering on the first dropdown would show a misleading
  intermediate result. Applying just updates the SAME shared filter state.
- **Live-as-you-type** (search, day-range chips, card clicks): instant,
  because there's no combination step for a single input/choice.

If you add a FOURTH filter dimension later, it goes through the same
pattern: lift its value to `App.tsx`, fold it into
`denominatorRecords`/`visibleRecords`, do not give it its own display.

### Consolidated filter menu

`FilterMenu.tsx` is a single click-to-open dropdown (closes on outside click
or Escape) that now hosts BOTH the day-range chips and the LHO/RM/DC picker —
they used to be scattered across the header. When adding a new *filter
control* (not a results display), put it inside this menu's panel rather than
adding another standalone header element, to keep the header from re-sprawling.

### Absolute vs. relative asset paths under a reverse-proxy prefix

The production deployment serves this app at a **path prefix**
(`https://<host>/inactive/`, via nginx `proxy_pass` with prefix-stripping).
Any asset referenced with a **leading-slash absolute path**
(`<img src="/eko-logo.svg">`) resolves against the **domain root**, not the
app's own prefix — it 404s in production while working fine in local dev
(where the app IS served from root). The nginx config's `sub_filter` trick
only rewrites **literal static HTML text** (`href="/`, `src="/` as they appear
in `index.html` or in inline `<script>`/`<style>` responses) — it does **not**
touch strings baked into the compiled JS bundle that React uses to set `src`
at runtime, because those appear as `src:"/eko-logo.svg"` (a JS object
property, no `="`) rather than the HTML attribute pattern the rewrite expects.
**Fix / rule going forward: always reference `public/` assets with a relative
path** (`"eko-logo.svg"`, no leading slash) in any JSX that sets `src`/`href`
dynamically. Static tags Vite itself emits into `index.html`
(`<script src="/assets/...">`) are fine either way since those DO get rewritten.

---

## 4. Deployment

**Target:** a systemd service (`inactive-alert.service`) behind nginx at a
`/inactive/` path prefix, on a shared rack server (also hosts an unrelated
`whatsapp-claw.service` — never touch that block when editing nginx/systemd
config).

**How:** `tools/run_deploy.py` (gitignored — see §5) does the whole
cycle: tars the repo (excluding `node_modules`/`dist`/`.git`/`.sqlite*`),
SCPs it over, extracts, rewrites `.env` PORT/SERVER_BASE_URL, runs
`npm install && npm run build` for both `backend/` and `frontend/` **on the
server itself** (not locally-built and copied), reinstalls the systemd unit +
nginx snippet, and restarts both services.

**Before every deploy:**
1. `npx tsc --noEmit` (both `backend/` and `frontend/`, from their own dirs)
2. `npm run build` locally too, as a pre-flight — catches issues before
   spending a round-trip to the server
3. Actually drive the change (Playwright or curl) against the **local** dev
   server first, then again against the **live** URL after deploying — a
   local pass doesn't guarantee the `/inactive/` prefix quirk (§3) won't bite
   you in prod.

**After every deploy:** the script prints `systemctl status` for both
services — confirm `Active: active (running)`, not just that the script
exited 0.

---

## 5. Git / GitHub

**Repo:** `https://github.com/royalljaat2006/EKO-EYES` (private).

**Never commit:** `backend/.env`, `backend/secrets/*.json` (Google service
account key), `backend/data/*.xlsx`/`*.sqlite*` (real CSP/RM/DC PII), or any
of the one-off debugging scripts in `tools/` that have the production
SSH/sudo password hardcoded (`tools/run_deploy.py`, `tools/curl_local.py`,
`tools/inspect_recon_conf.py`, `tools/read_claw_snippet.py`, `tools/read_inactive_logs.py`,
`tools/read_nginx_recon.py`) — all covered by `.gitignore` already; don't remove
those entries. If you add a NEW script that talks to the rack server, assume
it'll need credentials and gitignore it preemptively rather than after the fact.

**The rebase `--ours`/`--theirs` trap:** during `git rebase`, `--ours` means
the branch you're rebasing **onto** (upstream), and `--theirs` means the
commit being replayed (yours) — this is the **opposite** of what `--ours`/
`--theirs` mean during a normal `git merge`. Getting this backwards on a
conflict silently keeps the wrong side. If you hit a conflict during
`git pull --rebase`, either resolve it by hand (edit the file, remove
conflict markers, `git add`) or double-check which commit you actually want
before using `--ours`/`--theirs` as a shortcut. (This exact mistake wiped
README.md down to GitHub's one-line placeholder during this project's first
push — recovered from `git reflog` / the original commit object.)

---

## 6. Verification habits worth keeping

- **Typecheck before build, build before deploy, drive before declaring done.**
  `npx tsc --noEmit` catches most mistakes for free; a Playwright pass (or a
  targeted `curl` against the API) catches the rest — logic that typechecks
  can still be behaviorally wrong (e.g. a filter that "compiles" but always
  returns zero results).
- **Cross-check suspicious numbers against a second source.** When a count
  looked coincidentally identical across two different filters (an LHO+RM
  combo returning the same total as the LHO alone), it was verified directly
  against `/api/csps` before trusting it — turned out to be correct (that LHO
  genuinely has only one RM), not a bug. Don't assume — check.
- **When something "didn't send," check the log line before touching code.**
  `dailyJob.ts` logs `flagged`/`notifying`/`suppressedByCadence` on every run;
  in practice this has been the guardrail working as designed far more often
  than an actual defect.
- **Dev servers on this machine go stale silently across session breaks.** A
  background task can report "stopped" while the underlying process is still
  actually alive and serving (or vice versa) — always `curl` the health
  endpoint to check reality before trusting a task-status notification.
