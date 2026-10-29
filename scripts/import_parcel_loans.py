"""Read loan data from the supplied workbook without changing existing parcel data.
Run: python scripts/import_parcel_loans.py "path/to/Road 250m parcels (5).xlsx"
Requires openpyxl (scripts/requirements-parcel-loans.txt).
"""
import argparse
from collections import Counter
from datetime import date, datetime
import hashlib
import json
import math
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[1]
GEO = ROOT / 'apps/web/public/geojson'
FIELDS = ['loan_status', 'open_mortgage', 'open_loans_count', 'latest_open_loan_lender',
          'latest_loan_amount_usd', 'latest_loan_date', 'loan_age_years', 'loan_to_value_pct',
          'est_balance_now_usd', 'est_equity_usd', 'est_equity_pct', 'loan_signal']
NUMBERS = {'open_loans_count', 'latest_loan_amount_usd', 'loan_age_years', 'loan_to_value_pct',
           'est_balance_now_usd', 'est_equity_usd', 'est_equity_pct'}


def import_loans(source):
    expected = {
        p['properties']['town'].strip().upper() + '|' + p['properties']['parcel_id'].strip()
        for p in json.loads((GEO / 'parcels_250m.geojson').read_text(encoding='utf-8'))['features']
    }
    workbook = openpyxl.load_workbook(source, read_only=True, data_only=True)
    try:
        sheet = workbook['Sheet1']
        rows = sheet.iter_rows(values_only=True)
        headers = next(rows)
        required = {'TOWN', 'MAP_PAR_ID', *FIELDS}
        if not required.issubset(headers):
            raise ValueError('Required columns missing: ' + str(required - set(headers)))
        parcels = {}
        for row_number, values in enumerate(rows, 2):
            row = dict(zip(headers, values))
            if not any(v is not None and v != '' for v in values):
                continue
            if not row['TOWN'] or row['MAP_PAR_ID'] is None:
                raise ValueError(f'Missing parcel identity at row {row_number}')
            key = str(row['TOWN']).strip().upper() + '|' + str(row['MAP_PAR_ID']).strip()
            if key in parcels:
                raise ValueError('Duplicate spreadsheet identity: ' + key)
            record = {}
            for field in FIELDS:
                value = row[field]
                if value == '' or value is None:
                    value = None
                elif field in NUMBERS:
                    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                        raise ValueError(f'Invalid number at row {row_number}, {field}: {value}')
                elif field == 'latest_loan_date':
                    if not isinstance(value, (date, datetime)):
                        raise ValueError(f'Invalid loan date at row {row_number}: {value}')
                    value = value.strftime('%Y-%m-%d')
                elif not isinstance(value, str) or value.startswith(('#REF!', '#VALUE!', '#DIV/0!', '#N/A', '#NUM!')):
                    raise ValueError(f'Invalid text at row {row_number}, {field}: {value}')
                record[field] = value
            if not record['loan_signal'] or not record['loan_status']:
                raise ValueError(f'Missing loan category/status at row {row_number}')
            count = record['open_loans_count']
            if count is not None and (count < 0 or int(count) != count):
                raise ValueError(f'Invalid loan count at row {row_number}')
            record['source_row'] = row_number
            parcels[key] = record
    finally:
        workbook.close()
    if set(parcels) != expected:
        raise ValueError(f'Parcel mismatch: missing={expected - set(parcels)}, extra={set(parcels) - expected}')
    output = dict(version=1, source=dict(file=source.name, sheet='Sheet1',
                  sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                  columns='AP, AO, FQ:FZ', percentage_values='fractions',
                  estimates='Cached workbook values; not recalculated'), parcels=parcels)
    (GEO / 'parcel_loans.json').write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    print(json.dumps(dict(matched=len(parcels), categories=dict(Counter(p['loan_signal'] for p in parcels.values())))))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workbook', type=Path)
    import_loans(parser.parse_args().workbook)
