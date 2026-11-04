const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const base = process.env.SITEIQ_URL || 'http://127.0.0.1:5173';
function api(name) {
  const exports = {};
  new Function('exports', ts.transpileModule(fs.readFileSync(path.join(root, 'apps/web/src/utils', name), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exports);
  return exports;
}
const { developmentStatusFromBuildingCoverage } = api('parcelDevelopment.ts');
const { screenParcel } = api('parcelScreening.ts');
for (const [percent, expected] of [[0, true], [4.999, true], [5, true], [5.00001, false], [99, false], [null, false], [undefined, false], [-1, false], [NaN, false]]) {
  assert.equal(developmentStatusFromBuildingCoverage(percent, 'Mixed') === 'Vacant', expected, String(percent));
}
for (const original of ['Built-up', 'Mixed', 'Mixed (vacant + built-up)']) {
  assert.equal(developmentStatusFromBuildingCoverage(4.9, original), 'Vacant');
  assert.equal(developmentStatusFromBuildingCoverage(5.01, original), 'Built-up');
  assert.equal(developmentStatusFromBuildingCoverage(null, original), 'Built-up');
}
assert.equal(developmentStatusFromBuildingCoverage(null, 'Vacant'), 'Vacant');
assert.equal(developmentStatusFromBuildingCoverage(null, 'Paved, no building'), 'Vacant');
const sample = { status: 'Vacant', category: 'Developable', usable_acres: 2, building_coverage_pct: 4.9 };
assert.equal(screenParcel(sample).keep, 'Y');
assert.equal(screenParcel({ ...sample, status: 'Built-up', building_coverage_pct: 5.01 }).keep, 'N');
assert.equal(screenParcel({ ...sample, status: 'Built-up', building_coverage_pct: null }).keep, 'N');
assert.equal(screenParcel({ ...sample, listed_for_sale: true }).keep, 'N');
assert.equal(screenParcel({ ...sample, usable_acres: 0.57 }).keep, 'Y');
assert.equal(screenParcel({ ...sample, owner_type: 'Trust' }).keep, 'N');
assert.equal(screenParcel({ ...sample, category: 'Public land' }).keep, 'N');
assert.equal(screenParcel({ ...sample, use: 'Residential condo' }).keep, 'N');

const coverage = JSON.parse(fs.readFileSync(path.join(root, 'apps/web/public/geojson/parcel_building_coverage.json'), 'utf8')).parcels;
const index = JSON.parse(fs.readFileSync(path.join(root, 'apps/web/public/reports/index.json'), 'utf8')).parcels;
const source = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(root, 'apps/web/public/geojson/parcels_250m.geojson'), 'utf8')).features.map(f => [`${f.properties.town}|${f.properties.parcel_id}`, f.properties]));
for (const [key, record] of Object.entries(coverage)) {
  const report = JSON.parse(fs.readFileSync(path.join(root, 'apps/web/public/reports', index[key].file), 'utf8'));
  const p = source[key];
  const expected = report.metrics.building_area_m2 === null
    ? 100 * p.source_building_area_m2 / p.source_parcel_area_m2
    : 100 * report.metrics.building_area_m2 / report.metrics.gis_area_m2;
  assert.equal(record.building_pct, expected, `Coverage must match report: ${key}`);
  assert.equal(record.measurement_source, report.metrics.building_area_m2 === null ? 'source_workbook' : 'report');
}
const eligible = Object.values(coverage).filter(r => r.building_pct !== null && r.building_pct <= 5).length;
const total = Object.keys(coverage).length;

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const sites of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => {
        if (sessionStorage.getItem('test:legacy-mixed')) return;
        sessionStorage.setItem('test:legacy-mixed', '1');
        sessionStorage.setItem('siteiq:view:v1:sites:development', JSON.stringify('Mixed (vacant + built-up)'));
        sessionStorage.setItem('siteiq:view:v1:dashboard', JSON.stringify({ selectedStatus: 'Mixed', center: [42.86, -70.9], zoom: 13, minZoom: 10, scrollTop: 0 }));
      });
      await page.goto(`${base}${sites ? '/sites' : '/'}`);
      if (sites) {
        const select = page.getByRole('combobox', { name: 'Development status', exact: true });
        await page.getByRole('combobox', { name: 'Screening results', exact: true }).getByRole('option', { name: `All (${total})`, exact: true }).waitFor({ state: 'attached' });
        assert.deepEqual(await select.locator('option').evaluateAll(options => options.map(o => o.value)), ['ALL', 'Vacant', 'Built-up']);
        assert.equal(await select.inputValue(), 'ALL');
        await page.getByRole('combobox', { name: 'Rows per page' }).selectOption('0');
        assert.equal(await page.locator('tbody tr[tabindex="0"]').count(), total);
        await page.reload(); await page.locator('td[data-parcel-rank]').first().waitFor();
        assert.equal(await select.inputValue(), 'ALL');
        assert.equal(await page.locator('tbody tr[tabindex="0"]').count(), total);
      } else {
        const group = page.getByRole('group', { name: 'Development status', exact: true });
        const button = group.getByRole('button', { name: `All (${total})`, exact: true });
        await button.waitFor();
        assert.equal(await group.getByRole('button').count(), 3);
        assert.doesNotMatch(await group.textContent(), /Mixed/);
        assert.equal(await page.locator('.dashboard-parcel-overlay').count(), total);
        await page.reload(); await button.waitFor();
        assert.equal(await button.getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('.dashboard-parcel-overlay').count(), total);
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    const page = await browser.newPage();
    for (const [town, id, expected] of [['AMESBURY', '43-2', 'Vacant'], ['SALISBURY', '11-13', 'Built-up'], ['AMESBURY', '66-14', 'Vacant']]) {
      await page.goto(`${base}/sites/report/${town}/${id}`);
      const status = page.locator('dt').filter({ hasText: /^Development status$/ }).locator('..').locator('dd');
      await status.waitFor(); assert.equal(await status.textContent(), expected);
    }
    console.log(`PASS: all ${total} report measurements match; ${eligible} measured parcels at or below 5%; binary statuses, exact boundary, missing-data handling, existing exclusions, both-page persistence and report status verified.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
