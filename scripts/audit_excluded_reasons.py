import openpyxl
import json
from collections import defaultdict

wb = openpyxl.load_workbook(r'C:\Users\princ\Downloads\Road 250m parcels (6).xlsx', data_only=True)
sheet = wb.active
rows = list(sheet.iter_rows(values_only=True))
header = rows[0]
hdict = {str(h): i for i, h in enumerate(header) if h is not None}

with open('apps/web/public/geojson/parcels_250m.geojson', 'r', encoding='utf-8') as f:
    geojson_data = json.load(f)

geojson_by_id = {}
for feat in geojson_data['features']:
    p = feat['properties']
    geojson_by_id[(p['town'].upper(), p['parcel_id'])] = p

# Check each Excel row
excluded_in_excel = []
for r in rows[1:]:
    cat = r[hdict['land_category']]
    if not cat:
        continue
    keep = r[hdict['stage1_keep']]
    reason = r[hdict['category_reason']]
    drop = r[hdict['stage1_drop_reason']]
    pid = r[hdict.get('MAP_PAR_ID')] or r[hdict.get('NH_PARCEL_ID')] or r[hdict.get('LOC_ID')]
    town = r[hdict.get('TOWN')] or r[hdict.get('CITY')]
    bldg_m2 = r[hdict.get('building_m2')]
    owner = r[hdict.get('owner_name')] or r[hdict.get('OWNER1')]
    owner_type = r[hdict.get('owner_type')]
    wetland_pct = r[hdict.get('wetland_pct')]
    usable_acres = r[hdict.get('open_nonwetland_acres')]
    
    if keep == 'N':
        excluded_in_excel.append({
            'pid': pid, 'town': town, 'cat': cat, 'reason': reason, 'drop': drop,
            'bldg_m2': bldg_m2, 'owner': owner, 'owner_type': owner_type,
            'wetland_pct': wetland_pct, 'usable_acres': usable_acres
        })

print(f"Total rows: {len(rows)-1}, Excluded in Excel: {len(excluded_in_excel)}")

by_cat = defaultdict(list)
for p in excluded_in_excel:
    by_cat[p['cat']].append(p)

for cat, items in sorted(by_cat.items()):
    print(f"\n=======================================================")
    print(f"Excluded Category: {cat} ({len(items)} parcels)")
    print(f"=======================================================")
    dev_mentions = [x for x in items if x['reason'] and 'town code says developable' in str(x['reason']).lower()]
    print(f"  Parcels mentioning 'town code says developable': {len(dev_mentions)}")
    for d in dev_mentions:
        print(f"    - {d['town']} {d['pid']} | bldg_m2: {d['bldg_m2']} | wetland_pct: {d['wetland_pct']} | owner_type: {d['owner_type']} | acres: {d['usable_acres']}")
        print(f"      reason: {d['reason']}")
        print(f"      excel drop: {d['drop']}")
