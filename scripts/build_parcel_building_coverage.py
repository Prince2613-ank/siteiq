"""Index building percentages for every parcel from generated report metrics."""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def valid_measurements(building, lot):
    return (all(isinstance(n, (int, float)) and not isinstance(n, bool) and math.isfinite(n)
                for n in (building, lot)) and lot > 0 and 0 <= building <= lot)


def build_coverage_index():
    geo = ROOT / 'apps/web/public/geojson'
    reports = ROOT / 'apps/web/public/reports'
    index = json.loads((reports / 'index.json').read_text(encoding='utf8'))['parcels']
    features = json.loads((geo / 'parcels_250m.geojson').read_text(encoding='utf8'))['features']
    records = {}
    for feature in features:
        p = feature['properties']
        key = p['town'].strip().upper() + '|' + p['parcel_id'].strip()
        report = json.loads((reports / index[key]['file']).read_text(encoding='utf8'))
        metrics = report['metrics']
        lot = metrics['gis_area_m2']
        building = metrics['building_area_m2']
        if not isinstance(lot, (int, float)) or lot <= 0:
            raise ValueError('Invalid GIS lot area: ' + key)
        if building is not None and (not isinstance(building, (int, float)) or not 0 <= building <= lot):
            raise ValueError('Invalid building area: ' + key)
        report_building, report_lot = building, lot
        source = 'report'
        if building is None and not p.get('source_building_data_issue') and valid_measurements(
                p.get('source_building_area_m2'), p.get('source_parcel_area_m2')):
            building, lot = p['source_building_area_m2'], p['source_parcel_area_m2']
            source = 'source_workbook'
        records[key] = {
            'gis_area_m2': lot, 'building_area_m2': building,
            'building_pct': None if building is None else 100 * building / lot,
            'layer_coverage': report['sources']['layer_coverage'],
            'measurement_source': source,
            'report_building_area_m2': report_building, 'report_gis_area_m2': report_lot,
            'source_vacant_area_m2': p.get('source_vacant_area_m2'),
            # NH input has no paving layer; its zero placeholders are not measurements.
            'source_paved_area_m2': p.get('source_paved_area_m2') if p.get('state') == 'MA' else None,
            'source_parcel_area_m2': p.get('source_parcel_area_m2'),
        }
    result = {
        'version': 2, 'method': '100 * building area / matching parcel area; report measurements first, validated source workbook building_m2 / parcel_m2 when report building area is missing; unrounded threshold',
        'note': 'Mapped roof/building coverage only. Partial layer coverage is not a complete site survey. Missing area is not zero.',
        'parcels': records,
    }
    (geo / 'parcel_building_coverage.json').write_text(json.dumps(result, separators=(',', ':')), encoding='utf8')
    print(json.dumps({'parcels': len(records), 'at_or_below_5_percent': sum(r['building_pct'] is not None and r['building_pct'] <= 5 for r in records.values()),
                      'above_5_percent': sum(r['building_pct'] is not None and r['building_pct'] > 5 for r in records.values()),
                      'missing': sum(r['building_pct'] is None for r in records.values())}))


if __name__ == '__main__':
    build_coverage_index()
