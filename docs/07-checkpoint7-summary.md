# SiteIQ — Checkpoint 7: Real Property Investigation & Enrichment

Status: **Running code, full acceptance test demonstrated against real MassGIS data. Awaiting client review.**

## Acceptance test — demonstrated live, both required cases

### Case 1: successful automation, end to end

```
203 High Street, Andover, MA
        ↓ Create Site
Automated matching (worker, real MassGIS mirror)
        ↓
Ranked candidates: 203 High St 75%, 205/201/207/209 High St 60% — each
with real parcel boundary geometry attached
        ↓ Candidate Review
Human confirms 203 High St
        ↓ Atomic confirmation transaction
identityStatus: CONFIRMED, parcelRef: F_754483_3071276
latitude/longitude/parcelGeom populated from the real mirror geometry
        ↓ Field enrichment (same transaction)
lot_size: 30,056 sq ft — MATCHED — source MassGIS (live)
zoning_code: unavailable — FIELD_UNAVAILABLE — genuinely absent from
  MassGIS for this parcel, not inferred
use_code: unavailable — FIELD_UNAVAILABLE
        ↓
Activity History: site_created → match_attempt_completed →
  parcel_confirmed → duplicate_decision_recorded (see below) →
  match_attempt_completed → rematch_conflict_detected
```

Every step above was run against the live API/worker this session, not simulated.

### Case 2: safe failure / human intervention

Two sub-cases demonstrated:

- **Genuine no-match**: `9999 Fictional Boulevard, Andover, MA` — the mirror has nothing close, the Census geocoder fallback also found nothing usable, and the site correctly landed on `identityStatus: NO_MATCH` — zero candidates, nothing invented.
- **Re-match conflict**: re-running matching on the now-CONFIRMED `203 High Street` site against a *different* real address (`181 High Street, Andover, MA`, itself a genuine 100%-confidence exact match in the mirror) produced a **`NEEDS_REVIEW`** status while `Site.parcelRef` stayed exactly as it was — the previously confirmed parcel was **not silently replaced** — and a distinct `rematch_conflict_detected` activity event was logged, in addition to the existing `duplicate_decision_recorded` event from an earlier duplicate-parcel test on the same site. Both the UI (a red banner on Site Details and Candidate Review) and the API layer reflect this.

## What changed since Checkpoint 6

1. **Field enrichment through provenance** (client's core requirement): `FieldEnrichmentService` runs inside the same transaction as candidate confirmation, writing `SiteDataField` + `SiteDataFieldApproval` rows for `lot_size`, `zoning_code`, `use_code` — sourced from the confirmed parcel's real mirror record, never a direct unaudited write to `Site`. A field MassGIS genuinely doesn't have becomes `FIELD_UNAVAILABLE`, shown in the UI as "Unavailable from MassGIS" — never inferred from neighboring parcels or left ambiguous.
2. **Source info shown per field**, exactly the format requested: value, source name, retrieved date, and a "Status: Confirmed" label for a matched, uncontested first observation.
3. **Real parcel polygons on the map** — a genuine Leaflet map (`ParcelMap.tsx`) now renders actual PostGIS boundary geometry, both during Candidate Review (all candidates, selected one highlighted, click-to-select) and on the confirmed Site's Map tab (the single confirmed boundary). No placeholder rectangles anywhere in this path.
4. **Re-matching correctly protects a confirmed identity** — including a real bug caught and fixed this checkpoint (below).
5. New Prisma migration (additive): `zoning`/`useCode` columns on `ParcelMirrorRecord`, since the mirror wasn't persisting these MassGIS fields yet.

## A real bug this checkpoint caught and fixed

The `re-match` endpoint originally wrote `identityStatus = IDENTIFYING` to the database **synchronously**, before the background worker ever ran — for immediate UI feedback. That synchronous write silently defeated the re-match-conflict check: by the time the worker read the site to ask "was this already `CONFIRMED`?", the answer had already been overwritten to `IDENTIFYING` by the request handler itself, so the conflict was never detected. Caught by testing the acceptance flow end-to-end (not by a unit test — this was exactly the kind of bug that only shows up when you actually run the full sequence), fixed by removing that premature write and letting the worker be the sole owner of `identityStatus` transitions. A new integration test (`matching.service.spec.ts`) now covers this scenario directly.

## Known limitations carried forward (nothing new hidden)

- Only Andover has real MassGIS data currently ingested (per your explicit instruction to stop broad ingestion and refocus on the workflow — Worcester's ingestion was paused mid-run, resumable anytime with `npm run mirror:ingest -- Worcester`).
- Zoning/use-code being `FIELD_UNAVAILABLE` for the Andover parcels tested so far is genuinely accurate (MassGIS's own data), not a code gap — worth noting since it means the "missing values remain missing" behavior is proven with real absence, not a synthetic test case.
- Nearby-SiteIQ-sites overlay and measurement tools on the map remain future work, as previously scoped.
- The re-match trigger in the UI is a simple prompt-based input (not the full "Address / Parcel ID / Coordinates" tabbed form from Create Site) — functional for demonstrating the capability, not the final polished UX.
- Operational ingestion tracking (the municipality-level refresh-status table you described) is explicitly **not** built yet, as you said it doesn't block this checkpoint.

## Next step

Awaiting your review. Operational ingestion status/monitoring and broader municipality coverage remain queued behind product-workflow priorities, per your direction.
