import { isUnderOneUsableAcre } from '../utils/parcelScreening';
import { ScoreBadge } from '../components/ParcelScore';
import { ParcelScoringDialog } from '../components/ParcelScoringDialog';
import { useParcelScores } from '../utils/useParcelScores';
import { scoringStorageKey, type ScoringInput } from '../utils/parcelScoring';
import { PropertyRecords } from '../components/PropertyRecords';
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import L from 'leaflet';
import type { ReactNode } from 'react';
import './Dashboard.css';
import { loadParcels, loadGeoJson, loadListingCheck, escapeHtml, parcelKey } from '../utils/dataLoading';
import 'leaflet/dist/leaflet.css';
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

function DashboardSection({ title, description, children, open = true }: {
  title: string; description: string; children: ReactNode; open?: boolean;
}) {
  return <details className="dashboard-section" open={open}>
    <summary><span><strong>{title}</strong><small>{description}</small></span>
      <svg className="dashboard-section-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </summary>
    <div className="dashboard-section-content">{children}</div>
  </details>;
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

export interface CategoryDefinition {
  group: 'category' | 'status' | 'size';
  key: string;
  label: string;
  fill: string;
  stroke: string;
  textClass: string;
  match: (p: ParcelProperties) => boolean;
}

export const CATEGORIES: CategoryDefinition[] = [
  {
    group: 'size',
    key: 'Under 1 usable acre',
    label: 'Under 1 usable acre',
    fill: '#db2777',
    stroke: '#9d174d',
    textClass: 'text-pink-700 bg-pink-50 border-pink-200',
    match: isUnderOneUsableAcre,
  },
  {
    group: 'category',
    key: 'Commercial',
    label: 'Commercial',
    fill: '#3b82f6',
    stroke: '#1d4ed8',
    textClass: 'text-blue-700 bg-blue-50 border-blue-200',
    match: (p) => p.category === 'Commercial',
  },
  {
    group: 'category',
    key: 'Developable',
    label: 'Developable',
    fill: '#eab308',
    stroke: '#a16207',
    textClass: 'text-amber-800 bg-amber-50 border-amber-200',
    match: (p) => p.category === 'Developable',
  },
  {
    group: 'category',
    key: 'Industrial',
    label: 'Industrial',
    fill: '#ef4444',
    stroke: '#b91c1c',
    textClass: 'text-red-700 bg-red-50 border-red-200',
    match: (p) => p.category === 'Industrial',
  },
  {
    group: 'category',
    key: 'Non-developable',
    label: 'Non-Developable',
    fill: '#a855f7',
    stroke: '#7e22ce',
    textClass: 'text-purple-700 bg-purple-50 border-purple-200',
    match: (p) => p.category === 'Non-developable',
  },
  {
    group: 'category',
    key: 'Public land',
    label: 'Public Land',
    fill: '#15803d',
    stroke: '#166534',
    textClass: 'text-emerald-800 bg-emerald-50 border-emerald-300',
    match: (p) => p.category === 'Public land',
  },
  {
    group: 'category',
    key: 'Built-up (other)',
    label: 'Built-up (other)',
    fill: '#64748b',
    stroke: '#334155',
    textClass: 'text-slate-700 bg-slate-100 border-slate-300',
    match: (p) => p.category === 'Built-up (other)',
  },
  {
    group: 'category',
    key: 'Paved land',
    label: 'Paved Land',
    fill: '#94a3b8',
    stroke: '#475569',
    textClass: 'text-slate-600 bg-slate-50 border-slate-200',
    match: (p) => p.category === 'Paved land',
  },
  {
    group: 'status',
    key: 'Vacant',
    label: 'Vacant',
    fill: '#10b981',
    stroke: '#047857',
    textClass: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    match: (p) => p.status === 'Vacant',
  },
  {
    group: 'status',
    key: 'Mixed',
    label: 'Mixed (Vacant + Built-up)',
    fill: '#f97316',
    stroke: '#c2410c',
    textClass: 'text-orange-700 bg-orange-50 border-orange-200',
    match: (p) => p.status === 'Mixed (vacant + built-up)',
  },
  {
    group: 'status',
    key: 'Built-up',
    label: 'Built-up',
    fill: '#64748b',
    stroke: '#334155',
    textClass: 'text-slate-700 bg-slate-100 border-slate-300',
    match: (p) => p.status === 'Built-up',
  },
  {
    group: 'status',
    key: 'Paved status',
    label: 'Paved, no building',
    fill: '#94a3b8',
    stroke: '#475569',
    textClass: 'text-slate-600 bg-slate-50 border-slate-200',
    match: (p) => p.status === 'Paved, no building',
  },
];

export const CATEGORY_STYLES: Record<string, { fill: string; stroke: string; label: string; textClass: string }> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, { fill: c.fill, stroke: c.stroke, label: c.label, textClass: c.textClass }])
);

export const DEFAULT_CATEGORY_STYLE = {
  key: 'Other',
  label: 'Other',
  fill: '#94a3b8',
  stroke: '#64748b',
  textClass: 'text-slate-600 bg-slate-50 border-slate-200',
  match: () => true,
};

export function getParcelCategoryStyle(p?: ParcelProperties) {
  if (!p) return DEFAULT_CATEGORY_STYLE;
  for (const cat of CATEGORIES) {
    if (cat.group === 'category' && cat.match(p)) return cat;
  }
  return DEFAULT_CATEGORY_STYLE;
}

// 9 Lots filtered out on BOTH town AND parcel_id
const EXCLUDED_SET = new Set([
  'SALISBURY__10-80',
  'SALISBURY__23-39',
  'SALISBURY__18-123',
  'SALISBURY__18-124',
  'SALISBURY__18-125',
  'AMESBURY__78-10',
  'AMESBURY__78-1',
  'AMESBURY__80-28',
  'AMESBURY__77-36',
]);

function isExcludedSite(town?: string, parcel_id?: string): boolean {
  if (!town || !parcel_id) return false;
  return EXCLUDED_SET.has(`${town.toUpperCase().trim()}__${parcel_id.trim()}`);
}

function getBBox(geom: any): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  function traverse(coords: any) {
    if (typeof coords[0] === 'number') {
      const [x, y] = coords;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    } else {
      coords.forEach(traverse);
    }
  }
  traverse(geom.coordinates);
  return [minX, minY, maxX, maxY];
}

function bboxIntersects(b1: [number, number, number, number], b2: [number, number, number, number]): boolean {
  return !(b2[0] > b1[2] || b2[2] < b1[0] || b2[1] > b1[3] || b2[3] < b1[1]);
}

