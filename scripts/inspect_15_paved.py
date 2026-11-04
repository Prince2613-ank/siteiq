import json
import openpyxl

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

excel_map = {}
for r in rows[1:]:
    cat = get_col(r, 'land_category')
    if not cat: continue
    town = str(get_col(r, 'TOWN', 'CITY')).strip().upper()
    pid = str(get_col(r, 'MAP_PAR_ID', 'NH_PARCEL_ID', 'LOC_ID')).strip()
    excel_map[(town, pid)] = {
        'land_category': cat,
        'category_reason': get_col(r, 'category_reason'),
        'stage1_keep': get_col(r, 'stage1_keep'),
        'stage1_drop_reason': get_col(r, 'stage1_drop_reason'),
    }

with open('apps/web/public/geojson/parcels_250m.geojson', 'r', encoding='utf-8') as f:
    geojson_data = json.load(f)

for feat in geojson_data['features']:
    p = feat['properties']
    if p.get('category') == 'Paved land':
        key = (p['town'].strip().upper(), str(p['parcel_id']).strip())
        ex = excel_map.get(key, {})
        print(f"Parcel: {p['town']} {p['parcel_id']}")
        print(f"  Address: {p.get('address')} | Owner: {p.get('owner')} ({p.get('owner_type')})")
        print(f"  Category Reason: {ex.get('category_reason')}")
        print(f"  Zoning: {p.get('zoning')} | Use: {p.get('use')} | Acres: {p.get('acres')} | Usable: {p.get('usable_acres')}")
        print(f"  Building cov: {p.get('building_coverage_pct')} | Listed: {p.get('screening_rule') == 10}")
        print(f"  Current Keep: {p.get('keep')} | Screening Rule: {p.get('screening_rule')} | Reason: {p.get('screening_reason')}")
        print("-" * 60)
