const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const api = {};
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(root, 'apps/web/src/utils/parcelFormatters.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(api);
const history = p => api.getListingAttempts(p.zillow_past_attempt, p.zillow_link, p.redfin_past_attempt, p.redfin_link, p.past_listing_attempt);
assert.equal(history({ past_listing_attempt: 'No unsold past listing (Redfin)' }).length, 0);
assert.equal(history({ past_listing_attempt: 'Not checked (no Redfin page)' }).length, 0);
assert.equal(history({ past_listing_attempt: 'Sold 8 Jun 2026 ($957,000)' })[0].source, 'Redfin');
assert.equal(history({ redfin_past_attempt: 'Listed 1 Jan 2020', past_listing_attempt: 'Listed 1 Jan 2020' }).length, 1);
const lots = JSON.parse(fs.readFileSync(path.join(root, 'apps/web/public/geojson/listing_check.json'), 'utf8')).lots;
const parcels = JSON.parse(fs.readFileSync(path.join(root, 'apps/web/public/geojson/parcels_250m.geojson'), 'utf8')).features.map(f => f.properties);
const offMarket = parcels.filter(p => {
  const listing = lots[`${p.town}|${p.parcel_id}`];
  return listing?.status === 'Not listed' && Object.values(listing.links || {}).some(url => /^https?:\/\//i.test(url));
});
assert.equal(offMarket.length, 530);
assert.equal(offMarket.filter(p => history(p).length === 0).length, 502);
const sold = offMarket.filter(p => /^sold\b/i.test(p.past_listing_attempt || ''));
assert.equal(sold.length, 4);
assert.ok(sold.every(p => history(p).some(h => h.text === p.past_listing_attempt)));
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${process.env.SITEIQ_URL || 'http://127.0.0.1:5173'}/sites`);
    await page.locator('[data-parcel-rank]').first().waitFor();
    await page.getByRole('combobox', { name: 'Rows per page', exact: true }).selectOption('0');
    await page.getByRole('combobox', { name: 'Listing status', exact: true }).selectOption('NOT_LISTED');
    assert.equal(await page.locator('tbody tr[tabindex="0"]').count(), 530);
    assert.equal(await page.getByText('No history', { exact: true }).count(), 502);
    assert.equal(await page.getByText('Sale history', { exact: true }).count(), 4);
    for (const p of sold) {
      const row = page.locator('tbody tr[tabindex="0"]').filter({ has: page.getByText(`ID: ${p.parcel_id}`, { exact: true }) });
      assert.equal(await row.getByText('Sale history', { exact: true }).getAttribute('title'), `Redfin: ${p.past_listing_attempt}`);
    }
    console.log('PASS: all 530 off-market rows reconcile to 502 No history / 28 history; all four sale entries display Sale history with full dates and details.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