function pointInPoly(pt: [number, number], ring: number[][]): boolean {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function Dashboard() {
  // Layers data states
  const [parcelsData, setParcelsData] = useState<any>(null);
  const [roadsData, setRoadsData] = useState<any>(null);
  const [bufferData, setBufferData] = useState<any>(null);
  const [wetlandsData, setWetlandsData] = useState<any>(null);
  const [buildingsData, setBuildingsData] = useState<any>(null);
  const [listingCheckData, setListingCheckData] = useState<ListingCheckData | null>(null);
  const [expandedNote, setExpandedNote] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataWarning, setDataWarning] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);

  // Filter & Interaction states
  const [selectedParcel, setSelectedParcel] = useState<ParcelProperties | null>(null);
  const [selectedScoringParcel, setSelectedScoringParcel] = useState<ParcelProperties | null>(null);
  const [focusedParcelKey, setFocusedParcelKey] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedRoad, setSelectedRoad] = useState<string>('ALL');
  const [keepFilter, setKeepFilter] = useState<'ALL' | 'Y' | 'N'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [directoryLimit, setDirectoryLimit] = useState(100);
  const [rankingSort, setRankingSort] = useState('source');

  // Layer visibility toggles
  const [showParcels, setShowParcels] = useState(true);
  const [showIndustrial, setShowIndustrial] = useState(true);
  const [showBuffer, setShowBuffer] = useState(false);
  const [showRoads, setShowRoads] = useState(true);
  const [showWetlands, setShowWetlands] = useState(true);
  const [showBuildings, setShowBuildings] = useState(true);
  const [currentZoom, setCurrentZoom] = useState<number>(13);

  // Map refs
  const sidebarRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseTileLayerRef = useRef<L.TileLayer | null>(null);
  const bufferLayerRef = useRef<L.GeoJSON | null>(null);
  const wetlandsLayerRef = useRef<L.GeoJSON | null>(null);
  const buildingsLayerRef = useRef<L.GeoJSON | null>(null);
  const roadsLayerRef = useRef<L.GeoJSON | null>(null);
  const parcelsLayerRef = useRef<L.GeoJSON | null>(null);
  const highlightLayerRef = useRef<L.GeoJSON | null>(null);
  const parcelLayerMapRef = useRef<Map<string, L.Layer>>(new Map());
  const hasFittedInitialRef = useRef(false);

  // Fetch GeoJSON and listing check files on load
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    setDataWarning(null);
    const sources = ['Study boundary', 'Roads', 'Wetlands', 'Buildings', 'Parcels', 'Listing checks'];
    Promise.allSettled([
      loadGeoJson('/geojson/buffer_250m.geojson'),
      loadGeoJson('/geojson/roads.geojson'),
      loadGeoJson('/geojson/wetlands_250m.geojson'),
      loadGeoJson('/geojson/buildings_250m.geojson'),
      loadParcels(),
      loadListingCheck(),
    ]).then((results) => {
      if (!active) return;
      const values = results.map((result) => result.status === 'fulfilled' ? result.value : null);
      const [buffer, roads, wetlands, buildings, parcels, listingCheck] = values;
      setBufferData(buffer);
      setRoadsData(roads);
      setWetlandsData(wetlands);
      setBuildingsData(buildings);
      setParcelsData(parcels);
      setListingCheckData(listingCheck);
      if (!parcels) setLoadError('Parcel data could not be loaded. Check your connection and try again.');
      const unavailable = sources.filter((_, index) => index !== 4 && results[index].status === 'rejected');
      if (unavailable.length) setDataWarning(`${unavailable.join(', ')} unavailable. Parcel records remain accessible.`);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [loadVersion]);

  // Compute analytics from parcel data
  const parcelsList: ParcelFeature[] = useMemo(() => parcelsData?.features ?? [], [parcelsData]);
  const ranking = useParcelScores(parcelsList);

  const stats = useMemo(() => {
    const buildingFeatures: any[] = buildingsData?.features ?? [];
    let totalBuildingAreaM2 = 0;
    buildingFeatures.forEach((b) => {
      totalBuildingAreaM2 += b.properties?.area_m2 || 0;
    });

    const wetlandFeatures: any[] = wetlandsData?.features ?? [];
    let totalWetlandAreaM2 = 0;
    wetlandFeatures.forEach((w) => {
      totalWetlandAreaM2 += w.properties?.area_m2 || 0;
    });

    if (!parcelsList.length) {
      return {
        totalLots: 0,
        keepCount: 0,
        dropCount: 0,
        totalAcres: 0,
        usableAcres: 0,
        totalValMillion: 0,
        totalBuildings: buildingFeatures.length,
        totalBuildingSqFt: Number((totalBuildingAreaM2 * 10.7639).toFixed(0)),
        totalBuildingAcres: Number((totalBuildingAreaM2 * 0.000247105).toFixed(1)),
        totalWetlands: wetlandFeatures.length,
        totalWetlandAcres: Number((totalWetlandAreaM2 * 0.000247105).toFixed(1)),
        categories: {} as Record<string, { count: number; acres: number; usable: number }>,
        roads: {} as Record<string, number>,
        towns: {} as Record<string, number>,
      };
    }

    let totalAcres = 0;
    let usableAcres = 0;
    let keepCount = 0;
    let dropCount = 0;
    let totalVal = 0;
    const categories: Record<string, { count: number; acres: number; usable: number }> = {};
    CATEGORIES.forEach((c) => {
      categories[c.key] = { count: 0, acres: 0, usable: 0 };
    });
    const roads: Record<string, number> = {};
    const towns: Record<string, number> = {};

    parcelsList.forEach((f) => {
      const p = f.properties;
      const ac = p.acres || 0;
      const uac = p.usable_acres || 0;
      const rd = p.road || 'Other';
      const tn = p.town || 'Other';
      const val = parseFloat(String(p.total_val || 0)) || 0;

      totalAcres += ac;
      usableAcres += uac;
      totalVal += val;

      if (p.keep === 'Y') keepCount++;
      else dropCount++;

      const catStyle = getParcelCategoryStyle(p);
      if (catStyle && categories[catStyle.key]) {
        categories[catStyle.key].count++;
        categories[catStyle.key].acres += ac;
        categories[catStyle.key].usable += uac;
      }

      roads[rd] = (roads[rd] || 0) + 1;
      towns[tn] = (towns[tn] || 0) + 1;
    });

    return {
      totalLots: parcelsList.length,
      keepCount,
      dropCount,
      totalAcres: Number(totalAcres.toFixed(1)),
      usableAcres: Number(usableAcres.toFixed(1)),
      totalValMillion: Number((totalVal / 1e6).toFixed(1)),
      totalBuildings: buildingFeatures.length,
      totalBuildingSqFt: Number((totalBuildingAreaM2 * 10.7639).toFixed(0)),
      totalBuildingAcres: Number((totalBuildingAreaM2 * 0.000247105).toFixed(1)),
      totalWetlands: wetlandFeatures.length,
      totalWetlandAcres: Number((totalWetlandAreaM2 * 0.000247105).toFixed(1)),
      categories,
      roads,
      towns,
    };
  }, [parcelsList, buildingsData, wetlandsData]);

  // Filtered parcels for list/search
  const filteredParcels = useMemo(() => {
    return parcelsList.filter((f) => {
      const p = f.properties;
      if (keepFilter !== 'ALL' && p.keep !== keepFilter) return false;
      if (selectedCategory !== 'ALL') {
        const catDef = CATEGORIES.find((c) => c.key === selectedCategory);
        if (catDef && !catDef.match(p)) return false;
      }
      if (selectedRoad !== 'ALL' && p.road !== selectedRoad) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const addr = (p.address || '').toLowerCase();
        const pid = (p.parcel_id || '').toLowerCase();
        const own = (p.owner_name || p.owner || '').toLowerCase();
        return addr.includes(q) || pid.includes(q) || own.includes(q);
      }
      return true;
    });
  }, [parcelsList, keepFilter, selectedCategory, selectedRoad, searchQuery]);

  // Dynamic metrics from filtered parcels
  const filteredMetrics = useMemo(() => {
    let totalAcres = 0;
    filteredParcels.forEach((f) => {
      totalAcres += f.properties?.acres || 0;
    });
    return {
      totalLots: filteredParcels.length,
      totalAcres: Number(totalAcres.toFixed(1)),
    };
  }, [filteredParcels]);

  // Legend counts describe only the parcels matching every active filter.
  const legendCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const category of CATEGORIES) {
      counts[category.key] = filteredParcels.filter((feature) => category.match(feature.properties)).length;
    }
    return counts;
  }, [filteredParcels]);

  // Dynamic Keep Filter counts (given current Road, Category, Search)
  const keepCounts = useMemo(() => {
    const base = parcelsList.filter((f) => {
      const p = f.properties;
      if (selectedRoad !== 'ALL' && p.road !== selectedRoad) return false;
      if (selectedCategory !== 'ALL') {
        const catDef = CATEGORIES.find((c) => c.key === selectedCategory);
        if (catDef && !catDef.match(p)) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const addr = (p.address || '').toLowerCase();
        const pid = (p.parcel_id || '').toLowerCase();
        const own = (p.owner_name || p.owner || '').toLowerCase();
        return addr.includes(q) || pid.includes(q) || own.includes(q);
      }
      return true;
    });

    let keepY = 0;
    let keepN = 0;
    for (const f of base) {
      if (f.properties?.keep === 'Y') keepY++;
      else keepN++;
    }
    return {
      total: base.length,
      keepY,
      keepN,
    };
  }, [parcelsList, selectedRoad, selectedCategory, searchQuery]);

  // Dynamic Road Corridor counts (given current Keep, Category, Search)
  const roadCounts = useMemo(() => {
    const counts: Record<string, number> = {
      'Main St': 0,
      'Macy St': 0,
      'Rabbit Rd': 0,
      'Pike St': 0,
    };
    const base = parcelsList.filter((f) => {
      const p = f.properties;
      if (keepFilter !== 'ALL' && p.keep !== keepFilter) return false;
      if (selectedCategory !== 'ALL') {
        const catDef = CATEGORIES.find((c) => c.key === selectedCategory);
        if (catDef && !catDef.match(p)) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const addr = (p.address || '').toLowerCase();
        const pid = (p.parcel_id || '').toLowerCase();
        const own = (p.owner_name || p.owner || '').toLowerCase();
        return addr.includes(q) || pid.includes(q) || own.includes(q);
      }
      return true;
    });

    for (const f of base) {
      const rd = f.properties?.road;
      if (rd && rd in counts) {
        counts[rd]++;
      }
    }
    return counts;
  }, [parcelsList, keepFilter, selectedCategory, searchQuery]);

  // Spatial association for buildings and wetlands to parcels
  const isFiltered = useMemo(() => {
    return keepFilter !== 'ALL' || selectedCategory !== 'ALL' || selectedRoad !== 'ALL' || searchQuery.trim() !== '';
  }, [keepFilter, selectedCategory, selectedRoad, searchQuery]);

  const activeParcelIdSet = useMemo(() => {
    return new Set(filteredParcels.map((f) => f.properties?.parcel_id).filter(Boolean));
  }, [filteredParcels]);

  const parcelBBoxes = useMemo(() => {
    if (!parcelsList.length) return [];
    return parcelsList.map((f) => ({
      feature: f,
      bbox: getBBox(f.geometry),
      parcel_id: f.properties?.parcel_id,
      road: f.properties?.road,
    }));
  }, [parcelsList]);

  const buildingParcelIds = useMemo(() => {
    const buildingFeatures: any[] = buildingsData?.features ?? [];
    if (!buildingFeatures.length || !parcelBBoxes.length) return [];

    return buildingFeatures.map((bf) => {
      if (!bf.geometry || !bf.geometry.coordinates || bf.geometry.coordinates.length === 0) return null;
      const bBBox = getBBox(bf.geometry);
      const center: [number, number] = [(bBBox[0] + bBBox[2]) / 2, (bBBox[1] + bBBox[3]) / 2];
      let matchedPid: string | null = null;

      for (const pb of parcelBBoxes) {
        if (bboxIntersects(bBBox, pb.bbox)) {
          const geom = pb.feature.geometry;
          const rings: number[][][] = geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map((c: any) => c[0]);
          for (const ring of rings) {
            if (pointInPoly(center, ring)) {
              matchedPid = pb.parcel_id || null;
              break;
            }
          }
          if (matchedPid) break;
        }
      }
      if (!matchedPid) {
        for (const pb of parcelBBoxes) {
          if (bboxIntersects(bBBox, pb.bbox)) {
            matchedPid = pb.parcel_id || null;
            break;
          }
        }
      }
      return matchedPid;
    });
  }, [buildingsData, parcelBBoxes]);

  const wetlandParcelIds = useMemo(() => {
    const wetlandFeatures: any[] = wetlandsData?.features ?? [];
    if (!wetlandFeatures.length || !parcelBBoxes.length) return [];

    return wetlandFeatures.map((wf) => {
      if (!wf.geometry || !wf.geometry.coordinates || wf.geometry.coordinates.length === 0) return [];
      const wBBox = getBBox(wf.geometry);
      const pids: string[] = [];
      for (const pb of parcelBBoxes) {
        if (bboxIntersects(wBBox, pb.bbox) && pb.parcel_id) {
          pids.push(pb.parcel_id);
        }
      }
      return pids;
    });
  }, [wetlandsData, parcelBBoxes]);

  // Filtered buildings: only show building footprints of active parcels
  const filteredBuildingsData = useMemo(() => {
    if (!buildingsData?.features) return null;
    if (!isFiltered) return buildingsData;
    return {
      ...buildingsData,
      features: buildingsData.features.filter((_: any, idx: number) => {
        const pid = buildingParcelIds[idx];
        return pid && activeParcelIdSet.has(pid);
      }),
    };
  }, [buildingsData, isFiltered, buildingParcelIds, activeParcelIdSet]);

  // Filtered wetlands: only show wetland zones intersecting active parcels
  const filteredWetlandsData = useMemo(() => {
    if (!wetlandsData?.features) return null;
    if (!isFiltered) return wetlandsData;
    return {
      ...wetlandsData,
      features: wetlandsData.features.filter((_: any, idx: number) => {
        const pids = wetlandParcelIds[idx];
        return pids && pids.some((pid: string) => activeParcelIdSet.has(pid));
      }),
    };
  }, [wetlandsData, isFiltered, wetlandParcelIds, activeParcelIdSet]);

  // Clear previous parcel selection and popup whenever any filter changes
  useEffect(() => {
    setSelectedParcel(null);
    setFocusedParcelKey(null);
    setExpandedNote(false);
    if (highlightLayerRef.current) {
      highlightLayerRef.current.remove();
      highlightLayerRef.current = null;
    }
    if (mapRef.current) {
      mapRef.current.closePopup();
    }
  }, [keepFilter, selectedCategory, selectedRoad, searchQuery]);

  useEffect(() => {
    setExpandedNote(false);
  }, [selectedParcel]);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Center on Amesbury / Salisbury corridor
    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
      minZoom: 13,
      maxZoom: 19,
    }).setView([42.86, -70.9], 13);

    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    baseTileLayerRef.current = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        className: 'map-tiles-gray',
        attribution: '',
        maxZoom: 19,
      },
    ).addTo(map);

    setCurrentZoom(map.getZoom());
    map.on('zoomend', () => {
      setCurrentZoom(map.getZoom());
    });

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    if (mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);



  // Render Buffer 250m Layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (bufferLayerRef.current) {
      bufferLayerRef.current.remove();
      bufferLayerRef.current = null;
    }

    if (bufferData && showBuffer) {
      const layer = L.geoJSON(bufferData, {
        style: {
          color: '#ea580c',
          weight: 2.5,
          dashArray: '8 6',
          fillColor: '#f97316',
          fillOpacity: 0.05,
        },
      }).addTo(map);

      layer.bindTooltip('250m Highway & Road Corridor Study Buffer', { sticky: true });
      bufferLayerRef.current = layer;

      // Fit bounds to buffer on initial load
      try {
        const bounds = layer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [30, 30] });
        }
      } catch {
        // ignore
      }
    }
  }, [bufferData, showBuffer]);

  // Render Wetlands Layer (only filtered wetlands when filter is active)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (wetlandsLayerRef.current) {
      wetlandsLayerRef.current.remove();
      wetlandsLayerRef.current = null;
    }

    if (filteredWetlandsData && showWetlands) {
      const layer = L.geoJSON(filteredWetlandsData, {
        style: {
          color: '#0891b2',
          weight: 1.5,
          fillColor: '#06b6d4',
          fillOpacity: 0.45,
        },
        onEachFeature: (feature, l) => {
          const type = feature.properties?.wetland_type || 'Wetland Area';
          const areaM2 = feature.properties?.area_m2;
          const acres = areaM2 ? `${(areaM2 * 0.000247105).toFixed(2)} ac` : '';
          const m2 = areaM2 ? `${areaM2.toLocaleString(undefined, { maximumFractionDigits: 1 })} m²` : '';
          l.bindTooltip(
            `<div class="p-1 text-xs">
              <div class="font-bold text-cyan-900">🌿 ${type}</div>
              <div class="text-slate-700 font-medium">${acres} (${m2})</div>
              <div class="text-[10px] text-cyan-700 mt-0.5">Corridor Wetland Zone</div>
            </div>`,
            { sticky: true },
          );
        },
      }).addTo(map);

      wetlandsLayerRef.current = layer;

      if (buildingsLayerRef.current) buildingsLayerRef.current.bringToFront();
      if (roadsLayerRef.current) roadsLayerRef.current.bringToFront();
    }
  }, [filteredWetlandsData, showWetlands]);

  // Render Buildings Layer (only buildings on active parcels; LOD zoom >= 15 or >= 14 if filtered)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (buildingsLayerRef.current) {
      buildingsLayerRef.current.remove();
      buildingsLayerRef.current = null;
    }

    if (filteredBuildingsData && showBuildings && (currentZoom >= 15 || (isFiltered && currentZoom >= 14))) {
      const layer = L.geoJSON(filteredBuildingsData, {
        style: {
          color: '#0f172a',
          weight: 1,
          fillColor: '#334155',
          fillOpacity: 0.85,
        },
        onEachFeature: (feature, l) => {
          const areaM2 = feature.properties?.area_m2;
          const sqft = areaM2 ? `${(areaM2 * 10.7639).toLocaleString(undefined, { maximumFractionDigits: 0 })} sq ft` : '';
          const m2 = areaM2 ? `${areaM2.toFixed(1)} m²` : '';
          const src = feature.properties?.source || 'MassGIS Building Structures';
          l.bindTooltip(
            `<div class="p-1 text-xs">
              <div class="font-bold text-slate-900">🏢 Building Structure</div>
              <div class="text-slate-700 font-medium">${sqft} (${m2})</div>
              <div class="text-[10px] text-slate-400 mt-0.5">${src}</div>
            </div>`,
            { sticky: true },
          );
        },
      }).addTo(map);

      buildingsLayerRef.current = layer;

      if (roadsLayerRef.current) roadsLayerRef.current.bringToFront();
    }
  }, [filteredBuildingsData, showBuildings, currentZoom, isFiltered]);

  // Render Roads Layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (roadsLayerRef.current) {
      roadsLayerRef.current.remove();
      roadsLayerRef.current = null;
    }

    if (roadsData && showRoads) {
      const layer = L.geoJSON(roadsData, {
        style: {
          color: '#0f172a',
          weight: 4,
          opacity: 0.85,
        },
      }).addTo(map);

      roadsLayerRef.current = layer;
      layer.bringToFront();
    }
  }, [roadsData, showRoads]);

  // Center lot directly in the center of the map canvas
  const centerMapOnParcelAndPopup = useCallback((layer: L.Layer, targetZoom = 17) => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    try {
      const bounds = (layer as any).getBounds?.();
      if (bounds && bounds.isValid()) {
        const center = bounds.getCenter();
        const zoom = Math.max(map.getZoom(), targetZoom);
        map.setView(center, zoom, { animate: true });
      }
    } catch {
      // fallback
    }
  }, []);

  // Render Parcels Layer with dynamic styles and category colors
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (parcelsLayerRef.current) {
      parcelsLayerRef.current.remove();
      parcelsLayerRef.current = null;
    }
    parcelLayerMapRef.current.clear();

    if (parcelsData && (showParcels || showIndustrial)) {
      const layer = L.geoJSON(parcelsData, {
        filter: (feature) => {
          const p = feature.properties as ParcelProperties;
          // Industrial parcels have their own toolbar visibility control.
          if (p.category === 'Industrial' ? !showIndustrial : !showParcels) return false;
          if (keepFilter !== 'ALL' && p.keep !== keepFilter) return false;
          if (selectedCategory !== 'ALL') {
            const catDef = CATEGORIES.find((c) => c.key === selectedCategory);
            if (catDef && !catDef.match(p)) return false;
          }
          if (selectedRoad !== 'ALL' && p.road !== selectedRoad) return false;
          if (searchQuery.trim()) {
            const q = searchQuery.trim().toLowerCase();
            const addr = (p.address || '').toLowerCase();
            const pid = (p.parcel_id || '').toLowerCase();
            const own = (p.owner_name || p.owner || '').toLowerCase();
            return addr.includes(q) || pid.includes(q) || own.includes(q);
          }
          return true;
        },
        style: (feature) => {
          const p = feature?.properties as ParcelProperties;
          const isSelected = selectedParcel && parcelKey(selectedParcel) === parcelKey(p);
          const cStyle = getParcelCategoryStyle(p);

          return {
            color: isSelected ? '#fbbf24' : cStyle.stroke,
            weight: isSelected ? 3.5 : 1.2,
            fillColor: cStyle.fill,
            fillOpacity: isSelected ? 0.85 : 0.65,
          };
        },
        onEachFeature: (feature, l) => {
          const p = feature.properties as ParcelProperties;
          if (p.parcel_id) {
            parcelLayerMapRef.current.set(parcelKey(p), l);
          }

          // Small, compact popup card with Owner name & key lot details
          const valFormatted = p.total_val != null && p.total_val !== '' && !isNaN(Number(p.total_val)) && Number(p.total_val) > 0
            ? `$${Number(p.total_val).toLocaleString()}`
            : 'Not available';

          const lifeInfo = parseLifeEventSignal(p.life_event_signal, p.estate_record_detail, p.town, p.state);
          const lifeBadgeHtml = lifeInfo.hasSignal
            ? `<div style="margin-top: 3px;"><span style="display: inline-flex; align-items: center; gap: 3px; font-size: 8.5px; font-weight: 700; padding: 1.5px 5px; border-radius: 4px; background: ${lifeInfo.boxColor === 'purple' ? '#f3e8ff' : lifeInfo.boxColor === 'amber' ? '#fef3c7' : '#eff6ff'}; color: ${lifeInfo.boxColor === 'purple' ? '#6b21a8' : lifeInfo.boxColor === 'amber' ? '#92400e' : '#1e40af'}; border: 1px solid ${lifeInfo.boxColor === 'purple' ? '#d8b4fe' : lifeInfo.boxColor === 'amber' ? '#fde68a' : '#bfdbfe'};">${lifeInfo.icon} ${escapeHtml(lifeInfo.badgeText)}</span></div>`
            : '';

          const popupContent = `
            <div style="width: 220px; font-family: inherit; font-size: 11px; line-height: 1.4; color: #1e293b;">
              <!-- Header with Address & Close Button -->
              <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin-bottom: 5px;">
                <div style="min-width: 0;">
                  <div style="font-weight: 800; font-size: 12px; color: #0f172a; line-height: 1.25; word-break: break-word;">${escapeHtml(p.address || p.parcel_id || 'Parcel')}</div>
                  <div style="color: #64748b; font-size: 10px; margin-top: 1px;">${escapeHtml(p.town || '')}, ${escapeHtml(p.state || '')} · ID: <b>${escapeHtml(p.parcel_id || '—')}</b></div>
                </div>
                <button
                  type="button"
                  class="popup-close-btn"
                  onclick="window.__closeParcelPopup && window.__closeParcelPopup()"
                  style="width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; border-radius: 5px; border: 1px solid #e2e8f0; background: #f8fafc; color: #64748b; font-size: 11px; font-weight: bold; cursor: pointer; flex-shrink: 0; line-height: 1; transition: all 0.15s; margin-top: -2px; margin-right: -2px;"
                  title="Close card"
                  onmouseover="this.style.background='#e2e8f0'; this.style.color='#0f172a'"
                  onmouseout="this.style.background='#f8fafc'; this.style.color='#64748b'"
                >✕</button>
              </div>
              
              <!-- Owner Name -->
              <div style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px 7px; margin-bottom: 5px;">
                <div style="font-size: 8.5px; color: #64748b; font-weight: 700; text-transform: uppercase;">Owner</div>
                <div style="font-weight: 700; color: #0f172a; font-size: 11px; word-break: break-word; line-height: 1.25; margin-top: 1px;">${escapeHtml(p.owner_name || p.owner || 'Owner not on file')}</div>
                ${lifeBadgeHtml}
                ${p.children_count_estate_owner ? `<div style="margin-top: 3px; font-size: 9px; font-weight: 700; color: #6b21a8; background: #f3e8ff; border: 1px solid #d8b4fe; border-radius: 4px; padding: 1px 4px; display: inline-flex; align-items: center; gap: 3px;">👨‍👩‍👧‍👦 ${escapeHtml(p.children_count_estate_owner)}</div>` : ''}
              </div>

              <!-- Key Lot Details (Compact 2x2 grid) -->
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 3px 6px; font-size: 10px; margin-bottom: 5px;">
                <div><span style="color: #64748b;">Category:</span> <b>${escapeHtml(p.category || '—')}</b></div>
                <div><span style="color: #64748b;">Acres:</span> <b>${p.acres != null ? p.acres + ' ac' : '—'}</b></div>
                <div><span style="color: #64748b;">Status:</span> <b>${escapeHtml(p.status || '—')}</b></div>
                <div><span style="color: #64748b;">Assessed:</span> <b>${valFormatted}</b></div>
              </div>

            </div>
          `;
          l.bindPopup(popupContent, {
            maxWidth: 240,
            minWidth: 210,
            autoPan: false,
            closeButton: false,
            offset: L.point(0, -6),
          });

          // Click on lot: centers the lot dead-center in the map and opens the card pointing directly to it
          l.on('click', () => {
            setFocusedParcelKey(parcelKey(p));
            centerMapOnParcelAndPopup(l, 17);
            l.openPopup();
          });
        },
      }).addTo(map);

      parcelsLayerRef.current = layer;
      if (!hasFittedInitialRef.current && !selectedParcel && !window.location.search.includes('parcel=')) {
        hasFittedInitialRef.current = true;
        try {
          const b = layer.getBounds();
          if (b.isValid()) {
            map.fitBounds(b, { padding: [30, 30] });
            const homeZoom = map.getZoom();
            map.setMinZoom(homeZoom);
          }
        } catch {
          // ignore
        }
      } else {
        const isFiltered = keepFilter !== 'ALL' || selectedCategory !== 'ALL' || selectedRoad !== 'ALL' || searchQuery.trim() !== '';
        if (isFiltered) {
          try {
            const b = layer.getBounds();
            if (b.isValid()) {
              map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
            }
          } catch {
            // ignore
          }
        }
      }
      if (wetlandsLayerRef.current) wetlandsLayerRef.current.bringToFront();
      if (buildingsLayerRef.current) buildingsLayerRef.current.bringToFront();
      if (roadsLayerRef.current) roadsLayerRef.current.bringToFront();
    }
  }, [parcelsData, showParcels, showIndustrial, keepFilter, selectedCategory, selectedRoad, searchQuery, listingCheckData]);

  // Highlight selected or focused parcel polygon
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (highlightLayerRef.current) {
      highlightLayerRef.current.remove();
      highlightLayerRef.current = null;
    }

    const activeId = focusedParcelKey || (selectedParcel ? parcelKey(selectedParcel) : null);
    if (activeId && parcelsData) {
      const matchFeature = parcelsData.features?.find(
        (f: any) => parcelKey(f.properties) === activeId,
      );
      if (matchFeature && (matchFeature.properties.category === 'Industrial' ? showIndustrial : showParcels)) {
        const hLayer = L.geoJSON(matchFeature, {
          style: {
            color: '#fbbf24',
            weight: 4,
            fillColor: '#f59e0b',
            fillOpacity: 0.35,
          },
        }).addTo(map);
        highlightLayerRef.current = hLayer;
      }
    }
  }, [focusedParcelKey, selectedParcel, parcelsData, showParcels, showIndustrial]);

  const handleZoomToParcel = useCallback((parcelId: string) => {
    const layer = parcelLayerMapRef.current.get(parcelId);
    if (layer && mapRef.current) {
      centerMapOnParcelAndPopup(layer, 17);
      (layer as any).openPopup?.();
    }
  }, [centerMapOnParcelAndPopup]);

  const handleSelectParcel = useCallback((p: ParcelProperties) => {
    setSelectedParcel(p);
    setFocusedParcelKey(parcelKey(p));
    sidebarRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    requestAnimationFrame(() => {
      sidebarRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    });
    setTimeout(() => {
      sidebarRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
    if (p.parcel_id) {
      handleZoomToParcel(parcelKey(p));
    }
  }, [handleZoomToParcel]);

  // Keep the map popup close control available to its HTML content.
  useEffect(() => {
    const closePopup = () => {
      setFocusedParcelKey(null);
      if (mapRef.current) {
        mapRef.current.closePopup();
      }
    };

    (window as any).__closeParcelPopup = closePopup;

    const handlePopupClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const closeBtn = target.closest('.popup-close-btn');
      if (closeBtn) {
        e.preventDefault();
        e.stopPropagation();
        closePopup();
        return;
      }
    };
    document.addEventListener('click', handlePopupClick);

    return () => {
      delete (window as any).__closeParcelPopup;
      document.removeEventListener('click', handlePopupClick);
    };
  }, [parcelsData]);

  // Check for URL ?parcel= query param on load
  useEffect(() => {
    if (!parcelsData) return;
    const params = new URLSearchParams(window.location.search);
    const pid = params.get('parcel');
    const town = params.get('town');
    if (pid) {
      const matches = parcelsData.features?.filter((f: ParcelFeature) =>
        f.properties.parcel_id === pid && (!town || f.properties.town?.toUpperCase() === town.toUpperCase()),
      ) ?? [];
      if (matches.length === 1) {
        const match = matches[0];
        setSelectedParcel(match.properties);
        const timeout = window.setTimeout(() => handleZoomToParcel(parcelKey(match.properties)), 400);
        return () => window.clearTimeout(timeout);
      }
      setDataWarning(matches.length > 1
        ? 'This parcel ID exists in more than one town. Select a property from the parcel results.'
        : 'The linked parcel was not found. Select a property from the parcel results.');
      const bounds = parcelsLayerRef.current?.getBounds();
      if (bounds?.isValid()) mapRef.current?.fitBounds(bounds, { padding: [30, 30] });
    }
  }, [parcelsData, handleZoomToParcel]);

  const handleBackToResults = () => {
    setSelectedParcel(null);
    requestAnimationFrame(() => sidebarRef.current?.scrollTo({ top: 0 }));
  };

  const handleResetView = () => {
    setSelectedParcel(null);
    setFocusedParcelKey(null);
    setSelectedCategory('ALL');
    setSelectedRoad('ALL');
    setKeepFilter('ALL');
    setSearchQuery('');
    setShowParcels(true);
    setShowIndustrial(true);
    setShowWetlands(true);
    setShowBuildings(true);
    setShowRoads(true);
    if (mapRef.current) {
      if (parcelsLayerRef.current) {
        try {
          const b = parcelsLayerRef.current.getBounds();
          if (b.isValid()) {
            mapRef.current.fitBounds(b, { padding: [30, 30] });
            const homeZoom = mapRef.current.getZoom();
            mapRef.current.setMinZoom(homeZoom);
            return;
          }
        } catch {
          // ignore
        }
      }
      mapRef.current.fitBounds(
        [
          [42.839669, -70.934616],
          [42.881904, -70.865485],
        ],
        { padding: [30, 30] },
      );
      mapRef.current.setMinZoom(13);
    }
  };

  return (
    <div className="h-[calc(100vh-3.5rem)] w-full flex flex-col lg:flex-row overflow-hidden bg-slate-100">
      {/* Analytics Panel on LEFT */}
      <div ref={sidebarRef} className="dashboard-sidebar w-full lg:w-1/3 lg:shrink-0 h-[48vh] lg:h-full overflow-y-auto bg-white flex flex-col shadow-sm border-t lg:border-t-0 lg:border-r border-slate-300 z-10 order-2 lg:order-1">
        <header className="dashboard-sidebar-header">
          <div className="flex items-center justify-between gap-3">
            <div><h2>Overview</h2></div>
            <span className="dashboard-total">{loading ? 'Loading...' : loadError ? 'Data unavailable' : `${stats.totalLots.toLocaleString()} parcels`}</span>
          </div>
          <p className="dashboard-region">Amesbury / Salisbury / Seabrook</p>
          {selectedParcel && <button className="dashboard-back" onClick={handleBackToResults}><span aria-hidden="true">&larr; </span>Back to parcel results</button>}
        </header>

        <div className="dashboard-sidebar-body p-4 space-y-4 flex-1 text-slate-800">
          {(loadError || dataWarning) && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p>{loadError || dataWarning}</p><button className="mt-2 font-bold underline" onClick={() => setLoadVersion((value) => value + 1)}>Retry data load</button>
          </div>}

          {/* Selected Lot Inspector Card */}
          {selectedParcel && (
            <div className="dashboard-inspector space-y-3.5">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[10px] font-extrabold text-blue-700 uppercase tracking-wider bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse"></span>
                      Selected property
                    </span>
                    <span className="text-[11px] font-mono font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                      {selectedParcel.parcel_id}
                    </span>
                  </div>
                  <h3 className="text-base font-black text-slate-900 truncate">
                    {selectedParcel.address || selectedParcel.parcel_id}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 font-medium">
                    {selectedParcel.town}, {selectedParcel.state}
                  </p>
                </div>
                <button
                  onClick={handleBackToResults}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
                  title="Back to parcel results" aria-label="Back to parcel results"
                >
                  ✕
                </button>
              </div>

              <DashboardSection title="Property overview" description="Land, zoning, access and screening results" open={true}>
              {/* Property Details Grid */}
              {/* Property Details Grid */}
              <div className="space-y-1.5">
                
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs">
                    <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Category</span>
                    <div className="font-extrabold text-slate-900 flex items-center gap-1.5 mt-0.5 truncate text-xs">
                      <span
                        className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: getParcelCategoryStyle(selectedParcel).fill }}
                      />
                      <span className="truncate">{selectedParcel.category || '—'}</span>
                    </div>
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs">
                    <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Status</span>
                    <span className="font-extrabold text-emerald-800 truncate block mt-0.5 text-xs">
                      {selectedParcel.status || '—'}
                    </span>
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs">
                    <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Screening</span>
                    <div className="mt-0.5 flex flex-col gap-1">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-bold w-fit ${
                        selectedParcel.keep === 'Y' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {selectedParcel.keep === 'Y' ? '✓ Qualified (Keep)' : '✕ Dropped (Drop)'}
                      </span>
                      {selectedParcel.screening_reason && (
                        <div className="text-[10.5px] text-slate-600 font-medium leading-relaxed pt-0.5">
                          <span className="font-bold text-rose-800">Drop Reason: </span>
                          <span>{selectedParcel.screening_reason}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs">
                    <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Land area: total / usable</span>
                    <span className="font-black text-slate-900 block mt-0.5 text-xs">
                      {selectedParcel.acres ?? '—'} <span className="text-slate-400 font-normal">/</span> {selectedParcel.usable_acres ?? '—'} ac
                    </span>
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs">
                    <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Zoning Code</span>
                    <span className="font-extrabold text-indigo-700 block mt-0.5 text-xs">
                      {selectedParcel.zoning || '—'}
                    </span>
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs">
                    <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Units</span>
                    <span className="font-black text-slate-900 block mt-0.5 text-xs">{selectedParcel.units != null ? selectedParcel.units : '\u2014'}</span>
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs col-span-2">
                    <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Wetland Coverage</span>
                    <span className="font-extrabold text-cyan-800 block mt-0.5 text-xs">
                      {selectedParcel.wetland_pct != null ? `${selectedParcel.wetland_pct}%` : 'Not recorded'}
                    </span>
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs col-span-2">
                    <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Nearest Road & Distance</span>
                    <span className="font-extrabold text-slate-900 block mt-0.5 truncate text-xs" title={selectedParcel.road}>
                      {selectedParcel.road || '—'} ({selectedParcel.road_dist_m != null ? `${selectedParcel.road_dist_m}m` : 'distance not recorded'})
                    </span>
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs col-span-2">
                    <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Land Use</span>
                    <span className="font-bold text-slate-900 block mt-0.5 text-xs leading-snug break-words" title={selectedParcel.use}>
                      {selectedParcel.use || '—'}
                    </span>
                  </div>

                  {selectedParcel.site_address_town_record && (
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 shadow-2xs col-span-2">
                      <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Site Address (Town Record)</span>
                      <span className="font-extrabold text-slate-900 block mt-0.5 text-xs leading-snug">
                        {selectedParcel.site_address_town_record}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              </DashboardSection>
              <DashboardSection title="Current listing status" description="Availability, last checked date and source links" open={true}>
              {/* Listing Check Section */}
              {(() => {
                const lotKey = selectedParcel.town && selectedParcel.parcel_id
                  ? `${selectedParcel.town.toUpperCase().trim()}|${selectedParcel.parcel_id.trim()}`
                  : '';
                const listingInfo = listingCheckData?.lots ? listingCheckData.lots[lotKey] : undefined;

                const renderBadge = (status?: string) => {
                  if (!status || status === 'Not listed') {
                    return (
                      <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-0.5 rounded-full font-bold text-xs inline-flex items-center gap-1 shadow-2xs">
                        ✓ Off-market
                      </span>
                    );
                  }
                  if (status === 'Listed') {
                    return (
                      <span className="bg-rose-50 text-rose-800 border border-rose-200 px-2.5 py-0.5 rounded-full font-extrabold text-xs inline-flex items-center gap-1.5 shadow-2xs">
                        <span className="text-[8px] leading-none text-rose-600 animate-pulse">●</span> Listed for sale
                      </span>
                    );
                  }
                  if (status === 'Listed - one unit only' || status === 'Listed - condo units only') {
                    return (
                      <span className="bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-0.5 rounded-full font-extrabold text-xs inline-flex items-center gap-1.5 shadow-2xs">
                        <span className="text-[8px] leading-none text-amber-600">●</span> Partly listed
                      </span>
                    );
                  }
                  if (status === 'Under agreement (pending)') {
                    return (
                      <span className="bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-0.5 rounded-full font-extrabold text-xs inline-flex items-center gap-1.5 shadow-2xs">
                        <span className="text-[8px] leading-none text-amber-600">●</span> Under agreement
                      </span>
                    );
                  }
                  return (
                    <span className="bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-0.5 rounded-full font-bold text-xs shadow-2xs">
                      {status}
                    </span>
                  );
                };

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

              </DashboardSection>
              <DashboardSection title="Tax & public records" description="Recorded tax signals and registry checks" open={true}>
              {/* Tax Status & Takings (Money) */}
              {(() => {
                const taxSignalInfo = parseTaxSignal(selectedParcel.unpaid_tax_signal, selectedParcel.town, selectedParcel.state);
                const hasTakings = selectedParcel.tax_takings_found != null || selectedParcel.last_tax_taking || taxSignalInfo != null;

                if (!hasTakings) return null;

                return (
                  <div className="bg-slate-50/90 border border-slate-200/90 rounded-xl p-3.5 space-y-2.5 shadow-2xs">
                    <div className="flex items-center justify-between border-b border-slate-200/60 pb-1.5">
                      
                      {selectedParcel.tax_check_link && (
                        <a
                          href={selectedParcel.tax_check_link}
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
                          {selectedParcel.tax_takings_found != null ? `${selectedParcel.tax_takings_found} recorded` : '0 recorded'}
                        </span>
                      </div>
                      {selectedParcel.last_tax_taking && (
                        <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs col-span-2">
                          <span className="text-[10.5px] text-slate-500 block font-semibold uppercase tracking-wider">Last Recorded Tax Taking</span>
                          <span className="font-bold text-slate-900 block mt-0.5 text-xs">
                            {selectedParcel.last_tax_taking}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              </DashboardSection>
              <DashboardSection title="Owner & contact" description="Recorded owner, mailing address and related people" open={true}>
              {/* Owner Details & Location Card */}
              <div className="bg-slate-50/90 border border-slate-200/90 rounded-xl p-3.5 space-y-2.5 shadow-2xs">
                <div className="flex items-center justify-between gap-1 flex-wrap border-b border-slate-200/60 pb-1.5">
                  
                  <div className="flex items-center gap-1 flex-wrap">
                    {selectedParcel.owner_type && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-200/90 text-slate-800 border border-slate-300/60">
                        {selectedParcel.owner_type}
                      </span>
                    )}
                    {selectedParcel.owner_lives_on_lot === 'Y' && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200">
                        Lives on lot
                      </span>
                    )}
                    {isAbsenteeOwner(selectedParcel.owner_lives_on_lot, selectedParcel.owner_distance_group, selectedParcel.owner_type) && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200">
                        Absentee owner
                      </span>
                    )}
                  </div>
                </div>

                <div className="font-black text-slate-900 text-sm tracking-tight break-words">
                  {selectedParcel.owner_name || selectedParcel.owner || 'Owner not on file'}
                </div>

                {selectedParcel.owner_mailing_address && (
                  <div className="text-xs text-slate-700 font-medium flex items-start gap-2 bg-white p-2.5 rounded-lg border border-slate-200/70 shadow-2xs">
                    <span className="text-slate-400 shrink-0 text-sm">📍</span>
                    <span className="break-words leading-relaxed">{selectedParcel.owner_mailing_address}</span>
                  </div>
                )}

                {(selectedParcel.owner_distance_group || selectedParcel.owner_distance_miles != null) && (
                  <div className="flex items-center justify-between text-xs bg-white px-2.5 py-1.5 rounded-lg border border-slate-200/70 shadow-2xs text-slate-700">
                    <span>
                      Distance: <b className="text-slate-900 font-bold">{formatDistance(selectedParcel.owner_distance_miles) ?? '—'}</b>
                    </span>
                    <span className="text-slate-500 font-semibold text-[11px]">
                      {selectedParcel.owner_distance_group || ''}
                    </span>
                  </div>
                )}

                {selectedParcel.children_count_estate_owner && (
                  <div className="bg-white p-2.5 rounded-xl border border-purple-200/90 shadow-2xs space-y-1.5">
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs">👨‍👩‍👧‍👦</span>
                        <span className="text-[10.5px] font-extrabold text-purple-900 uppercase tracking-wider block">
                          Estate Owner Children / Heirs
                        </span>
                      </div>
                      {(() => {
                        const val = selectedParcel.children_count_estate_owner;
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
                      {selectedParcel.children_count_estate_owner}
                    </div>
                  </div>
                )}

                {(() => {
                  const cp = selectedParcel.company_people;
                  const link = selectedParcel.company_record_link;
                  const isBlockedOrGeneric =
                    !cp ||
                    cp.toLowerCase().includes('blocked') ||
                    cp.toLowerCase().includes('not looked up');
                  if (isBlockedOrGeneric) return null;

                  return (
                    <div className="pt-2 border-t border-slate-200/60 text-xs space-y-1">
                      <div className="text-xs text-slate-700 leading-snug">
                        <span className="font-bold text-slate-900 block text-[10.5px] uppercase tracking-wider mb-0.5">Company Officers / Agent:</span>
                        <span className="font-medium text-slate-800">{cp}</span>
                      </div>
                      {link && (
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800 hover:underline pt-0.5"
                        >
                          <span>Secretary of State Corporate Filing</span>
                          <span>↗</span>
                        </a>
                      )}
                    </div>
                  );
                })()}
              </div>

              </DashboardSection>
              <DashboardSection title="Mortgage & property restrictions" description="Mortgage, lease, easement and restriction records">
                  <PropertyRecords openMortgage={selectedParcel.open_mortgage} leaseEasementRestriction={selectedParcel.lease_easement_restriction} />
                </DashboardSection>
                <DashboardSection title="Ownership & sale history" description="Purchase date, price and deed reference" open={false}>
              {/* Ownership & Sale History Card */}
              <div className="bg-slate-50/90 border border-slate-200/90 rounded-xl p-3.5 space-y-2.5 shadow-2xs">
                <div className="flex items-center justify-between border-b border-slate-200/60 pb-1.5">
                  
                  {selectedParcel.town_record_link && (
                    <a
                      href={selectedParcel.town_record_link}
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
                      {formatYearsOwned(selectedParcel.years_owned)}
                    </span>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
                    <span className="text-[10.5px] text-slate-500 block font-semibold">Last Sale Date</span>
                    <span className="font-black text-slate-900 block mt-0.5 text-xs">
                      {formatSaleDate(selectedParcel.last_sale_date)}
                    </span>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
                    <span className="text-[10.5px] text-slate-500 block font-semibold">Last Sale Price</span>
                    <span className="font-black text-slate-900 block mt-0.5 text-xs">
                      {formatSalePrice(selectedParcel.last_sale_price)}
                    </span>
                  </div>
                  <div className="bg-emerald-50/60 p-2.5 rounded-xl border border-emerald-200 shadow-2xs">
                    <span className="text-[10.5px] text-emerald-800 block font-bold">Assessed Value</span>
                    <span className="font-black text-emerald-950 block mt-0.5 text-xs">
                      {(() => {
                        const val = selectedParcel.total_val;
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
                      {formatDeedBookPage(selectedParcel.deed_book_page, selectedParcel.town, selectedParcel.state)}
                    </span>
                  </div>
                </div>
              </div>

              </DashboardSection>
              <DashboardSection title="Estate & ownership signals" description="Registry findings and supporting records" open={parseLifeEventSignal(selectedParcel.life_event_signal, selectedParcel.estate_record_detail, selectedParcel.town, selectedParcel.state).hasSignal}>
              {/* Life Events & Estate Records Section */}
              {(() => {
                const lifeInfo = parseLifeEventSignal(
                  selectedParcel.life_event_signal,
                  selectedParcel.estate_record_detail,
                  selectedParcel.town,
                  selectedParcel.state
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
                    {selectedParcel.estate_record_detail && (
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
                          {selectedParcel.estate_record_detail}
                        </p>
                      </div>
                    )}

                    {/* Estate Owner Children / Heirs */}
                    {selectedParcel.children_count_estate_owner && (
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
                          {selectedParcel.children_count_estate_owner}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })()}

              </DashboardSection>
              <DashboardSection title="Listing history" description="Previous activity from Zillow and Redfin" open={false}>
              {/* Past Listing Attempts & History Section (Separate Container) */}
              {(() => {
                const attempts = getListingAttempts(
                  selectedParcel.zillow_past_attempt,
                  selectedParcel.zillow_link,
                  selectedParcel.redfin_past_attempt,
                  selectedParcel.redfin_link
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


              </DashboardSection>
            </div>
          )}

          {!selectedParcel && <>
          {/* Keep Y vs Keep N Filter Pills */}
          <div className="dashboard-filter-card space-y-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              1. Screening results
            </span>
            <div className="bg-slate-100 p-1 rounded-xl flex items-center gap-1 border border-slate-200/80 text-xs font-semibold">
              <button
                onClick={() => setKeepFilter('ALL')}
                className={`flex-1 py-1.5 px-2 rounded-lg transition-all text-center ${
                  keepFilter === 'ALL'
                    ? 'bg-slate-900 text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({keepCounts.total})
              </button>
              <button
                onClick={() => setKeepFilter('Y')}
                className={`flex-1 py-1.5 px-2 rounded-lg transition-all text-center flex items-center justify-center gap-1 ${
                  keepFilter === 'Y'
                    ? 'bg-slate-900 text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>✓</span> Qualified ({keepCounts.keepY})
              </button>
              <button
                onClick={() => setKeepFilter('N')}
                className={`flex-1 py-1.5 px-2 rounded-lg transition-all text-center flex items-center justify-center gap-1 ${
                  keepFilter === 'N'
                    ? 'bg-slate-900 text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>✕</span> Excluded ({keepCounts.keepN})
              </button>
            </div>
          </div>

          {/* Road Corridor Distribution */}
          <div className="dashboard-filter-card space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                2. Road corridor
              </span>
              {selectedRoad !== 'ALL' && (
                <button
                  onClick={() => setSelectedRoad('ALL')}
                  className="text-[10px] text-blue-600 font-bold hover:underline"
                >
                  Reset Road
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-1.5 text-xs">
              {Object.entries(roadCounts).map(([rd, count]) => {
                const isSelected = selectedRoad === rd;
                return (
                  <div
                    key={rd}
                    onClick={() => setSelectedRoad(isSelected ? 'ALL' : rd)}
                    className={`p-2 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900 font-bold shadow-sm'
                        : 'bg-white border-slate-200/90 hover:border-slate-300 hover:bg-slate-50 text-slate-800'
                    }`}
                  >
                    <span className="truncate text-xs font-medium">{rd}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      isSelected ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Parcel Directory List (Flows naturally without max-h-56 cutoff) */}
          <div className="space-y-2 pt-2 border-t border-slate-200/80">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  3. Parcel results ({filteredParcels.length})
                </span>
                <span className="text-[10px] text-slate-400 font-medium">Select a parcel to view its records and map location</span>
              </div>
            </div>

            {/* Search Input for Parcels */}
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search address, parcel ID, or owner..."
                className="w-full pl-8 pr-7 py-2 text-xs bg-slate-50/90 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all text-slate-800 placeholder:text-slate-400 shadow-xs"
              />
              <svg className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2 text-xs text-slate-400 hover:text-slate-600 font-bold"
                  title="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            <label className="flex items-center justify-between gap-2 text-[10px] text-slate-500">
              Rank parcels
              <select aria-label="Rank parcels" value={rankingSort} onChange={event => setRankingSort(event.target.value)} className="min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-700">
                <option value="source">Source order</option><option value="score">Opportunity score: highest first</option>
              </select>
            </label>
            <p className="text-[9px] text-slate-400">Scores are calculated automatically from recorded data.</p>
            {/* Expansive list flowing to full height - NO max-h-56 cutoff */}
            <div className="dashboard-directory space-y-2 pb-4">
              {loading && <p role="status" className="p-3 text-xs text-slate-500">Loading parcel records...</p>}
              {!loading && !loadError && filteredParcels.length === 0 && <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
                <p>No parcels match your filters.</p><button className="mt-2 font-semibold text-blue-600" onClick={handleResetView}>Clear filters</button>
              </div>}

              {(rankingSort === 'score' ? [...filteredParcels].sort((a, b) =>
                (ranking.scores.get(scoringStorageKey(b.properties))?.score ?? 0) - (ranking.scores.get(scoringStorageKey(a.properties))?.score ?? 0)) : filteredParcels).slice(0, directoryLimit).map((f) => {
                const p = f.properties;
                const isSelected = focusedParcelKey === parcelKey(p);
                const cStyle = getParcelCategoryStyle(p);

                return (
                  <div
                    key={parcelKey(p)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleSelectParcel(p);
                      }
                    }}
                    onClick={() => {
                      handleSelectParcel(p);
                    }}
                    className={`p-2.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between text-xs ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900 font-bold shadow-xs'
                        : 'bg-white border-slate-200/80 hover:border-slate-300 hover:bg-slate-50/80 text-slate-800'
                    }`}
                  >
                    <div className="truncate pr-2">
                      <div className={`font-semibold truncate ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                        {p.address || p.parcel_id}
                      </div>
                      <div className={`text-[10px] truncate mt-0.5 ${isSelected ? 'text-slate-300' : 'text-slate-400'}`}>
                        {p.town} · {p.acres} ac · Nearest: {p.road}
                      </div>
                      <div className="mt-1"><ScoreBadge score={ranking.scores.get(scoringStorageKey(p))} onClick={() => setSelectedScoringParcel(p)} /></div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {(() => {
                        const lifeInfo = parseLifeEventSignal(p.life_event_signal, p.estate_record_detail, p.town, p.state);
                        if (!lifeInfo.hasSignal) return null;
                        return (
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded border inline-flex items-center gap-0.5 ${
                              isSelected ? 'bg-purple-900/60 text-purple-200 border-purple-700' : lifeInfo.badgeClass
                            }`}
                            title={`${p.life_event_signal || ''}${p.estate_record_detail ? ' — ' + p.estate_record_detail : ''}`}
                          >
                            <span>{lifeInfo.icon}</span>
                            <span className="hidden sm:inline">{lifeInfo.type === 'estate_death' ? 'Heirs' : lifeInfo.type === 'estate_filed' ? 'Estate' : lifeInfo.type === 'senior_deferral' ? 'Senior' : '30+ yr'}</span>
                          </span>
                        );
                      })()}
                      {(() => {
                        const lKey = p.town && p.parcel_id ? `${p.town.toUpperCase().trim()}|${p.parcel_id.trim()}` : '';
                        const info = listingCheckData?.lots?.[lKey];
                        if (!info || info.status === 'Not listed') return null;
                        if (info.status === 'Listed') {
                          return (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" /> Listed
                            </span>
                          );
                        }
                        if (info.status === 'Under agreement (pending)') {
                          return (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Pending
                            </span>
                          );
                        }
                        return (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Listed
                          </span>
                        );
                      })()}
                      <span className="w-2.5 h-2.5 rounded-xs shadow-xs" style={{ backgroundColor: cStyle.fill }} />
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                        isSelected
                          ? 'bg-slate-800 text-slate-200 border border-slate-700'
                          : p.keep === 'Y'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-100 text-slate-500 border border-slate-200'
                      }`}>
                        {p.keep === 'Y' ? 'Qualified' : 'Excluded'}
                      </span>
                    </div>
                  </div>
                );
              })}
              {filteredParcels.length > directoryLimit && (
                <div className="text-center text-[11px] text-slate-400 py-2 font-medium">
                  Showing {directoryLimit} of {filteredParcels.length} lots · <button onClick={() => setDirectoryLimit(prev => prev + 100)} className="text-blue-600 font-bold hover:underline">Load 100 more</button>
                </div>
              )}
            </div>
          </div>
          </>}
        </div>
      </div>

      {/* Map Panel on RIGHT */}
      <div className="w-full lg:w-2/3 min-w-0 flex-1 lg:flex-none h-[52vh] lg:h-full relative flex flex-col order-1 lg:order-2">
        {/* Floating Top Control Toolbar */}
        <div className="absolute top-3 right-3 left-3 lg:left-auto z-[1000] flex justify-end items-center gap-2 pointer-events-none">
          {/* Layer and Basemap Toggles */}
          <div className="pointer-events-auto max-w-full flex flex-wrap justify-end items-center gap-1 bg-white/95 backdrop-blur-md border border-slate-200/80 rounded-xl p-1 shadow-lg shadow-slate-900/5 text-xs">
            <button
              onClick={() => setShowParcels(!showParcels)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium text-xs transition-all ${
                showParcels
                  ? 'bg-blue-600 text-white shadow-xs font-semibold'
                  : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100/70'
              }`}
              aria-pressed={showParcels} title="Toggle non-industrial parcels"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${showParcels ? 'bg-blue-200' : 'bg-slate-300'}`} />
              <span>Parcels</span>
            </button>
            <button
              onClick={() => setShowWetlands(!showWetlands)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium text-xs transition-all ${
                showWetlands
                  ? 'bg-cyan-600 text-white shadow-xs font-semibold'
                  : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100/70'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${showWetlands ? 'bg-cyan-200' : 'bg-slate-300'}`} />
              <span>Wetlands</span>
            </button>
            <button
              onClick={() => setShowIndustrial(!showIndustrial)}
              aria-pressed={showIndustrial}
              title="Toggle industrial parcels"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium text-xs transition-all ${
                showIndustrial ? 'bg-red-600 text-white shadow-xs font-semibold' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100/70'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${showIndustrial ? 'bg-red-200' : 'bg-slate-300'}`} />
              <span>Industrial</span>
            </button>
            <button
              onClick={() => setShowBuildings(!showBuildings)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium text-xs transition-all ${
                showBuildings
                  ? 'bg-slate-900 text-white shadow-xs font-semibold'
                  : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100/70'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${showBuildings ? 'bg-slate-300' : 'bg-slate-300'}`} />
              <span>Buildings</span>
            </button>
            <button
              onClick={() => setShowRoads(!showRoads)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium text-xs transition-all ${
                showRoads
                  ? 'bg-amber-600 text-white shadow-xs font-semibold'
                  : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100/70'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${showRoads ? 'bg-amber-200' : 'bg-slate-300'}`} />
              <span>Roads</span>
            </button>
            <div className="h-4 w-px bg-slate-200/80 mx-0.5" />
            <button
              onClick={handleResetView}
              className="flex items-center gap-1 px-2.5 py-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100/80 rounded-lg text-xs font-medium transition-all"
              title="Reset study view and clear filters"
            >
              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Reset</span>
            </button>
          </div>
        </div>

        {/* Leaflet Map Canvas */}
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Floating QGIS-Style Symbology Legend (Compact, Shifted Lower & Fully Visible) */}
        <div className="dashboard-map-legend absolute bottom-1.5 right-2 z-[1000] bg-white/95 backdrop-blur-sm border border-slate-200/90 rounded-lg py-1 px-2 shadow-sm text-[10px]">
          <div className="font-bold text-slate-700 mb-0.5 flex items-center justify-between gap-2 text-[10.5px]">
            <span>
              Parcel legend{' '}
              {filteredMetrics.totalLots !== parcelsList.length && (
                <span className="text-blue-600 font-semibold">({filteredMetrics.totalLots} Lots)</span>
              )}
            </span>
            {(selectedCategory !== 'ALL' || selectedRoad !== 'ALL' || keepFilter !== 'ALL' || searchQuery.trim() !== '') && (
              <button
                onClick={() => {
                  setSelectedCategory('ALL');
                  setSelectedRoad('ALL');
                  setKeepFilter('ALL');
                  setSearchQuery('');
                  setSelectedParcel(null);
                  setFocusedParcelKey(null);
                }}
                className="text-[9px] text-blue-600 font-semibold hover:underline"
              >
                Reset Filters
              </button>
            )}
          </div>
          <p className="mb-1 text-[9px] text-slate-500">Colors show land category. Select a filter to narrow the map.</p>
          {(['category', 'status', 'size'] as const).map((group) => {
            const entries = CATEGORIES.filter((cat) => cat.group === group && cat.key !== 'Industrial' && (legendCounts[cat.key] ?? 0) > 0);
            if (entries.length === 0) return null;
            return (
            <div key={group} className="dashboard-legend-group">
              <h4>{group === 'category' ? 'Land category' : group === 'status' ? 'Development status' : 'Land size'}</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2 gap-y-0.5">
                {entries.map((cat) => {
                  const count = legendCounts[cat.key] ?? 0;
                  const isSelected = selectedCategory === cat.key;
                  return <button
                    key={cat.key}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedCategory(isSelected ? 'ALL' : cat.key)}
                    className={`flex items-center justify-between gap-1.5 rounded px-1 py-1 text-left transition-colors ${isSelected ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'}`}
                    title={`Filter by ${cat.label} (${count})`}
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ backgroundColor: cat.fill, border: `1px solid ${cat.stroke}` }} />
                      <span className="font-medium text-[9.5px] leading-tight">{cat.label}</span>
                    </span>
                    <span className={`shrink-0 text-[9px] ${isSelected ? 'text-white' : 'text-slate-500'}`}>({count})</span>
                  </button>;
                })}
              </div>
            </div>
            );
          })}
          {filteredParcels.length === 0 && <p className="py-2 text-[10px] text-slate-500">No matching parcels.</p>}
        </div>
      </div>
      {selectedScoringParcel && ranking.scores.has(scoringStorageKey(selectedScoringParcel)) && <ParcelScoringDialog
        parcel={selectedScoringParcel} score={ranking.scores.get(scoringStorageKey(selectedScoringParcel))!}
        onClose={() => setSelectedScoringParcel(null)} />}
    </div>
  );
}

