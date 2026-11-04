// Write a reviewable decision for every parcel using the same current inputs as the app.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
function api(name) {
  const exports = {};
  new Function('exports', ts.transpileModule(fs.readFileSync(path.join(root, 'apps/web/src/utils', name), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText)(exports);
  return exports;
}
const { screenParcel, resolveCategory } = api('parcelScreening.ts');
const { developmentStatusFromBuildingCoverage } = api('parcelDevelopment.ts');
const { isListedForSale } = api('parcelListing.ts');
const coverage = read('apps/web/public/geojson/parcel_building_coverage.json').parcels;
const listings = read('apps/web/public/geojson/listing_check.json').lots;
const baseline = process.argv[2] ? Object.fromEntries(read(process.argv[2]).map(p => [`${p.town}|${p.parcel_id}`, p.keep])) : {};
const records = read('apps/web/public/geojson/parcels_250m.geojson').features.map(({ properties: p }) => {
  const key = `${p.town}|${p.parcel_id}`;
  const c = coverage[key];
  const category = resolveCategory(p.category, p.category_reason);
  const status = developmentStatusFromBuildingCoverage(c.building_pct, p.status);
  const decision = screenParcel({ ...p, category, status, building_coverage_pct: c.building_pct, building_coverage_source: c.measurement_source,
    listed_for_sale: isListedForSale(listings[key]?.status) });
  return { key, address: p.address, source_land_category: p.source_land_category,
    category_reason: p.category_reason, resolved_category: category, status,
    building_coverage_pct: c.building_pct, measurement_source: c.measurement_source,
    owner_type: p.owner_type, wetland_pct: p.wetland_pct, listing_status: listings[key]?.status ?? null,
    previous_keep: baseline[key] ?? null, ...decision };
});
const byRule = {};
for (const p of records.filter(p => p.keep === 'N')) byRule[p.screening_reason] = (byRule[p.screening_reason] || 0) + 1;
const result = { source_workbook: 'Road 250m parcels (6).xlsx',
  summary: { total: records.length, qualified: records.filter(p => p.keep === 'Y').length,
    excluded: records.filter(p => p.keep === 'N').length,
    vacant: records.filter(p => p.status === 'Vacant').length, built_up: records.filter(p => p.status === 'Built-up').length,
    newly_qualified: records.filter(p => p.previous_keep === 'N' && p.keep === 'Y').length,
    corrected_to_excluded: records.filter(p => p.previous_keep === 'Y' && p.keep === 'N').length,
    excluded_reasons: byRule }, records };
const output = path.join(root, 'docs/audits/2026-11-04-category-screening.json');
fs.writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.summary, null, 2));
