# ADR-0001: Modular Monolith Over Microservices

## Status
Accepted

## Context
SiteIQ is built and maintained by a single full-stack developer for an internal team of roughly 5–20 analysts, processing low hundreds of site investigations per month. The system has several distinct domains (auth, sites, parcel/zoning data, documents, analysis, reporting) that could in principle be split into separate services.

## Decision
Build a modular monolith: one backend codebase (NestJS), organized into strictly separated modules per domain, deployed as two processes — an API server and a background worker — sharing one database and one Redis instance. No service-to-service network boundaries between domains.

## Consequences
- Positive: no distributed-transaction problems (e.g. "create site + log activity + trigger lookup" is a single DB transaction), no service discovery/inter-service auth to build, much lower operational surface for one developer to run and debug.
- Positive: the worker already runs as an independent process, so splitting it into a genuinely separate deployable later (if it needs independent scaling) is a low-cost change, not a rewrite.
- Negative: module boundaries are enforced by code discipline (NestJS's DI/module system) rather than by hard network/process isolation — a determined change could violate a boundary without a second service rejecting it. Mitigated by consistent per-module folder structure and code review discipline.
- Revisit if: team size grows well past "small internal team," or one domain (e.g. background analysis) develops load/scaling characteristics wildly different from the rest of the app.
