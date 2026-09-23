import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MassGisAssessorRow, MassGisClient } from './massgis-client';

export interface IngestResult {
  municipality: string;
  parcelCount: number;
  skippedNoGeometry: number;
}

export interface ZoningIngestResult {
  districtCount: number;
}

/**
 * Real MassGIS ingestion — docs/06 §refresh-safety. Fetches a municipality's
 * current parcel data, transforms it, and performs the mirror swap
 * TRANSACTIONALLY: nothing is deleted from the mirror until the new data has
 * been fully fetched and transformed successfully. A network failure or bad
 * response partway through leaves the previous valid mirror completely
 * untouched — this is what answers the client's requirement #10 ("how are
 * failed/partial refreshes handled without destroying the previous valid
 * mirror").
 */
@Injectable()
export class MassGisIngestionService {
  private readonly logger = new Logger(MassGisIngestionService.name);

  constructor(
    private client: MassGisClient,
    private prisma: PrismaService,
  ) {}

  /**
   * Checkpoint 11 — wraps the actual ingestion with the operational
   * refresh-status record the client asked for: one `SourceRefreshLog` row
   * per attempt, whether it succeeds, partially succeeds (some parcels
   * skipped for missing geometry), or fails outright. Never affects the
   * fetch-before-write safety already built into ingestMunicipalityInternal
   * — this is purely an audit record layered on top.
   */
  async ingestMunicipality(municipality: string): Promise<IngestResult> {
    const startedAt = new Date();
    try {
      const result = await this.ingestMunicipalityInternal(municipality);
      await this.prisma.sourceRefreshLog.create({
        data: {
          source: 'MassGIS Parcels',
          municipality,
          status: result.skippedNoGeometry > 0 && result.parcelCount > 0 ? 'PARTIAL' : result.parcelCount > 0 ? 'SUCCESS' : 'FAILED',
          recordCount: result.parcelCount,
          errorMessage: result.parcelCount === 0 ? 'No parcels ingested — see logs for the specific reason (no rows returned or no usable geometry)' : null,
          startedAt,
          completedAt: new Date(),
        },
      });
      return result;
    } catch (err) {
      await this.prisma.sourceRefreshLog.create({
        data: {
          source: 'MassGIS Parcels',
          municipality,
          status: 'FAILED',
          errorMessage: (err as Error).message,
          startedAt,
          completedAt: new Date(),
        },
      });
      throw err;
    }
  }

  private async ingestMunicipalityInternal(municipality: string): Promise<IngestResult> {
    // 1. Fetch everything into memory first — nothing touches the DB yet.
    const assessorRows = await this.client.fetchAssessorRows(municipality);
    if (assessorRows.length === 0) {
      this.logger.warn(`No assessor rows returned for ${municipality} — leaving existing mirror data untouched`);
      return { municipality, parcelCount: 0, skippedNoGeometry: 0 };
    }

    const parcels = this.dedupeToOneRowPerParcel(assessorRows);
    const locIds = parcels.map((p) => p.LOC_ID);
    const geometryByLocId = await this.client.fetchGeometry(locIds);

    const now = new Date();
    const rowsToInsert: { locId: string; row: MassGisAssessorRow; wkt: string }[] = [];
    let skippedNoGeometry = 0;

    for (const row of parcels) {
      const rings = geometryByLocId.get(row.LOC_ID);
      if (!rings || rings.length === 0) {
        skippedNoGeometry++;
        continue;
      }
      rowsToInsert.push({ locId: row.LOC_ID, row, wkt: ringsToWkt(rings) });
    }

    if (rowsToInsert.length === 0) {
      this.logger.warn(`No parcels with usable geometry for ${municipality} — leaving existing mirror data untouched`);
      return { municipality, parcelCount: 0, skippedNoGeometry };
    }

    // 2. Only now, with a complete new dataset in hand, touch the DB — one
    // transaction: delete this municipality's old rows, insert the new
    // ones. If ANYTHING in this block throws, Postgres rolls the whole
    // transaction back and the previous data for this town is exactly as
    // it was.
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `DELETE FROM "ParcelMirrorRecord" WHERE municipality = $1 AND "sourceName" = 'MassGIS (live)'`,
          toTitleCase(municipality),
        );

