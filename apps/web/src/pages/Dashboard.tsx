import { SiteFilterDropdown } from '../components/SiteFilterDropdown';
import type { CSSProperties } from 'react';
import { readSession, writeSession } from '../utils/sessionState';
import { parcelReportPath } from '../utils/parcelReports';
import { LOAN_CATEGORIES, LOAN_FILTER_OPTIONS, type ParcelLoanData } from '../utils/parcelLoans';
import { WETLAND_FILTERS } from '../utils/parcelWetlands';
import { YEARS_OWNED_FILTERS, countFacet, matchesDashboardFilters, type DashboardFilters } from '../utils/dashboardFilters';
import { isUnderOneUsableAcre } from '../utils/parcelScreening';
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import L from 'leaflet';
import { useLocation, useNavigate } from 'react-router-dom';
import './Dashboard.css';
import { loadParcels, loadGeoJson, parcelKey } from '../utils/dataLoading';
import 'leaflet/dist/leaflet.css';
import { ZONING_DISTRICTS, ZONING_GROUPS, zoningColor } from '../utils/parcelZoning';
import type { ScoringInput } from '../utils/parcelScoring';

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

interface DashboardReturnState {
  selectedZoning?: string;
  selectedZonings?: string[];
  selectedZoningGroup?: string;
  selectedZoningGroups?: string[];
  fullZoningGroups?: string[];
  selectedYearsOwned?: string | string[];
  selectedLoanCategory?: string | string[];
  selectedStatus: string;
  selectedOwnerType: string | string[];
  selectedWetland?: string;
  keepFilter: 'ALL' | 'Y' | 'N';
  parcel: string;
  center: [number, number];
  zoom: number;
  minZoom: number;
  scrollTop: number;
  listingScrollTop?: number;
}

function restoreMultiSelection(value?: string | string[]): string[] {
  return (Array.isArray(value) ? value : value ? [value] : []).filter(option => option !== 'ALL');
}

function toggleMultiSelection(current: string[], value: string): string[] {
  return value === 'ALL' ? [] : current.includes(value) ? current.filter(option => option !== value) : [...current, value];
}

