export interface ScreeningInput {
  category?: string | null;
  status?: string | null;
  use?: string | null;
  wetland_pct?: number | string | null;
  usable_acres?: number | string | null;
}

export interface ScreeningResult {
  keep: 'Y' | 'N';
  screening_rule: number;
  screening_reason: string;
  drop_reason: string | null;
}

export function isUnderOneUsableAcre(parcel: Pick<ScreeningInput, 'usable_acres'>): boolean {
  const value = parcel.usable_acres;
  if (value == null || (typeof value === 'string' && value.trim() === '')) return false;
  const acres = Number(value);
  return Number.isFinite(acres) && acres >= 0 && acres < 1;
}

// First matching rule wins, in the order supplied by the client.
export function screenParcel(parcel: ScreeningInput): ScreeningResult {
  const category = (parcel.category ?? '').trim().toLowerCase();
  const status = (parcel.status ?? '').trim().toLowerCase();
  const openLand = status === 'vacant' || status === 'mixed' || status === 'mixed (vacant + built-up)';
  const result = (rule: number, qualified: boolean, reason: string): ScreeningResult => ({
    keep: qualified ? 'Y' : 'N', screening_rule: rule, screening_reason: reason,
    drop_reason: qualified ? null : reason,
  });

  if (category === 'public land') return result(1, false, 'Public land: town or state owned');
  if (category === 'non-developable' && parcel.wetland_pct != null &&
      parcel.wetland_pct !== '' && Number(parcel.wetland_pct) > 50) {
    return result(2, false, 'Non-developable land with more than 50% wetland coverage');
  }
  if (/\bcondo(?:minium)?\b/i.test(parcel.use ?? '')) {
    return result(3, false, 'Condominium unit: the land is not independently available');
  }
  if (parcel.usable_acres == null || (typeof parcel.usable_acres === 'string' && parcel.usable_acres.trim() === '') ||
      !Number.isFinite(Number(parcel.usable_acres)) || Number(parcel.usable_acres) < 0) {
    return result(9, false, 'Usable land area is not available; minimum 1 usable acre required');
  }
  if (isUnderOneUsableAcre(parcel)) return result(9, false, 'Less than 1 usable acre');
  if (openLand && ['developable', 'industrial', 'commercial'].includes(category)) {
    return result(4, true, 'Vacant or mixed land in a Developable, Industrial or Commercial category');
  }
  if (category === 'developable') return result(5, true, 'Developable land; any development status');
  if (openLand) return result(6, true, 'Vacant or mixed land; check zoning and wetland conditions');
  if (status === 'built-up') return result(7, false, 'Built-up property');
  if (status === 'paved, no building') return result(8, false, 'Paved land with no building');
  return result(9, false, 'Does not meet the land screening qualification rules');
}
