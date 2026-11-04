import json
import openpyxl
from collections import defaultdict

wb = openpyxl.load_workbook(r'C:\Users\princ\Downloads\Road 250m parcels (6).xlsx', data_only=True)
sheet = wb.active
rows = list(sheet.iter_rows(values_only=True))
header = rows[0]
hdict = {str(h): i for i, h in enumerate(header) if h is not None}

def get_col(row, *names):
    for name in names:
        idx = hdict.get(name)
        if idx is not None and idx < len(row):
            val = row[idx]
            if val is not None:
                return val
    return None

excel_rows = {}
for r in rows[1:]:
    cat = get_col(r, 'land_category')
    if not cat: continue
    town = str(get_col(r, 'TOWN', 'CITY')).strip().upper()
    pid = str(get_col(r, 'MAP_PAR_ID', 'NH_PARCEL_ID', 'LOC_ID')).strip()
    excel_rows[(town, pid)] = {
        'land_category': cat,
        'category_reason': get_col(r, 'category_reason'),
        'stage1_keep': get_col(r, 'stage1_keep'),
        'stage1_drop_reason': get_col(r, 'stage1_drop_reason'),
        'owner_type': get_col(r, 'owner_type'),
        'owner_name': get_col(r, 'owner_name', 'OWNER1'),
        'wetland_pct': get_col(r, 'wetland_pct'),
        'open_nonwetland_acres': get_col(r, 'open_nonwetland_acres'),
        'building_m2': get_col(r, 'building_m2'),
    }

with open('apps/web/public/geojson/parcels_250m.geojson', 'r', encoding='utf-8') as f:
    geojson_data = json.load(f)

# Group excluded parcels by their exclusion rule
rules_map = defaultdict(list)
for feat in geojson_data['features']:
    p = feat['properties']
    if p.get('keep') == 'N':
        key = (p['town'].strip().upper(), str(p['parcel_id']).strip())
        ex = excel_rows.get(key, {})
        rules_map[p.get('screening_rule')].append({
            'town': p['town'],
            'parcel_id': p['parcel_id'],
            'category': p.get('category'),
            'category_reason': ex.get('category_reason'),
            'drop_reason': p.get('drop_reason'),
            'owner_type': p.get('owner_type'),
            'building_coverage_pct': p.get('building_coverage_pct'),
            'wetland_pct': p.get('wetland_pct')
        })

print("=== SUMMARY OF EXCLUDED PARCELS BY RULE ===")
for rule, items in sorted(rules_map.items()):
    print(f"\nRule {rule}: {len(items)} parcels ({items[0]['drop_reason'][:50]}...)")
    # Check if any have 'developable' in reason
    dev_mentions = [x for x in items if x['category_reason'] and 'developable' in str(x['category_reason']).lower() and 'undevelopable' not in str(x['category_reason']).lower()]
    print(f"  Mention 'developable' (positive) in category_reason: {len(dev_mentions)}")
    for d in dev_mentions:
        print(f"    - {d['town']} {d['parcel_id']} | Cat: {d['category']} | Reason: {d['category_reason']} | Owner: {d['owner_type']} | Cov: {d['building_coverage_pct']} | Wet: {d['wetland_pct']}")

