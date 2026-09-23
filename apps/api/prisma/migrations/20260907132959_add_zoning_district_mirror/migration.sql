-- Additive migration (Checkpoint 8): a second, independent zoning source —
-- MassGIS's statewide Zoning Districts polygon layer — separate from the
-- assessor-self-reported zoning already on ParcelMirrorRecord.
CREATE TABLE "ZoningDistrictMirror" (
    "id" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "zoneDesc" TEXT,
    "geom" geometry(Geometry,4326) NOT NULL,
    "sourceName" TEXT NOT NULL DEFAULT 'MassGIS Zoning Districts',
    "sourceRefreshedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZoningDistrictMirror_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "zoning_district_geom_gist_idx" ON "ZoningDistrictMirror" USING GIST ("geom");
