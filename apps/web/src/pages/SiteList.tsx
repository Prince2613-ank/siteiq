import { isUnderOneUsableAcre } from '../utils/parcelScreening';
import { ScoreBadge } from '../components/ParcelScore';
import { ParcelScoringDialog } from '../components/ParcelScoringDialog';
import { useParcelScores } from '../utils/useParcelScores';
import { scoringStorageKey, type ScoringInput } from '../utils/parcelScoring';
import { PropertyRecords } from '../components/PropertyRecords';
import { useEffect, useState, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import './SiteList.css';
import { loadParcels, loadGeoJson, loadListingCheck } from '../utils/dataLoading';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  formatDistance,
  formatYearsOwned,
  formatSaleDate,
  formatSalePrice,
  formatDeedBookPage,
  isAbsenteeOwner,
  parseTaxSignal,
  parseLifeEventSignal,
  LifeEventDisplay,
  getListingAttempts,
  hasListingAttempt,
} from '../utils/parcelFormatters';

function SiteInfoSection({ title, description, children }: {
  title: string; description: string; children: ReactNode;
}) {
  return <section className="site-info-section">
    <header><h4>{title}</h4><p>{description}</p></header>
    <div className="site-info-section-content">{children}</div>
  </section>;
}

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
  const [searchParams] = useSearchParams();
  const [parcels, setParcels] = useState<ParcelFeature[]>([]);
  const ranking = useParcelScores(parcels);
  const [listingCheckData, setListingCheckData] = useState<ListingCheckData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataWarning, setDataWarning] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);

  // Filters & Search
  const [search, setSearch] = useState('');
  const [keepFilter, setKeepFilter] = useState<'ALL' | 'Y' | 'N' | 'LISTED'>(
    searchParams.get('filter') === 'listed' ? 'LISTED' : 'ALL'
  );
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [townFilter, setTownFilter] = useState('ALL');
  const [roadFilter, setRoadFilter] = useState('ALL');
  const [lifeEventFilter, setLifeEventFilter] = useState<'ALL' | 'HAS_SIGNAL' | 'ESTATE' | 'OLDER_OWNER' | 'SENIOR'>('ALL');
  const [sortBy, setSortBy] = useState<'qualified' | 'score_desc' | 'usable_desc' | 'gross_desc' | 'val_desc' | 'address_asc' | 'owner_asc'>('qualified');

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);

  const dialogRef = useRef<HTMLDivElement>(null);

  // Detail Modal
  const [selectedSite, setSelectedSite] = useState<ParcelProperties | null>(null);
  const [selectedScoringSite, setSelectedScoringSite] = useState<ParcelProperties | null>(null);
  const [expandedNote, setExpandedNote] = useState<boolean>(false);

  useEffect(() => {
    setExpandedNote(false);
    if (!selectedSite) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [selectedSite]);

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

  // Reset to page 1 on filter changes
  useEffect(() => {
    setPage(1);
  }, [search, keepFilter, categoryFilter, townFilter, roadFilter, lifeEventFilter, sortBy, pageSize]);

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
      if (roadFilter !== 'ALL' && p.road !== roadFilter) return false;

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
  }, [parcels, search, keepFilter, categoryFilter, townFilter, roadFilter, lifeEventFilter, sortBy, listingCheckData, parcelRanks]);

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
    setRoadFilter('ALL');
    setLifeEventFilter('ALL');
    setSortBy('qualified');
  };

  const handleRankAll = () => {
    handleResetFilters();
    setSortBy('score_desc');
    setPage(1);
  };
  const allSitesRanked = sortBy === 'score_desc' && !search.trim() && keepFilter === 'ALL' && categoryFilter === 'ALL' && townFilter === 'ALL' && roadFilter === 'ALL' && lifeEventFilter === 'ALL';

  const hasActiveFilters = search || keepFilter !== 'ALL' || categoryFilter !== 'ALL' || townFilter !== 'ALL' || roadFilter !== 'ALL' || lifeEventFilter !== 'ALL' || sortBy !== 'qualified';

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
              <span className={`w-1.5 h-1.5 rounded-full ${keepFilter === 'LISTED' ? 'bg-white' : 'bg-red-500 animate-pulse'}`} />
              Listed ({stats.listedCount})
            </button>
          </div>
        </div>

        {/* Dropdowns Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5 text-xs">
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
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Road Corridor</label>
            <select aria-label="Road corridor"
              value={roadFilter}
              onChange={(e) => setRoadFilter(e.target.value)}
              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            >
              <option value="ALL">All Roads</option>
              {stats.roads.map((r) => (
                <option key={r} value={r}>{r}</option>
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
              <option value="qualified">Qualified First, Usable Ac</option>
              <option value="score_desc">Rank by Score (High to Low)</option>
              <option value="usable_desc">Usable Acres (High → Low)</option>
              <option value="gross_desc">Gross Acres (High → Low)</option>
              <option value="val_desc">Assessed Value (High → Low)</option>
              <option value="address_asc">Address (A → Z)</option>
              <option value="owner_asc">Owner (A → Z)</option>
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button type="button" onClick={handleRankAll} disabled={loading || parcels.length === 0}
              aria-pressed={allSitesRanked}
              title="Clear filters and rank every site by opportunity score"
              className={`flex-[1.5] min-w-0 h-9 px-2 rounded-xl border text-[11px] leading-tight font-bold transition-colors disabled:opacity-40 ${allSitesRanked ? 'bg-blue-600 text-white border-blue-600' : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'}`}>
              Rank all {stats.totalSites}<span className="sr-only"> sites</span>
            </button>
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
                <th className="px-3 py-2.5 text-center whitespace-nowrap sticky right-0 bg-slate-50/95 z-20 shadow-[-3px_0_6px_-2px_rgba(0,0,0,0.08)] min-w-[140px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={14} className="px-4 py-12 text-center text-slate-400 font-medium">
                    Loading sites…
                  </td>
                </tr>
              )}
              {!loading && !loadError && currentSites.length === 0 && (
                <tr>
                  <td colSpan={14} className="px-4 py-12 text-center text-slate-400">
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
                    onClick={() => setSelectedSite(p)}
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

                    {/* Actions (Sticky Right) */}
                    <td className="px-3 py-1.5 text-center whitespace-nowrap sticky right-0 bg-white group-hover:bg-slate-50/95 z-10 shadow-[-3px_0_6px_-2px_rgba(0,0,0,0.08)] min-w-[100px]" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => {
                            if (p.parcel_id) {
                              navigate(`/?parcel=${encodeURIComponent(p.parcel_id)}&town=${encodeURIComponent(p.town || '')}`);
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold rounded-lg transition-all shadow-2xs active:scale-95"
                          title="Open parcel in Corridor Map"
                        >
                          <span>🗺️</span>
                          <span>Map</span>
                        </button>
                        <button
                          onClick={() => setSelectedSite(p)}
                          className="inline-flex items-center px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold rounded-lg border border-slate-200 transition-all active:scale-95"
                          title="View site details"
                        >
                          Info
                        </button>
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

      {/* Selected Site Detail Modal */}
      {selectedSite && (() => {
        const lotKey = selectedSite.town && selectedSite.parcel_id
          ? `${selectedSite.town.toUpperCase().trim()}|${selectedSite.parcel_id.trim()}`
          : '';
        const listingInfo = listingCheckData?.lots ? listingCheckData.lots[lotKey] : undefined;
        return (
          <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="site-info-title" onKeyDown={(event) => {
              if (event.key === 'Escape') setSelectedSite(null);
              if (event.key === 'Tab') {
                const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex="0"]');
                if (!controls?.length) return;
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
              }
            }} className="site-info-dialog bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200/80 overflow-hidden animate-fadeIn flex flex-col max-h-[90vh]">
              {/* Modal Header */}
              <div className="site-info-header p-5 border-b border-slate-200 flex items-start justify-between bg-white gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200/60 uppercase tracking-wider">
                      Property information
                    </span>
                    {listingInfo ? renderBadge(listingInfo.status) : (
                      <span className="text-[10px] text-slate-400 italic">Listing not checked</span>
                    )}
                  </div>
                  <h3 id="site-info-title" className="text-xl font-extrabold text-slate-900 tracking-tight break-words">
                    {selectedSite.address || selectedSite.parcel_id}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selectedSite.town}, {selectedSite.state} · ID: <span className="font-mono font-bold text-slate-700">{selectedSite.parcel_id}</span>
                  </p>
                </div>
                <button
                  aria-label="Dismiss property information"
                  onClick={() => setSelectedSite(null)}
                  className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/60 transition-all font-bold text-xs"
                >
                  ✕
                </button>
              </div>

              {/* Modal Body */}
              <div className="site-info-body p-4 space-y-3.5 text-xs overflow-y-auto">
                <SiteInfoSection title="Property overview" description="Land, zoning, access and screening results">
                {/* Grid metrics (Property Display) */}
                <div className="space-y-1.5">
                  
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs">
                      <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Category</span>
                      <span className="font-extrabold text-slate-900 block mt-0.5 text-xs">{selectedSite.category || '—'}</span>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs">
                      <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Development Status</span>
                      <span className="font-extrabold text-emerald-800 block mt-0.5 text-xs">{selectedSite.status || '—'}</span>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs">
                      <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Screening</span>
                      <div className="mt-0.5 flex flex-col gap-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-bold w-fit ${
                          selectedSite.keep === 'Y' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}>
                          {selectedSite.keep === 'Y' ? '✓ Qualified' : '✕ Excluded'}
                        </span>
                        {selectedSite.screening_reason && (
                          <div className="text-[10.5px] text-slate-600 font-medium leading-relaxed pt-0.5">
                            <span className="font-semibold">Screening reason: </span>
                            <span>{selectedSite.screening_reason}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs">
                      <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Land area: total / usable</span>
                      <span className="font-black text-slate-900 block mt-0.5 text-xs">
                        {selectedSite.acres ?? '—'} <span className="text-slate-400 font-normal">/</span> {selectedSite.usable_acres ?? '—'} ac
                      </span>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs">
                      <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Zoning Code</span>
                      <span className="font-extrabold text-indigo-700 block mt-0.5 text-xs">{selectedSite.zoning || '—'}</span>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs">
                      <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Units</span>
                      <span className="font-black text-slate-900 block mt-0.5 text-xs">{selectedSite.units != null ? selectedSite.units : '\u2014'}</span>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs col-span-2">
                      <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Wetland Coverage</span>
                      <span className="font-extrabold text-cyan-800 block mt-0.5 text-xs">{selectedSite.wetland_pct != null ? `${selectedSite.wetland_pct}%` : 'Not recorded'}</span>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs col-span-2">
                      <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Nearest Road & Distance</span>
                      <span className="font-extrabold text-slate-900 block mt-0.5 truncate text-xs">
                        {selectedSite.road || '—'} ({selectedSite.road_dist_m != null ? `${selectedSite.road_dist_m}m` : 'distance not recorded'}) {selectedSite.pct_in_250m != null ? `· ${selectedSite.pct_in_250m}% in 250m buffer` : ''}
                      </span>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs col-span-2">
                      <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Land Use</span>
                      <span className="font-bold text-slate-900 block mt-0.5 text-xs leading-snug break-words" title={selectedSite.use}>
                        {selectedSite.use || '—'}
                      </span>
                    </div>

                    {selectedSite.site_address_town_record && (
                      <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs col-span-2">
                        <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Site Address (Town Record)</span>
                        <span className="font-extrabold text-slate-900 block mt-0.5 text-xs leading-snug">
                          {selectedSite.site_address_town_record}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                </SiteInfoSection>
                <SiteInfoSection title="Current listing status" description="Availability, last checked date and source links">
                {/* Listing Check Section */}
                {(() => {
                  const lotKey = selectedSite.town && selectedSite.parcel_id
                    ? `${selectedSite.town.toUpperCase().trim()}|${selectedSite.parcel_id.trim()}`
                    : '';
                  const listingInfo = listingCheckData?.lots ? listingCheckData.lots[lotKey] : undefined;

                  return (
                    <div className="bg-slate-50/90 border border-slate-200/90 rounded-xl p-3.5 space-y-2.5 shadow-2xs">
                      {/* Header row: "Listing Check" + status badge */}
                      <div className="flex items-center justify-between gap-2 border-b border-slate-200/60 pb-1.5">
                        <div>
                          
                          {listingCheckData?.checked_on && (
                            <span className="text-[10px] text-slate-500 block mt-0.5 font-semibold">
                              Checked {listingCheckData.checked_on}
                            </span>
                          )}
                        </div>
                        {listingInfo ? renderBadge(listingInfo.status) : (
                          <span className="text-xs text-slate-500 font-semibold italic">
                            Listing not checked
                          </span>
                        )}
                      </div>

                      {!listingInfo ? (
                        <div className="text-xs text-slate-500 font-medium italic py-1">
                          No data
                        </div>
                      ) : (
                        <>
                          {/* If listed or has note/proof: callout box */}
                          {(listingInfo.proof || (listingInfo.status && listingInfo.status !== 'Not listed')) && (
                            <div className="bg-gradient-to-br from-rose-50/90 to-amber-50/40 border border-rose-200 rounded-xl p-3 text-xs space-y-2 shadow-2xs">
                              {listingInfo.note && (
                                <div>
                                  <p className={`text-xs text-slate-900 leading-relaxed font-medium ${expandedNote ? '' : 'line-clamp-2'}`}>
                                    {listingInfo.note}
                                  </p>
                                  {listingInfo.note.length > 80 && (
                                    <button
                                      type="button"
                                      onClick={() => setExpandedNote(!expandedNote)}
                                      className="text-xs text-blue-600 font-bold hover:underline mt-1 inline-block"
                                    >
                                      {expandedNote ? 'Show less' : 'more'}
                                    </button>
                                  )}
                                </div>
                              )}
                              {listingInfo.proof && (
                                <div>
                                  <a
                                    href={listingInfo.proof}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs transition-all shadow-sm hover:shadow active:scale-95"
                                  >
                                    Open listing ↗
                                  </a>
                                </div>
                              )}
                            </div>
                          )}

                          {/* "Verify on" row: wrap of small pill buttons ONLY for sites present in links */}
                          {(() => {
                            const linksObj = listingInfo.links || {};
                            const linkKeys = Object.keys(linksObj).filter(k => Boolean(linksObj[k]));
                            const VERIFY_ORDER = ['Zillow', 'Redfin', 'LoopNet', 'Crexi'];
                            const orderedKeys = [
                              ...VERIFY_ORDER.filter(k => linkKeys.includes(k)),
                              ...linkKeys.filter(k => !VERIFY_ORDER.includes(k))
                            ];

                            if (orderedKeys.length === 0) {
                              return (
                                <div className="pt-1">
                                  <span className="text-xs text-slate-500 font-medium italic">
                                    No data
                                  </span>
                                </div>
                              );
                            }

                            return (
                              <div className="space-y-1.5 pt-1">
                                <span className="text-[10.5px] font-extrabold text-slate-600 uppercase tracking-wider block">
                                  Verify on
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                  {orderedKeys.map((name) => (
                                    <a
                                      key={name}
                                      href={linksObj[name]}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200/90 hover:border-slate-300 rounded-lg text-xs font-bold text-slate-800 transition-all shadow-2xs hover:shadow-xs active:scale-95"
                                    >
                                      <span>{name}</span>
                                      <span className="text-[9px] text-slate-500 font-bold">↗</span>
                                    </a>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                        </>
                      )}
                    </div>
                  );
                })()}

                </SiteInfoSection>
                <SiteInfoSection title="Tax & public records" description="Recorded tax signals and registry checks">
                {/* Tax Status & Takings (Money) */}
                {(() => {
                  const taxSignalInfo = parseTaxSignal(selectedSite.unpaid_tax_signal, selectedSite.town, selectedSite.state);
                  const hasTakings = selectedSite.tax_takings_found != null || selectedSite.last_tax_taking || taxSignalInfo != null;

                  if (!hasTakings) return null;

                  return (
                    <div className="bg-slate-50/90 border border-slate-200/90 rounded-xl p-3.5 space-y-2.5 shadow-2xs">
                      <div className="flex items-center justify-between border-b border-slate-200/60 pb-1.5">
                        
                        {selectedSite.tax_check_link && (
                          <a
                            href={selectedSite.tax_check_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] font-bold text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-0.5"
                          >
                            Registry Tax Check ↗
                          </a>
                        )}
                      </div>

                      {taxSignalInfo && (
                        <div>
                          <div
                            className={`p-2.5 rounded-xl border text-xs font-semibold leading-relaxed shadow-2xs ${
                              taxSignalInfo.boxColor === 'red'
                                ? 'bg-rose-50/90 text-rose-900 border-rose-200'
                                : taxSignalInfo.boxColor === 'amber'
                                ? 'bg-amber-50/90 text-amber-900 border-amber-200'
                                : taxSignalInfo.boxColor === 'green'
                                ? 'bg-emerald-50/90 text-emerald-900 border-emerald-200'
                                : 'bg-slate-100 text-slate-800 border-slate-200'
                            }`}
                          >
                            <div className="flex items-start gap-1.5">
                              {taxSignalInfo.icon && (
                                <span className="shrink-0 text-sm leading-tight">{taxSignalInfo.icon}</span>
                              )}
                              <span className="font-bold">{taxSignalInfo.mainText}</span>
                            </div>
                          </div>
                          {taxSignalInfo.condoNote && (
                            <div className="text-[10.5px] text-slate-600 font-medium italic mt-1 px-1">
                              [condo unit, not the whole lot]
                            </div>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs col-span-2">
                          <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Tax Takings Found</span>
                          <span className="font-black text-slate-900 block mt-0.5 text-xs">
                            {selectedSite.tax_takings_found != null ? `${selectedSite.tax_takings_found} recorded` : '0 recorded'}
                          </span>
                        </div>
                        {selectedSite.last_tax_taking && (
                          <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs col-span-2">
                            <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Last Recorded Tax Taking</span>
                            <span className="font-bold text-slate-900 block mt-0.5 text-xs">
                              {selectedSite.last_tax_taking}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                </SiteInfoSection>
                <SiteInfoSection title="Owner & contact" description="Recorded owner, mailing address and related people">
                {/* Owner Details & Location Card */}
                <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between gap-1 flex-wrap">
                    
                    <div className="flex items-center gap-1 flex-wrap">
                      {selectedSite.owner_type && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700">
                          {selectedSite.owner_type}
                        </span>
                      )}
                      {selectedSite.owner_lives_on_lot === 'Y' && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                          Lives on lot
                        </span>
                      )}
                      {isAbsenteeOwner(selectedSite.owner_lives_on_lot, selectedSite.owner_distance_group, selectedSite.owner_type) && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                          Absentee owner
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="font-bold text-slate-900 text-sm break-words">
                    {selectedSite.owner_name || selectedSite.owner || 'Owner not on file'}
                  </div>

                  {selectedSite.owner_mailing_address && (
                    <div className="text-[11px] text-slate-600 flex items-start gap-1.5 bg-white/70 p-2 rounded-lg border border-slate-200/50">
                      <span className="text-slate-400 shrink-0">📍</span>
                      <span className="break-words">{selectedSite.owner_mailing_address}</span>
                    </div>
                  )}

                  {(selectedSite.owner_distance_group || selectedSite.owner_distance_miles != null) && (
                    <div className="flex items-center justify-between text-[10.5px] bg-white/70 px-2 py-1 rounded-lg border border-slate-200/50 text-slate-600">
                      <span>
                        Distance: <b className="text-slate-800">{formatDistance(selectedSite.owner_distance_miles) ?? '—'}</b>
                      </span>
                      <span className="text-slate-400 font-medium">
                        {selectedSite.owner_distance_group || ''}
                      </span>
                    </div>
                  )}

                  {selectedSite.children_count_estate_owner && (
                    <div className="bg-white p-2.5 rounded-xl border border-purple-200/90 shadow-2xs space-y-1.5">
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs">👨‍👩‍👧‍👦</span>
                          <span className="text-[10.5px] font-extrabold text-purple-900 uppercase tracking-wider block">
                            Estate Owner Children / Heirs
                          </span>
                        </div>
                        {(() => {
                          const val = selectedSite.children_count_estate_owner;
                          const match = val.match(/^(\d+)\s+child/i);
                          if (match) {
                            return (
                              <span className="text-[9.5px] font-bold px-2 py-0.5 rounded-md bg-purple-100 text-purple-900 border border-purple-200">
                                {match[1]} {Number(match[1]) === 1 ? 'Child' : 'Children'}
                              </span>
                            );
                          }
                          if (val.toLowerCase().includes('no children')) {
                            return (
                              <span className="text-[9.5px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                                0 Children Named
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>
                      <div className="text-xs font-bold text-slate-900 leading-snug">
                        {selectedSite.children_count_estate_owner}
                      </div>
                    </div>
                  )}

                  {(() => {
                    const cp = selectedSite.company_people;
                    const link = selectedSite.company_record_link;
                    const isBlockedOrGeneric =
                      !cp ||
                      cp.toLowerCase().includes('blocked') ||
                      cp.toLowerCase().includes('not looked up');
                    if (isBlockedOrGeneric) return null;

                    return (
                      <div className="pt-2 border-t border-slate-200/60 text-xs space-y-1">
                        <div className="text-[11px] text-slate-600 leading-snug">
                          <span className="font-bold text-slate-700 block text-[10px] uppercase">Company Officers / Agent:</span>
                          {cp}
                        </div>
                        {link && (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-800 hover:underline pt-0.5"
                          >
                            <span>Secretary of State Corporate Filing</span>
                            <span>↗</span>
                          </a>
                        )}
                      </div>
                    );
                  })()}
                </div>

                </SiteInfoSection>
                <SiteInfoSection title="Mortgage & property restrictions" description="Mortgage, lease, easement and restriction records">
                  <PropertyRecords openMortgage={selectedSite.open_mortgage} leaseEasementRestriction={selectedSite.lease_easement_restriction} />
                </SiteInfoSection>
                <SiteInfoSection title="Ownership & sale history" description="Purchase date, price and deed reference">
                {/* Ownership & Sale History Card */}
                <div className="bg-slate-50/90 border border-slate-200/90 rounded-xl p-3.5 space-y-2.5 shadow-2xs">
                  <div className="flex items-center justify-between border-b border-slate-200/60 pb-1.5">
                    
                    {selectedSite.town_record_link && (
                      <a
                        href={selectedSite.town_record_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-bold text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-0.5"
                      >
                        Town Record ↗
                      </a>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
                      <span className="text-[10.5px] text-slate-500 block font-semibold">Years Owned</span>
                      <span className="font-black text-slate-900 block mt-0.5 text-xs">
                        {formatYearsOwned(selectedSite.years_owned)}
                      </span>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
                      <span className="text-[10.5px] text-slate-500 block font-semibold">Last Sale Date</span>
                      <span className="font-black text-slate-900 block mt-0.5 text-xs">
                        {formatSaleDate(selectedSite.last_sale_date)}
                      </span>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
                      <span className="text-[10.5px] text-slate-500 block font-semibold">Last Sale Price</span>
                      <span className="font-black text-slate-900 block mt-0.5 text-xs">
                        {formatSalePrice(selectedSite.last_sale_price)}
                      </span>
                    </div>
                    <div className="bg-emerald-50/60 p-2.5 rounded-xl border border-emerald-200 shadow-2xs">
                      <span className="text-[10.5px] text-emerald-800 block font-bold">Assessed Value</span>
                      <span className="font-black text-emerald-950 block mt-0.5 text-xs">
                        {(() => {
                          const val = selectedSite.total_val;
                          if (val == null || String(val).trim() === '' || isNaN(Number(val)) || Number(val) <= 0) {
                            return 'Not available';
                          }
                          return `$${Number(val).toLocaleString()}`;
                        })()}
                      </span>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs col-span-2">
                      <span className="text-[10.5px] text-slate-500 block font-semibold">Deed Book / Page</span>
                      <span className="font-mono font-bold text-slate-900 block mt-0.5 text-xs">
                        {formatDeedBookPage(selectedSite.deed_book_page, selectedSite.town, selectedSite.state)}
                      </span>
                    </div>
                  </div>
                </div>

                </SiteInfoSection>
                <SiteInfoSection title="Estate & ownership signals" description="Registry findings and supporting records">
                {/* Life Events & Estate Records Section */}
                {(() => {
                  const lifeInfo = parseLifeEventSignal(
                    selectedSite.life_event_signal,
                    selectedSite.estate_record_detail,
                    selectedSite.town,
                    selectedSite.state
                  );

                  return (
                    <div className="bg-gradient-to-b from-purple-50/80 to-white border border-purple-200/90 rounded-xl p-3.5 space-y-2.5 shadow-2xs">
                      {/* Header */}
                      <div className="flex items-center justify-between border-b border-purple-100 pb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm">⚖️</span>
                          
                        </div>
                        {lifeInfo.hasSignal ? (
                          <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold border shadow-2xs ${lifeInfo.badgeClass}`}>
                            {lifeInfo.icon} {lifeInfo.badgeText}
                          </span>
                        ) : (
                          <span className="text-[10px] px-2.5 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                            No signal recorded
                          </span>
                        )}
                      </div>

                      {/* Main Signal Display */}
                      <div
                        className={`p-2.5 rounded-xl border text-xs leading-relaxed shadow-2xs ${
                          lifeInfo.boxColor === 'purple'
                            ? 'bg-purple-50/90 text-purple-950 border-purple-200'
                            : lifeInfo.boxColor === 'amber'
                            ? 'bg-amber-50/90 text-amber-950 border-amber-200'
                            : lifeInfo.boxColor === 'blue'
                            ? 'bg-blue-50/90 text-blue-950 border-blue-200'
                            : 'bg-slate-50 text-slate-700 border-slate-200/80'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span className="shrink-0 text-base leading-tight">{lifeInfo.icon}</span>
                          <div className="space-y-0.5">
                            <span className="block font-black text-slate-900 text-xs">
                              {lifeInfo.hasSignal ? 'Observed Life Event Signal' : 'Registry Status'}
                            </span>
                            <span className="block text-xs font-semibold text-slate-800 leading-snug">{lifeInfo.mainText}</span>
                          </div>
                        </div>
                      </div>

                      {/* Estate Record Detail (Official Registry Instrument) */}
                      {selectedSite.estate_record_detail && (
                        <div className="bg-white p-2.5 rounded-xl border border-purple-200/90 shadow-2xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10.5px] text-purple-900 block font-black uppercase tracking-wider">
                              Registry Estate Record Detail
                            </span>
                            <span className="text-[9.5px] font-mono text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200 font-bold">
                              Official Instrument
                            </span>
                          </div>
                          <p className="font-bold text-slate-900 text-xs leading-relaxed">
                            {selectedSite.estate_record_detail}
                          </p>
                        </div>
                      )}

                      {/* Estate Owner Children / Heirs */}
                      {selectedSite.children_count_estate_owner && (
                        <div className="bg-white p-2.5 rounded-xl border border-purple-200/90 shadow-2xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10.5px] text-purple-900 block font-black uppercase tracking-wider">
                              Estate Owner Children / Heirs
                            </span>
                            <span className="text-[9.5px] font-mono text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200 font-bold">
                              Obituary Record
                            </span>
                          </div>
                          <p className="font-bold text-slate-900 text-xs leading-relaxed">
                            {selectedSite.children_count_estate_owner}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })()}

                </SiteInfoSection>
                <SiteInfoSection title="Listing history" description="Previous activity from Zillow and Redfin">
                {/* Past Listing Attempts & History Section (Separate Container) */}
                {(() => {
                  const attempts = getListingAttempts(
                    selectedSite.zillow_past_attempt,
                    selectedSite.zillow_link,
                    selectedSite.redfin_past_attempt,
                    selectedSite.redfin_link
                  );

                  return (
                    <div className="bg-slate-50/90 border border-slate-200/90 rounded-xl p-3.5 space-y-2.5 shadow-2xs">
                      <div className="flex items-center justify-between gap-2 border-b border-slate-200/60 pb-1.5">
                        
                        {attempts.length > 0 && (
                          <span className="bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded-full font-bold text-[10px] shadow-2xs">
                            {attempts.length} {attempts.length === 1 ? 'record' : 'records'}
                          </span>
                        )}
                      </div>

                      {attempts.length === 0 ? (
                        <div className="text-xs text-slate-500 font-medium italic py-0.5">
                          No history
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {attempts.map((att) => (
                            <div
                              key={att.source}
                              className={`p-2.5 rounded-lg border ${
                                att.source === 'Zillow'
                                  ? 'bg-blue-50/70 border-blue-200 text-blue-950'
                                  : 'bg-rose-50/70 border-rose-200 text-rose-950'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded leading-none ${
                                  att.source === 'Zillow' ? 'bg-blue-100 text-blue-800' : 'bg-rose-100 text-rose-800'
                                }`}>
                                  {att.source}
                                </span>
                                {att.link && (
                                  <a
                                    href={att.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`inline-flex items-center gap-1 text-[11px] font-bold hover:underline ${
                                      att.source === 'Zillow' ? 'text-blue-700' : 'text-rose-700'
                                    }`}
                                  >
                                    <span>View on {att.source}</span>
                                    <span>↗</span>
                                  </a>
                                )}
                              </div>
                              <p className="text-xs text-slate-800 leading-relaxed font-medium">
                                {att.text}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                </SiteInfoSection>
              </div>


            </div>
          </div>
        );
      })()}
      {selectedScoringSite && ranking.scores.has(scoringStorageKey(selectedScoringSite)) && <ParcelScoringDialog
        parcel={selectedScoringSite} score={ranking.scores.get(scoringStorageKey(selectedScoringSite))!}
        onClose={() => setSelectedScoringSite(null)} />}
    </div>
  );
}
