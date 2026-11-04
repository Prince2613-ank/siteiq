const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:5174');
    await page.getByRole('group', { name: 'Listing status', exact: true }).getByRole('button', { name: /^Listed \(/ }).click();
    await page.locator('.dashboard-listing-record').first().locator('button').click();
    await page.locator('.dashboard-parcel-card').waitFor();

    // Hold the report request so the initial header can be compared with its loaded position.
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/reports/*.json', async route => { await gate; await route.continue(); });
    await page.evaluate(() => {
      window.navigationPaths = [];
      const original = history.pushState;
      history.pushState = function (...args) {
        window.navigationPaths.push(String(args[2]));
        return original.apply(this, args);
      };
    });
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    await page.waitForURL('**/sites/report/**');
    const reportURL = page.url();
    const back = page.getByRole('button', { name: 'Go back to map', exact: true });
    await back.waitFor();
    assert.match(await page.getByRole('status').textContent(), /Opening parcel report/);
    const loadingPosition = await back.boundingBox();
    const paths = await page.evaluate(() => window.navigationPaths);
    assert.equal(paths.length, 1);
    assert.match(paths[0], /^\/sites\/report\//);
    release();
    await page.locator('.parcel-report-content h1').waitFor();
    const loadedPosition = await back.boundingBox();
    assert.deepEqual(loadedPosition, loadingPosition);
    assert.ok(Math.abs(loadedPosition.x + loadedPosition.width / 2 - 720) < 1);
    await page.screenshot({ path: 'scratch/report-navigation-fixed.png' });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.unroute('**/reports/*.json');
    let releaseMobile;
    const mobileGate = new Promise(resolve => { releaseMobile = resolve; });
    await page.route('**/reports/*.json', async route => { await mobileGate; await route.continue(); });
    await page.reload();
    await back.waitFor();
    const mobileLoadingPosition = await back.boundingBox();
    releaseMobile();
    await page.locator('.parcel-report-content h1').waitFor();
    assert.deepEqual(await back.boundingBox(), mobileLoadingPosition);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 1440, height: 1000 });

    // Returning to Sites clears Dashboard origin and never reopens the report.
    await page.getByRole('button', { name: 'Sites', exact: true }).click();
    await page.waitForURL('**/sites');
    await page.getByRole('button', { name: /^View scoring details:/ }).first().waitFor();
    assert.equal(await back.count(), 0);
    assert.equal(await page.locator('.parcel-report-page').count(), 0);
    assert.equal(await page.evaluate(() => history.state.usr?.fromDashboard), undefined);
    await page.reload();
    await page.getByRole('button', { name: /^View scoring details:/ }).first().waitFor();
    assert.equal(await back.count(), 0);
    const firstRow = page.locator('tbody tr').filter({ has: page.locator('[data-parcel-rank]') }).first();
    await firstRow.click();
    await page.waitForURL('**/sites/report/**');
    await page.locator('.parcel-report-content h1').waitFor();
    assert.equal(await back.count(), 0);

    // A report entered from Dashboard still provides its direct map return.
    await page.goto('http://localhost:5174');
    await page.locator('.dashboard-parcel-card').waitFor();
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    await page.waitForURL(reportURL);
    await back.click();
    await page.locator('.dashboard-parcel-card').waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: direct report navigation, stable loading/header button, plain Sites return and refresh, Sites row report, Dashboard map return.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
