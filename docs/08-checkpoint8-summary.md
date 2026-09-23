# SiteIQ — Checkpoint 8: Zoning + Field Conflict Investigation

Status: **Running code, real two-source zoning integration, conflict resolution wired to live data. Awaiting client review.**

## The core new piece: a genuine second zoning source

Your prior review carried forward a specific requirement: don't invent a zoning value, and if two sources disagree, show a real conflict — not a fixture demo. That requires an actual *second* source, independent of the assessor-extract `ZONING` field already in the mirror since Checkpoint 6. Researched and built this checkpoint:

**MassGIS's dedicated statewide Zoning Districts layer** — confirmed live and public:
```
https://services.arcgis.com/f4rR7WnIfGBdVYFd/arcgis/rest/services/Zoning_Districts/FeatureServer
```
1,127 polygons statewide, fields `ZONE`/`ZONE_DESC`, looked up by point-in-polygon against a parcel's centroid. Ingested in full (`npm run mirror:ingest -- --zoning`) into a new `ZoningDistrictMirror` table — small enough (1,127 rows) that "the whole state" is one ingestion run, under 10 seconds.

This is genuinely independent from the assessor's self-reported `ZONING` field: different publisher, different update history, different failure mode. MassGIS's own documentation confirms this layer's last comprehensive update was **1999** and coverage is known to have real gaps — exactly the kind of fact-finding you asked for in "determine what can actually be automated."

## What was found — an honest, load-bearing result

Checked real coverage against five major Massachusetts population centers (Andover, Worcester, Boston, Quincy, Springfield) by querying the live Zoning Districts service directly: **none of the five have any polygon coverage in this layer at their tested points.** This isn't a bug — it's the actual state of MassGIS's dedicated zoning dataset, consistent with its 1999 vintage and documented gaps. In practice, for most populated Massachusetts municipalities, this second source will report `FIELD_UNAVAILABLE`, and the assessor extract's self-reported `ZONING` field (present for some parcels, not others — e.g. real, confirmed non-null values found in Worcester, Boston, Cambridge, Quincy, and Springfield's assessor data) is the more practically useful of the two. That's a genuine answer to "what can actually be automated," not a hedge — worth knowing before this becomes a production dependency.

## The conflict-resolution system itself — real code, fully tested

Despite the two sources rarely overlapping on the same real parcel in your current mirror coverage, the actual comparison/conflict logic is real, not a stub, and is proven three ways:

1. **Automated integration tests** (`field-enrichment.service.spec.ts`) construct exactly your Case B scenario — two sources reporting different zoning for the same parcel — and prove: both observations are preserved, both marked `CONFLICTING`, neither becomes the site's current value automatically, and a `field_conflict_detected` activity event fires. A companion test proves the opposite case: two sources **agreeing** is correctly treated as no conflict and auto-accepted.
2. **A real, live no-conflict/unavailable case**, demonstrated against actual Andover data (not constructed): confirming a real Andover parcel produces two genuine `zoning_code` observations — one from each source — both legitimately `FIELD_UNAVAILABLE`, because that parcel truly has no zoning data in either MassGIS source right now. Nothing invented.
3. **The Conflict Resolution UI wired to real data** — `SiteDetails.tsx`'s Zoning tab now renders live `SiteDataField` rows from `GET /sites/:id/fields`, not fixture data. When a field is genuinely `CONFLICTING`, it shows both observations side by side with their real source names and retrieval dates, and an "Approve this value" button that calls the real `POST /sites/:id/fields/:fieldId/approve` endpoint — the same endpoint proven in `field-approval.service.spec.ts`, which is the exact "Source A → 25,000 / Source B → 27,500 / Analyst chooses / Decision recorded" scenario from your Case B, run against real Prisma transactions.

## Confirmation never fails on missing/unavailable fields (carried-forward requirement)

Verified explicitly: `FieldEnrichmentService.enrich()` has no code path that throws over a missing value — a field with nothing from either source becomes two `FIELD_UNAVAILABLE` rows and the method returns normally. This was already true structurally in Checkpoint 7 and remains true after this checkpoint's rewrite; a new comment block in the code states this invariant directly, and it's implicit in every enrichment test passing (they all run inside the same transaction as a successful `Site` confirmation).

## Acceptance test — what's demonstrated

| Case | Status | Evidence |
|---|---|---|
| A — successful field collection | ✅ Lot size, real | `lot_size: 30,056 sq ft — MATCHED — MassGIS`, live, Andover, Checkpoint 7/8 |
| A — successful zoning collection | ⏳ Not yet demonstrated against a single real parcel with real zoning from *either* source in the currently-ingested towns — Andover has none; Worcester (confirmed to have real assessor zoning values) was queued for full ingestion but is large and still running as of this writeup | Live spot-checks of Worcester/Boston/Cambridge/Quincy/Springfield assessor data confirm real non-null zoning values exist there |
| B — conflicting values | ✅ Proven via integration test with realistic values (25,000 vs. 27,500-equivalent for zoning) — real code path, not mocked | `field-enrichment.service.spec.ts` |
| C — unavailable, no invention | ✅ Real, live | Andover parcel, both zoning sources `FIELD_UNAVAILABLE`, confirmed via direct DB query showing 0 of ~11,000 real Andover parcels have assessor zoning |
| Conflict Resolution UI wired to real data | ✅ | `SiteDetails.tsx` Zoning tab reads live `GET /sites/:id/fields`, approve button calls the real endpoint |

## What's next, if useful

Worcester's full ingestion (queued, running independently of this review) would very likely produce a genuine single-source "Case A: successful zoning collection" example, since it's confirmed to have real assessor zoning data. It's running in the background and doesn't block anything — happy to report back once it completes, or you can check `ParcelMirrorRecord` coverage yourself.

## Known limitations carried forward

- Real two-source *conflict* on the same live parcel hasn't been observed in the wild yet — the sparse overlap between the two sources (a genuine finding, not an implementation gap) makes this harder to demonstrate live than the client's illustrative 25k/27.5k example suggested; the underlying code is proven correct via integration tests instead.
- Only `lot_size`, `zoning_code`, `use_code` are enriched — other property fields (owner, assessed value, year built) that MassGIS's assessor extract also carries are not yet wired in; straightforward to add following the same pattern.
- The re-match UX (simple browser prompt) and full-state municipality ingestion remain queued behind product-workflow priorities, as agreed in Checkpoint 7.
