# SiteIQ — Checkpoint 6: Real Massachusetts Parcel Data Integration

Status: **Running code against live MassGIS data, verified. Awaiting client review.**

This checkpoint replaces the Checkpoint 5 fixture mirror with a real, working integration against MassGIS's actual public data service — answering the eleven questions you asked, with facts confirmed by direct testing, not assumption.

## Your eleven questions, answered

**1. How is the official MassGIS parcel dataset actually obtained?**
Two ways exist; we use the one that fits an automated pipeline. MassGIS publishes standardized assessors' parcel data both as (a) downloadable shapefile/File Geodatabase bulk files per municipality or statewide, and (b) a public **ArcGIS REST Feature Service**, no API key or authentication required. We use (b) — confirmed live and queryable during this checkpoint:
```
https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/MassachusettsPropertyTaxParcels/FeatureServer
```

**2. Statewide or by-municipality?**
Both are possible through this one service — it's queryable with a `WHERE CITY='...'` filter (municipality-scoped, what we use) or without one (statewide, paginated). The separate bulk-download option is also organized per-municipality or as one large statewide ZIP.

**3. What format is it published in?**
Shapefile, File Geodatabase (bulk downloads), and Esri JSON over REST (what we query — trivially converted to GeoJSON/WKT, no proprietary tooling needed).

**4. How frequently is the source updated?**
MassGIS's bulk downloads are refreshed **twice yearly** (January 1 and July 1) per their own documentation. The live REST service's own update cadence isn't separately documented anywhere we could find — treating it as tied to the same twice-yearly cycle is the safe assumption, and it's what our refresh schedule (below) is built around. Flagged as the one fact in this list we could not fully pin down from public documentation alone.

**5. What fields are actually available?**
Confirmed directly by querying the live schema. Two joined tables, keyed by `LOC_ID`:

| Table | Key fields |
|---|---|
| Tax Parcels (geometry) | `LOC_ID`, `MAP_PAR_ID`, polygon boundary |
| Assessor extract | `SITE_ADDR`, `ADDR_NUM`, `FULL_STR_STD` (pre-standardized street name), `CITY`, `ZIP`, `LOT_SIZE`, `LOT_UNITS` (acres/sqft), `ZONING`, `USE_CODE`, `TOTAL_VAL`/`LAND_VAL`/`BLDG_VAL`, `YEAR_BUILT`, `OWNER1`, and more |

Notably, **`ZONING` is present directly in the assessor extract** — not authoritative bylaw text, but a real code many towns populate. We're not using it yet (Checkpoint 5's "field enrichment" scope, still ahead of us), but it means zoning may need less separate integration work than doc 01/02 assumed.

**6. How is parcel geometry supplied?**
Real polygon boundaries, `esriGeometryPolygon`, requestable directly in WGS84 (`outSR=4326` — the same SRID our PostGIS columns use, no reprojection math needed).

**7. Licensing/usage restrictions?**
Publicly queryable with no key and no rate-limit wall encountered during testing. The dataset's stated caveat is about *authority*, not *usage*: "Assessor's parcel mapping is a representation of property boundaries, not an authoritative source... a legally authoritative map... can only be produced by a professional land surveyor" (MassGIS/EOTSS license text). No formal license name (e.g. CC0) was findable in the service metadata itself — flagged as worth a final confirmation email to MassGIS before this goes into a paid production deployment, but nothing found suggests restricted use for an internal research tool like SiteIQ.

**8/9. Initial import and subsequent refreshes?**
`npm run mirror:ingest -- Worcester "New Bedford" Boston ...` — one municipality at a time, same code path for the first import and every later refresh (no special-cased "seed" logic to keep in sync with the real thing).

