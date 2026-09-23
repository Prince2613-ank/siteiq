import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ZoningDistrictMatch {
  zone: string;
  zoneDesc: string | null;
  sourceName: string;
  sourceRefreshedAt: Date;
}

/**
 * The second, independent zoning source (Checkpoint 8) — point-in-polygon
 * lookup against MassGIS's statewide Zoning Districts layer, separate from
 * the assessor-self-reported zoning already in ParcelMirrorRecord. A
 * parcel whose centroid falls outside every polygon here (real, common —
 * statewide coverage has genuine gaps) returns null, never a guess.
 */
@Injectable()
export class ZoningDistrictRepository {
  constructor(private prisma: PrismaService) {}

  async findForPoint(lat: number, lng: number): Promise<ZoningDistrictMatch | null> {
    const rows = await this.prisma.$queryRaw<ZoningDistrictMatch[]>`
      SELECT zone, "zoneDesc", "sourceName", "sourceRefreshedAt"
      FROM "ZoningDistrictMirror"
      WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))
      LIMIT 1
    `;
    return rows[0] ?? null;
  }
}