export function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnState = useRef<DashboardReturnState | undefined>(readSession<DashboardReturnState>('dashboard') ?? location.state?.dashboardReturn).current;
  const restorePending = useRef(Boolean(returnState));
  // Layers data states
  const [parcelsData, setParcelsData] = useState<any>(null);
  const [roadsData, setRoadsData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataWarning, setDataWarning] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);

  // Filter & Interaction states
  const [selectedParcel, setSelectedParcel] = useState<ParcelProperties | null>(null);
  const [focusedParcelKey, setFocusedParcelKey] = useState<string | null>(returnState?.parcel ?? null);
  const [selectedZonings, setSelectedZonings] = useState<string[]>(() => returnState?.selectedZonings ??
    (returnState?.selectedZoning && returnState.selectedZoning !== 'ALL' ? [returnState.selectedZoning] : []));
  const [selectedZoningGroups, setSelectedZoningGroups] = useState<string[]>(() => (returnState?.selectedZoningGroups ??
    (returnState?.selectedZoningGroup && returnState.selectedZoningGroup !== 'ALL' ? [returnState.selectedZoningGroup] :
      ZONING_GROUPS.filter(group => selectedZonings.some(code => (group.codes as readonly string[]).includes(code))).map(group => group.id))).slice(-1));
  const [fullZoningGroups, setFullZoningGroups] = useState<string[]>(() => returnState?.fullZoningGroups ??
    (selectedZonings.length === 0 ? selectedZoningGroups : []));
  const [selectedYearsOwned, setSelectedYearsOwned] = useState<string[]>(() => restoreMultiSelection(returnState?.selectedYearsOwned));
  const [selectedLoanCategory, setSelectedLoanCategory] = useState<string[]>(() => restoreMultiSelection(returnState?.selectedLoanCategory));
  const zoningGroupsRef = useRef(selectedZoningGroups);
  zoningGroupsRef.current = selectedZoningGroups;
  const [selectedStatus, setSelectedStatus] = useState(returnState?.selectedStatus ?? 'ALL');
  const [selectedOwnerType, setSelectedOwnerType] = useState<string[]>(() => restoreMultiSelection(returnState?.selectedOwnerType));
  const [selectedWetland, setSelectedWetland] = useState(WETLAND_FILTERS.some(option => option.value === returnState?.selectedWetland) ? returnState!.selectedWetland! : 'ALL');
  const [keepFilter, setKeepFilter] = useState<'ALL' | 'Y' | 'N'>(returnState?.keepFilter ?? 'ALL');


  // Map refs
  const sidebarRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseTileLayerRef = useRef<L.TileLayer | null>(null);
  const parcelsLayerRef = useRef<L.GeoJSON | null>(null);
  const highlightLayerRef = useRef<L.GeoJSON | null>(null);
  const parcelLayerMapRef = useRef<Map<string, L.Layer>>(new Map());
  const hasFittedInitialRef = useRef(false);

  // Load the parcel records used by filters and clickable map features.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    setDataWarning(null);
    Promise.allSettled([loadParcels(), loadGeoJson('/geojson/roads.geojson')]).then(([parcels, roads]) => {
      if (!active) return;
      setRoadsData(roads.status === 'fulfilled' ? roads.value : null);
      if (roads.status === 'rejected') setDataWarning('Road data could not be loaded. Retry data load.');
      if (parcels.status === 'fulfilled') setParcelsData(parcels.value);
      else setLoadError('Parcel data could not be loaded. Check your connection and try again.');
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [loadVersion]);

  const parcelsList: ParcelFeature[] = useMemo(() => parcelsData?.features ?? [], [parcelsData]);
  const ownerTypes = useMemo(() => [...new Set(parcelsList.map(f => f.properties.owner_type?.trim() || 'Unknown'))].sort(), [parcelsList]);
  const filters = useMemo<DashboardFilters>(() => ({
    screening: keepFilter, districts: [...selectedZonings,
      ...ZONING_GROUPS.filter(group => fullZoningGroups.includes(group.id)).flatMap(group => [...group.codes])],
    status: selectedStatus, owner: selectedOwnerType, wetland: selectedWetland,
    listing: 'ALL', years: selectedYearsOwned, loan: selectedLoanCategory,
  }), [keepFilter, selectedZonings, fullZoningGroups, selectedStatus, selectedOwnerType, selectedWetland, selectedYearsOwned, selectedLoanCategory]);
  const filteredParcels = useMemo(() => parcelsList.filter(({ properties }) =>
    matchesDashboardFilters(properties, filters, {})), [parcelsList, filters]);
  const counts = useMemo(() => {
    const facet = (key: keyof DashboardFilters | 'zoningGroups', values: string[], extra: (keyof DashboardFilters)[] = []) =>
      countFacet(parcelsList, filters, {}, key, values.map(value => ({ value })), extra);
    return {
      screening: facet('screening', ['ALL', 'Y', 'N']),
      groups: facet('zoningGroups', ['ALL', ...ZONING_GROUPS.map(group => group.id)], ['districts']),
      districts: facet('districts', ['ALL', ...ZONING_DISTRICTS.map(district => district.code)]),
      status: facet('status', ['ALL', 'Vacant', 'Built-up']),
      owners: facet('owner', ['ALL', ...ownerTypes]),
      wetlands: facet('wetland', WETLAND_FILTERS.map(option => option.value)),
      years: facet('years', YEARS_OWNED_FILTERS.map(option => option.value)),
      loans: facet('loan', LOAN_CATEGORIES.map(option => option.value)),
    };
  }, [parcelsList, filters, ownerTypes]);
  const isFiltered = Object.values(filters).some(value => Array.isArray(value) ? value.length > 0 : value !== 'ALL');

  // Preserve the returning parcel on mount; later filter changes clear it.
  useEffect(() => {
    if (!parcelsData) return;
    setSelectedParcel(null);
    setFocusedParcelKey(null);
    if (highlightLayerRef.current) {
      highlightLayerRef.current.remove();
      highlightLayerRef.current = null;
    }
    if (mapRef.current) {
      mapRef.current.closePopup();
    }
  }, [keepFilter, selectedZonings, fullZoningGroups, selectedStatus, selectedOwnerType, selectedWetland, selectedYearsOwned, selectedLoanCategory]);


  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Center on Amesbury / Salisbury corridor
    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      zoomAnimation: false,
      attributionControl: false,
      minZoom: 14,
      maxZoom: 19,
    }).setView(returnState?.center ?? [42.86, -70.9], returnState?.zoom ?? 13);


    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    baseTileLayerRef.current = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        className: 'map-tiles-gray',
        attribution: '',
        maxZoom: 19,
      },
    ).addTo(map);

    const roadsPane = map.createPane('dashboard-roads');
    roadsPane.style.zIndex = '450';
    roadsPane.style.pointerEvents = 'none';
    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
      map.eachLayer(layer => {
        if (layer instanceof L.Popup) {
          const anchor = layer.getLatLng();
          if (anchor) map.setView(anchor, map.getZoom(), { animate: false });
        }
      });
    });
    if (mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      map.stop();
      map.remove();
      mapRef.current = null;
    };
  }, []);



  // Roads stay visible without legend or layer controls.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layers: L.GeoJSON[] = [];
    if (roadsData) layers.push(L.geoJSON(roadsData, {
      pane: 'dashboard-roads', interactive: false,
      style: { className: 'dashboard-road-overlay', color: '#0f172a', weight: 4, opacity: 0.85 },
    }).addTo(map));
    return () => { layers.forEach(layer => layer.remove()); };
  }, [roadsData]);

  // Center lot directly in the center of the map canvas
  const centerMapOnParcelAndPopup = useCallback((layer: L.Layer, targetZoom = 17) => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    try {
      const bounds = (layer as any).getBounds?.();
      if (bounds && bounds.isValid()) {
        const center = bounds.getCenter();
        // Use one anchor for the map and popup; popup auto-pan must not move the parcel away.
        const fittingZoom = map.getBoundsZoom(bounds, false, L.point(64, 180));
        const zoom = Math.max(map.getMinZoom(), Math.min(Math.max(map.getZoom(), targetZoom), fittingZoom));
        map.stop();
        map.setView(center, zoom, { animate: false });
        (layer as L.Path).openPopup(center);
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

    if (parcelsData) {
      const layer = L.geoJSON({ ...parcelsData, features: filteredParcels }, {
        style: (feature) => {
          const p = feature?.properties as ParcelProperties;
          const color = zoningColor(p.zoning);
          return {
            className: 'dashboard-parcel-overlay',
            color,
            weight: 1.5,
            opacity: 1,
            fillColor: color,
            fillOpacity: 0.5,
          };
        },
        onEachFeature: (feature, l) => {
          const p = feature.properties as ParcelProperties;
          if (p.parcel_id) {
            parcelLayerMapRef.current.set(parcelKey(p), l);
          }

          const card = document.createElement('div');
          card.className = 'dashboard-parcel-card';
          const address = document.createElement('strong');
          address.textContent = p.address || p.parcel_id || 'Parcel';
          const details = document.createElement('button');
          details.type = 'button';
          details.textContent = 'Details';
          details.addEventListener('click', () => {
            const map = mapRef.current!;
            map.stop();
            const center = map.getCenter();
            const snapshot: DashboardReturnState = {
              selectedZonings, fullZoningGroups, selectedZoningGroups: zoningGroupsRef.current, selectedYearsOwned, selectedLoanCategory, selectedStatus, selectedOwnerType, selectedWetland, keepFilter,
              parcel: parcelKey(p), center: [center.lat, center.lng], zoom: map.getZoom(),
              minZoom: map.getMinZoom(), scrollTop: sidebarRef.current?.scrollTop ?? 0,
              listingScrollTop: sidebarRef.current?.querySelector('.dashboard-listing-results')?.scrollTop ?? 0,
            };
            writeSession('dashboard', snapshot);
            navigate(`${location.pathname}${location.search}`, {
              replace: true, state: { ...location.state, dashboardReturn: snapshot },
            });
            navigate(parcelReportPath(p), { state: { fromDashboard: true } });
          });
          card.append(address, details);
          l.bindPopup(card, {
            maxWidth: 260,
            minWidth: 210,
            autoPan: false,
            closeButton: true,
            offset: L.point(0, -6),
          });

          l.on('popupopen', () => setFocusedParcelKey(parcelKey(p)));
          l.on('popupclose', () => setFocusedParcelKey(current => current === parcelKey(p) ? null : current));

          // Click on lot: centers the lot dead-center in the map and opens the card pointing directly to it
          l.on('click', () => {
            setFocusedParcelKey(parcelKey(p));
            centerMapOnParcelAndPopup(l, 17);
          });
        },
      }).addTo(map);

      parcelsLayerRef.current = layer;
      if (restorePending.current && returnState) {
        restorePending.current = false;
        hasFittedInitialRef.current = true;
        const selectedLayer = parcelLayerMapRef.current.get(returnState.parcel);
        if (selectedLayer) centerMapOnParcelAndPopup(selectedLayer, returnState.zoom);
        else map.setView(returnState.center, returnState.zoom, { animate: false });
        requestAnimationFrame(() => {
          sidebarRef.current?.scrollTo({ top: returnState.scrollTop });
          const list = sidebarRef.current?.querySelector<HTMLElement>('.dashboard-listing-results');
          if (list) list.scrollTop = returnState.listingScrollTop ?? 0;
        });
        return;
      }
      if (!hasFittedInitialRef.current && !selectedParcel && !window.location.search.includes('parcel=')) {
        hasFittedInitialRef.current = true;
        try {
          const b = layer.getBounds();
          if (b.isValid()) {
            map.fitBounds(b, { padding: [30, 30], animate: false });

          }
        } catch {
          // ignore
        }
      } else {
        if (isFiltered) {
          try {
            const b = layer.getBounds();
            if (b.isValid()) {
              map.fitBounds(b, { padding: [40, 40], maxZoom: 16, animate: false });
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }, [parcelsData, filteredParcels, filters, isFiltered, navigate]);

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
      if (matchFeature) {
        const hLayer = L.geoJSON(matchFeature, {
          interactive: false,
          style: {
            color: zoningColor(matchFeature.properties.zoning),
            weight: 4,
            fillColor: '#64748b',
            fillOpacity: 0,
            opacity: 1,
          },
        }).addTo(map);
        highlightLayerRef.current = hLayer;
      }
    }
  }, [focusedParcelKey, selectedParcel, parcelsData, isFiltered, selectedZonings]);

  const handleZoomToParcel = useCallback((parcelId: string) => {
    const layer = parcelLayerMapRef.current.get(parcelId);
    if (layer && mapRef.current) {
      setFocusedParcelKey(parcelId);
      mapRef.current.stop();
      if (window.matchMedia('(max-width: 1023px)').matches) mapContainerRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      centerMapOnParcelAndPopup(layer, 17);
    }
  }, [centerMapOnParcelAndPopup]);

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

  const handleResetView = () => {
    restorePending.current = false;
    setSelectedParcel(null);
    setFocusedParcelKey(null);
    setSelectedZonings([]);
    setSelectedZoningGroups([]);
    setFullZoningGroups([]);
    setSelectedYearsOwned([]);
    setSelectedLoanCategory([]);
    setSelectedStatus('ALL');
    setSelectedOwnerType([]);
    setSelectedWetland('ALL');
    setKeepFilter('ALL');
    const map = mapRef.current;
    if (map) {
      map.stop();
      map.closePopup();
      if (parcelsData) {
        const bounds = L.geoJSON(parcelsData).getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], animate: false });
      }
    }
    if (location.search) navigate('/', { replace: true, state: null });
    sidebarRef.current?.scrollTo({ top: 0 });
  };

  // Save the live view, rather than an older snapshot from a Details navigation.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !parcelsData || restorePending.current) return;
    const save = () => {
      const center = map.getCenter();
      const snapshot: DashboardReturnState = {
        selectedZonings, selectedZoningGroups, fullZoningGroups, selectedYearsOwned, selectedLoanCategory, selectedStatus, selectedOwnerType, selectedWetland, keepFilter,
        parcel: focusedParcelKey ?? '', center: [center.lat, center.lng], zoom: map.getZoom(), minZoom: 14,
        scrollTop: sidebarRef.current?.scrollTop ?? 0,
        listingScrollTop: sidebarRef.current?.querySelector('.dashboard-listing-results')?.scrollTop ?? 0,
      };
      writeSession('dashboard', snapshot);
    };
    save();
    map.on('moveend zoomend', save);
    const sidebar = sidebarRef.current;
    sidebar?.addEventListener('scroll', save, true);
    window.addEventListener('pagehide', save);
    return () => {
      map.off('moveend zoomend', save);
      sidebar?.removeEventListener('scroll', save, true);
      window.removeEventListener('pagehide', save);
    };
  }, [parcelsData, selectedZonings, selectedZoningGroups, fullZoningGroups, selectedYearsOwned, selectedLoanCategory, selectedStatus, selectedOwnerType, selectedWetland, keepFilter, focusedParcelKey]);


  return (
    <div className="h-[calc(100vh-3.5rem)] w-full flex flex-col lg:flex-row overflow-hidden bg-slate-100">
      <aside ref={sidebarRef} className="dashboard-sidebar w-full lg:w-1/3 lg:shrink-0 h-[48vh] lg:h-full overflow-y-auto border-t lg:border-t-0 lg:border-r border-slate-200 order-2 lg:order-1">
        <header className="dashboard-sidebar-header flex items-center justify-between">
          <h2>Filters</h2>
          <button type="button" className="reset-filters-button" onClick={handleResetView}>Reset filters</button>
        </header>
        <div className="p-4 space-y-4">
          {(loadError || dataWarning) && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p>{loadError || dataWarning}</p><button className="mt-2 font-bold underline" onClick={() => setLoadVersion(value => value + 1)}>Retry data load</button>
          </div>}
          <div className="dashboard-filter-card">
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-slate-600">Screening results</legend>
              <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
                {([
                  { value: 'ALL', label: 'All' },
                  { value: 'Y', label: 'Qualified' },
                  { value: 'N', label: 'Excluded' },
                ] as const).map(option => <button
                  key={option.value}
                  type="button"
                  aria-pressed={keepFilter === option.value}
                  onClick={() => setKeepFilter(option.value)}
                  className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${keepFilter === option.value ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >{option.label} ({loading || loadError ? '?' : counts.screening[option.value].toLocaleString()})</button>)}
              </div>
            </fieldset>
          </div>
          <div className="dashboard-filter-card">
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-slate-600">Zoning</legend>
              <div className={`dashboard-zoning-columns${selectedZoningGroups.length > 0 ? ' dashboard-zoning-columns--active' : ''}`}>
                <fieldset className="dashboard-zoning-column">
                  <legend className="sr-only">Zoning groups</legend>
                  <div className="dashboard-zoning-filters">
                    {ZONING_GROUPS.map(group => {
                      const selectedCount = group.codes.filter(code => selectedZonings.includes(code)).length;
                      return <button key={group.id} type="button"
                      style={{ '--zoning-color': group.color } as CSSProperties}
                      aria-expanded={selectedZoningGroups.includes(group.id)}
                      aria-pressed={fullZoningGroups.includes(group.id) || selectedCount > 0}
                      onClick={() => {
                        if (selectedCount === 0) {
                          setFullZoningGroups(current => selectedZoningGroups.includes(group.id)
                            ? current.filter(id => id !== group.id)
                            : current.includes(group.id) ? current : [...current, group.id]);
                        }
                        setSelectedZoningGroups(current => current.includes(group.id) ? [] : [group.id]);
                      }}>
                      <span className="dashboard-zoning-swatch" style={{ backgroundColor: group.color }} />
                      <span className="dashboard-zoning-group-label">
                        <strong>{group.name} ({counts.groups[group.id]})</strong>
                        {selectedCount > 0 && <span className="dashboard-zoning-selection-badge">{selectedCount} selected</span>}
                      </span>
                    </button>;
                    })}
                  </div>
                </fieldset>
                {selectedZoningGroups.length > 0 && <fieldset className="dashboard-zoning-column dashboard-zoning-districts">
                  <legend className="sr-only">Zoning district</legend>
                    <div className="dashboard-zoning-filters">
                      {ZONING_GROUPS.filter(group => selectedZoningGroups.includes(group.id)).map(group => <div key={group.id} className="dashboard-district-group" style={{ '--zoning-color': group.color } as CSSProperties}>
                        <h3>{group.name}</h3>
                        {ZONING_DISTRICTS.filter(district => (group.codes as readonly string[]).includes(district.code)).map(district => <button
                          key={district.code} type="button" className="dashboard-zoning-option"
                          aria-pressed={selectedZonings.includes(district.code)}
                          onClick={() => {
                            const next = selectedZonings.includes(district.code)
                              ? selectedZonings.filter(code => code !== district.code) : [...selectedZonings, district.code];
                            setSelectedZonings(next);
                            setFullZoningGroups(current => next.some(code => (group.codes as readonly string[]).includes(code))
                              ? current.filter(id => id !== group.id)
                              : current.includes(group.id) ? current : [...current, group.id]);
                          }}>
                          <span className="dashboard-zoning-swatch" style={{ backgroundColor: district.color }} />
                          <strong>{district.name} ({district.code}) <span className="dashboard-option-count">({counts.districts[district.code]})</span></strong>
                        </button>)}
                      </div>)}
                    </div>
                </fieldset>}
              </div>

            </fieldset>
          </div>
          <div className="dashboard-filter-card">
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-slate-600">Development status</legend>
              <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
                {[
                  { value: 'ALL', label: 'All' },
                  { value: 'Vacant', label: 'Vacant' },
                  { value: 'Built-up', label: 'Built-up' },
                ].map(option => <button
                  key={option.value}
                  type="button"
                  aria-pressed={selectedStatus === option.value}
                  onClick={() => setSelectedStatus(option.value)}
                  className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${selectedStatus === option.value ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >{option.label} ({loading || loadError ? '--' : counts.status[option.value].toLocaleString()})</button>)}
              </div>
            </fieldset>
          </div>
          <div className="dashboard-filter-card">
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-slate-600">Owner type</legend>
              <div className="dashboard-filter-pills">
                {['ALL', ...ownerTypes].map(type => <button key={type} type="button" aria-pressed={type === 'ALL' ? selectedOwnerType.length === 0 : selectedOwnerType.includes(type)}
                  onClick={() => setSelectedOwnerType(current => toggleMultiSelection(current, type))}>{type === 'ALL' ? 'All owner types' : type} ({counts.owners[type]})</button>)}
              </div>
            </fieldset>
          </div>
          <div className="dashboard-filter-card">
            <SiteFilterDropdown label="Years owned" allLabel="All ownership durations" selected={selectedYearsOwned} onChange={setSelectedYearsOwned}
              options={YEARS_OWNED_FILTERS.filter(option => option.value !== 'ALL').map(option => ({ ...option, count: counts.years[option.value] }))} />
          </div>
          <div className="dashboard-filter-card">
            <fieldset className="space-y-2" disabled={loading || Boolean(loadError)}>
              <legend className="text-xs font-semibold text-slate-600">Loan category</legend>
              <div className="dashboard-filter-pills">
                {LOAN_FILTER_OPTIONS.map(option => <button key={option.value} type="button"
                  aria-pressed={option.value === 'ALL' ? selectedLoanCategory.length === 0 : selectedLoanCategory.includes(option.value)}
                  onClick={() => setSelectedLoanCategory(current => toggleMultiSelection(current, option.value))}>
                  {option.label} ({loading || loadError ? '--' : counts.loans[option.value]})
                </button>)}
              </div>
            </fieldset>
          </div>
          <div className="dashboard-filter-card">
            <label className="dashboard-filter-field">Wetland coverage
              <select aria-label="Wetland coverage" value={selectedWetland} onChange={e => setSelectedWetland(e.target.value)}>
                {WETLAND_FILTERS.map(option => <option key={option.value} value={option.value}>{option.label} ({counts.wetlands[option.value]})</option>)}
              </select>
            </label>
          </div>
          {loading && <p role="status" className="text-xs text-slate-500">Loading parcels...</p>}
          {!loading && !loadError && filteredParcels.length === 0 && <p role="status" className="text-xs text-slate-500">No parcels match your filters.</p>}
        </div>
      </aside>
      <div className="w-full lg:w-2/3 min-w-0 flex-1 lg:flex-none h-[52vh] lg:h-full relative order-1 lg:order-2">
        <div ref={mapContainerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
