export interface ScreeningInput {
  category?: string | null;
  category_reason?: string | null;
  status?: string | null;
  use?: string | null;
  wetland_pct?: number | string | null;
  usable_acres?: number | string | null;
  listed_for_sale?: boolean;
  building_coverage_pct?: number | null;
  building_coverage_source?: 'report' | 'source_workbook';
  owner_type?: string | null;
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

// An explicit town developable statement takes precedence over a physical land label.
// Public land and explicit negative statements must not become developable by substring match.
export function hasTownDevelopableReason(categoryReason?: string | null): boolean {
  const reason = (categoryReason ?? '').toLowerCase();
  return /\btown code says developable\b/.test(reason) &&
    !/\b(?:undevelopable|non[ -]developable|not developable)\b/.test(reason);
}

export function resolveCategory(category?: string | null, categoryReason?: string | null): string {
  const cat = (category ?? '').trim();
  const catLower = cat.toLowerCase();
  const reason = (categoryReason ?? '').trim().toLowerCase();

  if (catLower === 'public land') return cat;
  if (hasTownDevelopableReason(reason)) return 'Developable';
  if (/\b(?:undevelopable|non[ -]developable|not developable)\b/.test(reason)) return cat;

  if (catLower === 'paved land' || !catLower) {
    if (reason.includes('industrial') || reason.includes('zoned i') || reason.includes('land use 440')) {
      return 'Industrial';
    }
    if (reason.includes('commercial') || /\b(?:390|391|3900|3910|031|334|337)\b/.test(reason)) {
      return 'Commercial';
    }
  }
  return cat;
}

// Unified ownership check: only private Company, Individual, and Unknown qualify.
export function isAllowedOwnership(parcel: Pick<ScreeningInput, 'owner_type' | 'category'>): boolean {
  if ((parcel.category ?? '').trim().toLowerCase() === 'public land') return false;
  const owner = (parcel.owner_type ?? 'unknown').trim().toLowerCase();
  return ['company', 'individual', 'unknown'].includes(owner);
}

// First matching rule wins, in the order supplied by the client.
export function screenParcel(parcel: ScreeningInput): ScreeningResult {
  const category = resolveCategory(parcel.category, parcel.category_reason).toLowerCase();
  const status = (parcel.status ?? '').trim().toLowerCase();
  const reasonText = (parcel.category_reason ?? '').trim().toLowerCase();
  const hasDevelopableReason = hasTownDevelopableReason(reasonText) ||
    (['developable', 'industrial', 'commercial'].includes(category) &&
      !/\b(?:undevelopable|non[ -]developable|not developable)\b/.test(reasonText));

  const openLand = status === 'vacant' || (status === 'paved, no building' && hasDevelopableReason);
  const vacantReason = parcel.building_coverage_pct == null ? 'Recorded vacant land'
    : `Vacant land with building footprint at or below 5%${parcel.building_coverage_source === 'source_workbook' ? ' (source workbook measurement)' : ''}`;
  const result = (rule: number, qualified: boolean, reason: string): ScreeningResult => ({
    keep: qualified ? 'Y' : 'N', screening_rule: rule, screening_reason: reason,
    drop_reason: qualified ? null : reason,
  });

  if (parcel.listed_for_sale === true) return result(10, false, 'Listed for sale');
  if (category === 'non-developable' && parcel.wetland_pct != null &&
      parcel.wetland_pct !== '' && Number(parcel.wetland_pct) > 50) {
    return result(2, false, 'Non-developable land with more than 50% wetland coverage');
  }
  if (/\bcondo(?:minium)?\b/i.test(parcel.use ?? '')) {
    return result(3, false, 'Condominium unit: the land is not independently available');
  }
  if (status === 'built-up') return result(7, false,
    parcel.building_coverage_pct == null ? 'Building coverage unavailable; not classified as vacant'
      : 'Built-up property: building footprint above 5% of parcel area');

  // Unified ownership screening: only private Company, Individual, and Unknown qualify.
  // Excludes public / government land, trusts, religious / non-profit, and other restricted entities.
  const ownerType = (parcel.owner_type ?? 'unknown').trim().toLowerCase();
  const isPublic = category === 'public land' || ownerType === 'government';
  if (isPublic || !['company', 'individual', 'unknown'].includes(ownerType)) {
    const reason = isPublic
      ? 'Public ownership: town or state owned'
      : `Excluded ownership: ${parcel.owner_type} (only Company, Individual, and Unknown qualify)`;
    return result(1, false, reason);
  }

  if (/\btown code says (?:undevelopable|not developable)\b/.test(reasonText)) {
    return result(12, false, 'Town records describe this land as undevelopable');
  }
  if (category === 'non-developable' && /\bcemetery\b|\bconservation\b|\bchapter 61\b/.test(reasonText)) {
    return result(11, false, 'Source classifies this land as cemetery, conservation or Chapter 61 use');
  }

  if (openLand && ['developable', 'industrial', 'commercial'].includes(category)) {
    if (hasTownDevelopableReason(parcel.category_reason)) {
      return result(4, true, `${vacantReason}; town records describe this land as developable`);
    }
    return result(4, true, `${vacantReason} in a Developable, Industrial or Commercial category`);
  }
  if (status === 'paved, no building' || (category === 'paved land' && !hasDevelopableReason)) {
    return result(8, false, 'Paved land with no building');
  }
  if (openLand) return result(6, true, `${vacantReason}; check zoning and wetland conditions`);
  return result(9, false, 'Does not meet the land screening qualification rules');
}