        for (const { locId, row, wkt } of rowsToInsert) {
          const address = normalizeAssessorAddress(row);
          const { lotSize, lotSizeUnit } = normalizeLotSize(row.LOT_SIZE, row.LOT_UNITS);

          await tx.$executeRawUnsafe(
            `INSERT INTO "ParcelMirrorRecord"
               (id, "parcelRef", address, municipality, zip, "lotSize", "lotSizeUnit", zoning, "useCode", "sourceName", "sourceRefreshedAt", geom, centroid)
             VALUES
               (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 'MassGIS (live)', $9,
                ST_MakeValid(ST_SetSRID(ST_GeomFromText($10), 4326)),
                ST_Centroid(ST_MakeValid(ST_SetSRID(ST_GeomFromText($10), 4326))))
             ON CONFLICT ("parcelRef") DO UPDATE SET
               address = EXCLUDED.address, municipality = EXCLUDED.municipality, zip = EXCLUDED.zip,
               "lotSize" = EXCLUDED."lotSize", "lotSizeUnit" = EXCLUDED."lotSizeUnit",
               zoning = EXCLUDED.zoning, "useCode" = EXCLUDED."useCode",
               "sourceName" = EXCLUDED."sourceName", "sourceRefreshedAt" = EXCLUDED."sourceRefreshedAt",
               geom = EXCLUDED.geom, centroid = EXCLUDED.centroid`,
            locId,
            address,
            toTitleCase(row.CITY),
            row.ZIP,
            lotSize,
            lotSizeUnit,
            row.ZONING || null,
            row.USE_CODE || null,
            now,
            wkt,
          );
        }
      },
      // A real municipality can be thousands of parcels — one row per
      // $executeRawUnsafe call is simple and safe (no hand-built
      // multi-row SQL to get subtly wrong) but slower than a bulk insert;
      // this timeout is sized for that trade-off, not for request-latency
      // sensitivity (this runs as an offline ingestion job, never on a
      // user-facing request path).
      { timeout: 10 * 60 * 1000, maxWait: 10000 },
    );

    this.logger.log(
      `Ingested ${rowsToInsert.length} parcels for ${municipality} (${skippedNoGeometry} skipped — no geometry returned)`,
    );
    return { municipality, parcelCount: rowsToInsert.length, skippedNoGeometry };
  }

  /**
   * One LOC_ID can have several assessor rows (condo units, sub-accounts).
   * We store one mirror row per physical parcel — pick the row whose
   * SITE_ADDR is the shortest (the base address, e.g. "142 Elm St" sorts
   * before "142 Elm St #2"), which is the address an analyst would
   * actually search for.
   */
  private dedupeToOneRowPerParcel(rows: MassGisAssessorRow[]): MassGisAssessorRow[] {
    const byLocId = new Map<string, MassGisAssessorRow>();
    for (const row of rows) {
      if (!row.LOC_ID) continue;
      const existing = byLocId.get(row.LOC_ID);
      const addr = row.SITE_ADDR ?? row.FULL_STR_STD ?? '';
      if (!existing) {
        byLocId.set(row.LOC_ID, row);
      } else {
        const existingAddr = existing.SITE_ADDR ?? existing.FULL_STR_STD ?? '';
        if (addr.length > 0 && (existingAddr.length === 0 || addr.length < existingAddr.length)) {
          byLocId.set(row.LOC_ID, row);
        }
      }
    }
    return Array.from(byLocId.values());
  }

  /**
   * Full-table refresh of the second zoning source (Checkpoint 8). Small
   * enough (~1,100 statewide records) that "one municipality at a time"
   * doesn't apply — this is a single statewide swap, same fetch-entirely-
   * before-touching-the-DB safety rule as ingestMunicipality.
   */
  async ingestZoningDistricts(): Promise<ZoningIngestResult> {
    const startedAt = new Date();
    try {
      const result = await this.ingestZoningDistrictsInternal();
      await this.prisma.sourceRefreshLog.create({
        data: {
          source: 'MassGIS Zoning Districts',
          municipality: null,
          status: result.districtCount > 0 ? 'SUCCESS' : 'FAILED',
          recordCount: result.districtCount,
          errorMessage: result.districtCount === 0 ? 'No zoning district records returned' : null,
          startedAt,
          completedAt: new Date(),
        },
      });
      return result;
    } catch (err) {
      await this.prisma.sourceRefreshLog.create({
        data: {
          source: 'MassGIS Zoning Districts',
          municipality: null,
          status: 'FAILED',
          errorMessage: (err as Error).message,
          startedAt,
          completedAt: new Date(),
        },
      });
      throw err;
    }
  }

  private async ingestZoningDistrictsInternal(): Promise<ZoningIngestResult> {
    const districts = await this.client.fetchZoningDistricts();
    if (districts.length === 0) {
      this.logger.warn('MassGIS Zoning Districts returned 0 records — leaving existing data untouched');
      return { districtCount: 0 };
    }

    const now = new Date();
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`DELETE FROM "ZoningDistrictMirror"`);
        for (const d of districts) {
          const wkt = ringsToWkt(d.rings);
          await tx.$executeRawUnsafe(
            `INSERT INTO "ZoningDistrictMirror" (id, zone, "zoneDesc", geom, "sourceName", "sourceRefreshedAt")
             VALUES (gen_random_uuid(), $1, $2, ST_MakeValid(ST_SetSRID(ST_GeomFromText($3), 4326)), 'MassGIS Zoning Districts', $4)`,
            d.zone,
            d.zoneDesc,
            wkt,
            now,
          );
        }
      },
      { timeout: 5 * 60 * 1000, maxWait: 10000 },
    );

    this.logger.log(`Ingested ${districts.length} zoning district polygons`);
    return { districtCount: districts.length };
  }
}

