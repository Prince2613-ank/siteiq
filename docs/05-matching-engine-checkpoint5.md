# SiteIQ — Checkpoint 5: Property Matching Engine

Status: **Running code, verified end-to-end via API + automated tests. Awaiting client review.**

This is the checkpoint that implements docs/02 and docs/03's design as real, working code: `Create Site → MatchAttempt → Worker → Candidate Review → Confirm → Activity History`, exactly the acceptance flow you specified.

## What's running

- **Worker** (`apps/api/src/worker.ts`, a separate process from the API — start with `npm run start:worker:dev`): consumes the `property-match` BullMQ queue, backed by Redis (`docker compose up -d redis`).
- **Matching pipeline** (`apps/api/src/modules/matching/`): normalize → exact → fuzzy → spatial (with US Census geocoding as the address→coordinate fallback), all querying a **local parcel mirror** table, never MassGIS live on the request path.
- **Local parcel mirror**: `ParcelMirrorRecord` table + `npm run mirror:load` loader script, currently seeded from a **fixture file**, not a live MassGIS pull — see "Known limitations" below, this is the one deliberate stand-in in this checkpoint.
- **Candidate Review UI**: `/sites/:id/candidates`, polls while the site is `IDENTIFYING`, renders ranked candidates with full evidence, enforces the duplicate-decision requirement in the UI (and the API enforces it independently — see below).
- **Confirmation endpoint**: exact atomic transaction from docs/03 §2, live.

## Scoring behavior (as actually implemented)

Confidence is a weighted combination of up to four independent signals, computed in `src/modules/matching/scoring.ts`:

| Signal | Weight | Computed from |
|---|---|---|
| Address similarity | 40% | `pg_trgm` `similarity()` for fuzzy matches; a local bigram similarity for spatial-path candidates (no second DB round trip); `1.0` for an exact match |
| Distance | 30% | `ST_Distance` from the supplied/geocoded point to the candidate's centroid, linearly decayed to 0 at 150m (the default search radius) |
| Parcel ID match | 20% | Boolean — was a parcel ID supplied and does it match |
| Municipality match | 10% | Boolean — does the normalized input city match the candidate's municipality |

**A signal that wasn't available for a given lookup is excluded, not scored as zero** — its weight is redistributed proportionally across the signals that were available. This is why a direct parcel-ID lookup with no address given scores 100% (parcel ID is the only available signal, and it matched perfectly) rather than being dragged down by an irrelevant or absent address. A real bug caught during this checkpoint's own testing: an earlier version passed the site's display address into a pure parcel-ID lookup and it noticeably reduced confidence on an otherwise-certain match — fixed by not sending address text into the matching input at all when a parcel ID is the primary input (see the comment in `sites.service.ts`'s `create()`).

**Lot size and zoning are never scoring inputs** — per your explicit KT §7 instruction, they're excluded from `CandidateSignals` entirely (a type-level guarantee, asserted directly in `scoring.spec.ts`).

