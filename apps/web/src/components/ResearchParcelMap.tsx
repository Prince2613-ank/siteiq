import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { imageryLayers, ImageryYear, ResearchParcel } from '../data/parcelResearch';

export type BoundaryStatus = 'loading' | 'official' | 'approximate';

interface Props {
  parcel: ResearchParcel;
  imageryYear: ImageryYear;
  showWetlands: boolean;
  showContext: boolean;
  onBoundaryStatus: (status: BoundaryStatus) => void;
  onParcelClick?: () => void;
  height?: string;
}

function approximateRing(parcel: ResearchParcel) {
  const radiusMeters = Math.sqrt((parcel.acres * 4046.8564224) / Math.PI);
  const latStep = radiusMeters / 111320;
  const lngStep = radiusMeters / (111320 * Math.cos((parcel.lat * Math.PI) / 180));
  const points: [number, number][] = [];
  for (let index = 0; index <= 48; index += 1) {
    const angle = (index / 48) * Math.PI * 2;
    points.push([parcel.lng + Math.cos(angle) * lngStep, parcel.lat + Math.sin(angle) * latStep]);
  }
  return { type: 'Polygon' as const, coordinates: [points] };
}

async function loadOfficialBoundary(parcel: ResearchParcel) {
  const endpoint = 'https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/MassachusettsPropertyTaxParcels/FeatureServer/1/query';
  const params = new URLSearchParams({
    geometry: `${parcel.lng},${parcel.lat}`,
    geometryType: 'esriGeometryPoint', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'OBJECTID,LOC_ID,MAP_PAR_ID,SITE_ADDR',
    outSR: '4326', returnGeometry: 'true', f: 'json',
  });
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4500);
  const response = await fetch(`${endpoint}?${params}`, { signal: controller.signal }).finally(() => window.clearTimeout(timeout));
  if (!response.ok) throw new Error('Parcel service unavailable');
  const data = (await response.json()) as { features?: Array<{ geometry?: { rings?: number[][][] } }> };
  const rings = data.features?.[0]?.geometry?.rings;
  if (!rings?.length) throw new Error('Parcel boundary not returned');
  return { type: 'Polygon' as const, coordinates: rings };
}

export function ResearchParcelMap({
  parcel, imageryYear, showWetlands, showContext,
  onBoundaryStatus, onParcelClick, height = '100%',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const contentRef = useRef<L.LayerGroup | null>(null);
  const imageryRef = useRef<L.TileLayer | null>(null);
  const wetlandsRef = useRef<L.TileLayer.WMS | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: false }).setView([parcel.lat, parcel.lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '', maxZoom: 20,
    }).addTo(map);
    contentRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    imageryRef.current?.remove();
    imageryRef.current = null;
    const layer = imageryLayers[imageryYear];
    if (layer.available && layer.url) {
      imageryRef.current = L.tileLayer(layer.url, {
        maxZoom: 20, opacity: 1, attribution: 'MassGIS orthoimagery',
      }).addTo(map);
    }
  }, [imageryYear]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    wetlandsRef.current?.remove();
    wetlandsRef.current = null;
    if (showWetlands) {
      wetlandsRef.current = L.tileLayer.wms('https://gis-prod.digital.mass.gov/geoserver/wms', {
        layers: 'massgis:GISDATA.WETLANDSDEP_POLY', format: 'image/png',
        transparent: true, opacity: 0.62, attribution: 'MassDEP wetlands via MassGIS',
      }).addTo(map);
    }
  }, [showWetlands]);

  useEffect(() => {
    let cancelled = false;
    const map = mapRef.current;
    const group = contentRef.current;
    if (!map || !group) return;
    group.clearLayers();
    map.setView([parcel.lat, parcel.lng], 16);
    onBoundaryStatus('loading');

    const draw = (geometry: GeoJSON.Polygon, status: BoundaryStatus) => {
      if (cancelled) return;
      group.clearLayers();
      if (showContext) {
        L.circle([parcel.lat, parcel.lng], {
          radius: 152.4, color: '#d97706', weight: 2, dashArray: '7 7',
          fillColor: '#f59e0b', fillOpacity: 0.06, interactive: false,
        }).bindTooltip('500 ft surrounding-wetland review area').addTo(group);
      }
      const boundary = L.geoJSON(geometry, {
        style: {
          color: status === 'official' ? '#f8fafc' : '#fbbf24', weight: 4,
          dashArray: status === 'official' ? undefined : '8 6', fillColor: '#0f766e', fillOpacity: 0.22,
        },
      }).addTo(group);
      boundary.bindTooltip(`${parcel.address}<br><b>Click for parcel report</b>`, { sticky: true });
      if (onParcelClick) boundary.on('click', onParcelClick);
      const bounds = boundary.getBounds();
      if (showContext) bounds.extend(L.latLng(parcel.lat, parcel.lng).toBounds(304.8));
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 18 });
      onBoundaryStatus(status);
    };

    draw(approximateRing(parcel), 'approximate');
    loadOfficialBoundary(parcel)
      .then((geometry) => draw(geometry as GeoJSON.Polygon, 'official'))
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [parcel, showContext, onBoundaryStatus, onParcelClick]);

  return <div ref={containerRef} className="research-map" style={{ height }} aria-label={`Map of ${parcel.address}`} />;
}
