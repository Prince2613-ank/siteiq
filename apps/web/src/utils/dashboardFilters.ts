import { parcelKey } from './dataLoading';
import { ZONING_GROUPS, zoningCode } from './parcelZoning';
import { matchesWetlandCoverage } from './parcelWetlands';
import type { ParcelLoanData } from './parcelLoans';

export const YEARS_OWNED_FILTERS = [
  { value: 'ALL', label: 'All ownership durations' },
  { value: 'UNDER_5', label: 'Under 5 years' },
  { value: '5_10', label: '5 to under 10 years' },
  { value: '10_20', label: '10 to under 20 years' },
  { value: '20_30', label: '20 to under 30 years' },
  { value: '30_PLUS', label: '30 years or more' },
] as const;

export interface DashboardFilters {
  screening: string;
  districts: string[];
  status: string;
  owner: string;
  wetland: string;
  listing: string;
  years: string;
  loan: string;
}
type FilterParcel = {
  town?: string; parcel_id?: string; zoning?: string; keep?: string;
  status?: string; owner_type?: string; wetland_pct?: unknown; years_owned?: unknown;
  loan?: ParcelLoanData;
};
type ListingRecord = { status?: string; links?: Record<string, string> };
export type ListingRecords = Record<string, ListingRecord>;

export function listingGroup(listing?: ListingRecord): 'LISTED' | 'NOT_LISTED' | 'NO_LINKS' {
  if (listing?.status && listing.status !== 'Not listed') return 'LISTED';
  return Object.values(listing?.links ?? {}).some(url => /^https?:\/\//i.test(url)) ? 'NOT_LISTED' : 'NO_LINKS';
}

export function matchesYearsOwned(value: unknown, filter: string): boolean {
  if (filter === 'ALL') return true;
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return false;
  const years = Number(value);
  if (!Number.isFinite(years) || years < 0) return false;
  switch (filter) {
    case 'UNDER_5': return years < 5;
    case '5_10': return years >= 5 && years < 10;
    case '10_20': return years >= 10 && years < 20;
    case '20_30': return years >= 20 && years < 30;
    case '30_PLUS': return years >= 30;
    default: return false;
  }
}

// One predicate drives the map, cards and every facet count. A facet omits only
// its own selection, so applying another filter always narrows its counts.
export function matchesDashboardFilters(p: FilterParcel, filters: DashboardFilters, listings: ListingRecords,
  omit: readonly (keyof DashboardFilters)[] = []): boolean {
  const check = (key: keyof DashboardFilters) => !omit.includes(key);
  const zone = zoningCode(p.zoning);
  return (!check('screening') || filters.screening === 'ALL' || p.keep === filters.screening)
    && (!check('districts') || filters.districts.length === 0 || filters.districts.includes(zone))
    && (!check('status') || filters.status === 'ALL' || p.status === filters.status)
    && (!check('owner') || filters.owner === 'ALL' || (p.owner_type?.trim() || 'Unknown') === filters.owner)
    && (!check('wetland') || matchesWetlandCoverage(p.wetland_pct, filters.wetland))
    && (!check('years') || matchesYearsOwned(p.years_owned, filters.years))
    && (!check('loan') || filters.loan === 'ALL' || p.loan?.loan_signal === filters.loan)
    && (!check('listing') || filters.listing === 'ALL' || listingGroup(listings[parcelKey(p)]) === filters.listing);
}

export function countFacet<T extends { properties: FilterParcel }>(parcels: T[], filters: DashboardFilters,
  listings: ListingRecords, facet: keyof DashboardFilters | 'zoningGroups',
  options: readonly { value: string }[], extraOmit: readonly (keyof DashboardFilters)[] = []): Record<string, number> {
  const base = parcels.filter(({ properties }) => matchesDashboardFilters(properties, filters, listings,
    facet === 'zoningGroups' ? extraOmit : [facet, ...extraOmit]));
  return Object.fromEntries(options.map(({ value }) => [value, value === 'ALL' ? base.length : base.filter(({ properties }) =>
    facet === 'districts' ? zoningCode(properties.zoning) === value :
      facet === 'zoningGroups' ? ZONING_GROUPS.find(group => group.id === value)?.codes.some(code => code === zoningCode(properties.zoning)) :
        matchesDashboardFilters(properties, { ...filters, [facet]: value }, listings, extraOmit)).length]));
}
