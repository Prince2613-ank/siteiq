import json
import pandas as pd

df = pd.read_excel(r'C:\Users\princ\Downloads\Road 250m parcels (2).xlsx')
print('Columns with "id" or "parcel" or "loc" or "map":')
for c in df.columns:
    if any(k in str(c).lower() for k in ['id', 'par', 'loc', 'map', 'town', 'address', 'owner']):
        print(f"  {c}")

with open('apps/web/public/geojson/parcels_250m.geojson', 'r', encoding='utf-8') as f:
    geojson = json.load(f)

print('GeoJSON feature count:', len(geojson['features']))
print('GeoJSON sample properties keys:', list(geojson['features'][0]['properties'].keys())[:15])

# Check if row order matches exactly 1-to-1 or if there is a primary key
df_match_col = None
for col in ['parcel_id', 'PARCEL_ID', 'loc_id', 'LOC_ID', 'map_par_id', 'MAP_PAR_ID']:
    if col in df.columns:
        df_match_col = col
        break

print('Matched candidate column:', df_match_col)
