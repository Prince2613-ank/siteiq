const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../../..');
const api = {};
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(root, 'apps/web/src/utils/parcelAreas.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(api);
assert.equal(api.areaMeasurements(4046.8564224, 8093.7128448).sqft, 43560);
assert.equal(api.areaMeasurements(4046.8564224, 8093.7128448).percent, 50);
assert.equal(api.areaMeasurements(null, 100).percent, null);
assert.equal(api.areaMeasurements(0, 100).percent, 0);
assert.equal(api.areaMeasurements(1, 0).percent, null);
assert.equal(api.areaMeasurements(NaN, 100).acres, null);
assert.equal(api.vacantLandMeasurements({ vacant_land_area_m2: 101, vacant_land_lot_area_m2: 100 }).acres, null);
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const coverage = read('apps/web/public/geojson/parcel_building_coverage.json').parcels;
const index = read('apps/web/public/reports/index.json').parcels;
const parcels = read('apps/web/public/geojson/parcels_250m.geojson').features.map(f => f.properties);
let changedSquareFeet = 0, changedPercent = 0;
for (const p of parcels) {
  const key = `${p.town}|${p.parcel_id}`, c = coverage[key];
  assert.equal(c.source_vacant_area_m2, p.source_vacant_area_m2, key);
  assert.equal(c.source_parcel_area_m2, p.source_parcel_area_m2, key);
  const paved = api.pavedLandMeasurements({ paved_land_area_m2: c.source_paved_area_m2, vacant_land_lot_area_m2: c.source_parcel_area_m2 });
  if (p.state === 'MA') {
    assert.equal(c.source_paved_area_m2, p.source_paved_area_m2, key);
    assert.equal(paved.sqft, p.source_paved_area_m2 / .09290304, key);
    assert.equal(paved.percent, 100 * p.source_paved_area_m2 / p.source_parcel_area_m2, key);
  } else {
    assert.equal(c.source_paved_area_m2, null, 'No NH paving coverage; zero placeholders are unknown');
    assert.equal(paved.acres, null);
  }
  const v = api.vacantLandMeasurements({ vacant_land_area_m2: c.source_vacant_area_m2, vacant_land_lot_area_m2: c.source_parcel_area_m2 });
  assert.equal(v.sqft, p.source_vacant_area_m2 / 0.09290304, key);
  assert.equal(v.percent, 100 * p.source_vacant_area_m2 / p.source_parcel_area_m2, key);
  assert.ok(v.percent >= 0 && v.percent <= 100, key);
  if (Math.round(v.sqft) !== Math.round(p.usable_acres * 43560)) changedSquareFeet++;
  if (v.percent.toFixed(1) !== (100 * p.usable_acres / p.acres).toFixed(1)) changedPercent++;
  const report = read(`apps/web/public/reports/${index[key].file}`);
  for (const field of ['building_area_m2', 'mapped_wetland_area_m2']) {
    const a = api.areaMeasurements(report.metrics[field], report.metrics.gis_area_m2);
    if (report.metrics[field] === null) assert.equal(a.sqft, null);
    else {
      assert.equal(a.sqft, report.metrics[field] / 0.09290304);
      assert.equal(a.percent, 100 * report.metrics[field] / report.metrics.gis_area_m2);
      assert.ok(a.percent <= 100.000001);
    }
  }
}
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    for (const key of ['SALISBURY|19-56', 'AMESBURY|42-15', 'SEABROOK|10-10-0']) {
      const [town, id] = key.split('|'), c = coverage[key];
      await page.goto(`${process.env.SITEIQ_URL || 'http://127.0.0.1:5173'}/sites/report/${town}/${id}`);
      const row = page.locator('.report-area-usable'); await row.waitFor();
      const cells = await row.locator('td').allTextContents();
      const fmt = (n, digits) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
      assert.deepEqual(cells, [fmt(c.source_vacant_area_m2 / .09290304, 0), fmt(c.source_vacant_area_m2 / 4046.8564224, 2), `${fmt(100 * c.source_vacant_area_m2 / c.source_parcel_area_m2, 1)}%`]);
      assert.equal(await page.locator('[data-report-note]').count(), 0, 'No description below the area table');
      const paving = await page.locator('.report-area-paved td').allTextContents();
      assert.deepEqual(paving, c.source_paved_area_m2 === null ? ['Not available', '—', '—'] : [fmt(c.source_paved_area_m2 / .09290304, 0), fmt(c.source_paved_area_m2 / 4046.8564224, 2), `${fmt(100 * c.source_paved_area_m2 / c.source_parcel_area_m2, 1)}%`]);
      if (id === '19-56') {
        await page.locator('.report-area-section').screenshot({ path: path.join(root, 'tmp/area-calculations.png') });
        console.log(`47 Pike St corrected vacant-land row: ${cells.join(' / ')}`);
        console.log(`47 Pike St paved-area row: ${paving.join(' / ')}`);
      }
    }
    console.log(`PASS: all ${parcels.length} parcel conversions and matching denominators checked; ${changedSquareFeet} vacant square-foot values and ${changedPercent} displayed percentages corrected; three report views verified.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
