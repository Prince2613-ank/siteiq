// Use the report's unrounded mapped building-footprint percentage.
// Missing/invalid coverage must not be treated as an empty parcel.
export function developmentStatusFromBuildingCoverage(percent?: number | null, recordedStatus?: string | null): 'Vacant' | 'Built-up' {
  if (typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 && percent <= 100) {
    return percent <= 5 ? 'Vacant' : 'Built-up';
  }
  // Preserve parcels already recorded without buildings. Unknown coverage does
  // not promote a formerly Built-up or Mixed parcel to Vacant.
  const status = (recordedStatus ?? '').trim().toLowerCase();
  return status === 'vacant' || status === 'paved, no building' ? 'Vacant' : 'Built-up';
}
