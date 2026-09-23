# SiteIQ — Technical Discovery Package

Status: **Revised per client review — architecture approved with changes, no implementation started.**
Scope: MVP as defined in `SiteIQ_Client_KT_Requirements.pdf`, Massachusetts only, single organization.

## Revision Log

**v2 (this revision)** — incorporates client's Checkpoint 1 review. Ten items resolved:

1. Validation strategy: **Zod chosen as the single source of truth** (§5) — `class-validator` dropped.
2. `SiteDataField` redesigned as strictly append-only with a separate `SiteDataFieldApproval` audit table and typed values (§4).
3. Duplicate reconciliation strategy defined — detect, flag, human-decided merge (§4, §5).
4. Reports formalized as immutable point-in-time snapshots, independent of later `Site` edits (§4).
5. Authorization model updated: assignment is informational, not access-restricting; analysts can work any active org site (§6).
6. Full invitation and password-reset lifecycle specified (§6).
7. AWS MVP cost estimate added — cheapest vs. recommended tiers (§16).
8. Map tile provider licensing flagged explicitly as dev-only until verified for production (§11).
9. ADR strategy defined, six initial ADRs written (§19, `docs/adr/`).

All other sections (architecture, frontend/backend framework choices, PostGIS, adapter pattern, conflict-resolution flow, background jobs, Docker, testing, CI/CD) are unchanged from v1 and were approved as-is.

Business decisions already confirmed with the client (see conversation record) and assumed throughout this document:

| Question | Decision |
|---|---|
| Conflicting source values | Never auto-merge. Store all values with source + timestamp, mark field `conflicting`, require analyst approval before it counts as confirmed. |
| Valid site / duplicates | Any address/coordinate can be entered. Once a parcel ID resolves, warn/block creating a second site against the same parcel within the org. |
| Multi-organization | Schema is org-scoped from day one (`organization_id` on every tenant table), but MVP ships with a single seeded organization — no org-switching or org-admin UI yet. |
| Site deletion / offboarding | Only Administrators can delete, and it's a soft delete (archived, not purged). When an analyst is deactivated, their sites become `unassigned`, not deleted. |
| Manual approval gate | Conflicting fields **and** low-confidence/partial matches both require explicit analyst approval before being treated as confirmed. |
| Cloud provider | Developer's choice — see §16. |
| Scale target | Small internal team (~5–20 analysts, low hundreds of sites/month). Architecture intentionally avoids premature scale investment. |
| MA data sources | To be sourced from free/public official channels — see §7 and the verification list in §21. |

---

## 1. Proposed System Architecture

A modular monolith, not microservices. One backend codebase, three deployable processes sharing it: an **API server**, a **background worker**, and a **frontend SPA** served separately. All three talk to one PostgreSQL database and one Redis instance.

```
┌─────────────┐      HTTPS       ┌──────────────────┐
│  React SPA  │ ───────────────► │   API (NestJS)    │
│  (browser)  │ ◄─────────────── │  REST, JSON        │
└─────────────┘                  └─────────┬─────────┘
                                            │
                     ┌──────────────────────┼───────────────────────┐
                     ▼                      ▼                       ▼
             ┌───────────────┐      ┌───────────────┐       ┌───────────────┐
             │ PostgreSQL +   │      │  Redis (queue) │       │  S3-compatible │
             │ PostGIS        │◄────►│  BullMQ         │       │  object storage│
             └───────────────┘      └───────┬────────┘       └───────────────┘
                                             ▼
                                    ┌───────────────────┐
                                    │  Worker process     │
                                    │  (parcel/zoning      │
                                    │   lookups, analysis) │
                                    └───────┬───────────┘
                                            ▼
                                 ┌─────────────────────────┐
                                 │ External data sources    │
                                 │ (MassGIS, town assessors) │
                                 └─────────────────────────┘
```

**Why a modular monolith over microservices:** one developer, MVP scope, small team scale. Microservices add network boundaries, deployment complexity and operational overhead that buy nothing at this scale and slow a solo developer down. The monolith is kept honest by strict internal module boundaries (see §19 folder structure) so it can be split later if a specific piece (e.g. the worker) genuinely needs to scale independently — it already runs as a separate process, so that split is cheap when it's actually needed.

**Alternative considered:** microservices per domain (sites, documents, analysis). Rejected for MVP — the coordination cost (service discovery, distributed transactions for something like "create site + log activity + trigger lookup") isn't justified by 5–20 users.

---

## 2. Frontend Architecture

- **Framework:** React 18 + TypeScript, built with Vite.
- **Data fetching/cache:** TanStack Query (React Query) for all server state — handles loading/error/retry states declaratively, which maps directly to the "analysis Queued→Processing→Completed" polling requirement and the "don't crash on API failure" requirement.
- **Routing:** React Router.
- **Styling/components:** Tailwind CSS + a small headless component set (Radix UI primitives) — fast to build a data-dense internal tool without shipping a heavy design system.
- **Forms/validation:** React Hook Form + Zod, with the **same Zod schemas shared with the backend** via a `packages/shared` package, so validation rules are defined once, not duplicated.
- **Map:** Leaflet (see §11).

**Why React over alternatives:** largest ecosystem for map/GIS plugins (react-leaflet, deck.gl if needed later), TanStack Query solves async-state UX cleanly, and TypeScript end-to-end lets the same DTOs flow from Prisma → API → frontend with no re-typing.

**Alternatives considered:**
- *Next.js* — rejected for MVP. Its value (SSR, file-based routing, SEO) doesn't matter for an internal, authenticated tool; a plain Vite SPA is simpler to reason about and deploy. Revisit only if public-facing pages are ever needed.
- *Vue/Svelte* — smaller ecosystems for the GIS/map tooling this project leans on; no other advantage strong enough to offset that.

---

## 3. Backend Architecture

- **Runtime/language:** Node.js + TypeScript.
- **Framework:** NestJS.

**Why NestJS:** the KT doc explicitly forbids "one giant backend file" and "business logic scattered randomly." NestJS enforces a module/controller/service/repository structure via its DI container, so that discipline is structural, not just a convention I have to remember to follow solo. It also has first-class support for the things this project needs out of the box: guards (→ RBAC), pipes (→ validation), interceptors (→ logging/response shaping), and a mature testing module.

