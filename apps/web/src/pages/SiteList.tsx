import { SiteFilterDropdown } from '../components/SiteFilterDropdown';
import { YEARS_OWNED_FILTERS, countFacet, matchesDashboardFilters, matchesYearsOwned, type DashboardFilters } from '../utils/dashboardFilters';
import { ZONING_GROUPS, ZONING_DISTRICTS } from '../utils/parcelZoning';
import { LOAN_FILTER_OPTIONS, type ParcelLoanData } from '../utils/parcelLoans';
import { WETLAND_FILTERS } from '../utils/parcelWetlands';
import { parcelReportPath } from '../utils/parcelReports';
import { useSessionState, useRememberScroll, writeSession, readSession } from '../utils/sessionState';
import { ScoreBadge } from '../components/ParcelScore';
import { ParcelScoringDialog } from '../components/ParcelScoringDialog';
import { useParcelScores } from '../utils/useParcelScores';
import { scoringStorageKey, type ScoringInput } from '../utils/parcelScoring';
import { useEffect, useState, useMemo, useRef, type CSSProperties } from 'react';
import './SiteList.css';
import { loadParcels, loadListingCheck, parcelKey } from '../utils/dataLoading';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  parseLifeEventSignal,
  getListingAttempts,
} from '../utils/parcelFormatters';

export interface ParcelProperties extends ScoringInput {
  loan?: ParcelLoanData;
  town?: string;
  state?: string;
  parcel_id?: string;
  address?: string;
  owner?: string;
  category?: string;
  status?: string;
  keep?: 'Y' | 'N';
  drop_reason?: string | null;
  screening_rule?: number;
  screening_reason?: string;
  acres?: number;
  usable_acres?: number;
  wetland_pct?: number;
  road?: string;
  road_dist_m?: number;
  pct_in_250m?: number;
  zoning?: string;
  use?: string;
  total_val?: string | number;
  units?: number;
  open_mortgage?: string | null;
  lease_easement_restriction?: string | null;

  // 18 New Columns
  owner_name?: string;
  owner_type?: string;
  owner_mailing_address?: string;
  company_people?: string;
  company_record_link?: string;
  owner_lives_on_lot?: string;
  owner_distance_miles?: number;
  owner_distance_group?: string;
  years_owned?: number;
  last_sale_date?: string;
  last_sale_price?: string;
  deed_book_page?: string;
  town_record_link?: string;
  tax_takings_found?: number;
  last_tax_taking?: string;
  unpaid_tax_signal?: string;
  tax_check_link?: string;
  site_address_town_record?: string;

  // Life Events & Estate Records
  life_event_signal?: string;
  estate_record_detail?: string;
  past_listing_attempt?: string;
  children_count_estate_owner?: string;

  // Zillow & Redfin Listing History
  zillow_link?: string;
  zillow_past_attempt?: string;
  redfin_link?: string;
  redfin_past_attempt?: string;
}

export interface ParcelFeature {
  type: 'Feature';
  properties: ParcelProperties;
  geometry: any;
}

export interface ListingLot {
  status: string;
  address?: string;
  address_search?: boolean;
  links?: Record<string, string>;
  proof?: string | null;
  note?: string;
}

export interface ListingCheckData {
  checked_on: string;
  link_rule?: string;
  lots: Record<string, ListingLot>;
}

const CATEGORY_COLORS: Record<string, string> = {
  Commercial: '#3b82f6',
  Developable: '#eab308',
  Vacant: '#10b981',
  'Mixed (vacant + built-up)': '#f97316',
  Mixed: '#f97316',
  'Built-up': '#64748b',
  'Built-up (other)': '#64748b',
  Industrial: '#ef4444',
  'Non-developable': '#a855f7',
  'Public land': '#15803d',
  'Paved land': '#94a3b8',
  'Paved, no building': '#94a3b8',
};

function matchesSiteLifeEvent(p: ParcelProperties, filter: string): boolean {
  if (filter === 'ALL') return true;
  const signal = parseLifeEventSignal(p.life_event_signal, p.estate_record_detail, p.town, p.state);
  switch (filter) {
    case 'HAS_SIGNAL': return signal.hasSignal;
    case 'ESTATE': return ['estate_death', 'estate_filed', 'life_estate'].includes(signal.type) || Boolean(p.estate_record_detail);
    case 'OLDER_OWNER': return signal.type === 'older_owner';
    case 'SENIOR': return signal.type === 'senior_deferral';
    default: return false;
  }
}

function matchesSiteSearch(p: ParcelProperties, search: string): boolean {
  const query = search.trim().toLowerCase();
  return !query || [p.address, p.parcel_id, p.owner_name || p.owner, p.use, p.zoning,
    p.children_count_estate_owner, p.estate_record_detail, p.zillow_past_attempt, p.redfin_past_attempt]
    .some(value => (value || '').toLowerCase().includes(query));
}

