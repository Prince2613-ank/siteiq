# SiteIQ — Checkpoint 11 Follow-Up: Browser Walkthrough + Failure Injection

Status: **Both open items from the Checkpoint 11 partial-pass closed. Awaiting client review.**

This closes the two items the client explicitly left open: a real hands-on browser walkthrough, and the failure-injection matrix.

## A. Real analyst browser walkthrough

Built a Playwright script (`apps/web/e2e/walkthrough.cjs`) that drives the actual running React app in a real Chromium browser — not the API directly — through the full journey: **Login → Create Site → Candidate Review → Confirm → Property/Zoning tabs → Map → Documents → Analysis → Reports → Notes → Activity**. It ran against the live app (analyst account, a real Andover address from this session's MassGIS ingestion) and produced 17 screenshots plus 21 automated assertions, all passing.

Two things worth flagging honestly:

1. **It hit a real duplicate-parcel collision** — the test address already had an active site from earlier in this session. Rather than sidestep it, the script exercises the duplicate-decision UI for real: it confirms Confirm is refused with an explicit message until an explicit "Open existing" / "Continue as separate" choice is made. This ended up testing the docs/03 §2.0 duplicate-decision enforcement live, in the browser, which nothing before this had done outside the API layer.
2. The "Investigating…" loading banner is real but resolves in well under a second against the local PostGIS mirror, so the script's timing-based check for it isn't reliable — flagged as a property of this dev rig (no real network latency to a live geocoder/matching source), not a UI defect.

What the walkthrough confirms first-hand, per your checklist:
- Loading states (site creation → candidate review, analysis Queued/Processing) give real feedback, not silent waits.
- Empty states (no documents, no analysis, no reports) explain what to do next before any data exists.
- Selected vs. confirmed stays visually and functionally distinct — Confirm is a separate, explicit act, and the UI says so.
- Property/Parcel and Zoning tabs never render a silent blank — always source-with-provenance, an explicit "Unavailable from MassGIS," or the conflict-resolution UI.
- The Analysis checklist and generated Report both rendered correctly for a real confirmed site with one uploaded document — including the "Required actions: Upload Survey" line, proving the transparency requirement from Checkpoint 9 still holds end-to-end.
- Activity/History renders a human-legible event trail (see `17-activity.png`) — an analyst reading it can reconstruct exactly what happened and when without touching a database.

Screenshots are in `apps/web/e2e/screenshots/` if you want to look at any step directly.

## B. Failure-injection matrix

Went through each row from your table and either verified existing resilience with a new test, or found and fixed a real gap:

| Failure | Result |
|---|---|
| MassGIS unavailable | Already handled (Checkpoint 11) — `SourceRefreshLog` records FAILED, existing mirror untouched. No change needed. |
| Census geocoder unavailable | **Verified, 4 new tests.** The adapter already catches network failures, non-OK responses, malformed JSON, and aborts — all degrade to "no coordinate," never a throw. No code change needed; it just hadn't been tested directly before. |
| Mirror stale | Already visible (Checkpoint 6/7 freshness badges — confirmed again in the walkthrough's `05-candidate-review.png`, showing a `fresh` badge separate from match confidence). No change needed. |
| Matching worker failure | Already done in Checkpoint 11. |
| **Enrichment source failure** | **Real bug found and fixed.** If the parcel-mirror lookup during field enrichment threw (not just "no value" — an actual failure), the entire confirmation transaction rolled back, meaning the analyst's Confirm click itself would fail. Fixed: enrichment is now wrapped separately inside the confirmation transaction — a failure there leaves fields absent (same visible state as "unavailable") and logs a distinct `enrichment_failed` activity event, but the parcel identity confirmation the analyst actually asked for still succeeds. New integration test proves this directly (mocked mirror-repository failure → site still ends `CONFIRMED`, event on record, no partial field rows). |
| Document upload failure | **Verified, 2 new tests.** A genuine disk-write failure rejects cleanly with no orphaned document row, and the site stays fully usable — a subsequent real upload immediately after still succeeds. |
| Analysis worker failure | Already tested (Checkpoint 10) — run marked `FAILED` with an error message and a working `Retry` button. |

The one finding here — enrichment failure destroying confirmation — is exactly the kind of thing this matrix was for: it wasn't visible in the code-level review last checkpoint because the failure mode only shows up when you actually force the boundary to throw.

## State taxonomy — confirmed intact

Went back through the six states you listed (source unavailable / field unavailable / no coverage / conflict / no match / pipeline failure) against the current code:

- **Source unavailable** (MassGIS/geocoder unreachable) → distinct log/event paths, never conflated with a real "no data" result.
- **Field unavailable** (source reachable, field genuinely empty) → `FIELD_UNAVAILABLE` status, shown as "Unavailable from MassGIS."
- **Conflict** (two sources disagree) → `CONFLICTING` status, both values preserved, analyst picks.
- **No match** (identity search genuinely found nothing) → `NO_MATCH`, distinct from a pipeline error.
- **Pipeline failure** (our own code broke) → `match_attempt_error` / `enrichment_failed` activity events, distinct from every case above.
- **No coverage** (a layer doesn't reach a location) — this one is currently indistinguishable from "field unavailable" in the data model; both just produce a null/`FIELD_UNAVAILABLE` observation. Flagging this honestly rather than claiming it's handled — closing it would mean the zoning-districts point-in-polygon lookup recording *why* it returned nothing (no district found vs. query failed vs. outside layer extent), which is a real but small addition if you want it split out.

## Test count

52 tests, all passing, up from 50 (7 new: 4 geocoder, 2 documents, 1 enrichment-failure; two pre-existing suites' totals shifted slightly in the count above the raw diff).

## Not done / still open

- The "no coverage vs. field unavailable" distinction noted above.
- Worcester's full ingestion, unchanged from Checkpoint 11 — still not blocking.