**Alternatives considered:**
- *Express* — more minimal/flexible, but all the structure NestJS gives for free (modules, DI, guards) would have to be hand-rolled and self-enforced, which is a real risk for a solo developer on a multi-month build. Rejected for MVP; not for lack of capability, but because Nest removes an entire category of self-discipline risk.
- *Python (FastAPI/Django)* — genuinely strong contender because of GeoDjango's mature native GIS ORM support. Rejected mainly for **one-language leverage**: as a solo full-stack developer, sharing TypeScript types/DTOs and validation schemas between frontend, backend and worker (via `packages/shared`) removes a whole class of drift bugs. PostGIS via raw SQL (see §4) closes most of the GIS-ORM gap this would have solved.
- *Ruby on Rails* — strong conventions similarly to Nest, but weaker TypeScript-sharing story with a TS frontend, and smaller current GIS ecosystem.

---

## 4. Database / Entity Design

- **Database:** PostgreSQL 16 with the **PostGIS** extension.

**Why Postgres+PostGIS:** parcel boundaries, "nearby sites," and basic measurement are inherently spatial. PostGIS is the de facto standard for this, is free, and runs anywhere Postgres runs — no separate GIS database to operate. Relational integrity (foreign keys, migrations, transactions) also matches the audit/history requirements far better than a document store would.

**Alternative considered:** MongoDB — rejected; the data is highly relational (org→users→sites→fields/documents/notes/activity) and the audit-trail requirement wants strong consistency and joins, which Postgres does natively and Mongo fights.

- **ORM:** Prisma, for schema-as-code migrations (satisfies "database changes must be migration-based") and end-to-end TypeScript types. Prisma's native support for PostGIS geometry columns is limited, so spatial columns/queries (parcel boundary storage, "nearby sites" radius search) are isolated behind a small `GeoRepository` that uses `$queryRaw` with PostGIS functions (`ST_DWithin`, `ST_AsGeoJSON`, etc.). This keeps the geometry-specific SQL in one place rather than leaking `$queryRaw` calls throughout the codebase.

  **Alternative considered:** TypeORM — has more native geometry column support, which would avoid the raw-SQL carve-out above. Rejected in favor of Prisma's stronger migration DX and type generation, since the carve-out is small and contained (one repository, not a scattered pattern).

### Core entities

```
Organization
 ├─ id, name, created_at

User
 ├─ id, organization_id → Organization
 ├─ email (unique), password_hash, role (admin|analyst|viewer)
 ├─ is_active, created_at, updated_at

Site
 ├─ id, organization_id → Organization
 ├─ name, street_address, city, state, zip
 ├─ parcel_ref, latitude, longitude, parcel_geom (PostGIS geometry, nullable)
 ├─ lot_size, lot_size_unit, zoning_code, zoning_district, municipality
 ├─ match_status (matched|partial|no_match|source_unavailable|needs_review)
 ├─ investigation_status (new|in_progress|needs_review|completed|archived)
 ├─ assigned_analyst_id → User (nullable = unassigned; informational only, see §6)
 ├─ potential_duplicate_of_site_id → Site (nullable, self-FK; see §4.1)
 ├─ merged_into_site_id → Site (nullable, self-FK; see §4.1)
 ├─ created_by_id → User, created_at, updated_at, deleted_at (soft delete)

SiteDataField          -- append-only observation log (see §4.2, §8)
 ├─ id, site_id → Site
 ├─ field_name (e.g. "lot_size", "zoning_code", "assessed_value", "coordinates")
 ├─ field_type (number | string | boolean | date | geo)
 ├─ value (JSONB — raw typed value: number, string, bool, ISO date, or {lat,lng}/GeoJSON)
 ├─ numeric_value (numeric, nullable — populated only when field_type = number; enables sorting/range/tolerance comparisons without JSONB casts)
 ├─ source_name, source_url, retrieved_at
 ├─ status (matched|partial|no_match|source_unavailable|field_unavailable|conflicting|needs_review)
 ├─ confidence (0–1, nullable)
 ├─ is_current (bool — the only mutable column on this table; see §4.2)
 ├─ created_at (immutable)

SiteDataFieldApproval   -- append-only decision log (see §4.2)
 ├─ id, site_id → Site, field_name
 ├─ approved_field_id → SiteDataField     (the observation chosen as current)
 ├─ previous_field_id → SiteDataField (nullable — what was current immediately before)
 ├─ approved_by_id → User, approved_at
 ├─ note (nullable — analyst's reasoning, optional)

Document
 ├─ id, site_id → Site
 ├─ filename, storage_key, mime_type, size_bytes
 ├─ uploaded_by_id → User, uploaded_at, deleted_at (soft delete)

AnalysisRun
 ├─ id, site_id → Site
 ├─ status (queued|processing|completed|failed)
 ├─ triggered_by_id → User
 ├─ started_at, completed_at, error_message, retry_count
 ├─ result (JSON — checklist/findings, see §10)

Note
 ├─ id, site_id → Site, author_id → User, body, created_at

ActivityEvent
 ├─ id, organization_id, site_id → Site (nullable for org-level events)
 ├─ actor_id → User, event_type, metadata (JSON), created_at

Report                  -- immutable snapshot, see §4.3
 ├─ id, site_id → Site, generated_by_id → User
 ├─ generated_at, snapshot_version (int), content_snapshot (JSON, immutable after insert)
 ├─ storage_key (rendered PDF, nullable)
```

