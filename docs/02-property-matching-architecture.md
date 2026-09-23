# SiteIQ — Property Matching & Automated Investigation Architecture

Status: **Draft for client review — no implementation started.**
Scope: addendum to [`01-technical-discovery.md`](./01-technical-discovery.md). That document's architecture (NestJS/React/Postgres+PostGIS/BullMQ/Redis/S3/AWS/testing/CI-CD/Docker) is the approved baseline and is **not** being redone here — this document adds the piece the revised KT introduced: SiteIQ as an *automated investigator* that recovers from bad input and scores its own confidence, not a system that only accepts exact matches.

## Client decisions this addendum assumes

| Question | Decision |
|---|---|
| Auto-confirm policy | Even high-confidence property identifications always get a one-click human acknowledgment before the investigation proceeds on them. No fully-silent auto-confirm of *which property this is* — that's the highest-stakes decision in the whole flow, since everything else is built on top of it. |
| MapGeo | Manual fallback only for MVP. No automated MapGeo scraping — it's a per-municipality commercial platform without a public API, and terms of use vary town by town. MassGIS and the state's Interactive Property Map (both MassGIS/EOTSS-hosted, both plausibly automatable) are the MVP's automated sources. |

---

## 1. Updated Architecture — Where Matching Fits

```
                 ┌─────────────────────────────────────────┐
                 │              React SPA                    │
                 └───────────────────┬───────────────────────┘
                                     │ HTTPS
                 ┌───────────────────▼───────────────────────┐
                 │             NestJS API                     │
                 └───────┬───────────────────────┬────────────┘
                         │                        │
             ┌───────────▼──────────┐   ┌─────────▼─────────────┐
             │ PostgreSQL + PostGIS  │   │  Redis / BullMQ        │
             │  incl. LOCAL MIRROR   │◄──┤  parcel-data-refresh   │
             │  of MA parcel data    │   │  property-match        │
             │  (see §8)             │   │  zoning-lookup         │
             └────────────────────────┘   │  analysis              │
                                          └─────────┬─────────────┘
                                                    ▼
                                        ┌────────────────────────┐
                                        │        Worker            │
                                        │  matching pipeline (§2)  │
                                        │  data-source adapters    │
                                        └───────────┬──────────────┘
                                                    ▼
                                  ┌───────────────────────────────────┐
                                  │ MassGIS · MA Interactive Property   │
                                  │ Map · (MapGeo: manual only)         │
                                  │ US Census Geocoder (fallback)       │
                                  └───────────────────────────────────┘
```

The one structural change from doc 01: **the statewide parcel dataset is mirrored locally**, not queried live per lookup (§8) — this is what makes fuzzy/spatial candidate search fast and resilient, and it's significant enough to warrant its own ADR (ADR-0007, §16).

---

## 2. Property Matching Architecture

Every site creation (and every manual "re-match") runs one **matching pipeline**, producing a `MatchAttempt` and one or more ranked `SiteMatchCandidate` rows (schema in §4). The pipeline branches on what the analyst provided:

```
Input: address? parcel ID? lat/lng? (any combination)
         │
         ▼
 Normalize address (parse into house#, street, type, city, state, zip)
         │
   ┌─────┴─────────────────────────────┐
   │ parcel ID given?                    │──yes──► exact lookup by ID against local mirror
   │                                      │             │
   └─────┬────────────────────────────────┘             │
        no                                              │
         ▼                                              │
 Exact match: normalized address vs. mirror's            │
 address index                                            │
         │                                                │
    found?──yes─────────────────────────────────────────►│
         │no                                              │
         ▼                                                │
 Fuzzy match: trigram similarity (Postgres pg_trgm) on     │
 mirror's address text, scoped to municipality/ZIP if      │
 known, to keep the search space small                      │
         │                                                │
   candidates found?──yes───────────────────────────────►│
         │no / input included coordinates                  │
         ▼                                                │
 lat/lng available?──no──► geocode via US Census Geocoder   │
         │yes                    │                          │
         ▼◄───────────────────────┘                          │
 Spatial nearest-candidate search (PostGIS KNN, default      │
 150m radius — tunable, see §2.2) against mirror parcel       │
 centroids/boundaries                                         │
         │                                                    │
         ▼                                                    │
 Score every candidate (§2.1) ──────────────────────────────►│
                                                               ▼
                                          Rank, persist as SiteMatchCandidate rows,
                                          top candidate pre-selected in the review UI
```