Bands: ≥90 "high confidence" (candidate pre-selected in the UI, still requires an explicit click), 60–89 "needs review," below 60 "no match." All three numbers (weights, radius, bands) live in one place (`scoring.ts`'s exported constants), not scattered — they're first-guess defaults meant to be tuned against real address data, not final.

## The eight required scenarios — verified

Each of these was run against the live worker (not just unit-tested) during this checkpoint:

| Scenario | Result |
|---|---|
| Exact address match | `142 Elm Street, Worcester, MA 01609` → EXACT strategy, 1 candidate, 100% |
| Misspelled address | `142 Elm Steet` → FUZZY strategy, top candidate still the correct parcel at 73% |
| Incomplete address | `Elm St, Worcester, MA` → FUZZY strategy, 4 plausible candidates (140/142/144/200 Elm St), all equally ranked at 71%, none pre-decided |
| Address + coordinates | garbled address text + real coordinates → SPATIAL strategy, correct parcel ranked first by distance |
| Parcel ID input | direct ID lookup → PARCEL_ID strategy, 100% |
| Multiple plausible parcels | (same as "incomplete address" above) |
| No reliable match | address outside the fixture mirror entirely → 0 candidates, `identityStatus = NO_MATCH`, no invented candidate |
| Re-match after corrected input | `POST /sites/:id/re-match` re-queues the pipeline against corrected input; a conflicting result flags rather than silently overwriting an already-confirmed identity (docs/02 §2.3) |

## Proving "never silently confirms" (your specific test requirement)

`candidate-confirmation.service.spec.ts` includes a test that deliberately confirms the **second, lower-confidence candidate** (61%) while a 96%-confidence candidate sits unconfirmed in the same attempt — and asserts the site's recorded parcel and confidence are exactly what the analyst chose, not the top score, with the higher-scoring candidate explicitly marked `REJECTED` on record. This is the direct proof that ranking is a UI convenience, never an authority — the analyst's click is what confirms, always.

A second test suite proves the duplicate-decision requirement can't be bypassed by calling the API directly (not just hidden in the UI): confirming a flagged-duplicate candidate with no `duplicateDecision` throws `422` before touching any data, verified by re-reading the candidate row afterward and confirming it's still `PROPOSED`.

**24 automated tests, all passing** — 12 pure unit tests (scoring, address normalization) and 12 integration tests against the real Postgres+PostGIS database (matching pipeline scenarios, confirmation transaction rules).

## Known limitations (stated plainly, not glossed over)

1. **The parcel mirror is fixture data, not a live MassGIS pull.** `prisma/fixtures/ma-parcels.json` — 10 curated parcels across Worcester, New Bedford, Boston, Andover, Quincy, and Springfield — loaded via `npm run mirror:load`. The exact MassGIS access mechanism was flagged as needing verification back in docs/02 §10/§21 and still hasn't been confirmed; building a scraper against an unverified live government endpoint and presenting it as "the real integration" would have been worse than being explicit about a fixture stand-in. **What's real and permanent**: the adapter boundary (`ParcelMirrorRepository`, all raw-SQL trigram/spatial queries) and the loader script's shape — swapping the fixture loader for a real MassGIS puller later touches one file (`load-parcel-mirror.ts`), nothing in the matching pipeline itself.
2. **Parcel boundaries in the mirror are synthetic** — a small buffered square around each fixture's point coordinate, not real assessor polygons, since the fixture only has point locations. Real boundaries arrive with the real MassGIS puller.
3. **Address normalization is a lightweight regex/token parser** (`address-normalizer.ts`), not a full address-parsing library — handles the common cases this checkpoint's scenarios needed, but rural, PO-box, or otherwise non-standard MA addresses are more likely to fall through to the spatial/geocoding path or return nothing.
4. **Geocoding fallback (US Census Bureau's public geocoder) is a real, live integration** — verified reachable and working during this checkpoint — but it's a dependency without an SLA; a failure there degrades to "no coordinate available," never a crash (wrapped with a 5s timeout + try/catch), consistent with docs/01 §12.
5. **"Parcel + zoning enrichment"** (populating `SiteDataField` rows for lot size/zoning from the mirror, with the full conflict-review workflow) is deliberately **not** part of this checkpoint — the confirm transaction sets identity fields only (`parcelRef`, `municipality`, `matchConfidence`, `matchMethod`), never `lotSize`/`zoningCode` directly, preserving the provenance discipline from Checkpoint 3 (docs/03 §2.2: field values only ever enter through `SiteDataField`, never a direct `Site` write). The Property/Parcel and Zoning tabs remain honest placeholders until Checkpoint 6 builds that system for real.
6. **Search radius (150m) and confidence bands (90/60) are first-guess defaults**, not validated against a large real address dataset — this checkpoint's fixture set is too small (10 parcels) to meaningfully tune them. Real tuning needs real MA address volume, which arrives with the real MassGIS mirror (limitation #1).
7. **The worker runs one instance locally** — concurrency is set to 4 (`worker.ts`), no horizontal scaling story yet; not needed at the "hundreds of sites per month" MVP scale (docs/01 §16), flagged as a scaling question for later if volume changes.

## How to run it yourself

```
docker compose up -d postgres redis
npm install
cd apps/api && npx prisma migrate deploy && npm run mirror:load
npm run start:worker:dev     # separate terminal
npm run start:dev            # API, separate terminal
cd ../web && npm run dev     # web, separate terminal
```

Try: create a site with address `142 Elm Steet, Worcester, MA 01609` (deliberately misspelled) — you'll land on Candidate Review with ranked candidates and full evidence, not a "no match" error.

## Next step

Awaiting your review. Once approved, Checkpoint 6 (documents + background analysis) is next per doc 01's milestone plan — that's also where "parcel + zoning enrichment" (limitation #5 above) and the field-conflict-review system get wired to real data for the first time.
