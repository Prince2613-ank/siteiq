-- Additive migration (Checkpoint 11): operational refresh-status tracking
-- for MassGIS data sources — "when was this last refreshed, did it
-- succeed/fail/partially succeed."
CREATE TYPE "RefreshStatus" AS ENUM ('SUCCESS', 'FAILED', 'PARTIAL');

CREATE TABLE "SourceRefreshLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "municipality" TEXT,
    "status" "RefreshStatus" NOT NULL,
    "recordCount" INTEGER,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceRefreshLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SourceRefreshLog_source_municipality_completedAt_idx" ON "SourceRefreshLog"("source", "municipality", "completedAt");
