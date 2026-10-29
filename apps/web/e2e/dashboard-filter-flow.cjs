// Run against the local Vite app: SITEIQ_URL=http://localhost:5174 node ...
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const baseURL = process.env.SITEIQ_URL || 'http://localhost:5174';
const load = file => JSON.parse(fs.readFileSync(path.join(root, 'apps/web/public', file), 'utf8'));
const screening = {};
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(root, 'apps/web/src/utils/parcelScreening.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText)(screening);
const records = load('geojson/parcels_250m.geojson').features.map(f => ({ ...f.properties, ...screening.screenParcel(f.properties) }));
const listings = load('geojson/listing_check.json').lots;
const identity = p => `${p.town.trim().toUpperCase()}|${p.parcel_id.trim()}`;
const listingCategory = p => {
  const listing = listings[identity(p)];
  if (listing?.status && listing.status !== 'Not listed') return 'Listed';
  return Object.values(listing?.links || {}).some(url => /^https?:\/\//i.test(url)) ? 'Not listed' : 'No links';
};
const residential = p => ['6R', 'R1', 'R2', 'R8', 'R-8', 'R20', 'R-20', 'R40', 'RES', 'RESIDNTL'].includes(p.zoning);
const count = locator => locator.textContent().then(text => Number(text.match(/\((\d+)\)\s*$/)[1]));

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseURL);
    const screeningGroup = page.getByRole('group', { name: 'Screening results', exact: true });
    await screeningGroup.getByRole('button', { name: 'All (766)', exact: true }).waitFor();
    const paths = page.locator('.dashboard-parcel-overlay');
    assert.equal(await paths.count(), 766);
    assert.ok(Number(await paths.first().getAttribute('fill-opacity')) > 0);
    assert.equal(await page.getByRole('combobox', { name: 'Owner type', exact: true }).count(), 0);
    const roadsPane = page.locator('.leaflet-dashboard-roads-pane');
    assert.equal(await roadsPane.evaluate(el => getComputedStyle(el).zIndex), '450');
    assert.equal(await roadsPane.evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    assert.ok(await roadsPane.locator('.dashboard-road-overlay').count() > 0);
    const wetlands = page.getByRole('combobox', { name: 'Wetland coverage', exact: true });
    assert.equal(await wetlands.locator('option').filter({ hasText: 'Unknown' }).count(), 0);
    const wetlandCounts = await wetlands.locator('option').allTextContents();
    assert.ok(wetlandCounts.every(text => /\(\d+\)$/.test(text)));
    assert.equal(wetlandCounts.slice(1).reduce((sum, text) => sum + Number(text.match(/\((\d+)\)$/)[1]), 0), 766);

    const listingGroup = page.getByRole('group', { name: 'Listing status', exact: true });
    let subtotal = 0;
    for (const label of ['Listed', 'Not listed', 'No links']) {
      const expected = records.filter(p => listingCategory(p) === label).length;
      assert.equal(await count(listingGroup.getByRole('button', { name: new RegExp(`^${label} \\(`) })), expected);
      subtotal += expected;
    }
    assert.equal(subtotal, 766);
    assert.equal(await count(listingGroup.getByRole('button', { name: /^All \(/ })), 766);
    const initialSnapshot = await page.evaluate(() => JSON.parse(sessionStorage.getItem('siteiq:view:v1:dashboard')));

    const groups = page.getByRole('group', { name: 'Zoning groups', exact: true });
    assert.equal(await groups.getByRole('button').count(), 6);
    assert.equal(await page.getByRole('group', { name: 'Zoning district', exact: true }).count(), 0);
    assert.equal(await page.locator('.dashboard-zoning-columns').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1);
    await groups.getByRole('button', { name: /^Residential \(/ }).click();
    const residentialRecords = records.filter(residential);
    assert.equal(await paths.count(), 766);
    const districts = page.getByRole('group', { name: 'Zoning district', exact: true });
    const left = await groups.boundingBox();
    const right = await districts.boundingBox();
    assert.ok(right.x > left.x + left.width, 'Districts must be a separate column beside groups');
    assert.ok(Math.abs(right.y - left.y) < 2, 'Column headings must align');
    assert.equal(await districts.getByRole('button', { name: /^All districts/ }).count(), 0);
    assert.equal(await districts.locator('[aria-pressed="true"]').count(), 0);
    const development = page.getByRole('group', { name: 'Development status', exact: true });
    await development.getByRole('button', { name: /^Vacant \(/ }).click();
    let expected = records.filter(p => p.status === 'Vacant');
    assert.equal(await paths.count(), expected.length);
    const r1 = districts.getByRole('button', { name: /^Low-Density Residential \(R1\)/ });
    assert.equal(await count(r1), expected.filter(p => p.zoning === 'R1').length);
    await r1.click();
    expected = expected.filter(p => p.zoning === 'R1');
    assert.equal(await paths.count(), expected.length);
    const r2 = districts.getByRole('button', { name: /^Medium-Density Residential \(R2\)/ });
    assert.equal(await count(r2), residentialRecords.filter(p => p.status === 'Vacant' && p.zoning === 'R2').length);
    await r2.click();
    expected = residentialRecords.filter(p => p.status === 'Vacant' && ['R1', 'R2'].includes(p.zoning));
    assert.equal(await paths.count(), expected.length);
    // Opening another group retains R1/R2 without applying its districts.
    const commercialButton = groups.getByRole('button', { name: /^Commercial \(/ });
    await commercialButton.click();
    assert.equal(await r1.count(), 0);
    assert.equal(await r2.count(), 0);
    assert.equal(await groups.locator('[aria-expanded="true"]').count(), 1);
    assert.equal(await groups.getByRole('button', { name: /^Residential \(/ }).locator('.dashboard-zoning-selection-badge').textContent(), '2 selected');
    assert.equal(await paths.count(), expected.length);
    const c = districts.getByRole('button', { name: /^Commercial \/ General Commercial \(C\)/ });
    assert.equal(await count(c), records.filter(p => p.status === 'Vacant' && p.zoning === 'C').length);
    await c.click();
    assert.equal(await paths.count(), expected.length + records.filter(p => p.status === 'Vacant' && p.zoning === 'C').length);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.dashboard-parcel-overlay').length > 0);
    assert.equal(await r1.count(), 0);
    assert.equal(await r2.count(), 0);
    assert.equal(await c.getAttribute('aria-pressed'), 'true');
    assert.equal(await groups.getByRole('button', { name: /^Residential \(/ }).getAttribute('aria-expanded'), 'false');
    assert.equal(await commercialButton.getAttribute('aria-expanded'), 'true');
    await page.screenshot({ path: path.join(root, 'scratch/zoning-columns-desktop.png') });
    // Closing a panel keeps its selected district applied, then explicitly clear it.
    await commercialButton.click();
    assert.equal(await districts.count(), 0);
    assert.equal(await paths.count(), expected.length + records.filter(p => p.status === 'Vacant' && p.zoning === 'C').length);
    await commercialButton.click();
    assert.equal(await c.getAttribute('aria-pressed'), 'true');
    await c.click();
    await groups.getByRole('button', { name: /^Residential \(/ }).click();
    assert.equal(await groups.locator('[aria-expanded="true"]').count(), 1);
    assert.equal(await paths.count(), expected.length);
    assert.equal(await r1.getAttribute('aria-pressed'), 'true');
    assert.equal(await r2.getAttribute('aria-pressed'), 'true');
    assert.equal(await c.count(), 0);
    const owners = page.getByRole('group', { name: 'Owner type', exact: true });
    assert.equal(await count(owners.getByRole('button', { name: /^Individual \(/ })), expected.filter(p => p.owner_type === 'Individual').length);
    await owners.getByRole('button', { name: /^Individual \(/ }).click();
    await page.getByRole('combobox', { name: 'Years owned', exact: true }).selectOption('20_30');
    expected = expected.filter(p => p.owner_type === 'Individual' && p.years_owned != null && p.years_owned >= 20 && p.years_owned < 30);
    assert.equal(await paths.count(), expected.length);
    await page.reload();
    await page.getByRole('button', { name: 'Reset filters', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('[role="status"]'));
    assert.equal(await paths.count(), expected.length);
    assert.equal(await r1.getAttribute('aria-pressed'), 'true');
    assert.equal(await r2.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('combobox', { name: 'Years owned', exact: true }).inputValue(), '20_30');
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    assert.equal(await paths.count(), 766);
    assert.equal(await districts.count(), 0);
    assert.equal(await groups.getByRole('button').count(), 6);
    const resetSnapshot = await page.evaluate(() => JSON.parse(sessionStorage.getItem('siteiq:view:v1:dashboard')));
    assert.deepEqual(resetSnapshot.selectedZoningGroups, []);
    assert.deepEqual(resetSnapshot.selectedZonings, []);
    assert.equal(resetSnapshot.selectedYearsOwned, 'ALL');
    assert.equal(resetSnapshot.parcel, '');
    assert.equal(resetSnapshot.zoom, initialSnapshot.zoom);
    assert.ok(Math.abs(resetSnapshot.center[0] - initialSnapshot.center[0]) < 0.00001, JSON.stringify({ initialSnapshot, resetSnapshot }));
    assert.ok(Math.abs(resetSnapshot.center[1] - initialSnapshot.center[1]) < 0.00001, JSON.stringify({ initialSnapshot, resetSnapshot }));

    // No-link cards must still focus their actual parcel and lead to its report.
    await listingGroup.getByRole('button', { name: /^No links \(/ }).click();
    const expectedNoLinks = records.filter(p => listingCategory(p) === 'No links');
    assert.equal(await paths.count(), expectedNoLinks.length);
    assert.equal(await page.locator('.dashboard-listing-record').count(), expectedNoLinks.length);
    await page.locator('.dashboard-listing-record button').first().click();
    await page.getByRole('button', { name: 'Details', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await page.locator('.dashboard-parcel-card').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.dashboard-parcel-card').count(), 0);
    assert.equal(await paths.count(), 766);
    await page.setViewportSize({ width: 390, height: 844 });
    await groups.getByRole('button', { name: /^Residential \(/ }).click();
    assert.equal(await paths.count(), 766);
    await districts.getByRole('button', { name: /^Low-Density Residential \(R1\)/ }).click();
    assert.equal(await paths.count(), records.filter(p => p.zoning === 'R1').length);
    await districts.getByRole('button', { name: /^Low-Density Residential \(R1\)/ }).click();
    assert.equal(await paths.count(), 766);
    assert.equal(await districts.locator('[aria-pressed="true"]').count(), 0);
    const mobileGroups = await groups.boundingBox();
    const mobileDistricts = await districts.boundingBox();
    assert.ok(mobileDistricts.y >= mobileGroups.y + mobileGroups.height, 'Mobile columns must stack');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(root, 'scratch/dashboard-filter-flow-mobile.png') });

    // Fresh report framing fits the property, while zoom-out stays limited.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${baseURL}/sites/report/SALISBURY/19-56`);
    await page.locator('.report-subject-boundary').waitFor();
    const zoom = await page.evaluate(() => JSON.parse(sessionStorage.getItem('siteiq:view:v1:report:SALISBURY|19-56:map:v2')).zoom);
    assert.ok(zoom > 15, `Small property should start closer than the broad view (got ${zoom})`);
    const mapRect = await page.locator('.parcel-report-map').boundingBox();
    const propertyRect = await page.locator('.report-subject-boundary').boundingBox();
    assert.ok(Math.abs(propertyRect.x + propertyRect.width / 2 - mapRect.x - mapRect.width / 2) < 2);
    assert.ok(Math.abs(propertyRect.y + propertyRect.height / 2 - mapRect.y - mapRect.height / 2) < 2);
    const minus = page.locator('.parcel-report-map .leaflet-control-zoom-out');
    for (let z = zoom; z > 15; z--) await minus.click();
    assert.equal(await minus.getAttribute('aria-disabled'), 'true');
    assert.deepEqual(await page.locator('.leaflet-control-scale-line').allTextContents(), ['300 m', '1000 ft']);
    assert.deepEqual(errors, []);
    console.log('PASS: 766 partitioned listing counts; default fills; road stacking; wetland counts; group/district/owner/tenure intersections; refresh; one-click reset; no-link popup; mobile; property report framing and zoom limit.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
