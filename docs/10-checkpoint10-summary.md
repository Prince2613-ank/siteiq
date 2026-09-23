# SiteIQ — Checkpoint 10: Reports + Complete Investigation Output

Status: **Running code, immutable report snapshots verified live and by automated test. Awaiting client review.**

## What was built

A `Report` is generated on demand (`POST /sites/:id/reports`) and captures a **complete, permanent snapshot** of everything the client asked for: property identity (original input, matched address, parcel, confidence, who/when confirmed), property data with full provenance (value/source/retrieved-date/status per field), investigation quality (missing/conflicting fields, sources used, staleness), documents (metadata only — name/category/uploader/date), the analysis checklist (complete/incomplete + required actions, and which `AnalysisRun` it's based on if any), and a curated audit trail (parcel confirmations, re-match conflicts, field conflicts/resolutions, document additions — not a raw log dump).

## Immutability — structural, not a convention

`ReportsService` has **no update method** anywhere in the codebase. `generate()` writes `Report.contentSnapshot` once; every read (`getOne`, `listForSite`) returns exactly that stored JSON, never re-joins live `Site`/`SiteDataField`/`Document` data. There is no code path that could make an old report drift.

**Live proof, not just a test assertion:** generated a report on a real Andover site (1 document on file), then uploaded a real second document (`survey.pdf`) through the actual API, then re-fetched the *original* report by ID — it still showed exactly 1 document. Generating a *new* report afterward correctly showed 2 documents and updated required actions. Same mechanism the client's September 7 / September 10 example describes, run against real data during this session.

## Shared computation, not duplicated logic

The identity/property-data/data-quality computation used to live only inside `AnalysisService`. It's now `InvestigationDataService`, used by both `AnalysisService` (recomputes fresh on every run, mutable `AnalysisRun.result`) and `ReportsService` (computed once, frozen forever into `Report.contentSnapshot`). One source of truth for "what do we currently know about this site" — Analysis and Reports differ only in whether the result gets saved as a live/mutable state or a permanent/immutable one.

## Acceptance test — all four required cases, automated and passing

| Case | Result |
|---|---|
| A — normal report | Confirmed site, real `lot_size`, one document → report correctly shows all current information |
| B — immutability | Report generated → a field's current value changed afterward (superseded, new observation marked current) → re-fetched old report still shows the original value → a newly generated report correctly shows the new one |
| C — preliminary | Report generated on a `NEEDS_REVIEW` site → `isPreliminary: true` → site confirmed afterward → re-fetched report stays `isPreliminary: true` (never flips) |
| D — incomplete/conflicting | Two sources disagree on zoning, no documents uploaded → report's `analysis.complete = false`, conflicting field shown with `value: null` (never resolved automatically), required actions list every real gap by name |

## PDF export — deliberately not built yet

Per your explicit instruction, correctness of the snapshot and UI came first. `Report.storageKey` (for a rendered PDF) exists in the schema from Checkpoint 3 but is unused — nothing currently writes to it. The report data is complete and correct; rendering it to PDF is a presentation-layer addition that doesn't touch the snapshot model, and can be picked up whenever it's actually wanted.

## Frontend

Site Details → **Reports** tab (new): a list of every report generated for the site (timestamp, generator, preliminary badge), and a full read-only render of whichever one is selected — identity, property data with source/date per field, investigation quality, documents, analysis checklist, audit trail — plus a prominent "🔒 Snapshot" note and, when applicable, the client's exact required banner: **"PRELIMINARY — Property identity had not been confirmed when this report was generated."**

## Test count

39 → **43 tests**, all passing (4 new, covering exactly the four required cases). Continuing the integration-test-first approach you flagged as valuable — these tests exercise the real Prisma transactions and the real `InvestigationDataService`, not mocks.

## Where this leaves the product

```
User Input → Real Parcel Investigation → Human Confirmation → Real Enrichment →
Source Comparison → Conflict Resolution → Documents → Transparent Analysis → Immutable Report
```

The full vertical slice from raw input to a defensible, permanent investigation record is now real, tested, and running.
