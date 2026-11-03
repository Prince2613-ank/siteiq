const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const api = {};
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(root, 'apps/web/src/utils/parcelScoring.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText)(api);
const read = name => JSON.parse(fs.readFileSync(path.join(root, 'apps/web/public/geojson', name), 'utf8'));
const loans = read('parcel_loans.json').parcels;
const id = p => `${p.town.trim().toUpperCase()}|${p.parcel_id.trim()}`;
const source = api.withNearbyIndustry(read('parcels_250m.geojson').features.map(f => ({ ...f, properties: { ...f.properties, loan: loans[id(f.properties)] } })));
const ranked = source.map(p => ({ p, score: api.scoreParcel(p) })).sort((a, b) => b.score.score - a.score.score ||
  (a.p.address || a.p.parcel_id).localeCompare(b.p.address || b.p.parcel_id, 'en', { numeric: true, sensitivity: 'base' }) ||
  api.scoringStorageKey(a.p).localeCompare(api.scoringStorageKey(b.p), 'en'));
const expectedLoanPoints = {
  'No open loan - likely free & clear': 0, 'Low leverage - strong equity': 2,
  'Moderate leverage': 5, 'High leverage (loan >= 80% of value)': 10,
  'Recent loan (<2 yrs) - unlikely to sell soon': 5, 'Not checked': 0,
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => localStorage.setItem('siteiq:ranking:ranking-v4:SALISBURY|11-13', JSON.stringify({ mortgage: -100, loan: -100 })));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${process.env.SITEIQ_URL || 'http://localhost:5174'}/sites`);
    await page.locator('[data-parcel-rank]').first().waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'Sort by', exact: true }).inputValue(), 'score_desc');
    await page.getByRole('combobox', { name: 'Rows per page', exact: true }).selectOption('0');
    await page.waitForFunction(() => document.querySelectorAll('[data-parcel-rank]').length === 766);
    const actual = await page.locator('tbody tr').evaluateAll(rows => rows.map(row => ({
      address: row.querySelector('td:first-child span').textContent.trim(),
      rank: Number(row.querySelector('[data-parcel-rank]').dataset.parcelRank),
      score: Number(row.querySelector('.parcel-score-badge').textContent.split('/')[0]),
    })));
    assert.deepEqual(actual, ranked.map(({ p, score }, index) => ({ address: p.address || p.parcel_id, rank: index + 1, score: score.score })));
    assert.equal(actual[0].address, '133 MAIN ST');
    assert.equal(actual[0].score, 85);
    const dialog = page.getByRole('dialog');
    const shownCategories = new Set();
    for (let i = 0; i < ranked.length; i++) {
      const { p, score } = ranked[i];
      if (shownCategories.has(p.loan.loan_signal)) continue;
      shownCategories.add(p.loan.loan_signal);
      await page.locator('tbody tr').nth(i).locator('.parcel-score-badge').click();
      await dialog.waitFor();
      assert.equal(await dialog.locator('.parcel-scoring-factor').count(), 16);
      const loanFactor = dialog.locator('.parcel-scoring-factor').filter({ has: page.getByText('Loan category', { exact: true }) });
      assert.equal(await loanFactor.count(), 1);
      const points = expectedLoanPoints[p.loan.loan_signal];
      assert.equal(await loanFactor.locator('.parcel-scoring-factor-heading strong').textContent(), `${points ? '+' : ''}${points} pts`);
      assert.equal(await loanFactor.locator('..').getByRole('heading').textContent(), 'Seller likelihood · up to 60 points');
      assert.equal(await dialog.locator('.parcel-scoring-factor-heading > span').filter({ hasText: /^Open mortgage$/ }).count(), 0);
      assert.equal(Number((await dialog.locator('.parcel-scoring-total').textContent()).split('/')[0]), score.score);
      assert.equal(await loanFactor.locator('.parcel-scoring-source-note').count(), p.loan.loan_signal === 'Not checked' ? 1 : 0);
      if (points === 10) {
        await loanFactor.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(root, 'scratch/loan-ranking-desktop.png') });
      }
      await page.getByRole('button', { name: 'Close scoring details' }).click();
    }
    assert.equal(shownCategories.size, 6);
    await page.reload();
    await page.locator('[data-parcel-rank]').first().waitFor();
    assert.equal(await page.locator('tbody tr').first().locator('.parcel-score-badge').textContent(), '85/100');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('tbody tr').first().locator('.parcel-score-badge').click();
    await dialog.waitFor();
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({ path: path.join(root, 'scratch/loan-ranking-mobile.png') });
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: all 766 scores and ranks match loan-aware source calculations; six loan categories add 0/2/5/10 points under seller likelihood; mortgage deduction removed; dialog, refresh, legacy overrides and mobile verified.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
