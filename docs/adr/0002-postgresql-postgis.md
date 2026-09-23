# ADR-0002: PostgreSQL + PostGIS as the Database

## Status
Accepted

## Context
SiteIQ needs strong relational integrity (org → users → sites → documents/notes/activity/analysis, with foreign keys and an audit trail) and genuine spatial capability: storing parcel boundaries, rendering them on a map, finding "nearby sites," and supporting basic measurement.

## Decision
Use PostgreSQL 16 with the PostGIS extension as the single database for all application data, including geometry.

## Consequences
- Positive: PostGIS is the de facto standard for spatial queries/storage in a relational database, is free, and runs anywhere Postgres runs — no separate GIS-specific database service to operate.
- Positive: relational integrity and transactions are a natural fit for the audit-heavy data model (`SiteDataField`, `SiteDataFieldApproval`, `ActivityEvent`) — see ADR-0003 for how the ORM interacts with PostGIS specifically.
- Negative: geometry columns/queries (`ST_DWithin`, `ST_AsGeoJSON`, etc.) require raw SQL rather than the primary ORM's query builder — isolated behind a small dedicated repository rather than scattered through the codebase.
- Rejected alternative: MongoDB — the data is fundamentally relational and audit-trail-heavy; Postgres's joins and transactional guarantees fit better than a document store would, and MongoDB's own geospatial support isn't a strong enough draw to offset that mismatch.
