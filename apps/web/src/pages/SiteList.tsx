import { parcelReportPath } from '../utils/parcelReports';
import { useSessionState, useRememberScroll, writeSession, readSession } from '../utils/sessionState';
import { isUnderOneUsableAcre } from '../utils/parcelScreening';
import { ScoreBadge } from '../components/ParcelScore';
import { ParcelScoringDialog } from '../components/ParcelScoringDialog';
import { useParcelScores } from '../utils/useParcelScores';
import { scoringStorageKey, type ScoringInput } from '../utils/parcelScoring';
import { useEffect, useState, useMemo, useRef } from 'react';
import './SiteList.css';
import { loadParcels, loadListingCheck, parcelKey } from '../utils/dataLoading';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  parseLifeEventSignal,
  getListingAttempts,
} from '../utils/parcelFormatters';

export interface ParcelProperties extends ScoringInput {
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
  const [categoryFilter, setCategoryFilter] = useSessionState('sites:categoryFilter', 'ALL');
  const [townFilter, setTownFilter] = useSessionState('sites:townFilter', 'ALL');
  const [lifeEventFilter, setLifeEventFilter] = useSessionState<'ALL' | 'HAS_SIGNAL' | 'ESTATE' | 'OLDER_OWNER' | 'SENIOR'>('sites:lifeEventFilter', 'ALL');
  const [sortBy, setSortBy] = useSessionState<'qualified' | 'score_desc' | 'usable_desc' | 'gross_desc' | 'val_desc' | 'address_asc' | 'owner_asc'>('sites:sortBy:v2', 'score_desc');

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
  const filterSignature = JSON.stringify([search, keepFilter, categoryFilter, townFilter, lifeEventFilter, sortBy, pageSize]);
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
      underOneAcreCount: parcels.filter((feature) => isUnderOneUsableAcre(feature.properties)).length,
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
    const list = parcels.filter((f) => {
      const p = f.properties;
      if (keepFilter === 'Y' && p.keep !== 'Y') return false;
      if (keepFilter === 'N' && p.keep !== 'N') return false;
      if (keepFilter === 'LISTED') {
        const key = `${(p.town || '').toUpperCase().trim()}|${(p.parcel_id || '').trim()}`;
        const lInfo = listingCheckData?.lots?.[key];
        if (!lInfo || !lInfo.status || lInfo.status === 'Not listed') return false;
      }
      if (categoryFilter === 'UNDER_1_USABLE_ACRE') {
        if (!isUnderOneUsableAcre(p)) return false;
      } else if (categoryFilter !== 'ALL' && p.category !== categoryFilter) return false;
      if (townFilter !== 'ALL' && p.town !== townFilter) return false;

      if (lifeEventFilter === 'HAS_SIGNAL') {
        const lInfo = parseLifeEventSignal(p.life_event_signal, p.estate_record_detail, p.town, p.state);
        if (!lInfo.hasSignal) return false;
      } else if (lifeEventFilter === 'ESTATE') {
        const lInfo = parseLifeEventSignal(p.life_event_signal, p.estate_record_detail, p.town, p.state);
        if (!['estate_death', 'estate_filed', 'life_estate'].includes(lInfo.type) && !p.estate_record_detail) return false;
      } else if (lifeEventFilter === 'OLDER_OWNER') {
        const lInfo = parseLifeEventSignal(p.life_event_signal, p.estate_record_detail, p.town, p.state);
        if (lInfo.type !== 'older_owner') return false;
      } else if (lifeEventFilter === 'SENIOR') {
        const lInfo = parseLifeEventSignal(p.life_event_signal, p.estate_record_detail, p.town, p.state);
        if (lInfo.type !== 'senior_deferral') return false;
      }

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const addr = (p.address || '').toLowerCase();
        const pid = (p.parcel_id || '').toLowerCase();
        const own = (p.owner_name || p.owner || '').toLowerCase();
        const use = (p.use || '').toLowerCase();
        const zon = (p.zoning || '').toLowerCase();
        const child = (p.children_count_estate_owner || '').toLowerCase();
        const estate = (p.estate_record_detail || '').toLowerCase();
        const zAtt = (p.zillow_past_attempt || '').toLowerCase();
        const rAtt = (p.redfin_past_attempt || '').toLowerCase();
        return addr.includes(q) || pid.includes(q) || own.includes(q) || use.includes(q) || zon.includes(q) || child.includes(q) || estate.includes(q) || zAtt.includes(q) || rAtt.includes(q);
      }
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
  }, [parcels, search, keepFilter, categoryFilter, townFilter, lifeEventFilter, sortBy, listingCheckData, parcelRanks]);

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
    setCategoryFilter('ALL');
    setTownFilter('ALL');
    setLifeEventFilter('ALL');
    setSortBy('score_desc');
  };

  const hasActiveFilters = search || keepFilter !== 'ALL' || categoryFilter !== 'ALL' || townFilter !== 'ALL' || lifeEventFilter !== 'ALL' || sortBy !== 'score_desc';

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

          {/* Screening Filter Pills */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200/80 text-xs font-semibold flex-wrap">
            <button
              onClick={() => setKeepFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                keepFilter === 'ALL' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({stats.totalSites})
            </button>
            <button
              onClick={() => setKeepFilter('Y')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                keepFilter === 'Y' ? 'bg-emerald-600 text-white shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>✓</span> Qualified ({stats.keepCount})
            </button>
            <button
              onClick={() => setKeepFilter('N')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                keepFilter === 'N' ? 'bg-rose-600 text-white shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>✕</span> Excluded ({stats.dropCount})
            </button>
            <button
              onClick={() => setKeepFilter('LISTED')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                keepFilter === 'LISTED' ? 'bg-red-600 text-white shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Listed ({stats.listedCount})
            </button>
          </div>
        </div>

        {/* Dropdowns Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2.5 text-xs">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Category</label>
            <select aria-label="Category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            >
              <option value="ALL">All Categories</option>
              <option value="UNDER_1_USABLE_ACRE">Under 1 usable acre ({stats.underOneAcreCount})</option>
              {stats.categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Municipality</label>
            <select aria-label="Municipality"
              value={townFilter}
              onChange={(e) => setTownFilter(e.target.value)}
              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            >
              <option value="ALL">All Towns</option>
              {stats.towns.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>


          <div>
            <label className="block text-[10px] font-bold text-purple-700 uppercase tracking-wider mb-1">Life Events</label>
            <select aria-label="Life events"
              value={lifeEventFilter}
              onChange={(e: any) => setLifeEventFilter(e.target.value)}
              className="w-full p-2 bg-purple-50/60 border border-purple-200 rounded-xl font-medium text-purple-950 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
            >
              <option value="ALL">All Life Events ({stats.totalSites})</option>
              <option value="HAS_SIGNAL">Any Signal ({stats.lifeEventCount})</option>
              <option value="ESTATE">Estate / Heirs ({stats.estateCount})</option>
              <option value="OLDER_OWNER">Older Owner (30+ yrs)</option>
              <option value="SENIOR">Senior Tax Deferral</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Sort By</label>
            <select aria-label="Sort by"
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
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
