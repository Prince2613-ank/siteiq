import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

export interface MapCandidate {
  id: string;
  label: string;
  confidence: number;
  selected: boolean;
  geometry: { boundary: GeoJsonGeometry; centroid: GeoJsonGeometry } | null;
  onClick?: () => void;
}

interface ParcelMapProps {
  height?: number;
  /** The original input location, before any matching — a red marker. */
  inputPoint?: { lat: number; lng: number } | null;
  /** Candidates shown during review — numbered markers + boundaries, selected one highlighted. */
  candidates?: MapCandidate[];
  /** The confirmed parcel's real boundary — green, after Candidate Review. */
  confirmedGeometry?: { boundary: GeoJsonGeometry; centroid: GeoJsonGeometry } | null;
}

/**
 * Real Leaflet map (Checkpoint 7) — draws actual PostGIS parcel boundaries,
 * never a placeholder rectangle. Distinguishes input point / candidate
 * parcels / confirmed parcel per the client's explicit requirement.
 *
 * Plain Leaflet (not react-leaflet) — imperative useEffect wiring, and
 * colored circle markers instead of Leaflet's default pin icon, which
 * avoids the well-known default-icon-path breakage under bundlers like
 * Vite (the icon PNGs Leaflet expects at a relative URL don't resolve
 * correctly once bundled) without pulling in an extra dependency to work
 * around it.
 */
export function ParcelMap({ height = 360, inputPoint, candidates = [], confirmedGeometry }: ParcelMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { attributionControl: true }).setView([42.3, -71.6], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    layerGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;
    layerGroup.clearLayers();

    const bounds: L.LatLngExpression[] = [];

    if (inputPoint) {
      L.circleMarker([inputPoint.lat, inputPoint.lng], {
        radius: 8,
        color: '#fff',
        weight: 2,
        fillColor: '#dc2626',
        fillOpacity: 1,
      })
        .bindTooltip('Input / geocoded location', { permanent: false })
        .addTo(layerGroup);
      bounds.push([inputPoint.lat, inputPoint.lng]);
    }

    for (const c of candidates) {
      if (!c.geometry) continue;
      const color = c.selected ? '#1e293b' : '#94a3b8';
      const boundaryLayer = L.geoJSON(c.geometry.boundary as any, {
        style: { color, weight: c.selected ? 3 : 2, fillOpacity: c.selected ? 0.15 : 0.05, dashArray: c.selected ? undefined : '4' },
      });
      boundaryLayer.addTo(layerGroup);
      if (c.onClick) {
        boundaryLayer.eachLayer((l) => l.on('click', c.onClick!));
      }
      try {
        const b = boundaryLayer.getBounds();
        if (b.isValid()) {
          bounds.push([b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]);
        }
      } catch {
        // no-op — a candidate with no real geometry just isn't drawn
      }

      const centroidCoords = (c.geometry.centroid.coordinates as [number, number]) ?? null;
      if (centroidCoords) {
        const marker = L.marker([centroidCoords[1], centroidCoords[0]], {
          icon: L.divIcon({
            className: '',
            html: `<div style="background:${color};color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4);">${c.label}</div>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
        }).bindTooltip(`Candidate ${c.label} · ${c.confidence}%`);
        if (c.onClick) marker.on('click', c.onClick);
        marker.addTo(layerGroup);
      }
    }

    if (confirmedGeometry?.boundary) {
      const boundaryLayer = L.geoJSON(confirmedGeometry.boundary as any, {
        style: { color: '#15803d', weight: 3, fillOpacity: 0.15 },
      });
      boundaryLayer.addTo(layerGroup);
      try {
        const b = boundaryLayer.getBounds();
        if (b.isValid()) bounds.push([b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]);
      } catch {
        // no-op
      }
    }

    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 19 });
    }
  }, [inputPoint, candidates, confirmedGeometry]);

  return <div ref={containerRef} style={{ height, width: '100%', borderRadius: 4 }} className="border border-slate-200" />;
}
