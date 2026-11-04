const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = process.env.SITEIQ_URL || 'http://127.0.0.1:5173';
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/sites/report/SALISBURY/19-56`);
    await page.locator('.report-property-heading h1').waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Screening', exact: true }).count(), 0);
    assert.equal(await page.locator('dt').filter({ hasText: /^Building coverage$/ }).count(), 0);
    assert.equal(await page.locator('.report-tag-qualified').count(), 1, 'Preserve qualification badge');
    const nav = page.getByRole('navigation', { name: 'Primary navigation' });
    assert.deepEqual(await nav.getByRole('link').allTextContents(), ['Dashboard', 'Sites', 'Screening Logic']);
    await nav.getByRole('link', { name: 'Screening Logic', exact: true }).click();
    await page.waitForURL('**/screening-logic');
    await page.getByRole('heading', { name: 'Screening Logic', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'What does Qualified mean?', exact: true }).count(), 0);
    assert.deepEqual(await page.locator('main h2').allTextContents(), ['Why is a parcel Excluded?', 'What does the 5% rule mean?', 'Screening, scores and ranks']);
    const totals = page.getByRole('region', { name: 'Current screening totals' });
    await totals.waitFor();
    assert.match(await totals.textContent(), /All parcels766Qualified213Excluded553/);
    const counts = await page.locator('tbody tr > td:last-child').allTextContents();
    assert.equal(counts.reduce((sum, value) => sum + Number(value), 0), 553);
    assert.match(await page.locator('main').textContent(), /building footprint ÷ matching parcel area × 100/);
    await page.screenshot({ path: path.resolve(__dirname, '../../../tmp/screening-report-desktop.png'), fullPage: true });
    await page.reload(); await totals.waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Mobile page should not overflow');
    await page.screenshot({ path: path.resolve(__dirname, '../../../tmp/screening-report-mobile.png'), fullPage: true });
    await page.route('**/geojson/parcel_building_coverage.json', route => route.abort());
    await page.reload(); await page.getByRole('alert').waitFor();
    assert.equal(await totals.count(), 0, 'Do not show invented totals when data fails');
    assert.deepEqual(errors, []);
    console.log('PASS: Screening Logic navigation, section removal/order, live 766/213/553 totals, exclusion reconciliation, refresh, mobile, error state and removal from parcel reports.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
