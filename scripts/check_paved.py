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
    reason = r[hdict.get('category_reason')]
    excel_map[(town, pid)] = reason

print("=== All 15 Paved Land Parcels ===")
for feat in geojson_data['features']:
    p = feat['properties']
    key = (p['town'].strip().upper(), str(p['parcel_id']).strip())
    cat = p.get('category')
    stat = p.get('status')
    if cat == 'Paved land' or 'paved' in str(stat).lower():
        reason = excel_map.get(key)
        print(f"{p['town']} {p['parcel_id']}:")
        print(f"  category: {cat} | status: {stat} | owner_type: {p.get('owner_type')} | listed: {p.get('screening_rule') == 10}")
        print(f"  category_reason: {reason}")
        print(f"  current keep: {p.get('keep')} | rule: {p.get('screening_rule')} | drop: {p.get('drop_reason')}")

