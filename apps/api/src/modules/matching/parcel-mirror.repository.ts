import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface ParcelMirrorRow {
  id: string;
  parcelRef: string;
  address: string;
  municipality: string;
  zip: string | null;
  lotSize: number | null;
  lotSizeUnit: string | null;
  zoning: string | null;
  useCode: string | null;
  sourceName: string;
  sourceRefreshedAt: Date;
}

export interface FuzzyMatchRow extends ParcelMirrorRow {
  similarity: number;
}

export interface SpatialMatchRow extends ParcelMirrorRow {
  distanceMeters: number;
}

const FIELDS = `id, "parcelRef", address, municipality, zip, "lotSize", "lotSizeUnit", zoning, "useCode", "sourceName", "sourceRefreshedAt"`;

/**
 * All geometry/trigram-index queries against the local parcel mirror
 * (docs/02 §8) live here, behind Prisma's $queryRaw — the one place raw SQL
 * is expected, per doc 01 ADR-0003. Nothing outside this repository knows
 * these are raw queries.
 */
@Injectable()
export class ParcelMirrorRepository {
  constructor(private prisma: PrismaService) {}

  async findByParcelRef(parcelRef: string): Promise<ParcelMirrorRow | null> {
    const rows = await this.prisma.$queryRawUnsafe<ParcelMirrorRow[]>(
      `SELECT ${FIELDS} FROM "ParcelMirrorRecord" WHERE "parcelRef" = $1 LIMIT 1`,
      parcelRef,
    );
    return rows[0] ?? null;
  }

  async findExact(normalizedStreetLine: string, municipality: string | null): Promise<ParcelMirrorRow[]> {
    return this.prisma.$queryRaw<ParcelMirrorRow[]>`
      SELECT ${this.rawFields()} FROM "ParcelMirrorRecord"
      WHERE lower(address) = lower(${normalizedStreetLine})
        AND (${municipality}::text IS NULL OR lower(municipality) = lower(${municipality}))
      LIMIT 5
    `;
  }

  /** pg_trgm similarity search — docs/02 §2's fuzzy-match strategy. */
  async findFuzzy(
    normalizedStreetLine: string,
    municipality: string | null,
    threshold = 0.25,
    limit = 5,
  ): Promise<FuzzyMatchRow[]> {
    return this.prisma.$queryRaw<FuzzyMatchRow[]>`
      SELECT ${this.rawFields()},
             similarity(lower(address), lower(${normalizedStreetLine})) AS similarity
      FROM "ParcelMirrorRecord"
      WHERE similarity(lower(address), lower(${normalizedStreetLine})) > ${threshold}
        AND (${municipality}::text IS NULL OR lower(municipality) = lower(${municipality}))
      ORDER BY similarity DESC
      LIMIT ${limit}
    `;
  }

  /** True point-in-parcel containment via PostGIS ST_Contains — the
   * strongest coordinate-based signal (client requirement, location-based
   * identification): does the supplied point fall INSIDE this parcel's
   * real boundary, not just near its centroid. Distinct from findNearby
   * below, which only measures centroid distance. */
  async findContainingPoint(lat: number, lng: number, limit = 5): Promise<ParcelMirrorRow[]> {
    return this.prisma.$queryRaw<ParcelMirrorRow[]>`
      SELECT ${this.rawFields()} FROM "ParcelMirrorRecord"
      WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))
      LIMIT ${limit}
    `;
  }

  /** PostGIS KNN/radius search — docs/02 §2's spatial-fallback strategy. */
  async findNearby(lat: number, lng: number, radiusMeters: number, limit = 5): Promise<SpatialMatchRow[]> {
    return this.prisma.$queryRaw<SpatialMatchRow[]>`
      SELECT ${this.rawFields()},
             ST_Distance(centroid::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS "distanceMeters"
      FROM "ParcelMirrorRecord"
      WHERE ST_DWithin(centroid::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radiusMeters})
      ORDER BY "distanceMeters" ASC
      LIMIT ${limit}
    `;
  }

  /** Distance from one point to a specific parcel's centroid, for combining with address-based matches. */
  async distanceTo(parcelRef: string, lat: number, lng: number): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<{ distanceMeters: number }[]>`
      SELECT ST_Distance(centroid::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS "distanceMeters"
      FROM "ParcelMirrorRecord"
      WHERE "parcelRef" = ${parcelRef}
      LIMIT 1
    `;
    return rows[0]?.distanceMeters ?? null;
  }

  /** Centroid lat/lng for a parcel — used for the second-zoning-source
   * spatial lookup at field-enrichment time (Checkpoint 8). */
  async findCentroid(parcelRef: string): Promise<{ lat: number; lng: number } | null> {
    const rows = await this.prisma.$queryRaw<{ lat: number; lng: number }[]>`
      SELECT ST_Y(centroid) AS lat, ST_X(centroid) AS lng
      FROM "ParcelMirrorRecord"
      WHERE "parcelRef" = ${parcelRef}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  /** Real parcel boundary + centroid as GeoJSON, for the map (Checkpoint 7).
   * Returns null geometry fields if this parcelRef isn't in the mirror
   * (never fabricated — the map simply won't draw a boundary it doesn't
   * have real data for). */
  async findGeoJson(parcelRefs: string[]): Promise<Map<string, { boundary: unknown; centroid: unknown }>> {
    if (parcelRefs.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<{ parcelRef: string; boundary: string; centroid: string }[]>`
      SELECT "parcelRef", ST_AsGeoJSON(geom) AS boundary, ST_AsGeoJSON(centroid) AS centroid
      FROM "ParcelMirrorRecord"
      WHERE "parcelRef" IN (${Prisma.join(parcelRefs)})
    `;
    const map = new Map<string, { boundary: unknown; centroid: unknown }>();
    for (const row of rows) {
      map.set(row.parcelRef, { boundary: JSON.parse(row.boundary), centroid: JSON.parse(row.centroid) });
    }
    return map;
  }

  private rawFields() {
    return Prisma.raw(FIELDS);
  }
}
