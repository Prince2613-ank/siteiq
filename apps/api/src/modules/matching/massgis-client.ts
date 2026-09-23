import { Injectable, Logger } from '@nestjs/common';

/**
 * Real MassGIS ArcGIS REST client — verified working during Checkpoint 6
 * research (see docs/06-massgis-integration.md for how this was found and
 * confirmed, since none of it was documented anywhere obvious):
 *
 *   Service:   https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/MassachusettsPropertyTaxParcels/FeatureServer
 *   Layer 1:   "Tax Parcels" — polygon geometry, keyed by LOC_ID
 *   Table 4:   "GISDATA.L3_ASSESS" — the assessor extract (address, lot size,
 *              zoning, use code, valuation), also keyed by LOC_ID
 *
 * No API key, no auth — publicly queryable. Confirmed live against real
 * Worcester/New Bedford/Boston/Andover/Quincy/Springfield data.
 *
 * This is the ONLY file that knows this URL, these field names, or Esri's
 * JSON response shape — everything downstream (massgis-ingestion.service.ts)
 * works with a normalized shape, per doc 01 §17/ADR-0006's adapter boundary.
 */
@Injectable()
export class MassGisClient {
  private readonly logger = new Logger(MassGisClient.name);
  private readonly baseUrl =
    'https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/MassachusettsPropertyTaxParcels/FeatureServer';
  private readonly pageSize = 1000; // service maxRecordCount is 2000; stay comfortably under it

  /** Raw assessor-extract rows for one municipality, paginated. */
  async fetchAssessorRows(municipality: string): Promise<MassGisAssessorRow[]> {
    const rows: MassGisAssessorRow[] = [];
    let offset = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const url = new URL(`${this.baseUrl}/4/query`);
      url.searchParams.set('where', `UPPER(CITY)=UPPER('${this.escapeSql(municipality)}')`);
      url.searchParams.set(
        'outFields',
        'LOC_ID,SITE_ADDR,ADDR_NUM,FULL_STR_STD,CITY,ZIP,LOT_SIZE,LOT_UNITS,ZONING,USE_CODE',
      );
      url.searchParams.set('resultOffset', String(offset));
      url.searchParams.set('resultRecordCount', String(this.pageSize));
      url.searchParams.set('f', 'json');

      const page = await this.getJson<{ features?: { attributes: MassGisAssessorRow }[] }>(url);
      const pageRows = (page.features ?? []).map((f) => f.attributes);
      rows.push(...pageRows);

      if (pageRows.length < this.pageSize) break;
      offset += this.pageSize;
    }
    this.logger.log(`Fetched ${rows.length} assessor rows for ${municipality}`);
    return rows;
  }

  /** Polygon geometry (as GeoJSON-shaped ring coordinates, WGS84) for a set of LOC_IDs.
   * Fetched with bounded concurrency — sequential chunking was impractically
   * slow for a real town's parcel count (verified: Andover alone, ~13k
   * assessor rows, took over 90s sequentially). */
  async fetchGeometry(locIds: string[], concurrency = 6): Promise<Map<string, number[][][]>> {
    const result = new Map<string, number[][][]>();
    const chunks: string[][] = [];
    for (let i = 0; i < locIds.length; i += 75) chunks.push(locIds.slice(i, i + 75));

    let cursor = 0;
    const worker = async () => {
      while (cursor < chunks.length) {
        const chunk = chunks[cursor++];
        const url = new URL(`${this.baseUrl}/1/query`);
        url.searchParams.set('where', `LOC_ID IN (${chunk.map((id) => `'${this.escapeSql(id)}'`).join(',')})`);
        url.searchParams.set('outFields', 'LOC_ID');
        url.searchParams.set('returnGeometry', 'true');
        url.searchParams.set('outSR', '4326'); // WGS84 — matches our PostGIS SRID
        url.searchParams.set('f', 'json');

        const page = await this.getJson<{
          features?: { attributes: { LOC_ID: string }; geometry?: { rings: number[][][] } }[];
        }>(url);
        for (const f of page.features ?? []) {
          if (f.geometry?.rings) result.set(f.attributes.LOC_ID, f.geometry.rings);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker()));
    return result;
  }

  /**
   * MassGIS's dedicated statewide Zoning Districts polygon layer
   * (Checkpoint 8) — a genuinely SEPARATE source from the assessor extract's
   * self-reported ZONING field above. Small enough (~1,127 features
   * statewide, confirmed via a count query) to fetch in a handful of
   * paginated calls rather than needing per-municipality filtering.
   */
  async fetchZoningDistricts(): Promise<ZoningDistrictRow[]> {
    const rows: ZoningDistrictRow[] = [];
    let offset = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const url = new URL(`${this.zoningBaseUrl}/0/query`);
      url.searchParams.set('where', '1=1');
      url.searchParams.set('outFields', 'ZONE,ZONE_DESC');
      url.searchParams.set('returnGeometry', 'true');
      url.searchParams.set('outSR', '4326');
      url.searchParams.set('resultOffset', String(offset));
      url.searchParams.set('resultRecordCount', String(this.pageSize));
      url.searchParams.set('f', 'json');

      const page = await this.getJson<{
        features?: { attributes: { ZONE: string; ZONE_DESC: string | null }; geometry?: { rings: number[][][] } }[];
      }>(url);
      const pageFeatures = page.features ?? [];
      for (const f of pageFeatures) {
        if (f.geometry?.rings) {
          rows.push({ zone: f.attributes.ZONE, zoneDesc: f.attributes.ZONE_DESC, rings: f.geometry.rings });
        }
      }
      if (pageFeatures.length < this.pageSize) break;
      offset += this.pageSize;
    }
    this.logger.log(`Fetched ${rows.length} zoning district polygons statewide`);
    return rows;
  }

  private readonly zoningBaseUrl =
    'https://services.arcgis.com/f4rR7WnIfGBdVYFd/arcgis/rest/services/Zoning_Districts/FeatureServer';

  private async getJson<T>(url: URL, attempt = 1): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      if (!res.ok) throw new Error(`MassGIS request failed: ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(`MassGIS error: ${JSON.stringify(data.error)}`);
      return data;
    } catch (err) {
      // Large polygon-geometry responses occasionally exceed a single
      // timeout window under real network conditions — one retry before
      // giving up, rather than failing the whole municipality over one
      // slow request.
      if (attempt < 2) {
        this.logger.warn(`Retrying MassGIS request after: ${(err as Error).message}`);
        return this.getJson<T>(url, attempt + 1);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  private escapeSql(value: string): string {
    return value.replace(/'/g, "''");
  }
}

export interface ZoningDistrictRow {
  zone: string;
  zoneDesc: string | null;
  rings: number[][][];
}

export interface MassGisAssessorRow {
  LOC_ID: string;
  SITE_ADDR: string | null;
  ADDR_NUM: string | null;
  FULL_STR_STD: string | null;
  CITY: string;
  ZIP: string | null;
  LOT_SIZE: number | null;
  LOT_UNITS: string | null; // 'A' = acres, 'S' = square feet (observed values)
  ZONING: string | null;
  USE_CODE: string | null;
}
