const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const baseURL = process.env.SITEIQ_URL || 'http://localhost:5174';
const json = name => JSON.parse(fs.readFileSync(path.join(root, 'apps/web/public', name), 'utf8'));
const loans = json('geojson/parcel_loans.json').parcels;
const records = json('geojson/parcels_250m.geojson').features.map(f => f.properties);
const key = p => `${p.town.trim().toUpperCase()}|${p.parcel_id.trim()}`;
assert.equal(Object.keys(loans).length, 766);
assert.ok(records.every(p => loans[key(p)]));
const formatters = {};
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(root, 'apps/web/src/utils/parcelLoans.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText)(formatters);
assert.equal(formatters.formatLoanPercent(0.42589437819420783), '42.6%');
assert.equal(formatters.formatLoanPercent(0), '0%');
assert.equal(formatters.formatLoanPercent(null), null);
assert.equal(formatters.formatLoanMoney(0), '$0');
assert.equal(formatters.formatLoanMoney(null), null);
assert.equal(formatters.formatLoanMoney(-100), '-$100');
const expectedCounts = {};
const displayCategory = value => value === 'Not checked' ? 'Loan details unavailable' : value;
const filterLabel = value => ({
  'No open loan - likely free & clear': 'No open loan',
  'Low leverage - strong equity': 'Low loan-to-value',
  'Moderate leverage': 'Moderate loan-to-value',
  'High leverage (loan >= 80% of value)': 'High loan-to-value (80%+)',
  'Recent loan (<2 yrs) - unlikely to sell soon': 'Recent loan (under 2 years)',
  'Not checked': 'Loan details unavailable',
})[value];
for (const loan of Object.values(loans)) expectedCounts[loan.loan_signal] = (expectedCounts[loan.loan_signal] || 0) + 1;
assert.equal(Object.values(expectedCounts).reduce((sum, n) => sum + n, 0), 766);

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseURL);
    const filter = page.getByRole('group', { name: 'Loan category', exact: true });
    const choose = value => filter.getByRole('button', { name: value === 'ALL' ? /^All categories \(/ : filterLabel(value) + ' (' }).click();
    await filter.getByRole('button', { name: 'All categories (766)', exact: true }).waitFor();
    const paths = page.locator('.dashboard-parcel-overlay');
    for (const [category, count] of Object.entries(expectedCounts)) {
      assert.equal(await filter.getByRole('button', { name: `${filterLabel(category)} (${count})`, exact: true }).count(), 1);
      await choose(category);
      assert.equal(await paths.count(), count);
    }
    const category = 'Low leverage - strong equity';
    await choose(category);
    await page.getByRole('group', { name: 'Development status', exact: true }).getByRole('button', { name: /^Vacant \(/ }).click();
    const expectedVacant = records.filter(p => p.status === 'Vacant');
    assert.equal(await paths.count(), expectedVacant.filter(p => loans[key(p)].loan_signal === category).length);
    for (const [signal] of Object.entries(expectedCounts)) {
      const expected = expectedVacant.filter(p => loans[key(p)].loan_signal === signal).length;
      assert.equal(await filter.getByRole('button', { name: `${filterLabel(signal)} (${expected})`, exact: true }).count(), 1);
    }
    await page.reload();
    await filter.getByRole('button', { name: /^All categories \(106\)$/ }).waitFor();
    assert.equal(await filter.getByRole('button', { name: filterLabel(category) + ' (' }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    assert.equal(await filter.getByRole('button', { name: /^All categories \(/ }).getAttribute('aria-pressed'), 'true');
    assert.equal(await paths.count(), 766);

    // Compare report fields against the imported source for every source category.
    const sampleKeys = [...new Set([...Object.keys(expectedCounts).map(category =>
      Object.keys(loans).find(key => loans[key].loan_signal === category)), 'SEABROOK|10-10-0', 'AMESBURY|FEE', 'SALISBURY|FEE'])];
    for (const identity of sampleKeys) {
      const [town, parcel] = identity.split('|');
      await page.goto(`${baseURL}/sites/report/${encodeURIComponent(town)}/${encodeURIComponent(parcel)}`);
      const section = page.locator('.report-loan-section');
      await section.waitFor();
      const fields = await section.locator('dl > div').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.querySelector('dt').textContent, node.querySelector('dd').textContent])));
      const loan = loans[identity];
      assert.equal(fields['Loan category'], displayCategory(loan.loan_signal));
      assert.equal(fields['Loan status'], loan.loan_signal === 'Not checked' ? undefined : loan.loan_status);
      if (loan.loan_signal === 'Not checked') assert.deepEqual(Object.keys(fields), ['Loan category']);
      assert.equal(fields['Estimated equity'], undefined);
      assert.equal(fields['Estimated equity share'], undefined);
      assert.equal(fields['Mortgage record'], undefined);
      assert.equal(fields['Open loans'], loan.open_loans_count === null ? undefined : String(loan.open_loans_count));
      assert.equal(fields['Latest open-loan lender'], loan.latest_open_loan_lender ?? undefined);
      assert.equal(fields['Latest loan date'], loan.latest_loan_date ?? undefined);
      for (const [label, field] of [['Latest loan amount', 'latest_loan_amount_usd'], ['Estimated current balance', 'est_balance_now_usd']]) {
        const value = loan[field];
        assert.equal(fields[label], value === null ? undefined : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value));
      }
      for (const [label, field] of [['Loan to value', 'loan_to_value_pct']]) {
        assert.equal(fields[label], loan[field] === null ? undefined : `${(loan[field] * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`);
      }
      assert.ok(!/undefined|NaN/.test(await section.textContent()));
      if (identity === 'AMESBURY|77-54') {
        await section.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(root, 'scratch/loan-report-desktop.png') });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.report-loan-section').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(root, 'scratch/loan-report-mobile.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: all 766 loan identities; six category counts and map results; combined filters; persistence/reset; source-accurate report fields, percentages, estimates, zero/missing handling and mobile layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
