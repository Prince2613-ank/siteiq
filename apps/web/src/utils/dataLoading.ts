import { screenParcel, resolveCategory } from './parcelScreening';
import { loadParcelLoans } from './parcelLoans';
import { developmentStatusFromBuildingCoverage } from './parcelDevelopment';
import { isListedForSale } from './parcelListing';

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Data request failed (${response.status})`);
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function loadGeoJson(url: string) {
  const data = await fetchJson(url);
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) ||
      data.features.some((feature: any) => !feature?.properties || !feature.geometry)) {
    throw new Error('The map data is incomplete or invalid.');
  }
  return data;
}

export async function loadListingCheck() {
  const data = await fetchJson('/geojson/listing_check.json');
  if (!data || typeof data.lots !== 'object' || Array.isArray(data.lots) || data.lots === null) {
    throw new Error('Listing data is invalid.');
  }
  return data;
}

export async function loadParcels() {
  const [data, loans, listings, coverage] = await Promise.all([
    loadGeoJson('/geojson/parcels_250m.geojson'), loadParcelLoans(), loadListingCheck(), loadParcelBuildingCoverage(),
  ]);
  return {
    ...data,
    features: data.features.map((feature: any) => {
      const loan = loans.parcels[parcelKey(feature.properties)];
      if (!loan) throw new Error('A parcel has no matching loan record');
      const properties = { ...withBuildingCoverage(feature.properties, coverage), listed_for_sale: isListedForSale(listings.lots[parcelKey(feature.properties)]?.status) };
      return { ...feature, properties: { ...properties, ...screenParcel(properties), loan } };
    }),
  };
}

type BuildingCoverageIndex = { parcels: Record<string, { building_pct: number | null; layer_coverage: 'complete' | 'partial'; measurement_source?: 'report' | 'source_workbook' }> };
export async function loadParcelBuildingCoverage(): Promise<BuildingCoverageIndex> {
  const data = await fetchJson('/geojson/parcel_building_coverage.json');
  if (!data || !data.parcels || typeof data.parcels !== 'object' || Array.isArray(data.parcels)) {
    throw new Error('Building coverage data is invalid.');
  }
  return data;
}

export function withBuildingCoverage<T extends { town?: string; parcel_id?: string; status?: string; category?: string; category_reason?: string | null }>(properties: T, coverage: BuildingCoverageIndex) {
  const record = coverage.parcels[parcelKey(properties)];
  return { ...properties, category: resolveCategory(properties.category, properties.category_reason), recorded_development_status: properties.status,
    status: developmentStatusFromBuildingCoverage(record?.building_pct, properties.status), building_coverage_pct: record?.building_pct ?? null,
    building_layer_coverage: record?.layer_coverage,
    building_coverage_source: record?.measurement_source ?? 'report',
  };
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]!));
}

export function parcelKey(parcel?: { town?: string; parcel_id?: string; address?: string }): string {
  return `${(parcel?.town ?? '').trim().toUpperCase()}|${(parcel?.parcel_id ?? parcel?.address ?? '').trim()}`;
}
