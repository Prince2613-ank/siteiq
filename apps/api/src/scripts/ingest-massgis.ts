import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MatchingModule } from '../modules/matching/matching.module';
import { MassGisIngestionService } from '../modules/matching/massgis-ingestion.service';

/**
 * Real MassGIS ingestion CLI — replaces the fixture loader
 * (load-parcel-mirror.ts, kept for offline/CI test use) for actual mirror
 * refreshes. Usage:
 *
 *   npm run mirror:ingest -- Worcester "New Bedford" Boston Andover Quincy Springfield
 *   npm run mirror:ingest -- --zoning       (refreshes the statewide Zoning Districts layer, Checkpoint 8)
 *
 * Each municipality is ingested independently and transactionally (docs/06
 * §refresh-safety) — one town's failure doesn't affect the others or
 * corrupt previously-ingested data.
 */
@Module({ imports: [PrismaModule, MatchingModule] })
class IngestModule {}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    // eslint-disable-next-line no-console
    console.error(
      'Usage: npm run mirror:ingest -- <Municipality> [<Municipality> ...]  |  npm run mirror:ingest -- --zoning',
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(IngestModule);
  const ingestion = app.get(MassGisIngestionService);

  if (args.includes('--zoning')) {
    try {
      const result = await ingestion.ingestZoningDistricts();
      // eslint-disable-next-line no-console
      console.log(`Zoning Districts: ${result.districtCount} polygons ingested`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Zoning Districts: FAILED —', err);
    }
    await app.close();
    return;
  }

  const municipalities = args;
  for (const municipality of municipalities) {
    try {
      const result = await ingestion.ingestMunicipality(municipality);
      // eslint-disable-next-line no-console
      console.log(
        `${municipality}: ${result.parcelCount} parcels ingested` +
          (result.skippedNoGeometry ? `, ${result.skippedNoGeometry} skipped (no geometry)` : ''),
      );
    } catch (err) {
      // One municipality's failure doesn't abort the rest — logged and
      // moved on, per docs/01 §12 (external failures never crash the app).
      // eslint-disable-next-line no-console
      console.error(`${municipality}: FAILED —`, err);
    }
  }

  await app.close();
}

main();
