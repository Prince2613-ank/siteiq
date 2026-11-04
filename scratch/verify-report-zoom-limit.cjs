const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('http://localhost:5174/sites/report/AMESBURY/42-15');
    await page.locator('.parcel-report-map .leaflet-control-zoom-out').waitFor();
    await page.evaluate(() => sessionStorage.setItem('siteiq:view:v1:report:AMESBURY|42-15:map', JSON.stringify({ zoom: 10 })));
    await page.reload();
    const minus = page.locator('.parcel-report-map .leaflet-control-zoom-out');
    await minus.waitFor();
    assert.equal(await minus.getAttribute('aria-disabled'), 'true');
    const plus = page.locator('.parcel-report-map .leaflet-control-zoom-in');
    await plus.click();
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('siteiq:view:v1:report:AMESBURY|42-15:map')).zoom === 16);
    await minus.click();
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('siteiq:view:v1:report:AMESBURY|42-15:map')).zoom === 15);
    assert.equal(await minus.getAttribute('aria-disabled'), 'true');
    await page.locator('.parcel-report-map').hover();
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('siteiq:view:v1:report:AMESBURY|42-15:map')).zoom), 15);
    assert.deepEqual(await page.locator('.leaflet-control-scale-line').allTextContents(), ['300 m', '1000 ft']);
    await page.reload();
    await minus.waitFor();
    assert.equal(await minus.getAttribute('aria-disabled'), 'true');
    assert.deepEqual(await page.locator('.leaflet-control-scale-line').allTextContents(), ['300 m', '1000 ft']);
    await page.goto('http://localhost:5174/sites/report/SALISBURY/11-22');
    await minus.waitFor();
    assert.equal(await minus.getAttribute('aria-disabled'), 'true');
    assert.deepEqual(await page.locator('.leaflet-control-scale-line').allTextContents(), ['300 m', '1000 ft']);
    console.log('PASS: zoom-out stops at 300 m / 1000 ft; old saved zoom is corrected; wheel, buttons, refresh and the reported Salisbury parcel respect the limit.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
