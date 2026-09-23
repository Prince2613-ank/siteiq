-- Additive migration (Checkpoint 7): zoning/use-code columns on the local
-- parcel mirror, so field enrichment has real assessor-reported values to
-- draw from instead of leaving Site.zoningCode permanently unpopulated.
ALTER TABLE "ParcelMirrorRecord" ADD COLUMN "zoning" TEXT;
ALTER TABLE "ParcelMirrorRecord" ADD COLUMN "useCode" TEXT;
