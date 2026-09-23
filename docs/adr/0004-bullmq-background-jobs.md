# ADR-0004: BullMQ on Redis for Background Jobs

## Status
Accepted

## Context
Parcel/zoning lookups and site analysis runs are long-running and must not block API request handling ("long-running work should run asynchronously," "run for a while without blocking the user's browser"). Jobs need retry/backoff, status tracking (queued/processing/completed/failed), and a manual retry path.

## Decision
Use BullMQ backed by Redis for all background job queues (`parcel-lookup`, `zoning-lookup`, `analysis`, `report-generation`), consumed by a separate worker process sharing the API's codebase and Prisma client.

## Consequences
- Positive: same language/runtime as the rest of the stack — no second runtime (e.g. Python/Celery) to operate or deploy.
- Positive: built-in exponential backoff and retry-count limits map directly onto the required Queued→Processing→Completed/Failed UI and "retry option where appropriate."
- Positive: lightweight enough to run locally in Docker Compose with plain Redis — no extra local infrastructure.
- Negative: Redis is now a hard dependency for both local dev and production, in addition to Postgres.
- Rejected alternative: AWS SQS + Lambda — more natively "serverless"/scalable, but adds AWS-specific lock-in to the job layer specifically and is meaningfully harder to run locally (would need LocalStack or similar). BullMQ is deliberately kept behind a small internal `JobQueue`-shaped usage pattern so a future move to SQS, if true serverless scale is ever needed, is a targeted change rather than a rewrite.
