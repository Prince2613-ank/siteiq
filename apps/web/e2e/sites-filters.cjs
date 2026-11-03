const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, 'apps/web/public/geojson', file), 'utf8'));
const screening = {};
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(root, 'apps/web/src/utils/parcelScreening.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText)(screening);
const loans = read('parcel_loans.json').parcels;
const records = read('parcels_250m.geojson').features.map(({ properties: p }) => ({
  ...p, ...screening.screenParcel(p), loan: loans[`${p.town.trim().toUpperCase()}|${p.parcel_id.trim()}`],
}));
const residential = p => ['6R', 'R1', 'R2', 'R8', 'R-8', 'R20', 'R-20', 'R40', 'RES', 'RESIDNTL'].includes(p.zoning);

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${process.env.SITEIQ_URL || 'http://127.0.0.1:5173'}/sites`);
    await page.getByRole('combobox', { name: 'Screening results', exact: true }).getByRole('option', { name: 'All (766)', exact: true }).waitFor({ state: 'attached' });
    await page.getByRole('combobox', { name: 'Rows per page' }).selectOption('0');
    const rows = page.locator('tbody tr');
    const reset = () => page.getByRole('button', { name: /Reset Filters/ }).click();
    const open = label => page.getByRole('button', { name: new RegExp(`^${label}:`) }).click();
    const close = () => page.keyboard.press('Escape');
    assert.equal(await rows.count(), 766);
    const arrows = await page.locator('.site-filter-select').evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundImage));
    assert.ok(arrows.every(arrow => arrow === arrows[0] && arrow.includes('svg')), 'All dropdowns must share the same chevron');
    assert.equal(await page.getByRole('checkbox').count(), 0);
    assert.equal(await page.getByRole('combobox', { name: 'Category', exact: true }).count(), 0);
    assert.equal(await page.getByRole('combobox', { name: 'Municipality', exact: true }).count(), 0);
    await open('Zoning');
    await page.getByRole('button', { name: /^Residential \(/ }).click();
    await close();
    assert.equal(await rows.count(), records.filter(residential).length);
    await open('Zoning');
    await page.getByRole('button', { name: /^Low-Density Residential \(R1\)/ }).click();
    await page.getByRole('button', { name: /^Medium-Density Residential \(R2\)/ }).click();
    await close();
    let expected = records.filter(p => ['R1', 'R2'].includes(p.zoning));
    assert.equal(await rows.count(), expected.length);
    await open('Zoning');
    await page.getByRole('button', { name: /^Commercial \(/ }).click();
    await close();
    await open('Zoning');
    await page.getByRole('button', { name: /^Commercial \/ General Commercial \(C\)/ }).click();
    await close();
    expected = records.filter(p => ['R1', 'R2', 'C'].includes(p.zoning));
    assert.equal(await rows.count(), expected.length);
    assert.equal(await page.getByRole('button', { name: /^Residential districts:/ }).count(), 0);
    await open('Zoning');
    assert.equal(await page.getByRole('group', { name: 'Residential districts', exact: true }).locator('button[aria-pressed="true"]').count(), 2);
    assert.equal(await page.locator('.site-filter-options--split .site-filter-color').count() > 6, true);
    const columns = await page.locator('.site-filter-options--split').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    assert.equal(columns, 2);
    const selectedZoningText = await page.locator('.site-filter-choice--zoning[aria-pressed="true"]').evaluateAll(elements =>
      elements.map(element => ({ color: getComputedStyle(element).color, weight: getComputedStyle(element).fontWeight })));
    assert.ok(selectedZoningText.length >= 3);
    assert.ok(selectedZoningText.every(style => style.color === 'rgb(15, 23, 42)' && style.weight === '700'), 'Selected zoning text must stay dark and bold on tinted backgrounds');
    await close();
    await page.getByRole('combobox', { name: 'Development status', exact: true }).selectOption('Vacant');
    expected = expected.filter(p => p.status === 'Vacant');
    assert.equal(await rows.count(), expected.length);
    const ownerValues = [...new Set(expected.map(p => p.owner_type?.trim() || 'Unknown'))].slice(0, 2);
    assert.equal(ownerValues.length, 2);
    await open('Owner type');
    for (const owner of ownerValues) await page.getByRole('group', { name: 'Owner type', exact: true }).getByRole('button').filter({ hasText: owner + ' (' }).click();
    await close();
    expected = expected.filter(p => ownerValues.includes(p.owner_type?.trim() || 'Unknown'));
    assert.equal(await page.getByRole('button', { name: 'Owner type: 2 selected', exact: true }).evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(15, 23, 42)');
    assert.equal(await rows.count(), expected.length);
    await open('Loan category');
    const options = page.getByRole('group', { name: 'Loan category', exact: true }).locator('button.site-filter-choice');
    await options.nth(0).click();
    await options.nth(1).click();
    await close();
    expected = expected.filter(p => ['No open loan - likely free & clear', 'Low leverage - strong equity'].includes(p.loan.loan_signal));
    assert.equal(await rows.count(), expected.length);
    await page.reload();
    await page.getByRole('button', { name: 'Loan category: 2 selected', exact: true }).waitFor();
    await page.waitForFunction(() => !document.body.textContent.includes('Loading'));
    assert.equal(await rows.count(), expected.length);
    await page.getByRole('button', { name: 'Owner type: 2 selected', exact: true }).waitFor();
    await reset();
    assert.equal(await rows.count(), 766);
    const yearsSelect = page.getByRole('combobox', { name: 'Years owned', exact: true });
    assert.equal(await yearsSelect.getAttribute('multiple'), null);
    await yearsSelect.selectOption('20_30');
    const tenureMatches = records.filter(p => p.years_owned != null && p.years_owned >= 20 && p.years_owned < 30);
    assert.equal(await rows.count(), tenureMatches.length);
    await page.reload();
    await yearsSelect.waitFor();
    await page.waitForFunction(() => !document.body.textContent.includes('Loading'));
    assert.equal(await yearsSelect.inputValue(), '20_30');
    assert.equal(await rows.count(), tenureMatches.length);
    await yearsSelect.selectOption('30_PLUS');
    assert.equal(await rows.count(), records.filter(p => p.years_owned != null && p.years_owned >= 30).length);
    await yearsSelect.selectOption('20_30');
    await page.getByRole('combobox', { name: 'Development status', exact: true }).selectOption('Vacant');
    assert.equal(await rows.count(), records.filter(p => p.status === 'Vacant' && p.years_owned != null && p.years_owned >= 20 && p.years_owned < 30).length);
    await reset();
    for (const [label, value, predicate] of [
      ['Screening results', 'Y', p => p.keep === 'Y'],
      ['Wetland coverage', 'LOW', p => p.wetland_pct > 0 && p.wetland_pct < 10],
    ]) {
      await page.getByRole('combobox', { name: label, exact: true }).selectOption(value);
      const optionColors = await page.getByRole('combobox', { name: label, exact: true }).locator('option').evaluateAll(options =>
        options.map(option => ({ background: getComputedStyle(option).backgroundColor, color: getComputedStyle(option).color })));
      assert.ok(optionColors.every(style => style.background === 'rgb(255, 255, 255)' && style.color === 'rgb(15, 23, 42)'), 'Native dropdown options must stay white with dark text when a filter is applied');
      assert.equal(await rows.count(), records.filter(predicate).length, label);
      await reset();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await open('Zoning');
    await page.getByRole('button', { name: /^Residential \(/ }).click();
    await close();
    await open('Zoning');
    await page.getByRole('button', { name: /^Low-Density Residential \(R1\)/ }).click();
    await page.screenshot({ path: path.join(root, 'scratch/sites-filters-mobile.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await close();
    assert.equal(await rows.count(), records.filter(p => p.zoning === 'R1').length);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(root, 'scratch/sites-filters-desktop.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: one colored side-by-side zoning dropdown; group/district/owner/loan multiselect; intersections; screening/years/wetlands; persistence/reset; mobile.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
