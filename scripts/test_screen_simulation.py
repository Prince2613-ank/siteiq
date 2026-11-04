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
    excel_map[(town, pid)] = get_col(r, 'category_reason')

with open('apps/web/public/geojson/parcels_250m.geojson', 'r', encoding='utf-8') as f:
    geojson_data = json.load(f)

with open('apps/web/public/geojson/parcel_building_coverage.json', 'r', encoding='utf-8') as f:
    coverage = json.load(f)['parcels']

with open('apps/web/public/geojson/listing_check.json', 'r', encoding='utf-8') as f:
    listings = json.load(f)['lots']

def resolve_category(category, reason):
    cat = (category or '').strip()
    r = (reason or '').strip().lower()
    cat_lower = cat.lower()
    
    # Only resolve if currently Paved land or unclassified
    if cat_lower in ['paved land', '']:
        if 'zoned i' in r or 'industrial' in r or '440' in r:
            return 'Industrial'
        if 'commercial' in r or any(c in r for c in ['390', '391', '031', '334', '337']):
            return 'Commercial'
        if 'town code says developable' in r or 'developable' in r:
            return 'Developable'
    return cat

def screen_parcel(p, reason, cov, is_listed):
    resolved_cat = resolve_category(p.get('category'), reason)
    cat_lower = resolved_cat.lower()
    orig_cat_lower = (p.get('category') or '').strip().lower()
    
    # building coverage
    percent = cov.get('building_pct') if cov else None
    recorded_status = (p.get('status') or '').strip().lower()
    
    has_dev_reason = reason is not None and any(k in str(reason).lower() for k in [
        'town code says developable', 'developable', 'zoned i', 'industrial', 'commercial', '390', '391', '031', '334', '337'
    ])
    
    measured = percent is not None and 0 <= percent <= 100
    vacant = (percent <= 5) if measured else (recorded_status in ['vacant', 'paved, no building'])
    status = 'vacant' if vacant else 'built-up'
    
    # Rule 10: Listed for sale
    if is_listed:
        return {'keep': 'N', 'rule': 10, 'reason': 'Listed for sale', 'cat': resolved_cat}
    
    # Rule 2: Wetland > 50% (checked on original category so Non-developable severe wetlands remain dropped)
    wet = p.get('wetland_pct')
    if orig_cat_lower == 'non-developable' and wet is not None and float(wet) > 50:
        return {'keep': 'N', 'rule': 2, 'reason': 'Non-developable land with more than 50% wetland coverage', 'cat': resolved_cat}
    
    # Rule 3: Condo
    if 'condo' in str(p.get('use') or '').lower():
        return {'keep': 'N', 'rule': 3, 'reason': 'Condominium unit: the land is not independently available', 'cat': resolved_cat}
    
    # Rule 7: Built up
    if status == 'built-up':
        reason_str = 'Built-up property: building footprint above 5% of GIS lot area' if measured else 'Building coverage unavailable; not classified as vacant'
        return {'keep': 'N', 'rule': 7, 'reason': reason_str, 'cat': resolved_cat}
    
    # Rule 1: Ownership
    owner_type = (p.get('owner_type') or 'unknown').strip().lower()
    is_public = cat_lower == 'public land' or owner_type == 'government'
    if is_public or owner_type not in ['company', 'individual', 'unknown']:
        reason_str = 'Public ownership: town or state owned' if is_public else f'Excluded ownership: {p.get("owner_type")} (only Company, Individual, and Unknown qualify)'
        return {'keep': 'N', 'rule': 1, 'reason': reason_str, 'cat': resolved_cat}
    
    open_land = status == 'vacant' or (recorded_status == 'paved, no building' and has_dev_reason)
    vacant_reason = 'Recorded vacant land' if percent is None else 'Vacant land with building footprint at or below 5%'
    
    # Rule 4: Prime vacant land
    if open_land and cat_lower in ['developable', 'industrial', 'commercial']:
        return {'keep': 'Y', 'rule': 4, 'reason': f'{vacant_reason} in a Developable, Industrial or Commercial category', 'cat': resolved_cat}
    
    # Rule 8: Paved land with no building (if not developable)
    if cat_lower == 'paved land' and not has_dev_reason:
        return {'keep': 'N', 'rule': 8, 'reason': 'Paved land with no building', 'cat': resolved_cat}
    
    # Rule 6: Other open land
    if open_land:
        return {'keep': 'Y', 'rule': 6, 'reason': f'{vacant_reason}; check zoning and wetland conditions', 'cat': resolved_cat}
    
    if recorded_status == 'paved, no building':
        return {'keep': 'N', 'rule': 8, 'reason': 'Paved land with no building', 'cat': resolved_cat}
    
    return {'keep': 'N', 'rule': 9, 'reason': 'Does not meet the land screening qualification rules', 'cat': resolved_cat}

results = []
for feat in geojson_data['features']:
    p = feat['properties']
    key = (p['town'].strip().upper(), str(p['parcel_id']).strip())
    str_key = f"{p['town'].strip().upper()}|{str(p['parcel_id']).strip()}"
    cov = coverage.get(str_key)
    listing = listings.get(str_key)
    is_listed = bool(listing and listing.get('status') and listing.get('status') != 'Not listed')
    reason = excel_map.get(key)
    
    res = screen_parcel(p, reason, cov, is_listed)
    results.append({
        'town': p['town'],
        'parcel_id': p['parcel_id'],
        'old_keep': p.get('keep'),
        'old_rule': p.get('screening_rule'),
        'old_cat': p.get('category'),
        'new_keep': res['keep'],
        'new_rule': res['rule'],
        'new_cat': res['cat'],
        'reason': reason
    })

from collections import Counter
summary = Counter()
rule_summary = Counter()
changed = []
for r in results:
    summary[(r['new_keep'])] += 1
    rule_summary[r['new_rule']] += 1
    if r['old_keep'] != r['new_keep'] or r['old_rule'] != r['new_rule'] or r['old_cat'] != r['new_cat']:
        changed.append(r)

print("=== NEW SUMMARY ===")
print("Keep counts:", summary)
print("Rule counts:", sorted(rule_summary.items()))
print(f"Total changed: {len(changed)}")
print("\nAll changed parcels:")
for c in changed:
    print(f"{c['town']} {c['parcel_id']:10} | Cat: {c['old_cat']} -> {c['new_cat']} | Keep: {c['old_keep']} (R{c['old_rule']}) -> {c['new_keep']} (R{c['new_rule']})")
    print(f"   Reason: {c['reason']}")