**10. How are failed/partial refreshes handled without destroying the previous valid mirror?**
The whole fetch-and-transform for one municipality happens **entirely in memory before any database write starts**. Only once a complete, valid dataset for that town exists in memory does one DB transaction run: delete that town's old rows, insert the new ones. If anything throws before that point (a network error, a bad response, a malformed record) — or the transaction itself fails partway — Postgres rolls back and the previous data for that municipality is untouched, byte for byte. One municipality's failure during a multi-town ingest run doesn't affect the others (each is caught and logged independently by the CLI script).

**11. How is the last successful refresh time exposed?**
`ParcelMirrorRecord.sourceRefreshedAt` (already part of the Checkpoint 3 schema) is threaded through to every candidate's `evidence.retrievedAt` and a derived `evidence.sourceAgeDays` — rendered in the Candidate Review UI as a **freshness badge, deliberately separate from the confidence badge** (green ≤30 days, amber ≤180 days, red beyond that) — see "Freshness vs. confidence" below.

## Freshness vs. confidence (your explicit product requirement)

These are two different questions and the UI now asks them separately:

- **Confidence** — "how sure is SiteIQ this is the right parcel?" (the scoring formula from docs/05, unchanged in this checkpoint)
- **Freshness** — "how old is the source data behind that match?" (new: `evidence.sourceAgeDays`, badge on every candidate card)

We deliberately did **not** fold freshness into the confidence score itself. A 94%-confidence match on 3-day-old data and a 94%-confidence match on 14-month-old data score identically on "is this the right parcel" — the address/location signals that produced 94% don't change based on how old the mirror happens to be. What *should* differ is how much an analyst trusts the *parcel attributes* (lot size, zoning) that will get pulled from that record — which is a Checkpoint 5-scope "field enrichment" concern, not an identity-matching one. Keeping the two signals visually separate rather than blending them into one number is what lets an analyst reason about both correctly.

## Real data, verified

Live-queried during this checkpoint (not simulated): `142 Elm St, Worcester` — the same address used throughout Checkpoint 5's testing — turned out to be a real Worcester condo building, returning genuine assessor records (multiple units, real zoning code `RG-5`, real lot size, real assessed values). This wasn't planned; it's a coincidence that happens to demonstrate the live integration is querying real MassGIS data, not a fixture dressed up to look real.

**Andover fully ingested and matched against**: 11,127 real parcels, 0 skipped for missing geometry. End-to-end proof: creating a site with the deliberately misspelled address `203 High Steet, Andover, MA` correctly ranked the real parcel `203 High St` first at 75% confidence (with `205 High St` and `201 High St` — genuine neighbors — as the next-ranked candidates at 60%), and every candidate's freshness badge correctly showed "0 days old." This is the same fuzzy-matching logic from Checkpoint 5, now proven against real MassGIS records instead of a 10-row fixture. Worcester, New Bedford, Boston, Quincy, and Springfield were queued for ingestion after Andover's success — check `ParcelMirrorRecord` for current coverage, since large municipalities take several minutes each (see "Performance notes" below).

### Performance notes (real problems, hit and fixed during this checkpoint)

Getting a real municipality's data in was not a one-shot success — three real issues surfaced and were fixed, worth recording rather than glossing over:

1. **Sequential geometry fetching was impractically slow** — Andover alone needed ~150 chunked geometry requests; done one at a time, this didn't finish in a reasonable window. Fixed with bounded concurrency (6 parallel workers) in `MassGisClient.fetchGeometry`.
2. **Large geometry responses occasionally exceeded a single request timeout** — some chunks (parcels with complex boundary polygons) took longer than the initial 15s budget. Fixed with a smaller chunk size (75 `LOC_ID`s per request instead of 200) and one automatic retry before failing.
3. **Prisma's default interactive-transaction timeout (5s) was far too short** for a per-row insert loop across 11,000+ parcels. Fixed by raising it to 10 minutes for this specific transaction — deliberately scoped to the ingestion job only, not a global change, since this is an offline batch process, not a user-facing request path where a long timeout would be the wrong trade-off.

