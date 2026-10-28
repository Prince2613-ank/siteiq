export const WETLAND_FILTERS = [
  { value: 'ALL', label: 'All wetland coverage' },
  { value: 'NONE', label: 'No wetlands (0%)' },
  { value: 'LOW', label: 'More than 0% to under 10%' },
  { value: 'MODERATE', label: '10% to under 25%' },
  { value: 'HIGH', label: '25% to 50%' },
  { value: 'VERY_HIGH', label: 'More than 50%' },
  { value: 'UNKNOWN', label: 'Unknown' },
] as const;

export function matchesWetlandCoverage(value: unknown, filter: string): boolean {
  if (filter === 'ALL') return true;
  const numeric = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
  const percent = numeric ? Number(value) : NaN;
  const known = Number.isFinite(percent) && percent >= 0 && percent <= 100;
  if (filter === 'UNKNOWN') return !known;
  if (!known) return false;
  switch (filter) {
    case 'NONE': return percent === 0;
    case 'LOW': return percent > 0 && percent < 10;
    case 'MODERATE': return percent >= 10 && percent < 25;
    case 'HIGH': return percent >= 25 && percent <= 50;
    case 'VERY_HIGH': return percent > 50;
    default: return false;
  }
}
