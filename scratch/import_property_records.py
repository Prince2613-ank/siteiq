"""Import only mortgage and restriction fields; never match across towns."""
import argparse
import datetime
import json
import shutil
import re
from collections import defaultdict
from pathlib import Path

import openpyxl

parser = argparse.ArgumentParser()
parser.add_argument('--apply', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
source = Path(r'C:\Users\princ\Downloads\Road 250m parcels (4).xlsx')
target = root / 'apps/web/public/geojson/parcels_250m.geojson'
fields = ['open_mortgage', 'lease_easement_restriction']

def normalize(value):
    if value is None:
        return ''
    if isinstance(value, (datetime.date, datetime.datetime)):
        return f'{value.month}-{value.day}'
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip().upper()

def id_aliases(value):
    aliases = {normalize(value)} - {''}
    date = value if isinstance(value, (datetime.date, datetime.datetime)) else None
    if isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}(?: 00:00:00)?', value.strip()):
        date = datetime.datetime.fromisoformat(value.strip())
    if date:
        # Excel has converted some parcel IDs into dates. Keep both possible
        # orders and resolve collisions using the exact town and address.
        aliases.update([f'{date.month}-{date.day}', f'{date.day}-{date.month}'])
    return aliases

workbook = openpyxl.load_workbook(source, read_only=True, data_only=True)
sheet = workbook['Sheet1']
rows = sheet.iter_rows(values_only=True)
headers = next(rows)
by_id, by_address = defaultdict(list), defaultdict(list)
source_count = 0
for row_number, values in enumerate(rows, start=2):
    row = dict(zip(headers, values))
    if not row.get('TOWN'):
        continue
    source_count += 1
    town = normalize(row['TOWN'])
    for id_column in ['MAP_PAR_ID', 'NH_PARCEL_ID']:
        for parcel_id in id_aliases(row.get(id_column)):
            if row_number not in [number for number, _ in by_id[(town, parcel_id)]]:
                by_id[(town, parcel_id)].append((row_number, row))
    address = normalize(row.get('SITE_ADDR'))
    if address:
        by_address[(town, address)].append((row_number, row))

data = json.loads(target.read_text(encoding='utf-8'))
unmatched, ambiguous, matches = [], [], []
for feature in data['features']:
    props = feature['properties']
    town, parcel_id = normalize(props.get('town')), normalize(props.get('parcel_id'))
    candidates = by_id.get((town, parcel_id), [])
    method = 'town + parcel ID'
    if len(candidates) > 1:
        address = normalize(props.get('address'))
        candidates = [(number, row) for number, row in candidates if normalize(row.get('SITE_ADDR')) == address]
        method = 'town + parcel ID + exact address'
    if not candidates:
        candidates = by_address.get((town, normalize(props.get('address'))), [])
        method = 'town + unique address'
    if len(candidates) != 1:
        (ambiguous if candidates else unmatched).append([town, parcel_id, len(candidates)])
        continue
    row_number, row = candidates[0]
    for field in fields:
        value = row.get(field)
        props[field] = None if value is None else str(value).strip() or None
    matches.append({'town': town, 'parcel_id': parcel_id, 'source_row': row_number, 'method': method})

audit = {
    'source': str(source), 'sheet': 'Sheet1', 'columns': {field: headers.index(field) + 1 for field in fields},
    'source_rows': source_count, 'matched': len(matches), 'total': len(data['features']),
    'unmatched': unmatched, 'ambiguous': ambiguous,
    'populated': {field: sum(bool(f['properties'].get(field)) for f in data['features']) for field in fields},
    'maximum_text_length': {field: max(len(f['properties'].get(field) or '') for f in data['features']) for field in fields},
    'matches': matches,
}
print(json.dumps({key: value for key, value in audit.items() if key != 'matches'}, indent=2))
assert not unmatched and not ambiguous, 'Import stopped: unresolved parcel matches.'
assert len({match['source_row'] for match in matches}) == len(matches), 'Import stopped: source row matched more than once.'
if args.apply:
    backup = root / 'scratch/geojson-backups/parcels_250m.geojson.pre_mortgage.bak'
    backup.parent.mkdir(parents=True, exist_ok=True)
    if not backup.exists():
        shutil.copy2(target, backup)
    target.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    (root / 'scratch/property-records-import.json').write_text(json.dumps(audit, indent=2), encoding='utf-8')
