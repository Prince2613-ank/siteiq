import json
import openpyxl

wb = openpyxl.load_workbook(r'C:\Users\princ\Downloads\Road 250m parcels (6).xlsx', data_only=True)
sheet = wb.active
rows = list(sheet.iter_rows(values_only=True))
header = rows[0]
hdict = {str(h): i for i, h in enumerate(header) if h is not None}

excel_map = {}
for r in rows[1:]:
    cat = r[hdict['land_category']]
    if not cat: continue
    town = str(r[hdict.get('TOWN')] or r[hdict.get('CITY')]).strip().upper()
    pid = str(r[hdict.get('MAP_PAR_ID')] or r[hdict.get('NH_PARCEL_ID')] or r[hdict.get('LOC_ID')]).strip()
    reason = r[hdict.get('category_reason')]
    excel_map[(town, pid)] = {
        'land_category': cat,
        'category_reason': reason,
        'stage1_keep': r[hdict.get('stage1_keep')],
        'stage1_drop_reason': r[hdict.get('stage1_drop_reason')]
    }

with open('apps/web/public/geojson/parcels_250m.geojson', 'r', encoding='utf-8') as f:
    geojson_data = json.load(f)

with open('apps/web/public/geojson/parcel_building_coverage.json', 'r', encoding='utf-8') as f:
    cov_data = json.load(f)['parcels']

with open('apps/web/public/geojson/listing_check.json', 'r', encoding='utf-8') as f:
    list_data = json.load(f)['lots']

parcels = []
for feat in geojson_data['features']:
    p = feat['properties']
    key = (p['town'].strip().upper(), str(p['parcel_id']).strip())
    str_key = f"{p['town'].strip().upper()}|{str(p['parcel_id']).strip()}"
    cov = cov_data.get(str_key)
    listing = list_data.get(str_key)
    bldg_pct = cov.get('building_pct') if cov else None
    
    excel_row = excel_map.get(key, {})
    parcels.append({
        'town': p['town'],
        'parcel_id': p['parcel_id'],
        'category': p.get('category'),
        'category_reason': excel_row.get('category_reason'),
        'excel_cat': excel_row.get('land_category'),
        'excel_keep': excel_row.get('stage1_keep'),
        'excel_drop': excel_row.get('stage1_drop_reason'),
        'geo_keep': p.get('keep'),
        'geo_rule': p.get('screening_rule'),
        'geo_drop': p.get('drop_reason'),
        'owner_type': p.get('owner_type'),
        'status': p.get('status'),
        'use': p.get('use'),
        'wetland_pct': p.get('wetland_pct'),
        'usable_acres': p.get('usable_acres'),
        'bldg_pct': bldg_pct,
        'listed_for_sale': bool(listing and listing.get('status') and listing.get('status') != 'Not listed')
    })

print(f"Loaded {len(parcels)} parcels for audit.")

# Check all parcels where Excel keep == 'N' vs Geo keep
print("\n=== Check parcels where Excel keep == 'N' but Geo keep == 'Y' ===")
excel_n_geo_y = [p for p in parcels if p['excel_keep'] == 'N' and p['geo_keep'] == 'Y']
print(f"Count: {len(excel_n_geo_y)}")
by_reason_excel_n = {}
for p in excel_n_geo_y:
    r = p['excel_drop']
    by_reason_excel_n[r] = by_reason_excel_n.get(r, 0) + 1
for r, c in sorted(by_reason_excel_n.items(), key=lambda x: -x[1]):
    print(f"  [{c}x] Excel drop reason: {r}")

print("\n=== Check parcels where Geo keep == 'N' ===")
geo_n = [p for p in parcels if p['geo_keep'] == 'N']
print(f"Count: {len(geo_n)}")
by_geo_rule = {}
for p in geo_n:
    r = f"Rule {p['geo_rule']}: {p['geo_drop']}"
    by_geo_rule[r] = by_geo_rule.get(r, 0) + 1
for r, c in sorted(by_geo_rule.items(), key=lambda x: -x[1]):
    print(f"  [{c}x] {r}")

