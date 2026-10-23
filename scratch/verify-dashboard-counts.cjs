const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const audit = require('./count-audit.json');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto('http://localhost:5173');
    await page.locator('.dashboard-directory > div').first().waitFor();
    const results = page.locator('.dashboard-sidebar').getByText(/3\. Parcel results/i);
    assert.match(await results.innerText(), new RegExp(`\\(${audit.total}\\)`));
    for (const group of ['Land category', 'Development status']) {
      const section = page.locator('.dashboard-legend-group').filter({ has: page.getByRole('heading', { name: group, exact: true }) });
      const values = await section.locator('button').allTextContents();
      const total = values.reduce((sum, value) => sum + Number(value.match(/\((\d+)\)/)[1]), 0);
      assert.equal(total, group === 'Land category' ? audit.total - audit.legend.Industrial : audit.total);
      console.log(`${group}: ${total} parcels`);
    }
    for (const [label, count] of Object.entries(audit.legend)) {
      if (label === 'Industrial') continue; // Industrial is now a visibility layer, tested separately.
      const entry = page.getByTitle(`Filter by ${label} (${count})`, { exact: true });
      await entry.waitFor();
      assert.match(await entry.innerText(), new RegExp(`\\(${count}\\)`));
      await entry.click();
      await page.waitForTimeout(100);
      assert.match(await results.innerText(), new RegExp(`\\(${count}\\)`));
      console.log(`${label}: legend and filter both ${count}`);
      await entry.click();
    }
    for (const [label, count] of [['Qualified', audit.screening.Y], ['Excluded', audit.screening.N]]) {
      await page.getByRole('button', { name: new RegExp(`${label} \\(${count}\\)`) }).click();
      assert.match(await results.innerText(), new RegExp(`\\(${count}\\)`));
      console.log(`${label}: ${count}`);
      await page.getByRole('button', { name: /^All \(/ }).click();
    }
    for (const [road, count] of Object.entries(audit.roads)) {
      const entry = page.locator('.dashboard-filter-card').getByText(road, { exact: true });
      await entry.click();
      assert.match(await results.innerText(), new RegExp(`\\(${count}\\)`));
      console.log(`${road}: ${count}`);
      await entry.click();
    }
    console.log(`All checks passed against ${audit.total} source features.`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
