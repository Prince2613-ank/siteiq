import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Loads the local parcel mirror (docs/02 §8, ADR-0007) from a fixture file.
 *
 * KNOWN, FLAGGED LIMITATION for Checkpoint 5: this reads a curated JSON
 * fixture (prisma/fixtures/ma-parcels.json), not a live pull from MassGIS.
 * The exact MassGIS access mechanism (ArcGIS FeatureServer vs. bulk
 * download) was flagged as needing verification in docs/02 §10/§21 and
 * still hasn't been confirmed — shipping a scraper against an unverified
 * live government endpoint and presenting it as "the MassGIS integration"
 * would be worse than being explicit about a fixture stand-in. The
 * ADAPTER BOUNDARY this script writes through (upsert into
 * ParcelMirrorRecord, same shape either way) is the real, permanent piece:
 * swapping this loader for a real MassGIS puller later is a contained
 * change to THIS FILE ONLY — nothing in the matching pipeline (src/modules/
 * matching) needs to know or care where the mirror's rows came from.
 *
 * Parcel BOUNDARIES are similarly synthetic here — a small square buffered
 * around each fixture's point coordinate, not a real assessor polygon —
 * since the fixture data only has point locations. Real boundary geometry
 * arrives with the real MassGIS puller.
 *
 * Geometry columns are written via raw SQL throughout (Prisma's client
 * can't populate Unsupported("geometry") columns directly — doc 01
 * ADR-0003), which is why this whole loader is one raw upsert statement
 * rather than mixing Prisma's query builder with raw SQL patchwork.
 */
const prisma = new PrismaClient();

interface FixtureParcel {
  parcelRef: string;
  address: string;
  municipality: string;
  zip: string;
  lotSize: number;
  lotSizeUnit: string;
  lat: number;
  lng: number;
}

async function main() {
  const fixturePath = path.join(__dirname, '..', '..', 'prisma', 'fixtures', 'ma-parcels.json');
  const fixtures: FixtureParcel[] = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

  for (const p of fixtures) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ParcelMirrorRecord"
         (id, "parcelRef", address, municipality, zip, "lotSize", "lotSizeUnit", "sourceName", "sourceRefreshedAt", geom, centroid)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'MassGIS (fixture)', now(),
          ST_Buffer(ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography, 15)::geometry,
          ST_SetSRID(ST_MakePoint($7, $8), 4326))
       ON CONFLICT ("parcelRef") DO UPDATE SET
         address = EXCLUDED.address,
         municipality = EXCLUDED.municipality,
         zip = EXCLUDED.zip,
         "lotSize" = EXCLUDED."lotSize",
         "lotSizeUnit" = EXCLUDED."lotSizeUnit",
         "sourceRefreshedAt" = now(),
         geom = EXCLUDED.geom,
         centroid = EXCLUDED.centroid`,
      p.parcelRef,
      p.address,
      p.municipality,
      p.zip,
      p.lotSize,
      p.lotSizeUnit,
      p.lng,
      p.lat,
    );
  }

  // eslint-disable-next-line no-console
  console.log(`Loaded ${fixtures.length} fixture parcels into the local mirror.`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
