import json
from pathlib import Path
from shapely.geometry import shape
from shapely.ops import transform, unary_union
from pyproj import Transformer
root=Path('apps/web/public')
source=json.loads((root/'geojson/parcels_250m.geojson').read_text(encoding='utf-8'))['features']
index=json.loads((root/'reports/index.json').read_text(encoding='utf-8'))['parcels']
project=Transformer.from_crs(4326,26986,always_xy=True).transform
assert len(index)==len(source)==766
building_reports=0
wetland_reports=0
for f in source:
 p=f['properties']
 key=p['town'].strip().upper()+'|'+p['parcel_id'].strip()
 report=json.loads((root/'reports'/index[key]['file']).read_text(encoding='utf-8'))
 assert report['subject']['properties']==p,('identity',key)
 subject=transform(project,shape(report['subject']['geometry']))
 assert abs(subject.area-report['metrics']['gis_area_m2'])<.001,('subject area',key,subject.area,report['metrics']['gis_area_m2'])
 for layer,metric in [('buildings','building_area_m2'),('wetlands','mapped_wetland_area_m2')]:
  shapes=[transform(project,shape(g['geometry'])) for g in report[layer]['features']]
  for g in shapes:
   assert g.difference(subject).area<.01,('overlay outside subject',key,layer,g.difference(subject).area)
  measured=unary_union(shapes).area if shapes else 0
  value=report['metrics'][metric]
  if value is not None:
   assert abs(measured-value)<.01,('measured overlay area',key,metric,measured,value)
  assert measured<=subject.area+.01,('area exceeds subject',key,metric)
 building_reports+=bool(report['buildings']['features'])
 wetland_reports+=bool(report['wetlands']['features'])
 assert ('World_Imagery' in report['sources']['imagery_url'])==(p['state']=='NH'),('aerial source',key)
print(json.dumps({'verified_reports':len(index),'with_building_overlays':building_reports,'with_wetland_overlays':wetland_reports,'checks':'source identity, all fields, projected areas, clipped overlays, no double-counted area, aerial coverage by state'}))
