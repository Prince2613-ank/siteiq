import { screenParcel } from './parcelScreening';

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
  const data = await loadGeoJson('/geojson/parcels_250m.geojson');
  return {
    ...data,
    features: data.features.map((feature: any) => ({
      ...feature, properties: { ...feature.properties, ...screenParcel(feature.properties) },
    })),
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
