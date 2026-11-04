import openpyxl
import json
from collections import Counter

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

# Collect all unique category_reason values and see their categories and Excel keep status
reasons = Counter()
for r in rows[1:]:
    cat = r[hdict['land_category']]
    if not cat: continue
    reason = str(r[hdict['category_reason']])
    keep = r[hdict['stage1_keep']]
    reasons[(cat, reason, keep)] += 1

print(f"Total unique (cat, reason, keep) combos: {len(reasons)}")
for (cat, reason, keep), count in sorted(reasons.items(), key=lambda x: (x[0][0], str(x[0][1]))):
    print(f"[{count:2}x] Cat: {cat:16} | Keep: {str(keep):4} | Reason: {reason}")

