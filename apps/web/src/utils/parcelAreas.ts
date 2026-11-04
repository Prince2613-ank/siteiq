export const M2_PER_ACRE = 4046.8564224;
export const M2_PER_SQFT = 0.09290304;

export function areaValue(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

export function areaMeasurements(areaM2: unknown, lotM2: unknown) {
  const area = areaValue(areaM2), lot = areaValue(lotM2);
  return {
    acres: area === null ? null : area / M2_PER_ACRE,
    sqft: area === null ? null : area / M2_PER_SQFT,
    percent: area === null || lot === null || lot <= 0 ? null : 100 * area / lot,
  };
}

function sourceAreaMeasurements(areaM2: unknown, lotM2: unknown) {
  const area = areaValue(areaM2), lot = areaValue(lotM2);
  // Never derive precise square feet from an already rounded acreage value.
  return area === null || lot === null || lot <= 0 || area > lot
    ? areaMeasurements(null, null) : areaMeasurements(area, lot);
}

export function vacantLandMeasurements(parcel: { vacant_land_area_m2?: unknown; vacant_land_lot_area_m2?: unknown }) {
  return sourceAreaMeasurements(parcel.vacant_land_area_m2, parcel.vacant_land_lot_area_m2);
}

export function pavedLandMeasurements(parcel: { paved_land_area_m2?: unknown; vacant_land_lot_area_m2?: unknown }) {
  return sourceAreaMeasurements(parcel.paved_land_area_m2, parcel.vacant_land_lot_area_m2);
}
