# SiteIQ — Checkpoint 4: Working Authentication + Site Management

Status: **Running code, verified end-to-end via API tests. Awaiting client review.**

This is the first checkpoint with a real, running application — not a wireframe or a proposal. Per the client's explicit instruction, the property-matching engine (docs/02, docs/03) was **not** touched here; sites are created and identified manually, exactly as scoped.

## What's running

- **API**: NestJS, `http://localhost:3000/api/v1` — auth, users, sites, notes, activity modules, all backed by the Checkpoint 3 Prisma schema against a real PostgreSQL+PostGIS database.
- **Web**: React + Vite + TanStack Query + Tailwind, `http://localhost:5173` — Login, Dashboard, Site List, Create Site, Site Details (Overview/Notes/Activity tabs live; Property/Zoning/Map/Documents/Analysis tabs show an honest "not built yet" placeholder rather than fake data), User Management.
- **Database**: Postgres+PostGIS via `docker compose up -d postgres`, migrated with the initial schema from Checkpoint 3 (including the extension-backed GIN/GIST indexes, applied by hand alongside the Prisma-generated SQL per docs/03 §6).

## How to run it yourself

```
docker compose up -d postgres        # start the database
npm install                          # from repo root (npm workspaces)
npm run db:migrate --workspace=apps/api   # or: cd apps/api && npx prisma migrate deploy
npm run db:seed --workspace=apps/api      # or: cd apps/api && npx ts-node prisma/seed.ts
npm run dev:api                      # NestJS on :3000
npm run dev:web                      # Vite on :5173, separate terminal
```

Seeded accounts (dev only — see "Known simplifications" below):

| Email | Password | Role |
|---|---|---|
| admin@siteiq.local | ChangeMe123! | Administrator |
| analyst@siteiq.local | ChangeMe123! | Analyst |

## What's been verified

The full flow was exercised directly against the running API (login → create site → list/filter → assign analyst → add note → activity history records it → logout), plus specific checks on the things that actually carry risk:

- **Authorization is enforced server-side, not just hidden in the UI**: a Viewer gets `403` attempting to create a site or list users, but `200` reading the site list — matching the doc 01 §6.1 permission matrix exactly.
- **Auth failure messages don't leak account existence**: wrong password and unknown email return the identical generic message.
- **Refresh token rotation**: `/auth/refresh` (via the httpOnly cookie) issues a new access token and a new refresh token each time; `/auth/logout` clears the cookie.
- **Deactivating a user unassigns their sites** rather than touching anything else (doc 01 §21).
- **Org-scoping**: every query is filtered server-side by the JWT's `organizationId`, never a client-supplied value (doc 01 §5/§6).
- The frontend type-checks cleanly (`tsc -b`) and both dev servers boot and serve; CORS is confirmed working correctly for the cross-origin, credentialed (cookie-based refresh) setup between `:5173` and `:3000`.

**What I have not done**: click through the UI in an actual browser — I don't have one available in this environment. I've verified the API contract directly and confirmed the frontend compiles and serves, but the visual/interactive experience (does the layout look right, do the forms feel right) hasn't been eyeballed by me. Please click through it yourself before treating the UI as final — that's a real gap, not a formality.

## Known, deliberate simplifications for this checkpoint

Flagging these now so they don't look like oversights later — each has a specific reason tied to what this checkpoint was actually scoped to prove:

1. **User invitation is a stand-in, not the real flow.** `POST /users/invite` creates the user active immediately with a generated temporary password returned once in the API response, instead of the invite-token-plus-email-link flow designed in doc 01 §6.2. That flow needs a working email sender (SES), which is a Checkpoint 9 deployment dependency — building it now would mean stubbing the email side anyway. The schema (`inviteTokenHash`, `inviteExpiresAt`) still has room for the real flow when SES is wired up.
2. **`packages/shared` Zod schemas are duplicated**, not actually imported by the API. Wiring a real cross-workspace TypeScript package into NestJS's build (`tsc`/webpack path resolution) is a build-tooling task worth doing properly rather than rushed under this checkpoint's actual scope (auth + site management). `apps/api/src/common/schemas.ts` is a tracked, commented duplicate — kept in sync by hand until Checkpoint 8's hardening pass formalizes it.
3. **One squashed initial migration**, not an evolving history — reasonable for a schema that hasn't shipped anywhere yet; normal migration discipline (doc 01 §15, "database changes must be migration-based") starts for real from here.
4. **Property/Zoning/Map/Documents/Analysis tabs are explicit placeholders**, not hidden or faked — consistent with the product's own "never silently invent" principle applied to the product's own construction status, not just its data.
5. Docker images for the API/web apps themselves (as opposed to the Postgres container) aren't built yet — containerizing the app is a Checkpoint 9 deliverable; local dev today runs both processes directly with `npm run dev:*`.

## Next step

Awaiting your review of the running application. Once approved, Checkpoint 5 (external data integration) is where the property-matching engine from docs/02/03 actually gets built and wired into the Create Site → Candidate Review flow this checkpoint deliberately left as manual entry.
