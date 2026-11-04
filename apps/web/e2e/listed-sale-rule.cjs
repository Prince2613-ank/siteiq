const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { attachCoverage, isBrowsable } = require('./parcel-coverage-fixture.cjs');
const root = path.resolve(__dirname, '../../..');
const base = process.env.SITEIQ_URL || 'http://127.0.0.1:5173';
const read = name => JSON.parse(fs.readFileSync(path.join(root, 'apps/web/public/geojson', name), 'utf8'));
function api(name) {
  const exports = {};
  new Function('exports', ts.transpileModule(fs.readFileSync(path.join(root, 'apps/web/src/utils', name), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText)(exports);
  return exports;
}
const { isListedForSale } = api('parcelListing.ts');
const { screenParcel } = api('parcelScreening.ts');
const { scoreParcel } = api('parcelScoring.ts');
for (const status of ['Listed', 'Listed - one unit only', 'Listed - condo units only', 'Under agreement (pending)', 'Pending', 'For sale', ' ACTIVE ']) {
  assert.equal(isListedForSale(status), true, status);
}
for (const status of [undefined, null, '', 'Not listed', 'Off market', 'Sold', 'Withdrawn', 'Listing removed']) {
  assert.equal(isListedForSale(status), false, String(status));
}
const parcel = { category: 'Developable', status: 'Vacant', usable_acres: 10, years_owned: 45, life_event_signal: 'Estate record for owner or a family member' };
assert.equal(screenParcel(parcel).keep, 'Y');
assert.ok(scoreParcel(parcel).score > 0);
assert.equal(screenParcel({ ...parcel, listed_for_sale: true }).keep, 'N');
assert.equal(screenParcel({ ...parcel, listed_for_sale: true }).drop_reason, 'Listed for sale');
assert.equal(scoreParcel({ ...parcel, listed_for_sale: true }).score, 0);
assert.equal(scoreParcel({ ...parcel, listed_for_sale: true }).exclusionReason, 'Listed for sale');
assert.ok(scoreParcel({ ...parcel, listed_for_sale: false }).score > 0, 'Off-market parcels retain their normal score');

const source = read('parcels_250m.geojson').features.map(f => attachCoverage(f.properties));
const listings = read('listing_check.json');
const key = p => `${p.town}|${p.parcel_id}`;
const listed = source.filter(p => listings.lots[key(p)]?.status && listings.lots[key(p)].status !== 'Not listed');
const visible = source.filter(isBrowsable);
const visibleListed = visible.filter(p => listed.includes(p));
const qualified = visible.filter(p => !listed.includes(p) && screenParcel(p).keep === 'Y');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/sites`);
    const screening = page.getByRole('combobox', { name: 'Screening results', exact: true });
    await screening.getByRole('option', { name: `Qualified (${qualified.length})`, exact: true }).waitFor({ state: 'attached' });
    await page.getByRole('combobox', { name: 'Rows per page' }).selectOption('0');
    await page.getByRole('combobox', { name: 'Listing status', exact: true }).selectOption('LISTED');
    const rows = page.locator('tbody tr[tabindex="0"]');
    assert.equal(await rows.count(), visibleListed.length);
    assert.equal(await rows.getByRole('button', { name: 'View scoring details: Score 0 out of 100', exact: true }).count(), visibleListed.length);
    assert.ok((await rows.allTextContents()).every(text => text.includes('Excluded')));
    await rows.first().locator('.parcel-score-badge').click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await dialog.locator('.parcel-scoring-total').textContent(), '0/100');
    assert.ok((await dialog.textContent()).includes('score is fixed at 0'));
    await page.getByRole('button', { name: 'Close scoring details' }).click();
    await screening.selectOption('Y');
    assert.equal(await rows.count(), 0, 'Listed + Qualified must have no results');

    await page.goto(`${base}/`);
    const screenGroup = page.getByRole('group', { name: 'Screening results', exact: true });
    await screenGroup.getByRole('button', { name: `Qualified (${qualified.length})`, exact: true }).waitFor();
    await page.getByRole('group', { name: 'Listing status', exact: true }).getByRole('button', { name: /^Listed \(/ }).click();
    assert.equal(await page.locator('.dashboard-parcel-overlay').count(), visibleListed.length);
    await screenGroup.getByRole('button', { name: 'Qualified (0)', exact: true }).click();
    assert.equal(await page.locator('.dashboard-parcel-overlay').count(), 0);

    // Report screening must use the current listing asset, including archived Mixed records.
    for (const p of listed) {
      await page.goto(`${base}/sites/report/${encodeURIComponent(p.town)}/${encodeURIComponent(p.parcel_id)}`);
      await page.locator('.report-property-heading h1').waitFor();
      const section = page.getByRole('heading', { name: 'Screening', exact: true }).locator('..');
      assert.match(await section.textContent(), /Excluded/);
      assert.match(await section.textContent(), /Listed for sale/);
    }
    // A removed listing must not remain excluded because of a cached report snapshot.
    const offMarket = structuredClone(listings);
    offMarket.lots['SALISBURY|23-39'].status = 'Not listed';
    await page.route('**/geojson/listing_check.json', route => route.fulfill({ json: offMarket }));
    await page.goto(`${base}/sites/report/SALISBURY/23-39`);
    await page.locator('.report-property-heading h1').waitFor();
    assert.match(await page.getByRole('heading', { name: 'Screening', exact: true }).locator('..').textContent(), /Qualified/);
    await page.unroute('**/geojson/listing_check.json');
    await page.route('**/geojson/listing_check.json', route => route.abort());
    await page.goto(`${base}/sites`);
    await page.getByRole('alert').filter({ hasText: 'Parcel data could not be loaded' }).waitFor();
    assert.equal(await rows.count(), 0, 'Do not classify parcels without required listing checks');
    assert.deepEqual(errors, []);
    console.log(`PASS: active/partial/pending status rules; ${visibleListed.length} visible listings score zero; Listed + Qualified empty on both pages; all ${listed.length} listed reports excluded; off-market report recovery and missing-feed handling.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