**Why a separate `SiteDataField` table instead of status columns bolted onto `Site`:** the KT doc requires knowing, per field, where a value came from, when, and its match/confidence status — and requires surfacing conflicting values, not silently picking one. A single `Site` row can only hold one "current" value per field. `SiteDataField` keeps the full history (every source's attempt), while `Site` holds only the denormalized *current, approved* value for fast reads (list/search/filter). This is more tables than a naive design, but it's the only way to satisfy "no silent invention" and per-field provenance without cramming multi-valued history into single columns.

### 4.1 Duplicate Reconciliation

The confirmed business rule is: any address/coordinate can be entered at creation time (no parcel match is required to start an investigation), but once a parcel ID resolves for a site, the system must not let two active sites silently represent the same real property.

**Scenario:** User A creates a site for "123 Main Street" — no parcel match yet. Independently, User B creates a site for "123 Main St." — also no parcel match yet. Days later, a re-run lookup resolves *both* to parcel `ABC-123`.

**Detection.** Parcel resolution happens inside the `parcel-lookup` worker job (§7, §9), not at site creation, since a parcel ID often isn't knowable up front. Whenever a job successfully resolves a `parcel_ref` for a site, it checks — scoped to the organization — whether any other **active** (non-archived, non-merged) site already has that same `parcel_ref`. This is a query, not a database unique constraint, because the condition is "warn," not "silently reject."

**Flagging, not merging.** If a match is found, nothing is auto-merged. Both sites are updated: `potential_duplicate_of_site_id` is set pointing at the other, `match_status` moves to `needs_review`, and an `ActivityEvent` (`potential_duplicate_detected`) is logged on both. The Site Detail page shows a persistent "Possible Duplicate" banner with a link to the other site whenever `potential_duplicate_of_site_id` is set and not yet dismissed.

**Human resolution.** Any analyst or admin viewing either flagged site can choose:
- **Merge into this site** — the user picks which of the two becomes canonical. The merge operation re-parents every `SiteDataField`, `SiteDataFieldApproval`, `Document`, `Note`, `ActivityEvent`, and `AnalysisRun` row from the duplicate onto the canonical site (an `UPDATE ... SET site_id`, run in one DB transaction — nothing is deleted or recreated, so no history is lost), then soft-deletes the duplicate with `merged_into_site_id` set to the canonical site's id. Both sites' `ActivityEvent` timelines get a `site_merged` entry. The duplicate site remains fetchable by its old id (e.g. from an old bookmark or report) and simply redirects/shows a "merged into Site #X" notice — it is never hard-deleted.
- **Not a duplicate** — clears `potential_duplicate_of_site_id` on both sites and logs the dismissal (e.g. two legitimately adjacent parcels that shared an ambiguous address). The flag will not re-trigger for that pair unless manually re-run.

This satisfies "we don't end up with two silently duplicated investigations": detection is automatic, resolution is always a deliberate, audited human action.

### 4.2 Strengthened Audit/Approval Semantics

Two rules make the history tamper-proof by construction, not just by convention:

1. **`SiteDataField` rows are never updated except the `is_current` boolean.** Every new observation — whether it's the first read for a field, a re-confirmation, or a conflicting value — is always a new `INSERT`, never an `UPDATE` of an existing row's `value`/`source`/`status`. So in the client's example (assessor 25,000 → conflict with zoning source 27,000 → new assessor read 25,500), all three rows exist forever, unedited. Toggling `is_current` on the winning row (and off on its predecessor) doesn't destroy or overwrite anything — it's metadata about which row is authoritative *right now*, and the full set of historical rows for that `field_name` is always retrievable with `SELECT * FROM site_data_fields WHERE site_id = ? AND field_name = ? ORDER BY created_at`.
2. **Every change of "current" is independently logged in `SiteDataFieldApproval`.** This is the piece the v1 design was missing: `is_current` alone tells you *what's current now*, not *the sequence of decisions that got you there*. `SiteDataFieldApproval` is itself insert-only and records who approved which observation, when, and what it replaced (`previous_field_id`) — so "show me every time this field's approved value changed, and who decided it" is a direct, simple query against one table, not a reconstruction from timestamps.

**Typed values.** v1 used `value: string | number`, which doesn't comfortably cover booleans, dates, or compound values like coordinates or parcel area (which may carry a unit). The revised design adds a `field_type` discriminator and stores the raw value in a `value` JSONB column — `25000` for a number, `"Industrial"` for a zoning code, `true`/`false` for boolean fields, an ISO-8601 string for dates, `{ "lat": 42.36, "lng": -71.06 }` for coordinates. A parallel `numeric_value` column is populated only for `field_type = number`, purely as a query-performance/indexing aid — it lets range filters, sorting, and the "tolerance" comparison used in conflict detection (§8) run as plain numeric comparisons instead of JSONB casts, without constraining every other field type to a rigid typed-column schema. New field types (e.g. a future multi-select field) need no migration — just a new `field_type` value and a JSON shape convention documented in code.

### 4.3 Report Immutability

A `Report.content_snapshot` is a deep copy taken at generation time — not a live view. It captures: the site's core identifying fields, every field's **currently approved** value along with its source, confidence, `approved_by`, and `approved_at` (i.e. a frozen copy of what `SiteDataField`/`SiteDataFieldApproval` said *at that moment*), the map's center/zoom and parcel geometry as of generation, the list of document metadata that existed at that time, all notes existing at generation time, and the analyst's conclusion text. Once written, `content_snapshot` is never updated by application code — the Reports tab always renders a report from its stored snapshot, never by re-joining today's `Site`/`SiteDataField` rows. So in the client's example, Report #1 permanently shows lot size 25,000 even after the live site is later corrected to 27,000. `snapshot_version` tags the shape of the JSON so a future change to what a report captures doesn't break rendering of older reports. A rendered PDF (`storage_key`, generated at the same time and stored in S3) is a second, belt-and-suspenders layer of immutability — even if the JSON renderer logic changes later, the original PDF a report actually represented is untouched.

---

## 5. API Design

REST, JSON, versioned under `/api/v1`. Resource-oriented, matching the KT doc's "likely resource areas" list.

```
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/auth/me

GET    /api/v1/users                     (admin)
POST   /api/v1/users/invite              (admin)
PATCH  /api/v1/users/:id                 (admin — role, active status)

GET    /api/v1/sites?search=&status=&municipality=&zoning=&analyst=&matchStatus=&updatedAfter=
POST   /api/v1/sites                     (create by address/parcel/coords)
GET    /api/v1/sites/:id
PATCH  /api/v1/sites/:id                 (name, notes-adjacent fields, assignment, status)
DELETE /api/v1/sites/:id                 (admin, soft delete)

POST   /api/v1/sites/:id/lookup          (trigger parcel + zoning lookup jobs)
GET    /api/v1/sites/:id/fields          (all SiteDataField rows, grouped by field, full history)
GET    /api/v1/sites/:id/fields/:fieldName/approvals   (SiteDataFieldApproval history for one field)
POST   /api/v1/sites/:id/fields/:fieldId/approve       (resolve conflict / confirm low-confidence value)

POST   /api/v1/sites/:id/duplicate-resolution          (body: { action: 'merge'|'dismiss', canonicalSiteId? })

GET    /api/v1/sites/:id/documents
POST   /api/v1/sites/:id/documents       (returns presigned upload URL, then metadata confirm)
GET    /api/v1/documents/:id             (returns presigned download URL)
DELETE /api/v1/documents/:id

GET    /api/v1/sites/:id/notes
POST   /api/v1/sites/:id/notes

POST   /api/v1/sites/:id/analysis-runs
GET    /api/v1/sites/:id/analysis-runs
GET    /api/v1/analysis-runs/:id
POST   /api/v1/analysis-runs/:id/retry

GET    /api/v1/sites/:id/activity

POST   /api/v1/sites/:id/reports
GET    /api/v1/sites/:id/reports
GET    /api/v1/reports/:id
```

- Every list endpoint supports pagination (`limit`/`cursor`) and the filters listed in KT §11.
- Every mutating endpoint is scoped to `req.user.organization_id` server-side — the org is never taken from the request body/query, closing the "access another org's data" risk in KT §12.
- Errors follow a single envelope: `{ error: { code, message, details? } }`, with codes mapped to HTTP status, so the frontend can render actionable messages instead of raw failures (KT §15).
- API documented via OpenAPI, generated from Nest decorators (`@nestjs/swagger`) — kept in sync with code by construction rather than hand-maintained.

**Validation strategy (resolved per client review): Zod only.** v1 proposed both shared Zod schemas *and* `class-validator` DTOs, which was two competing systems defining the same shapes. Zod wins: request/response shapes for the frontend forms already need to exist as Zod schemas in `packages/shared` (§2) so they can be reused for `react-hook-form` validation; keeping `class-validator` would mean hand-maintaining a second, decorator-based definition of the identical shape and manually keeping the two in sync. The backend uses [`nestjs-zod`](https://github.com/BenLorantfy/nestjs-zod) to turn each shared Zod schema into a Nest-compatible DTO class (`createZodDto`) wired through a `ZodValidationPipe`, replacing Nest's default `class-validator`-based `ValidationPipe` entirely. **Trade-off accepted:** `nestjs-zod`'s DTO classes still carry enough metadata for `@nestjs/swagger` to generate OpenAPI docs, but the integration is a notch less mature/battle-tested than native `class-validator` + `@nestjs/swagger`, which is the standard Nest combo — acceptable given it eliminates schema duplication entirely, which the client flagged as the priority.

---

## 6. Authentication and Authorization

- **Authentication:** email + password, bcrypt-hashed. JWT access token (short-lived, ~15 min) + rotating refresh token (httpOnly, secure cookie, ~7 days). No self-registration — an Administrator invites users (KT §12).
- **Authorization:** role-based (Administrator / Analyst / Viewer) enforced via Nest guards at the controller level, not in the frontend. Frontend hides UI affordances for UX only; the backend is the actual gate. Org-scoping (every query filtered by `organization_id` from the JWT) is a second, always-on guard layer.

**Why self-managed JWT auth over an auth-as-a-service (Auth0/Clerk/Cognito):** at 5–20 internal users with three fixed roles, a third-party IdP adds a monthly cost and an external dependency for a problem (login + 3 roles) that's genuinely small. Self-managed keeps full control and zero recurring cost.

**Trade-off / when to revisit:** self-managed auth means I own password-reset flows, brute-force protection, and token security correctness. If the client later wants SSO (Google Workspace/Microsoft), multi-org self-serve signup, or the user base grows well past "small internal team," an IdP (Auth0/Clerk/Cognito) becomes the better trade — worth flagging now so it's not a surprise later.

### 6.1 Authorization Model (resolved per client review)

Client's ruling: **assignment is organizational responsibility, not access control.** An analyst does not need to be the `assigned_analyst_id` on a site to view or work on it — assignment only answers "who owns following up on this," e.g. for the site list's "Assigned analyst" filter (KT §11). It is not enforced by any guard.

| Action | Administrator | Analyst | Viewer |
|---|---|---|---|
| View any active site in the org | ✅ | ✅ | ✅ |
| Create a site | ✅ | ✅ | ❌ |
| Edit site fields, resolve conflicts/approve values | ✅ | ✅ | ❌ |
| Add notes | ✅ | ✅ | ❌ |
| Upload / delete documents | ✅ | ✅ | ❌ |
| Trigger / retry analysis runs | ✅ | ✅ | ❌ |
| Generate reports | ✅ | ✅ | ❌ (view only) |
| Reassign a site's analyst | ✅ | ✅ | ❌ |
| Resolve duplicate flags (merge/dismiss) | ✅ | ✅ | ❌ |
| Archive / soft-delete a site | ✅ | ❌ | ❌ |
| Invite users, manage roles/active status | ✅ | ❌ | ❌ |

This replaces v1's open question about per-assignment ownership checks — there are none; the only two-tier split is Administrator (adds user management + archiving) vs. everyone-else-can-mutate-site-data vs. Viewer (read-only). Every row is still additionally gated by org-scoping (§5) regardless of role.

### 6.2 Invitation and Password-Reset Lifecycle

**Invitation:**
```
Admin (Users page) → "Invite user" (email + role)
   → User row created: is_active = false, invite_token (random, hashed at rest),
     invite_expires_at (+7 days)
   → Invite email sent (link: /accept-invite?token=...)
   → User opens link → sets password (min length/strength enforced client+server)
   → Account activated: is_active = true, invite_token cleared
   → Redirect to /login → normal JWT issuance
```
An expired or already-used invite token shows an actionable error with a "request a new invite" path (admin re-triggers from the Users page — same email, fresh token).

**Forgot password:**
```
/forgot-password (enter email)
   → if a matching active user exists: generate password_reset_token (hashed at rest,
     ~1 hour expiry) → email a reset link (/reset-password?token=...)
   → (if no matching user: same generic "check your email" response — no account
     enumeration via response differences)
   → user sets new password
   → password_hash updated, reset_token cleared, ALL existing refresh tokens for that
     user revoked (forces re-login on every device — standard practice after a password
     change, given these are internal property-investigation credentials)
```
**Email delivery:** AWS SES — fits the AWS stack (§16) directly, is inexpensive at this volume, and centralizes secrets/config with everything else already in Secrets Manager. Note: SES starts new accounts in a sending "sandbox" (recipient verification required, low send rate) and needs a one-time production-access request to AWS before go-live — flagged as a Checkpoint 9 deployment task, not a blocker for the architecture itself.

---

## 7. Parcel/Zoning Data Integration Strategy

**Adapter pattern**, one interface, swappable implementations:

```ts
interface ParcelDataProvider {
  lookupByAddress(address: NormalizedAddress): Promise<ProviderResult>;
  lookupByParcelId(parcelId: string): Promise<ProviderResult>;
}

interface ProviderResult {
  fields: { fieldName: string; value: string | number; confidence?: number }[];
  sourceName: string;
  sourceUrl?: string;
  retrievedAt: Date;
  matchStatus: 'matched' | 'partial' | 'no_match';
}
```

Each real integration (e.g. a MassGIS parcel service, an individual municipality's assessor system) is implemented as its own class behind this interface, registered in a small provider registry keyed by municipality/state. Nothing outside the `parcels`/`zoning` modules ever sees a provider's raw response shape — every provider implementation is responsible for mapping its own fields into `ProviderResult`. This directly satisfies KT §17 ("do not hard-code one website's response format throughout the application... normalize into our internal data model") and means adding a second state or replacing a source later is "write one new adapter class," not a rewrite.

Each provider call is wrapped with a timeout (AbortController) and try/catch at the call site; a failure never throws up into the request/job handler uncaught — it's translated into a `SiteDataField` row with `status = source_unavailable`, and the job continues to the next field/provider rather than aborting the whole lookup. This satisfies "external API failures should not crash the application" and "if an automated lookup fails, the user must be able to continue manually."

**Massachusetts sources (needs live verification — flagged, see §21):** based on existing knowledge, not confirmed today per your instruction to not block on live research:
- **MassGIS** (MassGIS / Bureau of Geographic Information, part of EOTSS) publishes a statewide "Standardized Assessors' Parcels" dataset aggregating municipal parcel data, usually available as GIS layers/downloads and sometimes via ArcGIS REST services.
- **Individual municipal assessor databases** — many MA towns publish parcel/assessment data through third-party vendor portals (e.g. Vision Government Solutions, Patriot Properties, Axis GIS), each with its own (often unofficial/no-key) access pattern. These are the most likely source of "some municipalities may not have the expected zoning layer" (KT §6) since coverage and format vary town by town.
- **Zoning** is generally *not* centralized statewide in a single authoritative dataset — it's typically published per-municipality (some via MassGIS-hosted layers, many not digitized at all). This is a real MVP risk: for many parcels, zoning may legitimately return `source_unavailable`, which is expected behavior per KT §6, not a bug.

The adapter boundary means the MVP can launch with parcel lookup covering a subset of MA municipalities (starting with whichever have clean digital data — likely MassGIS-covered towns) and expand coverage over time without touching the rest of the app.

---

## 8. Data Normalization and Conflict-Resolution Workflow

1. A lookup job (§9) calls one or more providers for a site's address/parcel.
2. Each returned field becomes a new `SiteDataField` row (never overwritten — full history kept).
3. Normalization rule per field:
   - **No existing value for this field** → new row inserted with `is_current = true` (if confidence is high) or `needs_review` (if confidence is low/partial), and `Site.<field>` is only updated automatically in the high-confidence case.
   - **New value agrees with current value** (exact or within tolerance for numeric fields like lot size) → row inserted, marked `is_current`, no action needed.
   - **New value disagrees with current value** → *both* rows marked `status = conflicting`, `Site.<field>` is **not** overwritten, and an `ActivityEvent` + in-app flag is raised for analyst review. This is the "flag, don't auto-resolve" rule confirmed with the client.
4. An analyst reviews conflicting/needs-review fields on the Site detail page (Overview + per-section tabs make it obvious what's confirmed vs. pending), and calls `POST /sites/:id/fields/:fieldId/approve`, which sets that row `is_current = true`, all sibling rows for that field `is_current = false`, updates `Site.<field>`, and logs an `ActivityEvent`.
5. Nothing is ever silently invented: a field with no successful source stays `null` on `Site` with the last known status (`no_match`/`source_unavailable`/`field_unavailable`) visible in the UI, per KT §2 and §6.

---

## 9. Background-Job Architecture

- **Queue:** BullMQ on Redis.

**Why BullMQ:** same language as the rest of the stack (no separate runtime like Python/Celery to operate), lightweight enough for small scale, built-in retry/backoff/delay support, and a dashboard (Bull Board) for visibility during development without extra infra.

**Alternative considered:** AWS SQS + Lambda — more "cloud native" and scales further, but adds AWS lock-in to the job layer specifically and is harder to run locally (LocalStack adds friction). Rejected for MVP; BullMQ can be swapped later behind a small `JobQueue` interface if true serverless scaling is ever needed.

- **Queues:** `parcel-lookup`, `zoning-lookup`, `analysis`, `report-generation`.
- **Worker:** a separate Node process (`apps/worker`) sharing the same modules/services as the API (same Prisma client, same provider adapters) — run as its own Docker container/process so a slow analysis job never blocks API request handling, satisfying KT §10 ("run for a while without blocking the user's browser") and §15 ("long-running work should run asynchronously").
- **Retry policy:** exponential backoff, max 3 attempts per job, then job/`AnalysisRun.status = failed` with `error_message` populated. The API exposes a `retry` endpoint that re-enqueues rather than auto-retrying forever, per KT §10's "retry option where appropriate."
- **Status visibility:** `AnalysisRun.status` (queued/processing/completed/failed) is updated by the worker at each stage and polled by the frontend via TanStack Query (short interval while status is non-terminal), giving the required Queued→Processing→Completed/Failed UI without needing websockets for MVP.

---

## 10. File/Document Storage

- **Storage:** S3-compatible object storage (AWS S3 in production, MinIO locally for parity — same API).
- **Flow:** client requests a presigned upload URL from the API (`POST /sites/:id/documents`), uploads directly to S3 from the browser (progress event available natively for the "show upload progress" requirement), then confirms completion so the API writes the `Document` metadata row. Downloads work the same way in reverse (short-lived presigned GET URL), so the API server never proxies file bytes.
- **Why presigned URLs over routing uploads through the API server:** keeps large file transfer off the Node process (memory/throughput), and is the standard, well-supported pattern for S3-backed uploads.
- **Access control:** presigned URLs are generated only after the same org/role/permission checks as any other endpoint — a user can't get a URL for a document outside their org.
- **Deletion:** soft delete in the DB (`deleted_at`) plus an async job to remove the S3 object, so an accidental delete is recoverable for a grace period before the object is actually purged.

---

## 11. GIS/Map Architecture

- **Library:** Leaflet + `react-leaflet`, with OpenStreetMap tiles as the default basemap.
- **Parcel boundaries:** rendered from `Site.parcel_geom` (PostGIS geometry, stored as GeoJSON when returned to the frontend via `ST_AsGeoJSON`).
- **Satellite view:** toggleable second tile layer (e.g. Esri World Imagery, which has a usable free tier) — satisfies "satellite/standard map option if supported by the chosen provider" without committing to a paid provider for MVP.
- **Nearby sites:** PostGIS `ST_DWithin` query against other sites in the org within a radius, rendered as secondary markers.
- **Measurement:** Leaflet-Geoman (actively maintained fork of Leaflet.draw) for basic distance/area measurement tools.
- **Citations:** every map view shows basemap attribution (required by OSM/Esri terms anyway) plus a link back to the parcel data's source (`SiteDataField.source_url`) alongside the map.

**Why Leaflet over Mapbox GL JS/Google Maps:** free, no API key/billing account required for the default basemap, mature plugin ecosystem covers every requirement in KT §7 (markers, boundaries, zoom/pan, measurement), and it's a small internal tool, not a consumer map product needing Mapbox's rendering polish. The map rendering is isolated behind one `<SiteMap>` component, so swapping to Mapbox GL later (e.g. for vector tiles/3D in Phase 2) is a contained change, not a rewrite.

**Alternative considered:** Mapbox GL JS — better performance at high marker density and a path to the Phase 2 "3D site visualization" idea, but requires an API key/billing setup and costs money past its free tier. Deferred; revisit if Phase 2 3D visualization is greenlit.

**Tile provider licensing — dev vs. production (flagged per client review).** The Leaflet *library* choice is unaffected by this, but the *tile source* behind it is not automatically production-safe:
- The public `tile.openstreetmap.org` server's usage policy explicitly prohibits heavy or commercial application traffic — it's meant for light/evaluation use. It is fine for local development and this project's prototyping, but **not** a safe default for a deployed production app, even an internal one, once real usage begins.
- Esri's free/ArcGIS-hosted World Imagery basemap likewise has usage terms and request caps that need reading against expected traffic before being relied on in production.
- **Do not finalize a production tile provider now.** For MVP dev/prototyping, raw OSM tiles + Esri imagery are used as-is (§15 local dev). Before Checkpoint 7 (GIS/map experience) ships to production, the production tile source will be one of: a paid-but-cheap OSM-data redistributor with clear commercial terms (e.g. MapTiler Cloud, Stadia Maps), or **AWS Location Service** (pay-per-request, OSM-backed, bills through the same AWS account as the rest of the stack — the natural fit given §16). Final pick and current pricing/terms will be confirmed at that checkpoint, added to the §21 verification list rather than assumed today.

---

## 12. Error Handling and Retry Strategy

- **Backend:** a global Nest exception filter catches all errors, maps known exceptions to proper HTTP codes + the standard error envelope (§5), and logs unknown errors with full context while returning a generic message to the client (no stack traces leaked).
- **External calls (data providers, S3):** every call wrapped with a timeout and try/catch at the adapter boundary (§7); failures degrade to a status flag (`source_unavailable`) rather than throwing through to the user, and are logged with enough context (provider name, site id, timestamp) to debug later.
- **Background jobs:** BullMQ's built-in retry/backoff (§9) with a capped attempt count, then a terminal `failed` state with a human-readable `error_message` and a manual retry action — never a silent infinite retry loop or a silently dropped job.
- **Frontend:** TanStack Query's error boundaries surface actionable, field-specific messages (not raw HTTP errors); a top-level React error boundary catches unexpected render crashes and shows a recoverable screen instead of a blank page.

---

## 13. Testing Strategy

- **Backend unit tests:** Jest, for service-layer business logic — especially the conflict-resolution rules (§8), permission/org-scoping guards, and provider-adapter normalization logic (these are the "important business logic" KT §15/§21 call out explicitly).
- **Backend integration tests:** Jest + Supertest against a real Postgres test database (via Testcontainers or a Docker Compose test service) — covers full request→DB round trips for the critical journeys: create site, run lookup, upload document, run analysis, generate report, permission enforcement (viewer cannot mutate).
- **Frontend:** Vitest + React Testing Library for component/hook logic (especially the conflict-approval UI and analysis status polling).
- **End-to-end:** Playwright, covering the MVP acceptance criteria list end to end (KT §21) — sign in → create MA site → see normalized data with a deliberately-conflicting field → upload a document → run analysis → see report — run against the Dockerized stack in CI.
- **External providers:** never hit real MA government sites in automated tests — provider adapters are tested against recorded fixtures/mocked HTTP responses, so tests are deterministic and don't depend on external uptime.

---

## 14. Security Considerations

- Passwords: bcrypt (cost factor 12), never logged.
- Transport: HTTPS everywhere (enforced at the load balancer/CDN); HSTS.
- Headers: Helmet defaults (CSP, X-Frame-Options, etc.).
- Input validation: shared Zod schemas via `nestjs-zod` on every controller input (§5) — reject unknown/malformed fields at the boundary, not deep in service logic.
- AuthZ: role guards + org-scoping on every query, as described in §6/§5 — no client-supplied `organization_id` is ever trusted.
- File uploads: MIME-type and size allowlist/limit enforced server-side before issuing a presigned URL (not just checked in the browser).
- Secrets: all credentials/API keys via environment variables, sourced from AWS Secrets Manager in deployed environments — never committed (`.env` is gitignored from day one, `.env.example` checked in with placeholder values).
- Rate limiting: on `/auth/*` endpoints specifically, to blunt credential-stuffing/brute force.
- Audit trail: `ActivityEvent` records every meaningful mutation (KT §13), which doubles as a security audit log (who changed what, when).
- Dependency hygiene: `npm audit`/Dependabot enabled in CI.

---

## 15. Docker / Local Development Architecture

`docker-compose.yml` at the repo root brings up the full stack for local dev:

```
services:
  postgres      (postgis/postgis image)
  redis
  minio         (S3-compatible, local file storage)
  api           (NestJS, hot-reload via volume mount)
  worker        (same image as api, different start command)
  web           (Vite dev server)
```

- One `.env.example` documents every required variable; `docker compose up` plus a seed script (`prisma db seed` — creates the one MVP organization, an admin user, and a couple of sample sites) gets a new environment running end to end with no manual setup, satisfying "database seed strategy" (KT §23).
- `api` and `worker` share one Docker image (same `Dockerfile`, different CMD) since they share the same codebase/dependencies — avoids maintaining two near-identical images.
- Local dev never talks to real external MA data sources by default (a `MOCK_PROVIDERS=true` env flag swaps in fixture-based adapters), so the app is fully runnable offline/without API keys out of the box.

---

## 16. Cloud/Deployment Recommendation

**Recommendation: AWS**, specifically:

| Concern | Service | Why |
|---|---|---|
| Container hosting | ECS Fargate (API + worker as separate services) | No servers to patch; scales each process independently; standard Docker images from CI, no AWS-specific rewrite needed. |
| Database | RDS for PostgreSQL (with PostGIS enabled) | Managed backups/patching; PostGIS supported directly. |
| Object storage | S3 | Native presigned-URL support matches §10 design exactly. |
| Queue backing store | ElastiCache for Redis (or Upstash serverless Redis to cut cost at this scale) | BullMQ needs Redis; managed avoids operating it by hand. |
| Frontend hosting | S3 + CloudFront (static SPA build) | Cheap, simple CDN hosting for a Vite build. |
| Secrets | AWS Secrets Manager | Central, audited, rotates independent of code deploys. |
| Logs | CloudWatch Logs | Native ECS integration, no extra agent to run. |

**Why AWS over a PaaS (Render/Railway/Fly.io):** this is a real internal business tool for a real company, not a throwaway prototype — it's reasonable to assume it needs to sit inside (or eventually connect to) the client's broader IT environment, and AWS is the most likely fit for that (IAM, VPC peering, procurement familiarity) if/when this needs to integrate with other company systems. AWS is also not meaningfully more complex to deploy here specifically *because* the app is already fully containerized and config-driven — the same images and `.env`-shaped config that run in Docker Compose locally run in ECS unchanged.

**Trade-off / alternative considered:** Render or Railway would genuinely be faster and cheaper to stand up for a pure MVP validation phase (less IAM/VPC ceremony, simpler pricing) and are worth reconsidering if the client wants to keep infrastructure spend minimal before committing further. Because everything is Dockerized with externalized config, switching from Render to AWS later (or vice versa) is a redeploy, not a rewrite — this decision is not a one-way door.

### 16.1 Cost Estimate (per client request)

Figures below are **good-faith estimates for `us-east-1`, at the stated small-team scale, and will drift with actual usage/traffic and AWS pricing changes** — treat as planning-grade, not a quote. Both tiers assume single-AZ (no cross-AZ redundancy) since that's appropriate for an internal 5–20 user tool at MVP; the "recommended" tier is a small step up in operational robustness, not a different architecture.

**Tier A — Cheapest reasonable production (still AWS, still real production, minimal fixed cost):**

| Component | Choice | Est. $/month |
|---|---|---|
| Compute (API + worker) | AWS App Runner (small instance, avoids a dedicated load balancer) | $20–25 |
| Database | RDS PostgreSQL `db.t4g.micro`, single-AZ, 20GB gp3, PostGIS enabled | $20–25 |
| Job queue backing store | Upstash Redis (serverless, pay-per-request) instead of ElastiCache | $0–10 |
| File storage | S3 (low doc volume at this scale) | $1–5 |
| Frontend hosting/CDN | S3 + CloudFront | $1–5 |
| Secrets | Secrets Manager (~4–5 secrets) | ~$2 |
| Logs | CloudWatch Logs | $1–3 |
| Email | SES | <$1 |
| **Total** | | **≈ $50–70/month** |

**Tier B — Recommended production (more standard AWS ops posture, easier to hand off to another engineer, room to scale before the next architecture conversation is needed):**

| Component | Choice | Est. $/month |
|---|---|---|
| Compute (API + worker) | ECS Fargate, 2 small tasks (0.25 vCPU/0.5GB each) | $18–25 |
| Load balancer | Application Load Balancer (needed for ECS Fargate HTTP routing + health checks) | $18–20 |
| Database | RDS PostgreSQL `db.t4g.micro`/`small`, single-AZ, PostGIS | $20–30 |
| Job queue backing store | ElastiCache for Redis `cache.t4g.micro` | $12–15 |
| File storage | S3 | $1–5 |
| Frontend hosting/CDN | S3 + CloudFront | $1–5 |
| Secrets | Secrets Manager | ~$2 |
| Logs | CloudWatch Logs | $2–4 |
| Email | SES | <$1 |
| **Total** | | **≈ $80–110/month** |

The delta between the two tiers is mainly the Application Load Balancer's ~$18–20/month fixed cost and ElastiCache vs. serverless Redis — both purely operational-maturity choices, not capability differences the client's users would notice. Multi-AZ RDS (recommended once this holds real production data the business depends on daily, not necessarily at MVP launch) would add roughly another $20–30/month on top of either tier.

**Recommendation:** launch on **Tier A**. Nothing about Tier A is a dead end — it's the same Docker images and the same RDS/S3/Secrets Manager setup, just swapping App Runner↔ECS+ALB and Upstash↔ElastiCache, both single-config changes in the deploy pipeline, not rewrites. Move to Tier B if/when uptime SLAs, team size, or in-house AWS ops familiarity make the extra operational maturity worth ~$30/month.

For reference, the non-AWS PaaS alternative mentioned above (Render/Railway) would land in roughly the **$25–45/month** range for an equivalent footprint — cheaper still, at the cost of the AWS-ecosystem fit argument made above. Flagging it again here since cost was the client's specific concern; happy to default to it instead if minimizing spend outweighs the AWS-fit reasoning.

---

## 17. CI/CD Approach

**GitHub Actions**, two workflows:

1. **`ci.yml`** (every PR and push to `main`): install deps → lint → typecheck → unit tests → integration tests (spins up Postgres/Redis service containers) → build Docker images. Blocks merge on failure.
2. **`deploy.yml`** (on merge to `main`, or manual dispatch for a specific environment): builds and pushes images to ECR, runs Prisma migrations against the target RDS instance, updates the ECS service (rolling deploy), deploys the frontend build to S3/invalidates CloudFront.

Auth to AWS via GitHub's OIDC provider (no long-lived AWS keys stored in GitHub secrets). Staging and production are separate ECS services/RDS instances from the same pipeline, gated by environment protection rules.

---

## 18. Logging / Monitoring

- **Structured logging:** JSON logs (via `pino`, wired into Nest's logger) — every log line includes request id, org id, user id (when available), so a single request/job can be traced across API and worker logs.
- **Centralization:** shipped to CloudWatch Logs (native from ECS, no extra agent).
- **Error tracking:** Sentry (generous free tier) for both frontend and backend — captures unhandled exceptions with stack traces and user/org context, closing the loop on "good error handling" without building a bespoke error-reporting system.
- **Health checks:** a `/health` endpoint (DB + Redis connectivity) used by ECS for container health and by an uptime check (e.g. a simple CloudWatch alarm or a free UptimeRobot-style check) for basic availability monitoring.
- **Business-relevant logging:** every `ActivityEvent` write is also a structured log line, so activity history is queryable both in-app (via the API) and in raw logs if ever needed for support/debugging.

---

## 19. Expected Folder / Repository Structure

A single repository, npm/pnpm workspaces monorepo (keeps the shared-types benefit from §2/§3 without publishing an internal package to a registry):

```
siteiq/
├── apps/
│   ├── api/                    NestJS API server
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── users/
│   │   │   │   ├── organizations/
│   │   │   │   ├── sites/
│   │   │   │   ├── site-data-fields/
│   │   │   │   ├── parcels/        (provider adapters)
│   │   │   │   ├── zoning/         (provider adapters)
│   │   │   │   ├── documents/
│   │   │   │   ├── analysis/
│   │   │   │   ├── notes/
│   │   │   │   ├── activity/
│   │   │   │   └── reports/
│   │   │   ├── common/          guards, interceptors, filters, decorators
│   │   │   ├── config/
│   │   │   └── main.ts
│   │   ├── prisma/              schema.prisma, migrations/, seed.ts
│   │   └── test/
│   ├── worker/                  BullMQ processors, reuses apps/api modules
│   │   └── src/processors/
│   └── web/                     React SPA
│       └── src/
│           ├── pages/
│           ├── features/        one folder per domain (sites, documents, analysis...)
│           ├── components/       shared/dumb UI components
│           ├── api/              typed API client
│           └── hooks/
├── packages/
│   └── shared/                  Zod schemas + TS types shared by api/worker/web
├── infra/
│   ├── docker/                  Dockerfiles
│   └── ci/                      shared GitHub Actions composite steps
├── docs/
│   ├── adr/                      architectural decision records, see §19.1
│   ├── 01-technical-discovery.md
│   └── ...                       API docs, diagrams, future checkpoint docs
├── docker-compose.yml
├── .env.example
└── package.json                 workspace root
```

Each `modules/<domain>` folder in the API follows the same internal shape (`*.controller.ts`, `*.service.ts`, `*.repository.ts` where warranted, `dto/`, `*.spec.ts`) — this consistency is what keeps "business logic scattered randomly" from happening as the codebase grows.

### 19.1 Architectural Decision Records

Per client request, significant, hard-to-reverse technical decisions are recorded as short ADRs in `docs/adr/`, each following the standard Context / Decision / Consequences shape (one page or less). Six initial ADRs, written now to capture this discovery package's key calls before implementation starts, so the reasoning survives independent of this document and is easy to find later:

- `docs/adr/0001-modular-monolith.md`
- `docs/adr/0002-postgresql-postgis.md`
- `docs/adr/0003-prisma-orm.md`
- `docs/adr/0004-bullmq-background-jobs.md`
- `docs/adr/0005-self-managed-authentication.md`
- `docs/adr/0006-adapter-based-data-providers.md`

New ADRs are added as future non-trivial decisions come up (e.g. the production tile provider pick in §11, or the App Runner→ECS migration if/when Tier B is adopted) — they're cheap to write and expensive to reconstruct from memory later, which is exactly the failure mode they exist to prevent for a solo-developer project.

---

## 20. Development Milestones

Mapped directly to the client checkpoints already defined in the KT doc:

| # | Checkpoint | Key deliverables |
|---|---|---|
| 1 | Architecture proposal | This document (for approval). |
| 2 | UX/wireframe proposal | Wireframes for site list, site detail (all tabs from KT §8), create-site flow, conflict-resolution UI. |
| 3 | Data model + API proposal | Finalized Prisma schema + OpenAPI spec, reviewed against this doc's §4/§5. |
| 4 | Working auth + site management | Login/roles/org-scoping live; create/list/search/filter/soft-delete sites (no external data yet — manual entry only). |
| 5 | External data integration | Parcel/zoning adapters for an initial MA municipality subset; normalization + conflict workflow (§7/§8) live end to end. |
| 6 | Documents + background analysis | Upload/download/delete documents; BullMQ analysis pipeline with Queued/Processing/Completed/Failed UI + retry. |
| 7 | GIS/map experience | Site detail map: marker, parcel boundary, satellite toggle, nearby sites, measurement. |
| 8 | Testing + production hardening | Test suite across all layers (§13), security pass (§14), error handling audit. |
| 9 | Deployment + final demo | Docker/CI-CD (§15/§17) live against staging+prod AWS environments (§16), full MVP acceptance criteria (KT §21) walked through live. |

---

## 21. Open Items Requiring Verification Before/During Implementation

Flagged explicitly per your instruction not to block this document on live research:

1. **Exact MassGIS access method** — confirm current API/download format for the Standardized Assessors' Parcels dataset (REST service vs. bulk download vs. ArcGIS Online item) and any usage terms, before building the first parcel adapter.
2. **Zoning data coverage** — confirm which MA municipalities have digitized/queryable zoning layers (via MassGIS or otherwise) to scope which towns the MVP's zoning lookup can realistically support at launch; this determines how often `source_unavailable` is the expected result for zoning.
3. **Municipal assessor portal access patterns** (Vision Government Solutions, Patriot Properties, Axis GIS, etc.) — these are typically per-town, sometimes without a formal API (HTML scraping may be the only option for some towns), which affects both the adapter design and reliability expectations; needs confirmation per-municipality as coverage expands.
4. ~~Resource ownership rule for notes/edits~~ — **resolved**, see §6.1: assignment is informational only, not an access restriction.
5. **Production tile provider selection** (MapTiler / Stadia / AWS Location Service) — confirm current pricing/terms and pick one before Checkpoint 7 ships to production; see §11.
6. **SES production access** — request AWS SES production sending access (out of sandbox) as a Checkpoint 9 deployment task; see §6.2.

None of these block approval of the architecture itself — they affect adapter implementation details (§7) and municipality coverage scoping, addressed during Checkpoint 5.

---

**Next step:** awaiting your review/approval of this package before any implementation begins (per your instruction). Happy to walk through trade-offs on any section in more depth, or adjust a decision, before we move to Checkpoint 2 (UX/wireframes).
