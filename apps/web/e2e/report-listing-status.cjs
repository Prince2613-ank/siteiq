const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const lots = JSON.parse(fs.readFileSync(path.join(root, 'apps/web/public/geojson/listing_check.json'), 'utf8')).lots;
const properties = JSON.parse(fs.readFileSync(path.join(root, 'apps/web/public/geojson/parcels_250m.geojson'), 'utf8')).features.map(f => f.properties);
const group = p => {
  const listing = lots[`${p.town}|${p.parcel_id}`];
  if (listing?.status && listing.status !== 'Not listed') return 'Listed';
  return Object.values(listing?.links || {}).some(link => /^https?:\/\//i.test(link)) ? 'Not listed' : 'Not listed/Not found';
};
const counts = {};
for (const p of properties) counts[group(p)] = (counts[group(p)] || 0) + 1;
assert.deepEqual(counts, { Listed: 9, 'Not listed': 530, 'Not listed/Not found': 227 });
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const base = process.env.SITEIQ_URL || 'http://127.0.0.1:5173';
    const examples = [properties.find(p => p.town === 'SALISBURY' && p.parcel_id === '11-22'),
      properties.find(p => group(p) === 'Not listed'), properties.find(p => group(p) === 'Listed')];
    for (const p of examples) {
      await page.goto(`${base}/sites/report/${p.town}/${encodeURIComponent(p.parcel_id)}`);
      await page.locator('[data-listing-status]').waitFor();
      const label = group(p) === 'Listed' ? lots[`${p.town}|${p.parcel_id}`].status : group(p);
      assert.equal(await page.locator('[data-listing-status]').textContent(), label);
      const section = page.getByRole('heading', { name: /^Listing & [Hh]istory$/i }).locator('..');
      const value = section.locator('dt').filter({ hasText: /^Listing status$/ }).locator('..').locator('dd');
      assert.equal(await value.textContent(), label);
      // The PDF reads these same report tags and section fields from the DOM.
      assert.ok((await page.locator('.parcel-report-content').textContent()).includes(label));
    }
    console.log('PASS: Listed, Not listed and Not listed/Not found remain distinct in report badges and export content; all 766 listing groups reconcile to 9/530/227.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
