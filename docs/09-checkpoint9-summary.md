# SiteIQ — Checkpoint 9: Analysis & Development Feasibility

Status: **Running code, transparent investigation summary wired end-to-end against real data. Awaiting client review.**

## What was built

A real background-job analysis pipeline (`AnalysisRun`, queued/processed exactly like property matching — same `Queued → Processing → Completed/Failed` architecture, same worker process) that computes a **structured, transparent investigation summary** — deliberately not a single opaque score, per your explicit instruction.

Two things didn't exist at all before this checkpoint and were built to make the summary honest rather than partial:

1. **Real documents** — `Document.category` (additive migration) + actual file upload/download/delete, stored on local disk (a documented stand-in for the S3 design in docs/01 §10 — no AWS credentials in this dev environment; the storage boundary is shaped so swapping in real S3 later touches one file, nothing in the API contract or frontend).
2. **The Analysis queue itself** — `AnalysisController`/`AnalysisService`, wired into the same BullMQ worker as matching, computing the summary from real `Site`, `SiteDataField`, and `Document` rows at run time.

## The summary format — exactly as specified

```
Property Identity          Property Data              Documents
✓ Confirmed                ✓ Lot size: 30,056 sq ft   ✓ Site Plan on file
  Parcel: F_754...          ⚠ Zoning: unavailable       ⚠ Survey missing
  Confidence: 100%
                            Investigation
Conflicts                  ⚠ INCOMPLETE
✓ No unresolved conflicts
                            Required actions:
                            1. Zoning unavailable from automated sources — investigate manually
                            2. Upload Survey
```

Rendered in the UI (`SiteDetails.tsx`'s Analysis tab) as literal checkboxes/warnings per section — identity, property data, source quality, conflicts, documents, investigation status, required actions — not a score.

## Acceptance test — all three cases, live and automated

| Case | Result |
|---|---|
| **A — normal** | Real Andover parcel (`181 High Street`), confirmed, real `lot_size: 30,056 sq ft`, a real Site Plan document uploaded live during this test → analysis correctly dropped "Upload Site Plan" from required actions after the upload, kept "Upload Survey" (genuinely still missing) |
| **B — preliminary** | Analysis run on a `NEEDS_REVIEW` site → `isPreliminary: true`, permanently — confirmed via an integration test that the flag doesn't flip even after the site is later confirmed (matches the rule established back in Checkpoint 5/7) |
| **C — incomplete/conflicting** | Integration test: a genuinely `CONFLICTING` zoning field and a completely-unattempted `lot_size` field both surface correctly — `conflictingFields`/`missingFields` populated, `propertyData` entry for zoning shows `value: null` (never picks a side), required actions list both issues by name |

Plus a fourth test proving a **failed** analysis run is marked `FAILED` with a real error message rather than left stuck at `PROCESSING` or throwing uncaught. **39 automated tests total, all passing** (35 from prior checkpoints + 4 new for analysis).

## A real interesting case surfaced during live testing

Running analysis on the Andover site that had been through the Checkpoint 7 re-match-conflict test produced `identity.status: NEEDS_REVIEW` alongside `confirmedBy`/`confirmedAt` still populated from its earlier (now-superseded) confirmation — an accurate reflection of a site that *was* confirmed, then hit a re-match conflict, and hasn't been re-confirmed since. The summary didn't hide this or pretend the old confirmation still holds; "Confirm the property identity" correctly appears in required actions. Not a constructed test case — this came from the app's actual accumulated state during this session's testing.

## Carried-forward items — deliberately not done this checkpoint

- **Field-status vocabulary refinement** (source unavailable vs. field unavailable vs. no coverage vs. conflict) — you asked for this in the *next* work, not this checkpoint. Not touched; `FIELD_UNAVAILABLE`/`CONFLICTING` remain the only statuses in play, as before.
- **Worcester ingestion** — attempted twice more this session, interrupted both times by process restarts needed for other schema/code changes (an operational annoyance worth fixing before this becomes a real habit, not a data problem). Real Worcester coverage remains not yet loaded; Andover continues to be the acceptance/dev fixture, as you directed. Happy to run it uninterrupted in a dedicated session whenever useful.
- **Field prioritization beyond lot size/zoning/use code** — not expanded; owner/assessed-value/year-built etc. remain unadded pending your prioritization input, as agreed.
- **No AI-generated recommendation** — correctly absent. The analysis is entirely rule-based aggregation of real data; nothing here infers a development recommendation.

## How to try it yourself

Site Details → Documents tab (upload a file, pick a category) → Analysis tab → **Run Analysis** → watch it go Queued → Processing → Completed live, then read the checklist.
