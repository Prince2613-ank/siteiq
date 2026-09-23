# ADR-0003: Prisma as the ORM, With a Dedicated Repository for PostGIS Queries

## Status
Accepted

## Context
The database is PostgreSQL + PostGIS (ADR-0002). The project needs schema-as-code migrations (a hard client requirement: "database changes should be migration-based") and end-to-end TypeScript types flowing from the database through the API to the frontend. It also needs to query/store PostGIS geometry columns (parcel boundaries, "nearby sites" radius search).

## Decision
Use Prisma as the primary ORM for all standard relational models and migrations. Isolate all geometry-column reads/writes and spatial queries behind one dedicated `GeoRepository` that uses Prisma's `$queryRaw`/`$executeRaw` with PostGIS SQL functions, since Prisma's native geometry-column support is limited.

## Consequences
- Positive: strong migration DX and generated TypeScript types for the ~90% of the schema that's ordinary relational data (users, sites, documents, notes, activity, etc.).
- Positive: the raw-SQL PostGIS carve-out is contained to one repository, not spread across the codebase — keeps the "no business logic scattered randomly" requirement intact even where the ORM's abstraction breaks down.
- Negative: that one repository's PostGIS SQL is hand-written and not type-checked by Prisma the way normal queries are — extra care and test coverage needed there specifically.
- Rejected alternative: TypeORM — has more native geometry-column support (would avoid the raw-SQL carve-out), but weaker migration tooling and generated-type ergonomics than Prisma. The carve-out this decision requires is small and well-contained, so Prisma's stronger day-to-day DX wins for the ~90% majority case.
