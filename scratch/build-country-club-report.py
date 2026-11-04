import json, urllib.request, urllib.parse
from pathlib import Path
from datetime import datetime, timezone
from shapely.geometry import shape, mapping, box
from shapely.ops import transform, unary_union
from pyproj import Transformer
root=Path('apps/web/public/geojson')
parcels=json.loads((root/'parcels_250m.geojson').read_text())['features']
subject=next(f for f in parcels if f['properties']['address']=='2 COUNTRY CLUB LN' and f['properties']['town']=='AMESBURY')
geom=shape(subject['geometry']); area_project=Transformer.from_crs(4326,26986,always_xy=True).transform
bounds=geom.bounds
query=dict(f='geojson',where='1=1',geometry=','.join(map(str,bounds)),geometryType='esriGeometryEnvelope',inSR='4326',outSR='4326',spatialRel='esriSpatialRelIntersects',outFields='*',returnGeometry='true',resultRecordCount=2000)
service='https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/BuildingStructures2D/FeatureServer/0'
url=service+'/query?'+urllib.parse.urlencode(query)
try:
 with urllib.request.urlopen(url,timeout=40) as r: raw=json.load(r)
 if raw.get('error') or raw.get('exceededTransferLimit'): raise ValueError(str(raw.get('error','Query truncated')))
 buildings=[]
 for f in raw.get('features',[]):
  clipped=shape(f['geometry']).intersection(geom)
  if not clipped.is_empty and clipped.area>1e-14: buildings.append(dict(type='Feature',properties={'source':'MassGIS Building Structures 2-D'},geometry=mapping(clipped)))
 building_coverage='Full parcel queried from MassGIS Building Structures 2-D.'
except Exception as e:
 print('BUILDING SOURCE UNAVAILABLE',str(e));buildings=[];building_coverage='Building data is unavailable; absence of footprints does not mean no buildings.'
wetlands=[]
for f in json.loads((root/'wetlands_250m.geojson').read_text())['features']:
 clipped=shape(f['geometry']).intersection(geom)
 if not clipped.is_empty and clipped.area>1e-14: wetlands.append(dict(type='Feature',properties=f['properties'],geometry=mapping(clipped)))
nearby=geom.buffer(.002)
neighbors=[f for f in parcels if f['properties']['parcel_id']!=subject['properties']['parcel_id'] and shape(f['geometry']).intersects(nearby)]
area=lambda g:transform(area_project,g).area
output=dict(subject=subject,neighbors=dict(type='FeatureCollection',features=neighbors),buildings=dict(type='FeatureCollection',features=buildings),wetlands=dict(type='FeatureCollection',features=wetlands),metrics=dict(gis_area_m2=area(geom),building_area_m2=sum(area(shape(f['geometry'])) for f in buildings) if 'Full parcel' in building_coverage else None,building_count=len(buildings) if 'Full parcel' in building_coverage else None,mapped_wetland_area_m2=sum(area(shape(f['geometry'])) for f in wetlands)),sources=dict(buildings_url=service,building_coverage=building_coverage,wetlands_coverage='Wetland geometry is from the local 250 m road-corridor layer and is incomplete outside that corridor.',imagery_url='https://tiles.arcgis.com/tiles/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Aerial_Imagery_2025/MapServer/tile/{z}/{y}/{x}',imagery_label='MassGIS 2025 aerial imagery',generated_at=datetime.now(timezone.utc).isoformat()))
dest=Path('apps/web/public/reports/2-country-club-ln.json');dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(json.dumps(output,separators=(',',':')))
print(json.dumps({'output':str(dest),'neighbors':len(neighbors),'buildings':len(buildings),'wetlands':len(wetlands),'metrics':output['metrics'],'coverage':building_coverage}))
