-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'ANALYST', 'VIEWER');

-- CreateEnum
CREATE TYPE "InvestigationStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'NEEDS_REVIEW', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "IdentityStatus" AS ENUM ('IDENTIFYING', 'NEEDS_REVIEW', 'CONFIRMED', 'MANUAL', 'NO_MATCH');

-- CreateEnum
CREATE TYPE "MatchStrategy" AS ENUM ('EXACT', 'FUZZY', 'SPATIAL', 'PARCEL_ID');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DuplicateDecision" AS ENUM ('NONE', 'OPENED_EXISTING', 'CONTINUED_SEPARATE');

-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('NUMBER', 'STRING', 'BOOLEAN', 'DATE', 'GEO');

-- CreateEnum
CREATE TYPE "FieldStatus" AS ENUM ('MATCHED', 'PARTIAL', 'NO_MATCH', 'SOURCE_UNAVAILABLE', 'FIELD_UNAVAILABLE', 'CONFLICTING', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "inviteTokenHash" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "resetTokenHash" TEXT,
    "resetExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT,
    "streetAddress" TEXT,
    "city" TEXT,
    "state" TEXT NOT NULL DEFAULT 'MA',
    "zip" TEXT,
    "originalInputType" TEXT NOT NULL,
    "originalInputAddress" TEXT,
    "originalInputParcelRef" TEXT,
    "originalInputLat" DOUBLE PRECISION,
    "originalInputLng" DOUBLE PRECISION,
    "parcelRef" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "parcelGeom" geometry(Geometry,4326),
    "lotSize" DOUBLE PRECISION,
    "lotSizeUnit" TEXT,
    "zoningCode" TEXT,
    "zoningDistrict" TEXT,
    "municipality" TEXT,
    "identityStatus" "IdentityStatus" NOT NULL DEFAULT 'IDENTIFYING',
    "confirmedCandidateId" TEXT,
    "matchConfidence" INTEGER,
    "matchMethod" TEXT,
    "matchStatus" TEXT,
    "investigationStatus" "InvestigationStatus" NOT NULL DEFAULT 'NEW',
    "assignedAnalystId" TEXT,
    "potentialDuplicateOfSiteId" TEXT,
    "mergedIntoSiteId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchAttempt" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "strategyUsed" "MatchStrategy" NOT NULL,
    "candidateCount" INTEGER NOT NULL,
    "topConfidence" INTEGER,
    "triggeredById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteMatchCandidate" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "parcelRef" TEXT,
    "matchedAddress" TEXT,
    "municipality" TEXT,
    "candidateGeom" geometry(Geometry,4326),
    "confidence" INTEGER NOT NULL,
    "evidence" JSONB NOT NULL,
    "rank" INTEGER NOT NULL,
    "status" "CandidateStatus" NOT NULL DEFAULT 'PROPOSED',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "duplicateDecision" "DuplicateDecision" NOT NULL DEFAULT 'NONE',
    "duplicateOfSiteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteMatchCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteDataField" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "fieldType" "FieldType" NOT NULL,
    "value" JSONB NOT NULL,
    "numericValue" DOUBLE PRECISION,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "status" "FieldStatus" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteDataField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteDataFieldApproval" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "approvedFieldId" TEXT NOT NULL,
    "previousFieldId" TEXT,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "SiteDataFieldApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'QUEUED',
    "isPreliminary" BOOLEAN NOT NULL,
    "triggeredById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT,
    "actorId" TEXT,
    "eventType" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "generatedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshotVersion" INTEGER NOT NULL,
    "contentSnapshot" JSONB NOT NULL,
    "storageKey" TEXT,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParcelMirrorRecord" (
    "id" TEXT NOT NULL,
    "parcelRef" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "municipality" TEXT NOT NULL,
    "zip" TEXT,
    "lotSize" DOUBLE PRECISION,
    "lotSizeUnit" TEXT,
    "geom" geometry(Geometry,4326) NOT NULL,
    "centroid" geometry(Point,4326) NOT NULL,
    "sourceName" TEXT NOT NULL DEFAULT 'MassGIS',
    "sourceRefreshedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParcelMirrorRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Site_confirmedCandidateId_key" ON "Site"("confirmedCandidateId");

-- CreateIndex
CREATE INDEX "Site_organizationId_investigationStatus_idx" ON "Site"("organizationId", "investigationStatus");

-- CreateIndex
CREATE INDEX "Site_organizationId_parcelRef_idx" ON "Site"("organizationId", "parcelRef");

-- CreateIndex
CREATE INDEX "Site_organizationId_deletedAt_idx" ON "Site"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "MatchAttempt_siteId_createdAt_idx" ON "MatchAttempt"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "SiteMatchCandidate_siteId_attemptId_idx" ON "SiteMatchCandidate"("siteId", "attemptId");

-- CreateIndex
CREATE INDEX "SiteMatchCandidate_siteId_status_idx" ON "SiteMatchCandidate"("siteId", "status");

-- CreateIndex
CREATE INDEX "SiteDataField_siteId_fieldName_isCurrent_idx" ON "SiteDataField"("siteId", "fieldName", "isCurrent");

-- CreateIndex
CREATE INDEX "SiteDataFieldApproval_siteId_fieldName_idx" ON "SiteDataFieldApproval"("siteId", "fieldName");

-- CreateIndex
CREATE INDEX "Document_siteId_deletedAt_idx" ON "Document"("siteId", "deletedAt");

-- CreateIndex
CREATE INDEX "AnalysisRun_siteId_status_idx" ON "AnalysisRun"("siteId", "status");

-- CreateIndex
CREATE INDEX "Note_siteId_createdAt_idx" ON "Note"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_siteId_createdAt_idx" ON "ActivityEvent"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_organizationId_createdAt_idx" ON "ActivityEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Report_siteId_generatedAt_idx" ON "Report"("siteId", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ParcelMirrorRecord_parcelRef_key" ON "ParcelMirrorRecord"("parcelRef");

-- CreateIndex
CREATE INDEX "ParcelMirrorRecord_municipality_idx" ON "ParcelMirrorRecord"("municipality");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_confirmedCandidateId_fkey" FOREIGN KEY ("confirmedCandidateId") REFERENCES "SiteMatchCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_assignedAnalystId_fkey" FOREIGN KEY ("assignedAnalystId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_potentialDuplicateOfSiteId_fkey" FOREIGN KEY ("potentialDuplicateOfSiteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_mergedIntoSiteId_fkey" FOREIGN KEY ("mergedIntoSiteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchAttempt" ADD CONSTRAINT "MatchAttempt_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchAttempt" ADD CONSTRAINT "MatchAttempt_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteMatchCandidate" ADD CONSTRAINT "SiteMatchCandidate_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteMatchCandidate" ADD CONSTRAINT "SiteMatchCandidate_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "MatchAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteMatchCandidate" ADD CONSTRAINT "SiteMatchCandidate_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteMatchCandidate" ADD CONSTRAINT "SiteMatchCandidate_duplicateOfSiteId_fkey" FOREIGN KEY ("duplicateOfSiteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteDataField" ADD CONSTRAINT "SiteDataField_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteDataFieldApproval" ADD CONSTRAINT "SiteDataFieldApproval_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteDataFieldApproval" ADD CONSTRAINT "SiteDataFieldApproval_approvedFieldId_fkey" FOREIGN KEY ("approvedFieldId") REFERENCES "SiteDataField"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteDataFieldApproval" ADD CONSTRAINT "SiteDataFieldApproval_previousFieldId_fkey" FOREIGN KEY ("previousFieldId") REFERENCES "SiteDataField"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteDataFieldApproval" ADD CONSTRAINT "SiteDataFieldApproval_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Extension-backed indexes (see docs/03-data-model-api-contract.md §6) —
-- not expressible in Prisma's schema DSL, added by hand to this migration.
CREATE INDEX "parcel_mirror_address_trgm_idx" ON "ParcelMirrorRecord" USING GIN (address gin_trgm_ops);
CREATE INDEX "parcel_mirror_geom_gist_idx" ON "ParcelMirrorRecord" USING GIST (geom);
CREATE INDEX "parcel_mirror_centroid_gist_idx" ON "ParcelMirrorRecord" USING GIST (centroid);
CREATE INDEX "site_parcel_geom_gist_idx" ON "Site" USING GIST ("parcelGeom");
CREATE INDEX "candidate_geom_gist_idx" ON "SiteMatchCandidate" USING GIST ("candidateGeom");