Every branch converges on the same scoring step and the same output shape, so the UI and the "accept a candidate" API endpoint don't need to know which strategy found the candidate.

### 2.1 Confidence Scoring

Per the client's explicit rule (KT §7): **no single signal proves an address.** Each candidate's confidence is a weighted combination of independent signals, computed in one place (`packages/shared/matching-config.ts`, shared by worker and API so the frontend can render the same breakdown it's evidence for):

| Signal | What it measures | Default weight |
|---|---|---|
| Address string similarity | Trigram/Jaro-Winkler similarity between the normalized input address and the candidate's address, 0–1 | 40% |
| Geographic distance | Inverse-distance score from any provided/geocoded coordinate to the candidate's parcel centroid, decayed to 0 at the search radius | 30% |
| Parcel ID match | Boolean — exact match if a parcel ID was provided | 20% |
| Municipality/ZIP match | Boolean — input municipality/ZIP matches candidate's | 10% |

When an input signal isn't available (e.g. no address was typed, only coordinates), that weight redistributes proportionally across the remaining available signals rather than counting as zero — so a coordinates-only lookup isn't unfairly penalized for lacking an address to compare.

**Lot size and zoning are deliberately excluded from the primary score**, per the client's explicit KT §7 instruction — they can't independently prove an address. They're available as secondary, human-readable context in the candidate review UI ("this candidate's zoning is Industrial, consistent with your notes") but never move the confidence number.

Weights and the radius (§2.2) live in one config object, not scattered magic numbers — they're the kind of thing that will get tuned after seeing real MA address data in Checkpoint 5, without needing a code change to adjust.

### 2.2 Confidence Bands & Search Radius (proposed defaults — tunable, validated during Checkpoint 5 per KT §16)

| Band | Score | Behavior |
|---|---|---|
| High confidence | ≥ 90 | Top candidate pre-selected in the review UI; analyst sees the evidence and clicks one "Confirm" button (per the approved no-silent-auto-confirm policy — §0). |
| Needs review | 60–89 | Candidate list shown (KT §11's "3 possible properties found" pattern), no pre-selected default — analyst actively picks one or rejects all. |
| No match | < 60, or zero candidates within the search radius | KT §12's "No reliable property match found" screen — try another address, enter coordinates, or continue manually. |

Default spatial search radius: **150 meters**, chosen as a starting point wide enough to catch typo'd addresses in dense areas and adjacent-parcel ambiguity, narrow enough to keep candidate counts manageable in rural areas with large lots. This is explicitly a first guess to validate against real MA address data during Checkpoint 5 (KT §16 delegates the exact radius/methodology to the developer, to be validated in testing) — not a number to treat as final today.

### 2.3 Address Correction / Recovery Strategy

This is KT §5/§6's core requirement — never just return "no match" on a typo, but never silently substitute a different address either. The pipeline above already produces this behavior structurally:

- `Site.original_input_address` (and `original_input_parcel_ref`/`original_input_lat`/`original_input_lng`) are written once at creation and **never modified** — the client's literal input is permanently preserved regardless of what gets matched.
- A candidate becoming the site's confirmed identity only happens through the explicit accept action (§4 API), which is logged with full evidence — so the UI can always show "you searched for 123 Mian St → you confirmed 123 Main Street, parcel ABC-123, 96% confidence" exactly as KT §6 illustrates.
- **Re-matching**: if an analyst corrects the input address later (or the mirror data updates), a new `MatchAttempt` runs and produces new candidates — it never overwrites the already-confirmed identity automatically. If a re-match's top candidate *disagrees* with the currently-confirmed parcel, that surfaces as a flagged discrepancy for analyst review (the same "don't silently change a confirmed fact" pattern used for field-level conflicts and site duplicates in doc 01 §4.1/§8) rather than silently swapping the site's identity out from under an ongoing investigation.

---

## 3. Data-Source Adapter Architecture (extends doc 01 §7 / ADR-0006)

Same adapter interface and boundary as doc 01 — nothing changes structurally, but the concrete sources and their roles are now specific:

| Source | Role | Automation approach | Status |
|---|---|---|---|
| **MassGIS** (Standardized Assessors' Parcels) | Primary parcel/lot/geometry/address data, statewide | Bulk dataset, periodically mirrored locally (§8) — not called live per lookup | To verify exact current access mechanism (ArcGIS FeatureServer vs. bulk download) before Checkpoint 5 |
| **Massachusetts Interactive Property Map** | Secondary/cross-check source, and likely zoning-adjacent context | Also MassGIS/EOTSS-hosted — needs verification whether it's a distinct dataset or the same underlying data behind a different viewer, before committing adapter effort to it | To verify — may turn out to be redundant with MassGIS itself, in which case it's not worth a second automated adapter |
| **MapGeo** | Per-municipality parcel viewer, often the most current source for a specific town | **Manual only for MVP** (client decision, §0) — analyst looks it up and enters/cites it like any manual field | Deliberately not automated |
| **Municipal zoning layers** | Zoning district/code, where digitized | Live adapter calls, per-municipality, as in doc 01 §7 | Coverage is inherently uneven — unchanged from doc 01 |
| **US Census Geocoder** | Fallback: turns a garbled address into approximate coordinates when string matching finds nothing usable | Live API call, free/public, no key required | Dependency-risk noted in §10 |

Every source still normalizes into the same internal shape before touching the data model, and every call is still individually timeout/try-catch wrapped so one source's failure degrades to `source_unavailable` rather than crashing the investigation (doc 01 §7/§12) — none of that changes.

---

## 4. Database Design Updates

New entities, additive to doc 01 §4 (no changes to `SiteDataField`, `SiteDataFieldApproval`, `Document`, `AnalysisRun`, `Note`, `ActivityEvent`, `Report`):

```
Site (fields added)
 ├─ original_input_type (address | parcel_id | coordinates | address_and_coordinates)
 ├─ original_input_address, original_input_parcel_ref, original_input_lat, original_input_lng
 │    (raw as entered — immutable after creation)
 ├─ match_confidence (0–100, nullable — confidence of the currently-CONFIRMED identity)
 ├─ match_method (exact | fuzzy_candidate | spatial_candidate | manual | corrected)
 ├─ identity_confirmed_at, identity_confirmed_by_id (nullable until the one-click accept happens)

MatchAttempt            -- one row per matching run (initial creation, or an explicit re-match)
 ├─ id, site_id → Site
 ├─ input_snapshot (JSONB — exactly what was searched at this attempt)
 ├─ strategy_used (exact | fuzzy | spatial | parcel_id)
 ├─ candidate_count, top_confidence
 ├─ triggered_by_id, created_at

SiteMatchCandidate       -- append-only; every candidate ever surfaced, for any attempt
 ├─ id, site_id → Site, attempt_id → MatchAttempt
 ├─ parcel_ref, matched_address, municipality
 ├─ confidence (0–100)
 ├─ evidence (JSONB — { addressSimilarity, distanceMeters, distanceScore, parcelIdMatch, municipalityMatch })
 ├─ rank (1 = top candidate within this attempt)
 ├─ status (proposed | accepted | rejected | superseded)
 ├─ decided_by_id (nullable), decided_at (nullable)
 ├─ created_at (immutable)
```

**Why a separate `MatchAttempt` + `SiteMatchCandidate` rather than fields on `Site`:** the same reasoning as `SiteDataField` in doc 01 §4 — the client's KT §6 explicitly wants "original input → suggested property → evidence → confidence → decision" preserved, permanently and inspectably, not just the final answer. `Site` holds only the current confirmed identity (fast reads); the full matching history — including every attempt and every candidate that was ever considered, even rejected ones — lives in these two append-only tables, exactly mirroring the provenance principle already established for field-level data.

---

## 5. API Design Updates

```
POST   /api/v1/sites                                  (creates the site in an "identifying" state, queues a MatchAttempt)
GET    /api/v1/sites/:id/match-attempts
GET    /api/v1/sites/:id/match-attempts/:attemptId/candidates
POST   /api/v1/sites/:id/match-attempts/:attemptId/candidates/:candidateId/accept   (the one-click confirm)
POST   /api/v1/sites/:id/match-attempts/:attemptId/reject-all                       (→ manual entry path, KT §12)
POST   /api/v1/sites/:id/re-match                                                   (re-run identification, e.g. after correcting the input)
```

`POST /sites` no longer synchronously returns a fully-formed site — the response includes the site id plus `identityStatus: 'identifying'`, and the frontend polls/subscribes the same way it already does for analysis runs (doc 01 §9) until the `MatchAttempt`'s candidates are ready for review.

---

## 6. GIS/Map Architecture — One Addition

Doc 01 §11 stands unchanged (Leaflet, standard/satellite toggle, measurement, nearby-sites panel). One addition: the candidate review screen (§7 below) reuses the same map component to plot every candidate as a pin with its confidence and evidence in a popup — the same visual "does this make sense" check analysts do manually today (KT §15's stated reason maps matter), just applied to *choosing between candidates* rather than only inspecting a single confirmed site.

---

## 7. UX Note — One New Wireframe Needed

The 12 wireframes from Checkpoint 2 covered field-level conflict resolution (Screen 6) but not property-*identity* candidate review — the specific "Potential property match found" (KT §6) and "3 possible properties found" (KT §11) screens are new. Recommend adding one wireframe (or a variant/extension of Screen 6's pattern) covering: the high-confidence one-click-confirm state, the multi-candidate review state, and the no-match state (KT §12) with its three recovery actions. Happy to produce this now or fold it in alongside Checkpoint 5 implementation — your call.

---

## 8. Background-Job Architecture Updates

Two changes to doc 01 §9's job set:

- **`parcel-data-refresh`** (new, scheduled/repeatable BullMQ job, not per-site) — periodically pulls the current Standardized Assessors' Parcels dataset from MassGIS into a local PostGIS table (the "mirror," §... below). Frequency to be set based on how often MassGIS actually republishes the statewide dataset (commonly a periodic, not continuous, refresh cycle) — likely weekly or monthly, confirmed during Checkpoint 5.
- **`property-match`** (replaces doc 01's `parcel-lookup` as the entry point) — runs the matching pipeline (§2) against the local mirror, writes `MatchAttempt`/`SiteMatchCandidate` rows. `zoning-lookup` and `analysis` are unchanged from doc 01.

### Why a local mirror instead of live per-request calls to MassGIS (this is a real architecture decision — see ADR-0007)

Doc 01's original design (§7) implicitly assumed each site's lookup calls the external source live. That doesn't work well for the matching pipeline specifically: fuzzy trigram search and spatial nearest-neighbor search need to run *many* candidate comparisons per lookup, fast, and need a stable dataset to build a trigram/spatial index over. Calling MassGIS live for every candidate comparison would be slow, rate-limit-prone, and fragile against source downtime — exactly the kind of external dependency KT §15 (non-functional requirements, doc 01) says shouldn't be able to crash or block the application.

Instead: a scheduled job pulls the statewide parcel dataset into our own PostGIS table (with a `pg_trgm` GIN index on the address text and a spatial GIST index on geometry), and all matching — exact, fuzzy, and spatial — runs as local database queries against that mirror. MassGIS is only called live by the refresh job, on a schedule, not on the user's critical path. Zoning stays live/per-municipality since it isn't one bulk statewide dataset the same way.

**Trade-off:** the mirror is only as fresh as its last refresh — a very recent subdivision or lot-line change might not appear immediately. This is surfaced honestly (the site record shows the mirror's last-refreshed timestamp alongside any parcel data pulled from it), not hidden, consistent with the "never silently invent" principle. A manual re-match after a known recent change is always available as an escape hatch.

---

## 9. Testing Strategy Additions (extends doc 01 §13)

- **Golden-fixture matching tests**: a curated set of real-shape MA address fixtures (correct spellings, common typos, missing ZIPs, rural non-standard addresses) run through the full pipeline against a small seeded test mirror, asserting expected confidence bands — this is what catches a scoring-formula regression before it reaches production, not just "does the code run."
- **Deliberately adversarial fixtures**: addresses with no reasonable match, addresses matching multiple very-close-confidence candidates (ambiguous — both should land in "needs review," neither should win by accident), coordinates outside Massachusetts.
- **Adapter-level tests** for MassGIS/property-map/geocoder integrations still run against recorded fixtures, never live sources, per doc 01 §13.

---

## 10. Risks and Limitations (per KT §22 — stated plainly, not hidden)

- **Fuzzy matching can still rank a wrong candidate first**, especially given how many Massachusetts towns share common street names ("Main Street" exists in dozens of MA municipalities). The approved no-silent-auto-confirm policy (§0) is the primary mitigation — a human always looks at the evidence before it becomes the confirmed identity — but it doesn't eliminate the risk of an analyst clicking through a wrong high-confidence suggestion without scrutinizing it.
- **MapGeo gap**: for towns where MapGeo is genuinely the most current/authoritative source, SiteIQ's automated data may be thinner or slightly staler than a manual MapGeo check would surface. This is a known, accepted MVP limitation per the client's decision (§0), not an oversight.
- **Mirror freshness**: the local parcel mirror (§8) is only as current as its last scheduled refresh, not live. Shown transparently via a retrieval timestamp; not hidden.
- **Address parsing edge cases**: rural, PO-box-only, or otherwise non-standard MA addresses (more common in parts of Western MA) are harder to normalize and more likely to fall through to the spatial/coordinate path or manual entry — an accepted limitation of automated address parsing generally, not specific to this design.
- **Zoning coverage remains uneven** town-by-town, as already flagged in doc 01 §7/§21 — unchanged by this addendum.
- **Geocoder dependency**: the US Census Geocoder is a free public service without a formal SLA. Flagged as a dependency risk; a paid geocoder (Google/Mapbox) is a documented fallback-of-fallback if reliability becomes a real problem post-launch, at added cost — not adopted preemptively given MVP budget concerns already raised in doc 01 §16.1.
- **Two named sources need verification before Checkpoint 5**, as flagged in §3's table — specifically whether MassGIS's exact access mechanism and the Interactive Property Map's relationship to it are what this document assumes.

---

## 11. Repository Structure Additions (extends doc 01 §19)

```
apps/api/src/modules/
├── matching/            NEW — matching pipeline orchestration, confidence scoring
├── geocoding/            NEW — US Census Geocoder adapter
├── parcels/              (existing) — now includes the parcel-data-refresh mirror-sync logic
packages/shared/
└── matching-config.ts    NEW — confidence weights, bands, search radius (single source of truth, §2.1/§2.2)
docs/adr/
└── 0007-local-parcel-mirror.md   NEW (see below)
```

---

## 12. Milestones — Update to Doc 01 §20

**Checkpoint 5 (External data integration)** is now understood to include, not just parcel/zoning adapters:
- The `parcel-data-refresh` mirror-sync job and its schema (trigram + spatial indexes).
- The full matching pipeline (§2) and its confidence-scoring config.
- The candidate-review UI (§7 — one new wireframe/flow to design, either now or at the start of this checkpoint).
- Golden-fixture matching test suite (§9).

No other checkpoint changes — everything else in doc 01 §20 stands.

---

**Next step:** awaiting your review of this addendum specifically. Once approved, I'll add ADR-0007 (local parcel mirror) alongside the existing six, and — your call from §7 — either produce the candidate-review wireframe now or fold it into the start of Checkpoint 5.
