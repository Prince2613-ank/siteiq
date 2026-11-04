"""Import original category evidence; runtime parcelScreening resolves precedence."""
import argparse
import json
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workbook', type=Path)
    args = parser.parse_args()
    workbook = openpyxl.load_workbook(args.workbook, read_only=True, data_only=True)
    rows = iter(workbook.active.values)
    headers = next(rows)
    records = {}
    for row in rows:
        record = dict(zip(headers, row))
        if not record.get('land_category'):
            continue
        town = str(record.get('TOWN') or record.get('CITY') or '').strip().upper()
        parcel_id = str(record.get('MAP_PAR_ID') or record.get('NH_PARCEL_ID') or record.get('LOC_ID') or '').strip()
        key = (town, parcel_id)
        if not all(key) or key in records:
            raise ValueError(f'Missing or duplicate parcel identity: {key}')
        records[key] = record
    workbook.close()
    target = ROOT / 'apps/web/public/geojson/parcels_250m.geojson'
    data = json.loads(target.read_text(encoding='utf-8'))
    keys = {(p['town'].strip().upper(), str(p['parcel_id']).strip())
            for p in (f['properties'] for f in data['features'])}
    if keys != records.keys() or len(keys) != len(data['features']):
        raise ValueError('Workbook and project parcel identities do not match exactly')
    for feature in data['features']:
        p = feature['properties']
        record = records[(p['town'].strip().upper(), str(p['parcel_id']).strip())]
        p['source_land_category'] = record['land_category']
        p['category'] = record['land_category']
        p['category_reason'] = record.get('category_reason')
        p['source_building_area_m2'] = record.get('building_m2')
        p['source_parcel_area_m2'] = record.get('parcel_m2')
        p['source_building_data_issue'] = record.get('data_issue')
        p['source_vacant_area_m2'] = record.get('open_nonwetland_m2')
        p['source_paved_area_m2'] = record.get('paved_m2')
    target.write_text(json.dumps(data, separators=(',', ':')), encoding='utf-8')
    print(f'Imported original category and reason for all {len(keys)} parcels; workbook unchanged.')

if __name__ == '__main__':
    main()
