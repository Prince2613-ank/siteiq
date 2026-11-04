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

with open('apps/web/public/geojson/parcels_250m.geojson', 'r', encoding='utf-8') as f:
    geojson_data = json.load(f)

with open('apps/web/public/geojson/parcel_building_coverage.json', 'r', encoding='utf-8') as f:
    cov_data = json.load(f)['parcels']

with open('apps/web/public/geojson/listing_check.json', 'r', encoding='utf-8') as f:
    list_data = json.load(f)['lots']

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

# Check all parcels in GeoJSON
all_audited = []
for feat in geojson_data['features']:
    p = feat['properties']
    key = (p['town'].strip().upper(), str(p['parcel_id']).strip())
    str_key = f"{p['town'].strip().upper()}|{str(p['parcel_id']).strip()}"
    ex = excel_rows.get(key, {})
    cov = cov_data.get(str_key)
    listing = list_data.get(str_key)
    
    bldg_pct = cov.get('building_pct') if cov else None
    is_listed = bool(listing and listing.get('status') and listing.get('status') != 'Not listed')
    
    all_audited.append({
        'town': p['town'],
        'parcel_id': p['parcel_id'],
        'geo_cat': p.get('category'),
        'excel_cat': ex.get('land_category'),
        'category_reason': ex.get('category_reason'),
        'owner_type': p.get('owner_type') or ex.get('owner_type'),
        'owner_name': p.get('owner'),
        'status': p.get('status'),
        'bldg_pct': bldg_pct,
        'wetland_pct': p.get('wetland_pct'),
        'usable_acres': p.get('usable_acres'),
        'is_listed': is_listed,
        'current_geo_keep': p.get('keep'),
        'current_geo_rule': p.get('screening_rule'),
        'current_geo_reason': p.get('screening_reason'),
        'excel_keep': ex.get('stage1_keep'),
        'excel_drop': ex.get('stage1_drop_reason')
    })

print(f"Total audited parcels: {len(all_audited)}")

# Let us find EVERY parcel that has 'developable' in category_reason
dev_parcels = [p for p in all_audited if p['category_reason'] and 'town code says developable' in str(p['category_reason']).lower()]
print(f"\nTotal parcels with 'town code says developable': {len(dev_parcels)}")
for p in dev_parcels:
    print(f"{p['town']} {p['parcel_id']:10} | Cat: {p['geo_cat']:15} | Cov: {str(p['bldg_pct']):5} | Wet: {str(p['wetland_pct']):5} | Owner: {str(p['owner_type']):10} | Listed: {str(p['is_listed']):5} | GeoKeep: {p['current_geo_keep']} (R{p['current_geo_rule']}) | ExKeep: {p['excel_keep']}")
    print(f"   Reason: {p['category_reason']}")