None of these were silently worked around — each fix is a comment at its call site explaining why, discoverable by the next person who touches this code.

## Architecture — what changed, what didn't

```
MassGIS ArcGIS REST FeatureServer
         ↓
   MassGisClient            (src/modules/matching/massgis-client.ts — the ONLY file
         ↓                   that knows the URL, field names, or Esri JSON shape)
MassGisIngestionService      (fetch → transform → transactional per-municipality swap)
         ↓
   ParcelMirrorRecord        (unchanged schema from Checkpoint 3)
         ↓
   MatchingService           (unchanged from Checkpoint 5 — exact/fuzzy/spatial
                               pipeline has no idea whether the mirror came from
                               a fixture or MassGIS; that's the adapter boundary
                               doing its job)
```

Per your instruction, **the matching engine itself was not rewritten** — `matching.service.ts`, `scoring.ts`, `parcel-mirror.repository.ts`, and the confirmation transaction are byte-for-byte the logic from Checkpoint 5. Only the mirror's data source changed, exactly as the adapter boundary was designed to allow (doc 01 ADR-0006).

**Geocoder provider abstraction** (your other explicit request): `GeocodingService` is now `CensusGeocoderAdapter`, one implementation of a `Geocoder` interface bound behind a `GEOCODER` injection token (`geocoder.interface.ts`). `MatchingService` depends on the interface, never the concrete class. Replacing the Census geocoder later — a paid provider, a different public one — means writing one new class and changing one binding in `matching.module.ts`; nothing in the matching pipeline references "Census" by name anymore.

## Known limitations (still, honestly, not fully closed)

1. **Multi-part (disjoint) parcels aren't specially handled** — geometry is built as a single `POLYGON` from whatever rings MassGIS returns, then repaired with `ST_MakeValid`. A genuinely multi-part parcel (two disconnected pieces of land, same LOC_ID) would need `MULTIPOLYGON` handling this doesn't yet do. Uncommon but real; flagged rather than silently mishandled.
2. **Condo/multi-unit buildings collapse to one mirror row** — MassGIS gives each unit its own assessor record sharing one `LOC_ID`; we pick the shortest `SITE_ADDR` as the representative parcel address (e.g. "142 Elm St" over "142 Elm St #3"). Per-unit data (individual valuations) isn't retained in the mirror — acceptable for parcel-identity matching, a real gap if per-unit analysis is ever needed.
3. **REST-service update cadence vs. the twice-yearly bulk files** is the one fact we couldn't fully confirm (item 4 above) — our refresh schedule assumes twice yearly; if the live service actually updates more often, we're not capturing that extra freshness yet, but we're also not claiming staler data than we have (the freshness badge is honest about whatever `sourceRefreshedAt` actually says).
4. **No scheduled/automatic refresh job yet** — `mirror:ingest` is a manually-run CLI script per municipality. Wiring it into a BullMQ repeatable job (the architecture doc 02 §8 already described) is straightforward given the ingestion service is already built and idempotent, but wasn't the priority this checkpoint — flagged for the next infrastructure pass.
5. **Only a handful of municipalities are ingested today**, not all 351 — running the full statewide set through this pipeline (paginated REST calls, ~2-3 million parcels) would take considerably longer and hasn't been done in this session; the pipeline itself has no per-municipality limitation, it's purely a "how long do we want this ingestion run to take today" choice.

## How to run it yourself

```
npm run mirror:ingest --workspace=apps/api -- Worcester "New Bedford" Boston Andover Quincy Springfield
```

Then create a site for a real address in one of those towns — you'll be matching against actual current MassGIS data, not fixtures.

## Next step

Awaiting your review. Given the matching engine itself is unchanged and already approved, this checkpoint is scoped narrowly — real data in, same pipeline. Zoning/lot-size field enrichment (the "populate SiteDataField from the mirror, with conflict review" work flagged as out-of-scope back in docs/05) remains the next major piece of the original business workflow, as you said.
