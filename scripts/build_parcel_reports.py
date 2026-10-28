"""Build report assets from the checked-in GIS layers. No network requests.
Run: python scripts/build_parcel_reports.py
Dependencies: scripts/requirements-parcel-reports.txt
"""
import hashlib
import json
from pathlib import Path
from shapely import make_valid
from shapely.geometry import shape, mapping, GeometryCollection
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
GEO = ROOT / 'apps/web/public/geojson'
OUT = ROOT / 'apps/web/public/reports'
OUT.mkdir(parents=True, exist_ok=True)
project = Transformer.from_crs(4326, 26986, always_xy=True).transform
unproject = Transformer.from_crs(26986, 4326, always_xy=True).transform

def load(name):
    return json.loads((GEO / name).read_text(encoding='utf-8'))

def polygon(geometry):
    geometry = make_valid(geometry)
    if geometry.geom_type in ('Polygon', 'MultiPolygon'):
        return geometry
    parts = [g for g in getattr(geometry, 'geoms', ()) if g.geom_type in ('Polygon', 'MultiPolygon')]
    return unary_union(parts)

def feature(geometry, properties):
    return dict(type='Feature', properties=properties, geometry=mapping(transform(unproject, geometry)))

def collection(features):
    return dict(type='FeatureCollection', features=features)

parcels = load('parcels_250m.geojson')['features']
parcel_shapes = [polygon(transform(project, shape(f['geometry']))) for f in parcels]
parcel_tree = STRtree(parcel_shapes)
buildings = load('buildings_250m.geojson')['features']
building_shapes = [polygon(transform(project, shape(f['geometry']))) for f in buildings]
building_tree = STRtree(building_shapes)
wetlands = load('wetlands_250m.geojson')['features']
wetland_shapes = [polygon(transform(project, shape(f['geometry']))) for f in wetlands]
wetland_tree = STRtree(wetland_shapes)
corridor = unary_union([polygon(transform(project, shape(f['geometry']))) for f in load('buffer_250m.geojson')['features']])
listings = load('listing_check.json')['lots']
index = dict(version=1, parcels={})
complete_count = 0

for i, source in enumerate(parcels):
    properties = source['properties']
    key = properties['town'].strip().upper() + '|' + properties['parcel_id'].strip()
    if key in index['parcels']:
        raise ValueError('Duplicate parcel identity: ' + key)
    subject = parcel_shapes[i]
    if subject.is_empty or subject.area <= 0:
        raise ValueError('Invalid subject geometry: ' + key)
    coverage = min(1.0, subject.intersection(corridor).area / subject.area)
    # Massachusetts source layers do not establish complete coverage in New Hampshire.
    complete = coverage >= 0.999 and properties.get('state') == 'MA'
    complete_count += int(complete)
    nearby = []
    for j in parcel_tree.query(subject.buffer(100), predicate='intersects'):
        if j == i:
            continue
        p = parcels[j]['properties']
        nearby.append(feature(parcel_shapes[j], {k: p.get(k) for k in ('address', 'town', 'parcel_id')}))

    def clipped_layer(features, geometries, tree):
        results = []
        clipped_shapes = []
        for j in tree.query(subject, predicate='intersects'):
            clipped = polygon(geometries[j].intersection(subject))
            if clipped.is_empty or clipped.area < 0.01:
                continue
            if clipped.difference(subject).area > 0.01:
                raise ValueError('Overlay escapes subject boundary: ' + key)
            results.append(feature(clipped, features[j]['properties']))
            clipped_shapes.append(clipped)
        area = unary_union(clipped_shapes).area if clipped_shapes else 0
        if area > subject.area + 0.01:
            raise ValueError('Overlay exceeds lot area: ' + key)
        return collection(results), area

    building_layer, building_area = clipped_layer(buildings, building_shapes, building_tree)
    wetland_layer, wetland_area = clipped_layer(wetlands, wetland_shapes, wetland_tree)
    is_nh = properties.get('state') == 'NH'
    report = dict(
        subject=feature(subject, properties), neighbors=collection(nearby),
        buildings=building_layer, wetlands=wetland_layer, listing=listings.get(key),
        metrics=dict(gis_area_m2=subject.area, corridor_coverage_fraction=coverage,
                     building_area_m2=building_area if complete or building_area > 0 else None,
                     building_count=len(building_layer['features']) if complete or building_area > 0 else None,
                     mapped_wetland_area_m2=wetland_area if complete or wetland_area > 0 else None),
        sources=dict(imagery_url=(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' if is_nh else
            'https://tiles.arcgis.com/tiles/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Aerial_Imagery_2025/MapServer/tile/{z}/{y}/{x}'),
            imagery_attribution='Imagery: Esri World Imagery' if is_nh else 'Imagery: MassGIS 2025',
            layer_coverage='complete' if complete else 'partial',
            geometry_source='Checked-in parcel, building, wetland and corridor GeoJSON; areas in EPSG:26986'))
    filename = hashlib.sha256(key.encode()).hexdigest()[:16] + '.json'
    (OUT / filename).write_text(json.dumps(report, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')
    index['parcels'][key] = dict(file=filename, address=properties.get('address'), town=properties['town'], parcel_id=properties['parcel_id'])

(OUT / 'index.json').write_text(json.dumps(index, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')
# Retain the prototype asset as an alias to the same generated source record.
country = index['parcels']['AMESBURY|42-15']['file']
(OUT / '2-country-club-ln.json').write_bytes((OUT / country).read_bytes())
print(json.dumps(dict(reports=len(index['parcels']), complete_corridor_coverage=complete_count,
                     partial_corridor_coverage=len(parcels)-complete_count,
                     bytes=sum(p.stat().st_size for p in OUT.glob('*.json')))))
