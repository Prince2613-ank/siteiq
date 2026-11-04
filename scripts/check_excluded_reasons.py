import json
import openpyxl

wb = openpyxl.load_workbook(r'C:\Users\princ\Downloads\Road 250m parcels (6).xlsx', data_only=True)
sheet = wb.active
rows = list(sheet.iter_rows(values_only=True))
header = rows[0]
hdict = {str(h): i for i, h in enumerate(header) if h is not None}

with open('apps/web/public/geojson/parcels_250m.geojson', 'r', encoding='utf-8') as f:
    geojson_data = json.load(f)

excel_map = {}
for r in rows[1:]:
    cat = r[hdict['land_category']]
    if not cat: continue
    town = str(r[hdict.get('TOWN')] or r[hdict.get('CITY')]).strip().upper()
    pid = str(r[hdict.get('MAP_PAR_ID')] or r[hdict.get('NH_PARCEL_ID')] or r[hdict.get('LOC_ID')]).strip()
    excel_map[(town, pid)] = {
        'land_category': cat,
        'category_reason': r[hdict.get('category_reason')],
        'stage1_keep': r[hdict.get('stage1_keep')],
        'stage1_drop_reason': r[hdict.get('stage1_drop_reason')]
    }

print("=== CHECK ALL EXCLUDED PARCELS (GEOJSON KEEP == 'N') ===")
geo_excluded = []
for feat in geojson_data['features']:
    p = feat['properties']
    if p.get('keep') == 'N':
        key = (p['town'].strip().upper(), str(p['parcel_id']).strip())
        ex = excel_map.get(key, {})
        geo_excluded.append({
            'town': p['town'],
            'parcel_id': p['parcel_id'],
            'category': p.get('category'),
            'category_reason': ex.get('category_reason'),
            'screening_rule': p.get('screening_rule'),
            'drop_reason': p.get('drop_reason'),
            'excel_keep': ex.get('stage1_keep'),
            'excel_drop': ex.get('stage1_drop_reason'),
            'owner_type': p.get('owner_type'),
            'wetland_pct': p.get('wetland_pct'),
        })

print(f"Total GeoJSON Excluded: {len(geo_excluded)}")

# Check how many excluded parcels mention developable/commercial/industrial in category_reason
dev_in_excluded = [x for x in geo_excluded if x['category_reason'] and any(k in str(x['category_reason']).lower() for k in ['developable', 'zoned i', 'industrial', 'commercial'])]
print(f"Excluded parcels with developable/commercial/industrial signals in category_reason: {len(dev_in_excluded)}")

print("\nBreakdown of these parcels:")
for x in dev_in_excluded:
    print(f"- {x['town']} {x['parcel_id']} | Cat: {x['category']} | Owner: {x['owner_type']} | Rule {x['screening_rule']}: {x['drop_reason']}")
    print(f"  Reason: {x['category_reason']}")

