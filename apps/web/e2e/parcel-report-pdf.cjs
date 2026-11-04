const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const base = process.env.SITEIQ_URL || 'http://127.0.0.1:5173';
const output = path.join(root, 'tmp/pdfs');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/sites`);
    await page.locator('tbody tr[tabindex="0"]').first().waitFor();
    await page.locator('tbody tr[tabindex="0"]').first().click();
    await page.waitForURL('**/sites/report/**');
    const highestRanked = page.url();
    const reports = [highestRanked, `${base}/sites/report/AMESBURY/42-15`, `${base}/sites/report/AMESBURY/FEE`, `${base}/sites/report/SEABROOK/10-10-0`];
    const manifest = [];
    for (const [index, url] of reports.entries()) {
      await page.goto(url);
      const exportButton = page.getByRole('button', { name: 'Export PDF', exact: true });
      await page.locator('.report-property-heading h1').waitFor();
      assert.equal(await exportButton.isEnabled(), true);
      assert.equal(await page.getByRole('heading', { name: 'Property links', exact: true }).count(), 0);
      assert.equal(await page.getByRole('heading', { name: 'Screening', exact: true }).count(), 0);
      assert.equal(await page.getByRole('heading', { name: 'Mortgage & restrictions', exact: true }).count(), 0);
      for (const label of ['Open mortgage', 'Leases, easements & restrictions']) {
        const fields = page.locator('dt').filter({ hasText: new RegExp(`^${label}$`) });
        assert.equal(await fields.count(), await page.locator('.report-loan-section dt').filter({ hasText: new RegExp(`^${label}$`) }).count(), `${label} must be inside Loan information`);
      }
      assert.match(await page.locator('.report-loan-section > h2 + [data-report-description]').textContent(), /Southern Essex Registry of Deeds \(salemdeeds.com\).*loans recorded only under the owner’s name may not appear/);
      assert.equal(await page.locator('.report-property-links').count(), 0);
      await page.getByRole('button', { name: 'Copy link', exact: true }).click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), url);
      await page.getByRole('button', { name: 'Link copied', exact: true }).waitFor();
      const expected = await page.locator('.parcel-report-content').evaluate(article => ({
        title: article.querySelector('h1').textContent,
        sections: [...article.querySelectorAll('.report-section h2')].map(heading => heading.textContent),
        fields: [...article.querySelectorAll('.report-section dl > div')].map(row => [row.querySelector('dt').textContent, row.querySelector('dd').textContent]),
        links: [...article.querySelectorAll('.report-listing-links a')].map(link => link.href),
      }));
      await page.locator('.parcel-report-map .leaflet-tile-loaded').first().waitFor();
      if (url.includes('/SEABROOK/')) {
        const tileUrls = await page.locator('.parcel-report-map img.leaflet-tile').evaluateAll(images => images.map(image => image.src));
        assert.ok(tileUrls.some(url => url.includes('/tile/19/')), 'Use available level-19 World Imagery when zoomed in');
        assert.ok(tileUrls.every(url => !url.includes('/tile/20/')), 'Do not export the unavailable level-20 imagery tiles');
      }
      await page.locator('.parcel-report-map').screenshot({ path: path.join(output, `report-map-${index + 1}.png`) });
      const downloadEvent = page.waitForEvent('download');
      await exportButton.click();
      const download = await downloadEvent;
      assert.match(download.suggestedFilename(), /^SiteIQ-.+\.pdf$/);
      const file = path.join(output, download.suggestedFilename());
      await download.saveAs(file);
      assert.equal(await download.failure(), null);
      const bytes = fs.readFileSync(file);
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      assert.ok(bytes.length > 10000, 'PDF must include the report and map');
      assert.ok(!bytes.includes(Buffer.from(url)), 'PDF must not contain the property report URL, including metadata and link annotations');
      manifest.push({ file, url, ...expected });
      assert.equal(await exportButton.isEnabled(), true);
      if (index === 0) {
        await page.screenshot({ path: path.join(output, 'report-export-desktop.png') });
        await page.setViewportSize({ width: 390, height: 844 });
        await exportButton.scrollIntoViewIfNeeded();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await exportButton.isVisible(), true);
        await page.screenshot({ path: path.join(output, 'report-export-mobile.png') });
        await page.setViewportSize({ width: 1440, height: 1000 });
      }
    }
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
    // Do not silently replace the requested aerial map with a blank diagram.
    await page.route('**/MapServer/tile/**', route => route.abort());
    await page.goto(highestRanked);
    await page.locator('.report-property-heading h1').waitFor();
    await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Aerial imagery' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Export PDF', exact: true }).isEnabled(), true);
    await page.unroute('**/MapServer/tile/**');
    // An unloaded report must not export a previous property's information.
    await page.route('**/reports/index.json', route => route.abort());
    await page.goto(`${base}/sites/report/NO-TOWN/NO-PARCEL`);
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Export PDF', exact: true }).isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log('PASS: four property PDFs with MA/NH aerial sources, no embedded report URLs, copied links, safe filenames, imagery failure/retry guards, desktop/mobile controls.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
