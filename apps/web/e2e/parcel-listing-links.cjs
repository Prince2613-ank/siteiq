const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../../..');
const api = {};
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(root, 'apps/web/src/utils/parcelListing.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(api);
const links = api.parcelListingLinks;
assert.equal(api.listingSourceLogo('https://www.zillow.com/homedetails/1/'), '/source-logos/zillow.ico');
assert.equal(api.listingSourceLogo('https://notzillow.com/'), undefined);
assert.deepEqual(links({ links: { Zillow: 'https://example.com/p' }, proof: 'https://example.com/p' }, { zillow_link: 'https://example.com/p' }), [{ label: 'Zillow', href: 'https://example.com/p' }]);
assert.deepEqual(links({ links: { Bad: 'javascript:alert(1)', Missing: 'No page' } }), []);
assert.deepEqual(links(null, { redfin_link: ' https://example.com/redfin ' }), [{ label: 'Redfin', href: 'https://example.com/redfin' }]);
const read = file => JSON.parse(fs.readFileSync(path.join(root, 'apps/web/public/geojson', file), 'utf8'));
const listings = read('listing_check.json').lots;
const parcels = read('parcels_250m.geojson').features.map(f => f.properties);
let count = 0, noLinks = 0;
for (const p of parcels) {
  const result = links(listings[`${p.town}|${p.parcel_id}`], p);
  assert.equal(result.length, new Set(result.map(link => new URL(link.href).href.replace(/\/$/, ''))).size);
  assert.ok(result.every(link => /^https?:\/\//i.test(link.href)));
  assert.ok(result.every(link => api.listingSourceLogo(link.href)), 'Every recorded listing source has a logo');
  count += result.length;
  noLinks += result.length === 0;
}
assert.equal(noLinks, 227);
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    for (const id of ['18-21', '18-125', '11-22']) {
      const p = parcels.find(p => p.town === 'SALISBURY' && p.parcel_id === id);
      const expected = links(listings[`SALISBURY|${id}`], p);
      await page.goto(`${process.env.SITEIQ_URL || 'http://127.0.0.1:5173'}/sites/report/SALISBURY/${id}`);
      const section = page.getByRole('heading', { name: /^Listing & [Hh]istory$/i }).locator('..');
      await section.waitFor();
      assert.deepEqual(await section.locator('a').evaluateAll(elements => elements.map(a => ({ href: a.href, target: a.target, rel: a.rel }))), expected.map(link => ({ href: new URL(link.href).href, target: '_blank', rel: 'noopener noreferrer' })));
      await page.waitForFunction(() => [...document.querySelectorAll('.report-listing-links img')].every(img => img.complete && img.naturalWidth > 0));
      assert.equal(await section.locator('a > img:first-child').count(), expected.length, 'Show each official logo before its link label');
      if (!expected.length) await section.getByText('No listing links found.', { exact: true }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      await section.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (id === '18-21') await section.screenshot({ path: path.join(root, 'tmp/listing-links-mobile.png') });
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    console.log(`PASS: all 766 parcel sources checked (${count} unique property links; ${noLinks} parcels without links); off-market, listed, no-links and mobile report views verified.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