function normalizeAssessorAddress(row: MassGisAssessorRow): string {
  const raw = row.SITE_ADDR ?? `${row.ADDR_NUM ?? ''} ${row.FULL_STR_STD ?? ''}`.trim();
  return toTitleCase(raw.replace(/\s+/g, ' ').trim());
}

function toTitleCase(s: string | null): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .split(' ')
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** MassGIS observed LOT_UNITS values: 'A' (acres), 'S' (square feet). */
function normalizeLotSize(value: number | null, unit: string | null): { lotSize: number | null; lotSizeUnit: string | null } {
  if (value === null || value === undefined || value === 0) return { lotSize: null, lotSizeUnit: null };
  if (unit === 'A') return { lotSize: Math.round(value * 43560), lotSizeUnit: 'sqft' };
  return { lotSize: Math.round(value), lotSizeUnit: 'sqft' };
}

/** Esri polygon rings (WGS84 lng/lat pairs) -> WKT POLYGON. First ring is
 * treated as the outer boundary, remaining rings as holes — the common
 * case for a single-parcel lot. A genuinely multi-part (disjoint) parcel
 * would need MULTIPOLYGON handling; flagged as a known simplification in
 * docs/06, not silently mishandled (ST_MakeValid repairs minor issues but
 * won't split a wrongly-merged multi-part parcel). */
function ringsToWkt(rings: number[][][]): string {
  const ringToText = (ring: number[][]) => `(${ring.map(([lng, lat]) => `${lng} ${lat}`).join(', ')})`;
  return `POLYGON(${rings.map(ringToText).join(', ')})`;
}
