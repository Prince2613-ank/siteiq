const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, 'apps/web/public/geojson', name), 'utf8'));
const api = {};
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(root, 'apps/web/src/utils/parcelScreening.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(api);
const { attachCoverage } = require('./parcel-coverage-fixture.cjs');
const listings = read('listing_check.json').lots;
const parcels = read('parcels_250m.geojson').features.map(({ properties }) => {
  const p = attachCoverage(properties);
  const status = listings[`${p.town}|${p.parcel_id}`]?.status;
  p.listed_for_sale = /^(listed\b|for sale\b|active\b|under agreement\b|pending\b)/i.test(status || '');
  return { ...p, ...api.screenParcel(p) };
});
assert.equal(parcels.length, 766);
assert.equal(parcels.filter(p => p.keep === 'Y').length, 213);
assert.equal(parcels.filter(p => p.keep === 'N').length, 553);
assert.equal(parcels.filter(p => api.hasTownDevelopableReason(p.category_reason)).length, 53);
assert.equal(parcels.filter(p => api.hasTownDevelopableReason(p.category_reason) && p.keep === 'Y').length, 44);
for (const p of parcels) {
  assert.ok(p.source_land_category, 'Original spreadsheet category retained');
  if (api.hasTownDevelopableReason(p.category_reason) && p.source_land_category !== 'Public land') assert.equal(p.category, 'Developable');
  if (api.hasTownDevelopableReason(p.category_reason) && p.keep === 'N') assert.ok([1, 3, 7, 10].includes(p.screening_rule), `${p.town}|${p.parcel_id}: explicit town statement must not be rejected for paving/wetland category`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const base = process.env.SITEIQ_URL || 'http://127.0.0.1:5173';
    await page.goto(`${base}/`);
    await page.getByRole('group', { name: 'Screening results', exact: true }).getByRole('button', { name: 'Qualified (213)', exact: true }).waitFor();
    await page.goto(`${base}/sites`);
    await page.getByRole('combobox', { name: 'Screening results', exact: true }).getByRole('option', { name: 'Qualified (213)', exact: true }).waitFor({ state: 'attached' });
    for (const [id, qualified] of [['10-27', true], ['10-82', true], ['23-41', true], ['18-125', false], ['19-110', false]]) {
      await page.goto(`${base}/sites/report/SALISBURY/${id}`);
      const section = page.getByRole('heading', { name: 'Screening', exact: true }).locator('..');
      await section.waitFor();
      assert.match(await section.textContent(), qualified ? /Qualified.*town records describe this land as developable/s : /Excluded/);
      const category = page.locator('dt').filter({ hasText: /^Land category$/ }).locator('..');
      assert.match(await category.textContent(), /Developable/);
    }
    console.log('PASS: all 766 categories reviewed; 53 town-developable statements, 44 Qualified / 9 independently excluded; Dashboard/Sites counts and five report decisions match.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
