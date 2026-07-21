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
  of every bucket, i.e. every flagged CSP — NOT literally every CSP; healthy/
  unmeasurable rows are never included).
- **`Status`** (`inactive | at-risk | healthy | unknown`) — a coarser, 4-way
  bucket used for chart/status coloring (`frontend/src/statusOptions.ts`).
  Different axis from `RangeOption` — don't conflate the two.

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

`FilteredResultsPanel.tsx` is the single "status chart + CSP table" renderer,
used by both the LHO/RM/DC combo filter (`EntityResultsPanel.tsx`) and the
universal search bar (`UniversalSearchBar.tsx`). Neither of those two compute
their own chart/table markup — they compute a filtered `records[]` and hand it
to `FilteredResultsPanel`. If a third "show me a filtered slice of the roster"
feature is needed, make it produce a `records[]` and reuse this component
rather than writing a fourth copy of the chart+table JSX.

### Two different filter interaction models, on purpose

- **Combine-then-apply** (LHO/RM/DC): nothing filters until "View results" is
  pressed, because the three dropdowns are meant to be combined with AND
  before you see anything. Premature live-filtering on the first dropdown
  would show a misleading intermediate result.
- **Live-as-you-type** (universal search, the day-range chips): a single
  input/choice with no combination step, so instant feedback is correct and
  expected.

Pick the model based on whether the control **combines with other controls**
before producing a meaningful result, not out of habit.

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

**How:** `run_deploy.py` (repo root, gitignored — see §5) does the whole
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
of the one-off debugging scripts in the repo root that have the production
SSH/sudo password hardcoded (`run_deploy.py`, `curl_local.py`,
`inspect_recon_conf.py`, `read_claw_snippet.py`, `read_inactive_logs.py`,
`read_nginx_recon.py`) — all covered by `.gitignore` already; don't remove
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