export function SiteList() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [parcels, setParcels] = useState<ParcelFeature[]>([]);
  const ranking = useParcelScores(parcels);
  const [listingCheckData, setListingCheckData] = useState<ListingCheckData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataWarning, setDataWarning] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);

  // Filters & Search
  const [search, setSearch] = useSessionState('sites:search', '');
  const [keepFilter, setKeepFilter] = useSessionState<'ALL' | 'Y' | 'N' | 'LISTED'>('sites:keepFilter',
    searchParams.get('filter') === 'listed' ? 'LISTED' : 'ALL'
  );
  const [lifeEventFilter, setLifeEventFilter] = useSessionState<'ALL' | 'HAS_SIGNAL' | 'ESTATE' | 'OLDER_OWNER' | 'SENIOR'>('sites:lifeEventFilter', 'ALL');
  const [sortBy, setSortBy] = useSessionState<'qualified' | 'score_desc' | 'usable_desc' | 'gross_desc' | 'val_desc' | 'address_asc' | 'owner_asc'>('sites:sortBy:v2', 'score_desc');

  const [zoningGroups, setZoningGroups] = useSessionState<string[]>('sites:zoningGroups', []);
  const [zoningDistricts, setZoningDistricts] = useSessionState<string[]>('sites:zoningDistricts', []);
  const [developmentSelection, setDevelopment] = useSessionState<string[] | string>('sites:development', 'ALL');
  const development = Array.isArray(developmentSelection) ? developmentSelection.at(-1) ?? 'ALL' : developmentSelection;
  const [owners, setOwners] = useSessionState<string[]>('sites:owners', []);
  const [yearsSelection, setYearsOwned] = useSessionState<string | string[]>('sites:yearsOwned', []);
  const yearsOwned = useMemo(() => (Array.isArray(yearsSelection) ? yearsSelection : [yearsSelection]).filter(value => value !== 'ALL'), [yearsSelection]);
  const [loanCategories, setLoanCategories] = useSessionState<string[]>('sites:loanCategories', []);
  const [wetlands, setWetlands] = useSessionState('sites:wetlands', 'ALL');
  useEffect(() => { if (keepFilter === 'LISTED') setKeepFilter('ALL'); }, [keepFilter]);
  const filters = useMemo<DashboardFilters>(() => ({
    screening: keepFilter === 'LISTED' ? 'ALL' : keepFilter,
    districts: ZONING_GROUPS.filter(group => zoningGroups.includes(group.id)).flatMap(group => {
      const selected = zoningDistricts.filter(code => (group.codes as readonly string[]).includes(code));
      return selected.length > 0 ? selected : [...group.codes];
    }),
    status: development, owner: owners, years: 'ALL', loan: loanCategories, wetland: wetlands, listing: 'ALL',
  }), [keepFilter, zoningGroups, zoningDistricts, development, owners, yearsOwned, loanCategories, wetlands]);
  const ownerTypes = useMemo(() => [...new Set(parcels.map(({ properties }) => properties.owner_type?.trim() || 'Unknown'))].sort(), [parcels]);
  const developmentStatuses = useMemo(() => [...new Set(parcels.map(({ properties }) => properties.status).filter((status): status is string => Boolean(status)))].sort(), [parcels]);
  const contextParcels = useMemo(() => parcels.filter(({ properties }) =>
    matchesSiteSearch(properties, search) && matchesSiteLifeEvent(properties, lifeEventFilter)), [parcels, search, lifeEventFilter]);
  const lifeCounts = useMemo(() => {
    const base = parcels.filter(({ properties }) => matchesSiteSearch(properties, search)
      && matchesDashboardFilters(properties, filters, {})
      && (yearsOwned.length === 0 || yearsOwned.some(value => matchesYearsOwned(properties.years_owned, value))));
    return Object.fromEntries(['ALL', 'HAS_SIGNAL', 'ESTATE', 'OLDER_OWNER', 'SENIOR'].map(value =>
      [value, base.filter(({ properties }) => matchesSiteLifeEvent(properties, value)).length]));
  }, [parcels, search, filters, yearsOwned]);
  const filterCounts = useMemo(() => {
    const tenureParcels = contextParcels.filter(({ properties }) => yearsOwned.length === 0 || yearsOwned.some(value => matchesYearsOwned(properties.years_owned, value)));
    const facet = (key: keyof DashboardFilters | 'zoningGroups', values: readonly string[], omit: (keyof DashboardFilters)[] = []) =>
      countFacet(key === 'years' ? contextParcels : tenureParcels, filters, {}, key, values.map(value => ({ value })), omit);
    return {
      screening: facet('screening', ['ALL', 'Y', 'N']),
      groups: facet('zoningGroups', ZONING_GROUPS.map(group => group.id), ['districts']),
      districts: facet('districts', ZONING_DISTRICTS.map(district => district.code)),
      status: facet('status', developmentStatuses),
      owners: facet('owner', ownerTypes),
      years: facet('years', YEARS_OWNED_FILTERS.map(option => option.value)),
      loans: facet('loan', LOAN_FILTER_OPTIONS.map(option => option.value)),
      wetlands: facet('wetland', WETLAND_FILTERS.map(option => option.value)),
    };
  }, [contextParcels, filters, ownerTypes, yearsOwned, developmentStatuses]);

  // Pagination
  const [page, setPage] = useSessionState('sites:page:v2', 1);
  const [pageSize, setPageSize] = useSessionState<number>('sites:pageSize', 50);


  // Detail Modal
  const legacySelectedSite = useRef(readSession<ParcelProperties | null>('sites:selectedSite')).current;
  const [selectedScoringSite, setSelectedScoringSite] = useSessionState<ParcelProperties | null>('sites:selectedScoringSite', null);

  const openSite = (parcel: ParcelProperties) => {
    writeSession('sites:selectedSite', null);
    navigate(parcelReportPath(parcel));
  };

  useEffect(() => {
    if (legacySelectedSite && !searchParams.has('parcel')) {
      writeSession('sites:selectedSite', null);
      navigate(parcelReportPath(legacySelectedSite), { replace: true, state: location.state });
    }
  }, []);

  useEffect(() => {
    const id = searchParams.get('parcel');
    const town = searchParams.get('town');
    if (!id || !parcels.length) return;
    const matches = parcels.filter(({ properties: p }) => p.parcel_id === id &&
      (!town || p.town?.toUpperCase() === town.toUpperCase()));
    if (matches.length === 1) {
      writeSession('sites:selectedSite', null);
      navigate(parcelReportPath(matches[0].properties), { replace: true, state: location.state });
    }
    else setDataWarning(matches.length > 1 ? 'Select a town to identify the linked parcel.' : 'The linked parcel was not found.');
  }, [parcels, searchParams]);

  const renderBadge = (status?: string) => {
    if (!status || status === 'Not listed') {
      return (
        <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-semibold text-[11px] inline-flex items-center gap-1">
          ✓ Off-market
        </span>
      );
    }
    if (status === 'Listed') {
      return (
        <span className="bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full font-semibold text-[11px] inline-flex items-center gap-1">
          <span className="text-[8px] leading-none text-red-600">●</span> Listed for sale
        </span>
      );
    }
    if (status === 'Listed - one unit only' || status === 'Listed - condo units only') {
      return (
        <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-semibold text-[11px] inline-flex items-center gap-1">
          <span className="text-[8px] leading-none text-amber-600">●</span> Partly listed
        </span>
      );
    }
    if (status === 'Under agreement (pending)') {
      return (
        <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-semibold text-[11px] inline-flex items-center gap-1">
          <span className="text-[8px] leading-none text-amber-600">●</span> Under agreement
        </span>
      );
    }
    return (
      <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-semibold text-[11px]">
        {status}
      </span>
    );
  };

  // Fetch all study corridor parcels and listing check data
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    setDataWarning(null);
    Promise.all([
      loadParcels(),
      loadListingCheck().catch(() => { if (active) setDataWarning('Listing checks are unavailable. Listing status is unknown until the data can be loaded.'); return null; }),
    ])
      .then(([parcelsGeo, listingCheck]) => {
        if (!active) return;
        setParcels(parcelsGeo?.features ?? []);
        setListingCheckData(listingCheck);
        setLoading(false);
      })
      .catch((err) => {
        if (active) { setParcels([]); setLoadError('Parcel data could not be loaded. Check your connection and try again.'); setLoading(false); }
      });

    return () => {
      active = false;
    };
  }, [loadVersion]);

  // Refresh keeps the saved page; actual filter changes start at page 1.
  const filterSignature = JSON.stringify([search, filters, yearsOwned, lifeEventFilter, sortBy, pageSize]);
  const previousFilters = useRef(filterSignature);
  useEffect(() => {
    if (previousFilters.current !== filterSignature) setPage(1);
    previousFilters.current = filterSignature;
  }, [filterSignature]);

  useRememberScroll('sites:scroll', undefined, !loading);
  useRememberScroll(`sites:score-scroll:${selectedScoringSite ? parcelKey(selectedScoringSite) : ''}`, '.parcel-scoring-body', Boolean(selectedScoringSite) && !loading);

  // Sites Stats
  const stats = useMemo(() => {
    let totalAcres = 0;
    let usableAcres = 0;
    let totalVal = 0;
    let keepCount = 0;
    let dropCount = 0;
    let listedCount = 0;
    let lifeEventCount = 0;
    let estateCount = 0;
    const categoriesSet = new Set<string>();
    const townsSet = new Set<string>();
    const roadsSet = new Set<string>();

    parcels.forEach((f) => {
      const p = f.properties;
      totalAcres += p.acres || 0;
      usableAcres += p.usable_acres || 0;
      const v = Number(p.total_val);
      if (!isNaN(v) && v > 0) totalVal += v;

      if (p.keep === 'Y') keepCount++;
      else dropCount++;

      const key = `${(p.town || '').toUpperCase().trim()}|${(p.parcel_id || '').trim()}`;
      const lInfo = listingCheckData?.lots?.[key];
      if (lInfo && lInfo.status && lInfo.status !== 'Not listed') {
        listedCount++;
      }

      const lifeInfo = parseLifeEventSignal(p.life_event_signal, p.estate_record_detail, p.town, p.state);
      if (lifeInfo.hasSignal) {
        lifeEventCount++;
        if (['estate_death', 'estate_filed', 'life_estate'].includes(lifeInfo.type) || p.estate_record_detail) {
          estateCount++;
        }
      }

      if (p.category) categoriesSet.add(p.category);
      if (p.town) townsSet.add(p.town);
      if (p.road) roadsSet.add(p.road);
    });

    return {
      totalSites: parcels.length,
      keepCount,
      dropCount,
      listedCount,
      lifeEventCount,
      estateCount,
      totalAcres: totalAcres.toFixed(1),
      usableAcres: usableAcres.toFixed(1),
      totalValMillion: (totalVal / 1e6).toFixed(1),
      categories: Array.from(categoriesSet).sort(),
      towns: Array.from(townsSet).sort(),
      roads: Array.from(roadsSet).sort(),
    };
  }, [parcels, listingCheckData]);

  // Rank the entire corridor before filtering or pagination. Equal scores use
  // address, then the town/parcel identity, for a stable display position.
  const rankedParcels = useMemo(() => [...parcels].sort((a, b) => {
    const pa = a.properties, pb = b.properties;
    const scoreDifference = (ranking.scores.get(scoringStorageKey(pb))?.score ?? 0) - (ranking.scores.get(scoringStorageKey(pa))?.score ?? 0);
    if (scoreDifference) return scoreDifference;
    const addressDifference = (pa.address || pa.parcel_id || '').localeCompare(pb.address || pb.parcel_id || '', 'en', { numeric: true, sensitivity: 'base' });
    return addressDifference || scoringStorageKey(pa).localeCompare(scoringStorageKey(pb), 'en');
  }), [parcels, ranking.scores]);
  const parcelRanks = useMemo(() => new Map(rankedParcels.map((feature, index) =>
    [scoringStorageKey(feature.properties), index + 1])), [rankedParcels]);

  // Filtered & Sorted parcels
  const filteredSites = useMemo(() => {
    const list = contextParcels.filter((f) => {
      const p = f.properties;
      if (!matchesDashboardFilters(p, filters, {})) return false;
      if (yearsOwned.length > 0 && !yearsOwned.some(value => matchesYearsOwned(p.years_owned, value))) return false;
      return true;
    });

    return list.sort((a, b) => {
      const pa = a.properties;
      const pb = b.properties;

      if (sortBy === 'score_desc') {
        return (parcelRanks.get(scoringStorageKey(pa)) ?? 0) - (parcelRanks.get(scoringStorageKey(pb)) ?? 0);
      }
      if (sortBy === 'qualified') {
        const keepA = pa.keep === 'Y' ? 1 : 0;
        const keepB = pb.keep === 'Y' ? 1 : 0;
        if (keepB !== keepA) return keepB - keepA;
        return (Number(pb.usable_acres) || 0) - (Number(pa.usable_acres) || 0);
      }
      if (sortBy === 'usable_desc') {
        return (Number(pb.usable_acres) || 0) - (Number(pa.usable_acres) || 0);
      }
      if (sortBy === 'gross_desc') {
        return (Number(pb.acres) || 0) - (Number(pa.acres) || 0);
      }
      if (sortBy === 'val_desc') {
        return (Number(pb.total_val) || 0) - (Number(pa.total_val) || 0);
      }
      if (sortBy === 'address_asc') {
        return (pa.address || pa.parcel_id || '').localeCompare(pb.address || pb.parcel_id || '');
      }
      if (sortBy === 'owner_asc') {
        return (pa.owner_name || pa.owner || '').localeCompare(pb.owner_name || pb.owner || '');
      }
      return 0;
    });
  }, [contextParcels, filters, yearsOwned, sortBy, parcelRanks]);

  // Paginated Sites
  const totalItems = filteredSites.length;
  const totalPages = pageSize === 0 ? 1 : Math.ceil(totalItems / pageSize);
  const currentSites = useMemo(() => {
    if (pageSize === 0) return filteredSites;
    const start = (page - 1) * pageSize;
    return filteredSites.slice(start, start + pageSize);
  }, [filteredSites, page, pageSize]);

  const handleResetFilters = () => {
    setSearch('');
    setKeepFilter('ALL');
    setZoningGroups([]);
    setZoningDistricts([]);
    setDevelopment('ALL');
    setOwners([]);
    setYearsOwned([]);
    setLoanCategories([]);
    setWetlands('ALL');
    setLifeEventFilter('ALL');
    setSortBy('score_desc');
  };

  const hasActiveFilters = search || yearsOwned.length > 0 || Object.values(filters).some(value => Array.isArray(value) ? value.length > 0 : value !== 'ALL') || lifeEventFilter !== 'ALL' || sortBy !== 'score_desc';

  return (
    <div className="min-h-full bg-slate-50/50 p-2.5 sm:p-3.5 lg:p-4 w-full space-y-3">
      {/* Search & Filter Controls */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm space-y-3">
        {/* Search row */}
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search sites"
              placeholder="Search sites by address, owner, parcel ID, zoning, land use…"
              className="w-full pl-9 pr-8 py-2.5 bg-slate-50/80 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all shadow-xs"
            />
            <svg className="w-4 h-4 text-slate-400 absolute left-3 top-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-2.5 text-xs text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            )}
          </div>

        </div>

        {/* Dropdowns Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
          <label className="site-filter-field"><span className="site-filter-label">Screening results</span>
            <select className="site-filter-select" aria-label="Screening results" data-active={filters.screening !== 'ALL'} value={filters.screening} onChange={event => setKeepFilter(event.target.value as 'ALL' | 'Y' | 'N')}>
              {[['ALL', 'All'], ['Y', 'Qualified'], ['N', 'Excluded']].map(([value, label]) => <option key={value} value={value}>{label} ({filterCounts.screening[value]})</option>)}
            </select>
          </label>
          <SiteFilterDropdown label="Zoning" allLabel="All zoning groups" selected={zoningGroups}
            selectionCount={zoningDistricts.length || zoningGroups.length}
            summaryText={zoningDistricts.length > 0 ? `${zoningGroups.length === 1 ? ZONING_GROUPS.find(group => group.id === zoningGroups[0])?.name : `${zoningGroups.length} groups`} · ${zoningDistricts.length} selected` : undefined}
            options={ZONING_GROUPS.map(group => ({
              value: group.id, label: group.name, color: group.color, count: filterCounts.groups[group.id],
              detail: zoningDistricts.some(code => (group.codes as readonly string[]).includes(code))
                ? `${zoningDistricts.filter(code => (group.codes as readonly string[]).includes(code)).length} selected` : undefined,
            }))}
            onChange={values => {
              setZoningGroups(values);
              const codes: string[] = ZONING_GROUPS.filter(group => values.includes(group.id)).flatMap(group => [...group.codes]);
              setZoningDistricts(current => current.filter(code => codes.includes(code)));
            }}
            sideContent={zoningGroups.length > 0 ? ZONING_GROUPS.filter(group => zoningGroups.includes(group.id)).map(group =>
              <fieldset key={group.id} className="site-zoning-district-group">
                <legend><span className="site-filter-color" style={{ backgroundColor: group.color }} aria-hidden="true" />{group.name} districts</legend>
                {ZONING_DISTRICTS.filter(district => (group.codes as readonly string[]).includes(district.code)).map(district =>
                  <button key={district.code} type="button" className="site-filter-choice site-filter-choice--zoning" aria-pressed={zoningDistricts.includes(district.code)}
                    style={{ '--zoning-color': district.color } as CSSProperties}
                    onClick={() => setZoningDistricts(current => current.includes(district.code) ? current.filter(code => code !== district.code) : [...current, district.code])}>
                    <span className="site-filter-color" style={{ backgroundColor: district.color }} aria-hidden="true" />
                    <span>{district.name} ({district.code}) ({filterCounts.districts[district.code]})</span>
                  </button>)}
              </fieldset>) : undefined} />
          <label className="site-filter-field"><span className="site-filter-label">Development status</span>
            <select className="site-filter-select" aria-label="Development status" data-active={development !== 'ALL'} value={development} onChange={event => setDevelopment(event.target.value)}>
              <option value="ALL">All development statuses</option>
              {developmentStatuses.map(value => <option key={value} value={value}>{value} ({filterCounts.status[value]})</option>)}
            </select>
          </label>
          <SiteFilterDropdown label="Owner type" allLabel="All owner types" selected={owners} onChange={setOwners}
            options={ownerTypes.map(value => ({ value, label: value, count: filterCounts.owners[value] }))} />
          <SiteFilterDropdown label="Years owned" allLabel="All ownership durations" selected={yearsOwned} onChange={setYearsOwned}
            options={YEARS_OWNED_FILTERS.filter(option => option.value !== 'ALL').map(option => ({ ...option, count: filterCounts.years[option.value] }))} />
          <SiteFilterDropdown label="Loan category" allLabel="All categories" selected={loanCategories} onChange={setLoanCategories}
            options={LOAN_FILTER_OPTIONS.filter(option => option.value !== 'ALL').map(option => ({ ...option, count: filterCounts.loans[option.value] }))} />
          <label className="site-filter-field"><span className="site-filter-label">Wetland coverage</span>
            <select className="site-filter-select" aria-label="Wetland coverage" data-active={wetlands !== 'ALL'} value={wetlands} onChange={event => setWetlands(event.target.value)}>
              {WETLAND_FILTERS.map(option => <option key={option.value} value={option.value}>{option.label} ({filterCounts.wetlands[option.value]})</option>)}
            </select>
          </label>

          <div>
            <label className="site-filter-label">Life Events</label>
            <select aria-label="Life events" data-active={lifeEventFilter !== 'ALL'}
              value={lifeEventFilter}
              onChange={(e: any) => setLifeEventFilter(e.target.value)}
              className="site-filter-select"
            >
              <option value="ALL">All Life Events ({lifeCounts.ALL})</option>
              <option value="HAS_SIGNAL">Any Signal ({lifeCounts.HAS_SIGNAL})</option>
              <option value="ESTATE">Estate / Heirs ({lifeCounts.ESTATE})</option>
              <option value="OLDER_OWNER">Older Owner (30+ yrs) ({lifeCounts.OLDER_OWNER})</option>
              <option value="SENIOR">Senior Tax Deferral ({lifeCounts.SENIOR})</option>
            </select>
          </div>

          <div>
            <label className="site-filter-label">Sort By</label>
            <select aria-label="Sort by" data-active={sortBy !== 'score_desc'}
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              className="site-filter-select"
            >
              <option value="score_desc">Rank by Score (High to Low)</option>
              <option value="qualified">Qualified First, Usable Ac</option>
              <option value="usable_desc">Usable Acres (High → Low)</option>
              <option value="gross_desc">Gross Acres (High → Low)</option>
              <option value="val_desc">Assessed Value (High → Low)</option>
              <option value="address_asc">Address (A → Z)</option>
              <option value="owner_asc">Owner (A → Z)</option>
            </select>
          </div>

          <div className="flex items-end gap-2">
            {hasActiveFilters && (
              <button
                onClick={handleResetFilters}
                className="flex-1 min-w-0 h-9 px-2 text-[11px] leading-tight font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 rounded-xl transition-all"
              >
                ✕ Reset Filters
              </button>
            )}
          </div>
        </div>
      </div>

      {(loadError || dataWarning) && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
        <p>{loadError || dataWarning}</p><button className="mt-2 font-bold underline" onClick={() => setLoadVersion((value) => value + 1)}>Retry data load</button>
      </div>}

      {/* Sites Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
        {/* Table summary bar */}
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row items-start sm:items-center gap-2 justify-between text-xs bg-slate-50/70">
          <span className="font-medium text-slate-600">
            Showing <span className="font-bold text-slate-900 font-mono">{totalItems === 0 ? 0 : (page - 1) * pageSize + 1}–{pageSize === 0 ? totalItems : Math.min(page * pageSize, totalItems)}</span> of <span className="font-bold text-slate-900 font-mono">{totalItems}</span> sites
          </span>
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-[11px]">Rows per page:</span>
            <select aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={0}>All ({totalItems})</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto bg-slate-50/80 px-1.5">
          <table className="w-full border-separate border-spacing-x-0 border-spacing-y-1.5 text-xs text-left">
            <thead>
              <tr className="bg-slate-50/95 text-[10.5px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200/80">
                <th className="px-3 py-2.5 whitespace-nowrap sticky left-0 bg-slate-50/95 z-20 shadow-[1px_0_0_0_rgba(226,232,240,0.8)]">Site / Address</th>
                <th className="px-2 py-2.5 whitespace-nowrap">Owner</th>
                <th className="px-2 py-2.5 whitespace-nowrap">Town</th>
                <th className="px-2 py-2.5 whitespace-nowrap">Category</th>
                <th className="px-2 py-2.5 whitespace-nowrap">Status</th>
                <th className="px-2 py-2.5 whitespace-nowrap">Screening</th>
                <th className="px-2 py-2.5 whitespace-nowrap" title={`Position among all ${parcels.length} sites by score; equal scores use address order`}>Rank</th>
                <th className="px-2 py-2.5 whitespace-nowrap" title="Automatically calculated from source data">Score /100</th>
                <th className="px-2 py-2.5 whitespace-nowrap">Listing Status</th>
                <th className="px-2.5 py-2.5 whitespace-nowrap">Listing History</th>
                <th className="px-2 py-2.5 text-right whitespace-nowrap">Acres (Usable/Gross)</th>
                <th className="px-2 py-2.5 text-right whitespace-nowrap">Assessed Value</th>
                <th className="px-2 py-2.5 whitespace-nowrap">Road Corridor</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={13} className="px-4 py-12 text-center text-slate-400 font-medium">
                    Loading sites…
                  </td>
                </tr>
              )}
              {!loading && !loadError && currentSites.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-4 py-12 text-center text-slate-400">
                    No sites match your search and filter criteria.
                    <div className="mt-2">
                      <button
                        onClick={handleResetFilters}
                        className="text-xs text-blue-600 font-semibold hover:underline"
                      >
                        Clear all filters
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {currentSites.map((f) => {
                const p = f.properties;
                const catColor = CATEGORY_COLORS[p.category || ''] || '#94a3b8';
                const hasVal = p.total_val != null && p.total_val !== '' && !isNaN(Number(p.total_val)) && Number(p.total_val) > 0;
                const valFormatted = hasVal ? `$${Number(p.total_val).toLocaleString()}` : 'Not available';

                const key = `${(p.town || '').toUpperCase().trim()}|${(p.parcel_id || '').trim()}`;
                const lInfo = listingCheckData?.lots?.[key];
                const isListed = lInfo && lInfo.status && lInfo.status !== 'Not listed';

                return (
                  <tr
                    key={`${p.town || ''}_${p.parcel_id || p.address}`}
                    className="bg-white hover:bg-slate-50 transition-colors group cursor-pointer [&>td]:border-y [&>td]:border-slate-200/80 [&>td:first-child]:border-l [&>td:first-child]:rounded-l-lg [&>td:last-child]:border-r [&>td:last-child]:rounded-r-lg"
                    onClick={() => openSite(p)}
                    tabIndex={0}
                    onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openSite(p); } }}
                  >
                    {/* Site / Address (Sticky left) */}
                    <td className="px-3 py-1.5 sticky left-0 bg-white group-hover:bg-slate-50/95 z-10 shadow-[1px_0_0_0_rgba(226,232,240,0.8)]">
                      <div className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors flex items-center gap-1.5 flex-wrap">
                        <span>{p.address || p.parcel_id}</span>
                        {isListed && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold inline-flex items-center gap-1 ${
                              lInfo.status === 'Listed'
                                ? 'bg-red-50 text-red-700 border border-red-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                            title={lInfo.note || lInfo.status}
                          >
                            <span className="text-[7px] leading-none">●</span>
                            {lInfo.status === 'Listed'
                              ? 'Listed'
                              : lInfo.status.includes('one unit') || lInfo.status.includes('condo')
                              ? 'Partly listed'
                              : 'Under agreement'}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                        ID: {p.parcel_id || '—'}
                      </div>
                    </td>

                    {/* Owner */}
                    <td className="px-2.5 py-1.5 max-w-[200px]">
                      <div className="font-semibold text-slate-900 truncate" title={p.owner_name || p.owner}>
                        {p.owner_name || p.owner || '—'}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {p.owner_type && (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200/60">
                            {p.owner_type}
                          </span>
                        )}
                        {p.owner_lives_on_lot === 'Y' ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                            On lot
                          </span>
                        ) : p.owner_distance_miles != null ? (
                          <span className="text-[9px] font-medium text-slate-400">
                            {p.owner_distance_miles} mi away
                          </span>
                        ) : null}
                      </div>
                      {p.tax_takings_found != null && p.tax_takings_found > 0 && (
                        <div className="mt-1">
                          <span
                            className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-200 inline-flex items-center gap-0.5"
                            title={p.last_tax_taking || 'Recorded tax taking'}
                          >
                            <span>⚠️</span> Tax taking ({p.tax_takings_found})
                          </span>
                        </div>
                      )}
                      {(() => {
                        const lifeInfo = parseLifeEventSignal(p.life_event_signal, p.estate_record_detail, p.town, p.state);
                        if (!lifeInfo.hasSignal) return null;
                        return (
                          <div className="mt-1">
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded border inline-flex items-center gap-1 leading-none shadow-2xs ${lifeInfo.badgeClass}`}
                              title={`${p.life_event_signal || ''}${p.estate_record_detail ? ' — ' + p.estate_record_detail : ''}`}
                            >
                              <span>{lifeInfo.icon}</span>
                              <span className="truncate max-w-[170px]">{lifeInfo.badgeText}</span>
                            </span>
                          </div>
                        );
                      })()}
                      {p.children_count_estate_owner && (
                        <div className="mt-1">
                          <span
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded border inline-flex items-center gap-1 leading-none shadow-2xs bg-purple-50 text-purple-900 border-purple-200"
                            title={p.children_count_estate_owner}
                          >
                            <span>👨‍👩‍👧‍👦</span>
                            <span className="truncate max-w-[170px]">{p.children_count_estate_owner}</span>
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Town */}
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      <span className="font-semibold text-slate-700">{p.town}</span>
                      <span className="text-[10px] text-slate-400 ml-1">{p.state}</span>
                    </td>

                    {/* Category */}
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: catColor }} />
                        <span className="font-medium text-slate-800">{p.category || '—'}</span>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      <span className="text-slate-600 font-medium">{p.status || '—'}</span>
                    </td>

                    {/* Screening */}
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                          p.keep === 'Y'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                        title={p.drop_reason ? `Exclusion reason: ${p.drop_reason}` : 'Qualified lot'}
                      >
                        {p.keep === 'Y' ? '✓ Qualified' : '✕ Excluded'}
                      </span>
                    </td>

                    <td className="px-2.5 py-1.5 whitespace-nowrap font-bold tabular-nums text-slate-700" data-parcel-rank={parcelRanks.get(scoringStorageKey(p))}
                      aria-label={`Rank ${parcelRanks.get(scoringStorageKey(p))} of ${parcels.length}`}>
                      #{parcelRanks.get(scoringStorageKey(p))}
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap"><ScoreBadge score={ranking.scores.get(scoringStorageKey(p))} onClick={() => setSelectedScoringSite(p)} /></td>
                    {/* Listing Status */}
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      {(() => {
                        if (!lInfo || !lInfo.status) {
                          return <span className="text-slate-400 text-[11px] italic">Not checked</span>;
                        }
                        return renderBadge(lInfo.status);
                      })()}
                    </td>

                    {/* Listing History / Attempts (Zillow & Redfin) */}
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      {(() => {
                        const attempts = getListingAttempts(
                          p.zillow_past_attempt,
                          p.zillow_link,
                          p.redfin_past_attempt,
                          p.redfin_link
                        );

                        if (attempts.length === 0) {
                          return (
                            <span className="text-slate-400 font-medium italic text-[11px]">
                              No history
                            </span>
                          );
                        }

                        return (
                          <span
                            title={attempts.map((att) => att.source).join(', ')}
                            className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded leading-none border ${
                              attempts[0].source === 'Zillow'
                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}
                          >
                            {attempts[0].source}
                            {attempts.length > 1 && <span>+{attempts.length - 1}</span>}
                          </span>
                        );
                      })()}
                    </td>

                    {/* Acres */}
                    <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                      <span className="font-bold text-slate-900">{p.usable_acres ?? '—'}</span>
                      <span className="text-slate-400 text-[10px] font-normal"> / {p.acres ?? '—'} ac</span>
                    </td>

                    {/* Assessed Value */}
                    <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                      <span className={`font-semibold ${hasVal ? 'text-slate-900' : 'text-slate-400 text-[11px]'}`}>
                        {valFormatted}
                      </span>
                    </td>

                    {/* Road Corridor */}
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      <div className="font-medium text-slate-800">{p.road || '—'}</div>
                      <div className="text-[10px] text-slate-400">
                        {p.road_dist_m != null ? `${p.road_dist_m}m away` : '0m'}
                      </div>
                    </td>

                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination bar */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs bg-slate-50/70">
            <span className="text-slate-500 font-medium">
              Page <span className="font-bold text-slate-800 font-mono">{page}</span> of <span className="font-bold text-slate-800 font-mono">{totalPages}</span>
            </span>
            <div className="flex items-center gap-1.5">
              <button
                disabled={page <= 1}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-medium text-slate-700 disabled:opacity-40 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-2xs active:scale-95"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-medium text-slate-700 disabled:opacity-40 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-2xs active:scale-95"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedScoringSite && ranking.scores.has(scoringStorageKey(selectedScoringSite)) && <ParcelScoringDialog
        parcel={selectedScoringSite} score={ranking.scores.get(scoringStorageKey(selectedScoringSite))!}
        onClose={() => setSelectedScoringSite(null)} />}
    </div>
  );
}
