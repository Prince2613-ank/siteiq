# SiteIQ — Data Model & API Contract (Checkpoint 3)

Status: **Draft for client review — no implementation started.**
Builds on the approved [`01-technical-discovery.md`](./01-technical-discovery.md) and [`02-property-matching-architecture.md`](./02-property-matching-architecture.md). This document is the concrete schema (`prisma/schema.prisma`) and API contract for the complete approved workflow:

```
Create Site → Automated Matching → Candidate Review → Confirm Parcel →
Parcel/Zoning Enrichment → Field Conflict Review → Analysis → Report
```

## Client requirement carried in from wireframe approval

On "Confirm Selected Parcel," the system must record: who confirmed it, when, which candidate/parcel was selected, which `MatchAttempt` produced it, confidence/evidence at confirmation time, an optional analyst note, and whether a duplicate decision was made — so a report or audit review can always answer *"why did SiteIQ decide this was the correct parcel, and who approved it?"* This is implemented as a single atomic write, detailed in §2.

---

## 1. Schema Walkthrough

The full schema is [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma) — this section explains the shape, not the syntax.

**Three provenance layers, same pattern throughout, per the "never silently invent or hide" principle:**

| Layer | Current/fast-read copy | Full history |
|---|---|---|
| Property identity | `Site.parcelRef`, `.latitude/.longitude`, `.matchConfidence`, `.identityStatus` | `MatchAttempt` + `SiteMatchCandidate` (every attempt, every candidate ever surfaced) |
| Field values | `Site.lotSize`, `.zoningCode`, etc. | `SiteDataField` + `SiteDataFieldApproval` (every observation, every approval decision) |
| Reports | — (reports aren't "current" data) | `Report.contentSnapshot`, immutable per doc 01 §4.3 |

`Site` never holds the only copy of anything important — it's a denormalized cache of "what's currently confirmed," always traceable back to the append-only table that actually decided it. This is why list/search/filter (KT §11) can stay fast (plain `Site` queries, no joins needed for the common case) while still being fully auditable.

**Two review workflows, two schemas, deliberately not shared** (client's explicit instruction, wireframe review point 7):

- **Property-identity review** — "is this the right parcel?" — `SiteMatchCandidate.status/decidedBy/decidedAt/note`.
- **Field-value review** — "which source's lot size is correct?" — `SiteDataFieldApproval`.

They look structurally similar (both are "append-only observations + a decision record") because they're the same *category* of problem, but they're separate tables with separate APIs, exactly matching the two separate wireframe screens (4b vs. 6).

---

## 2. The Confirmation Write — Satisfying the Audit Requirement

`POST /api/v1/sites/:id/match-attempts/:attemptId/candidates/:candidateId/confirm`

**Request:**
```json
{
  "note": "Assessor address and MassGIS parcel record both point here; confirming.",
  "duplicateDecision": "CONTINUED_SEPARATE"   // required only if this candidate is flagged as a duplicate — see below
}
```

### 2.0 Server-enforced duplicate decision (client requirement — closes a bypass-the-UI gap)

`duplicateDecision` is not a free-form optional field the caller can leave at `NONE` — its valid values depend on whether **the candidate itself** carries a duplicate flag:

- The matching pipeline (worker) sets `SiteMatchCandidate.duplicateOfSiteId` at candidate-creation time, whenever that candidate's `parcelRef` already belongs to another active (non-archived, non-merged) `Site` in the organization. This is evidence attached to the candidate, computed once, before any human ever sees it — not something the confirm request can spoof, since the caller never sets `duplicateOfSiteId` directly.
- The confirm endpoint validates the request **against that stored flag**, server-side, before touching anything:
  - If `candidate.duplicateOfSiteId IS NOT NULL` → the request's `duplicateDecision` **must** be `OPENED_EXISTING` or `CONTINUED_SEPARATE`. `NONE` (or omitting the field) is rejected with `422 Unprocessable Entity` — `{"error": {"code": "DUPLICATE_DECISION_REQUIRED", "message": "This candidate matches parcel <ref> on an existing active site; specify OPENED_EXISTING or CONTINUED_SEPARATE."}}`.
  - If `candidate.duplicateOfSiteId IS NULL` → `duplicateDecision` **must** be `NONE` (or omitted, which defaults to `NONE`). Passing `OPENED_EXISTING`/`CONTINUED_SEPARATE` on a non-duplicate candidate is also rejected (`422`) — a decision can't be recorded about a duplicate that doesn't exist.
- This validation runs in the same NestJS service method that starts the transaction below — there is no code path (including a direct API call bypassing the wireframe) that can confirm a flagged-duplicate candidate without an explicit decision. It's the same "the backend is the actual gate, not the frontend" principle already established for authorization (doc 01 §6).

**What happens, in one DB transaction** (so it's all-or-nothing — never a half-confirmed state), after the above validation passes:

1. The target `SiteMatchCandidate` row is updated: `status = ACCEPTED`, `decidedById = <current user>`, `decidedAt = now()`, `note = <from request>`, `duplicateDecision = <from request>`. This single row **is** the permanent answer to "who confirmed it, when, with what note, and what was the duplicate call" — it is never edited again after this write.
2. Every sibling candidate from the same `attemptId` is set `status = REJECTED` (if `PROPOSED`) — so the full candidate set's outcome is preserved (client's "3 possible properties" example stays inspectable: which two were passed over and why they scored lower is still in `evidence`).
3. `Site` is updated: `confirmedCandidateId = <candidate id>`, `identityStatus = CONFIRMED`, `parcelRef`/`latitude`/`longitude`/`parcelGeom` copied from the candidate, `matchConfidence = candidate.confidence` (the exact confidence **at the moment of confirmation** — if the underlying parcel mirror data changes later, this historical number doesn't drift), `matchMethod = attempt.strategyUsed`.
4. If `duplicateDecision = OPENED_EXISTING`: the transaction instead redirects — this site is soft-deleted with `mergedIntoSiteId` set to `candidate.duplicateOfSiteId` (doc 01 §4.1's merge flow), and no `Site.confirmedCandidateId` is ever set on the abandoned record.
5. An `ActivityEvent` (`eventType: "parcel_confirmed"`) is written **on this site** with a `metadata` snapshot of `{candidateId, attemptId, parcelRef, confidence, evidence, duplicateDecision, duplicateOfSiteId}` — this is what makes the confirmation show up in Activity History (wireframe Screen 10) without a join back to `SiteMatchCandidate`. When `duplicateDecision != NONE`, a **second** `ActivityEvent` (`eventType: "duplicate_decision_recorded"`) is written on *both* sites involved — see §2.1.
6. Any `AnalysisRun` still `QUEUED`/`PROCESSING` that started before this confirmation keeps its `isPreliminary = true` flag (it doesn't retroactively become non-preliminary — a new run must be started to get a non-preliminary result, keeping the wireframe's "preliminary" label honest about what it actually reflects).

### 2.1 Duplicate/merge decisions in Activity History (client requirement)

Both the confirm endpoint's `OPENED_EXISTING`/`CONTINUED_SEPARATE` path (§2 step 5) and the standalone `POST /sites/:id/duplicate-resolution` endpoint (§3, for a duplicate flag surfaced *after* confirmation by a later re-match) write the same shape of `ActivityEvent`, so Activity History can always answer the client's five questions in one place without cross-referencing tables:

```json
{
  "eventType": "duplicate_decision_recorded",
  "siteId": "<the site the flag was raised on>",
  "actorId": "<who decided>",
  "createdAt": "<when>",
  "metadata": {
    "consideredDuplicateSiteId": "<the site flagged as a possible duplicate>",
    "canonicalSiteId": "<the site kept as the record of truth>",
    "action": "merged" | "dismissed",
    "sourceCandidateId": "<SiteMatchCandidate id, if raised via confirmation>"
  }
}
```

This event is written **on both sites** (the flagged one and the canonical one) with identical `metadata`, so opening either site's Activity History independently answers "which site was the duplicate, which became canonical, who decided, when, and merged-or-dismissed" — no need to know in advance which side of the pair you're looking at.

**Response:**
```json
{
  "site": { "id": "...", "identityStatus": "CONFIRMED", "parcelRef": "04-112-0034", "matchConfidence": 94, "matchMethod": "FUZZY" },
  "confirmedCandidate": {
    "id": "...", "status": "ACCEPTED", "decidedById": "u_123", "decidedAt": "2026-09-03T09:20:00Z",
    "confidence": 94, "evidence": { "addressSimilarity": 0.97, "distanceMeters": 18, "parcelIdMatch": true, "municipalityMatch": true, "sourceName": "MassGIS", "retrievedAt": "2026-09-03T09:14:00Z" },
    "note": "Assessor address and MassGIS parcel record both point here; confirming.",
    "duplicateDecision": "CONTINUED_SEPARATE"
  }
}
```

Every field the client listed (who, when, which candidate, which attempt, confidence/evidence at the time, note, duplicate decision) is present in this one response and permanently queryable via `GET /sites/:id/match-attempts/:attemptId/candidates` afterward.

---

## 3. Full API Contract

Builds on doc 01 §5 and doc 02 §5 — consolidated here as the complete endpoint set for this workflow. All routes under `/api/v1`, all scoped server-side to `req.user.organizationId`, all validated with the shared Zod schemas (doc 01 §5's validation-strategy resolution).

### Auth
```
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
GET    /auth/me
POST   /auth/accept-invite        { token, password }
POST   /auth/forgot-password      { email }
POST   /auth/reset-password       { token, password }
```

### Users (admin only, except /me)
```
GET    /users
POST   /users/invite              { email, role }
POST   /users/:id/resend-invite
PATCH  /users/:id                 { role?, isActive? }
```

### Sites — creation & identity (the new workflow)
```
POST   /sites                                          { originalInputType, address?, parcelRef?, lat?, lng?, name?, assignedAnalystId? }
       → 201 { id, identityStatus: "IDENTIFYING" }      (MatchAttempt queued immediately, worker picks it up)

GET    /sites/:id                                       full Site record (identityStatus tells the frontend which wireframe state to render)

GET    /sites/:id/match-attempts
GET    /sites/:id/match-attempts/:attemptId
GET    /sites/:id/match-attempts/:attemptId/candidates   ranked list, full evidence per candidate (Screen 4b's data source)

POST   /sites/:id/match-attempts/:attemptId/candidates/:candidateId/confirm   see §2
POST   /sites/:id/match-attempts/:attemptId/reject-all   { }
       → sets Site.identityStatus = MANUAL, all candidates REJECTED — KT §12's manual path

POST   /sites/:id/re-match                                { address?, parcelRef?, lat?, lng? }
       → queues a new MatchAttempt; if its top candidate conflicts with an already-CONFIRMED
         identity, returns a flagged-discrepancy response rather than auto-updating (doc 02 §2.3)
```

### Sites — list, update, lifecycle
```
GET    /sites?search=&status=&municipality=&zoning=&analyst=&matchStatus=&updatedAfter=&cursor=&limit=
PATCH  /sites/:id                 { name?, assignedAnalystId?, investigationStatus? }   — metadata only, never lotSize/zoningCode/etc. (see §2.2)
DELETE /sites/:id                 (admin, soft delete)
POST   /sites/:id/duplicate-resolution   { action: "merge" | "dismiss", canonicalSiteId? }   (doc 01 §4.1 — for a duplicate flag surfaced after confirmation, e.g. by a later re-match; writes the same ActivityEvent shape as §2.1)
```

### Field-level data (separate from identity — §1)
```
GET    /sites/:id/fields                                  all SiteDataField rows, grouped by fieldName
GET    /sites/:id/fields/:fieldName/approvals              SiteDataFieldApproval history for one field
POST   /sites/:id/fields/:fieldId/approve                  { note? }   → resolves a conflict or confirms a low-confidence value
POST   /sites/:id/fields/manual                            { fieldName, value, note? }   → manual observation entry, see §2.2
```

### 2.2 Manual field entry goes through provenance, never direct `Site` edits (client requirement)

There is deliberately **no** API that writes straight to `Site.lotSize`, `Site.zoningCode`, or any other collected-data field — not even when `identityStatus = MANUAL` and there's no automated observation to compare against. `PATCH /sites/:id` only ever touches genuine site *metadata* (name, assignment, investigation status) that was never part of the provenance model to begin with.

Instead, `POST /sites/:id/fields/manual` is a thin, explicit wrapper around the same machinery `SiteDataField`/`SiteDataFieldApproval` already provide for automated sources (doc 01 §4.2, §8):

1. Writes a new `SiteDataField` row: `sourceName = "Manual"`, `retrievedAt = now()`, `status = MATCHED` (an analyst directly asserting a value is treated as a confident, first-class observation — not `NEEDS_REVIEW` by default), `confidence = null` (confidence scoring doesn't apply to a human-entered value), `fieldType`/`value` inferred from the field's config the same way an adapter's output would be.
2. Runs through the **exact same normalization rule** as any other observation (doc 01 §8): if there's no existing value for that field, or the new value agrees with the current one, it's marked `isCurrent = true` and `Site.<field>` is updated. If it *disagrees* with an existing automated (or prior manual) observation, both are marked `conflicting` and `Site.<field>` is **not** touched — the manual entry doesn't get special authority to silently override an existing value; it goes through Conflict Resolution (Screen 6) like any other disagreement.
3. Writes a `SiteDataFieldApproval` row exactly as the field-approval endpoint does, so "a human typed this value in directly, here's who and when" is recorded with the same rigor as an automated-then-approved value — there's no second-class, unaudited path for manually entered data.

This means manual entry, automated observation, and conflict resolution are all expressions of the same underlying model — the API surface is different (a human is asserting a value vs. an adapter reporting one), but the data never bypasses provenance to reach `Site` directly.

### Documents
```
GET    /sites/:id/documents
POST   /sites/:id/documents                { filename, mimeType, sizeBytes }  → { uploadUrl, documentId }  (presigned S3 URL, doc 01 §10)
POST   /sites/:id/documents/:docId/complete
GET    /documents/:id                       → { downloadUrl }
DELETE /documents/:id
```

### Analysis
```
POST   /sites/:id/analysis-runs
GET    /sites/:id/analysis-runs
GET    /analysis-runs/:id
POST   /analysis-runs/:id/retry
```
`AnalysisRun.isPreliminary` (schema §1) is set from `Site.identityStatus !== 'CONFIRMED'` at creation time — the API never needs a separate "is this preliminary" computation elsewhere; the frontend just reads the flag.

### Notes & Activity
```
GET    /sites/:id/notes
POST   /sites/:id/notes            { body }
GET    /sites/:id/activity
```

### Reports
```
POST   /sites/:id/reports
GET    /sites/:id/reports
GET    /reports/:id
```

---

## 4. Example: The Full Happy-Path Sequence

Mirrors the approved wireframe flow exactly:

```
1.  POST /sites {originalInputType:"address", address:"142 Elm Street, Worcester, MA 01609"}
    → 201, identityStatus: IDENTIFYING

2.  worker runs property-match job → MatchAttempt + 3 SiteMatchCandidate rows created
    → Site.identityStatus becomes NEEDS_REVIEW (frontend was polling GET /sites/:id)

3.  GET /sites/:id/match-attempts/:attemptId/candidates
    → 3 candidates, ranked, each with confidence + evidence (Screen 4b renders this directly)

4.  POST .../candidates/:id/confirm {note:"...", duplicateDecision:"CONTINUED_SEPARATE"}
    → Site.identityStatus = CONFIRMED, parcelRef/lat/lng populated, ActivityEvent logged (§2)

5.  worker runs zoning-lookup + remaining parcel-detail jobs against the confirmed parcelRef
    → SiteDataField rows created (some MATCHED, maybe one CONFLICTING)

6.  GET /sites/:id/fields → frontend shows Overview tab with status badges

7.  POST /sites/:id/fields/:fieldId/approve  → resolves the lot-size conflict (Screen 6)

8.  POST /sites/:id/analysis-runs → isPreliminary:false (identity already confirmed by now)
    → worker processes, GET /analysis-runs/:id polled until COMPLETED

9.  POST /sites/:id/reports → immutable contentSnapshot captured, including the confirmed
    identity's confidence/evidence as they stood at generation time
```

---

## 5. Validation (Zod) — Two Representative Schemas

Per doc 01 §5's resolved validation strategy (Zod only, via `nestjs-zod`), shared between frontend and backend from `packages/shared`:

```ts
export const CreateSiteSchema = z.object({
  originalInputType: z.enum(['address', 'parcel_id', 'coordinates', 'address_and_coordinates']),
  address: z.string().min(3).optional(),
  parcelRef: z.string().optional(),
  lat: z.number().min(41.2).max(42.9).optional(),  // rough MA bounding box — a soft guard, not a hard geofence
  lng: z.number().min(-73.6).max(-69.9).optional(),
  name: z.string().optional(),
  assignedAnalystId: z.string().uuid().optional(),
}).refine(
  (v) => v.address || v.parcelRef || (v.lat !== undefined && v.lng !== undefined),
  { message: 'At least one of address, parcelRef, or lat+lng is required' }
);

export const ConfirmCandidateSchema = z.object({
  note: z.string().max(1000).optional(),
  duplicateDecision: z.enum(['NONE', 'OPENED_EXISTING', 'CONTINUED_SEPARATE']).default('NONE'),
});

export const ManualFieldEntrySchema = z.object({
  fieldName: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
  note: z.string().max(1000).optional(),
});
```

`ConfirmCandidateSchema` validates *shape* only (Zod can't know whether this specific candidate is flagged as a duplicate). The §2.0 rule — `duplicateDecision` must be `NONE` iff the candidate has no `duplicateOfSiteId` — is checked in the service layer against the loaded candidate row, after shape validation passes and before the transaction opens. Shape validation and business-rule validation are different concerns and deliberately live in different layers (doc 01 §16's "backend validates input, enforces permissions" split).

---

## 6. Migration Notes (for the first `prisma migrate` — not run yet)

Three things Prisma's schema DSL can't express directly, added as raw SQL in the initial migration:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Fast fuzzy address search against the local parcel mirror (doc 02 §8)
CREATE INDEX parcel_mirror_address_trgm_idx
  ON "ParcelMirrorRecord" USING GIN (address gin_trgm_ops);

-- Spatial search indexes
CREATE INDEX parcel_mirror_geom_gist_idx ON "ParcelMirrorRecord" USING GIST (geom);
CREATE INDEX parcel_mirror_centroid_gist_idx ON "ParcelMirrorRecord" USING GIST (centroid);
CREATE INDEX site_parcel_geom_gist_idx ON "Site" USING GIST ("parcelGeom");
CREATE INDEX candidate_geom_gist_idx ON "SiteMatchCandidate" USING GIST ("candidateGeom");
```

These live in the migration file itself (versioned, applied by `prisma migrate deploy` alongside the generated migration), not run manually — satisfies "database changes must be migration-based" (doc 01 §15) even for the parts Prisma's DSL doesn't cover natively.

---

**Next step:** awaiting your review of the schema and API contract. Once approved, this becomes the reference for Checkpoint 4 (working authentication + site management) — the first checkpoint that produces running code.
