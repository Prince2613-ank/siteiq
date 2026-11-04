const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { attachCoverage, isBrowsable } = require('./parcel-coverage-fixture.cjs');
const root = path.resolve(__dirname, '../../..');
const base = process.env.SITEIQ_URL || 'http://127.0.0.1:5173';
const json = name => JSON.parse(fs.readFileSync(path.join(root, 'apps/web/public/geojson', name), 'utf8'));
function moduleExports(name) {
  const exports = {};
  new Function('exports', ts.transpileModule(fs.readFileSync(path.join(root, 'apps/web/src/utils', name), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText)(exports);
  return exports;
}
const zoning = moduleExports('parcelZoning.ts');
const screening = moduleExports('parcelScreening.ts');
const loanOptions = moduleExports('parcelLoans.ts').LOAN_FILTER_OPTIONS.filter(o => o.value !== 'ALL');
const loans = json('parcel_loans.json').parcels;
const listings = json('listing_check.json').lots;
const key = p => `${p.town}|${p.parcel_id}`;
const sourceRecords = json('parcels_250m.geojson').features.map(({ properties: p }) => {
  const fields = { ...attachCoverage(p), listed_for_sale: Boolean(listings[key(p)]?.status && listings[key(p)].status !== 'Not listed') };
  return { ...fields, ...screening.screenParcel(fields), loan: loans[key(p)] };
});
const records = sourceRecords.filter(isBrowsable);
const listingCategory = p => {
  const listing = listings[key(p)];
  if (listing?.status && listing.status !== 'Not listed') return 'LISTED';
  return Object.values(listing?.links || {}).some(url => /^https?:\/\//i.test(url)) ? 'NOT_LISTED' : 'NO_LINKS';
};
const ownerOptions = [...new Set(records.map(p => p.owner_type?.trim() || 'Unknown'))].sort().map(value => ({ value, label: value }));
const yearsOptions = [
  ['UNDER_5', 'Under 5 years', 0, 5], ['5_10', '5 to under 10 years', 5, 10],
  ['10_20', '10 to under 20 years', 10, 20], ['20_30', '20 to under 30 years', 20, 30], ['30_PLUS', '30 years or more', 30, Infinity],
].map(([value, label, min, max]) => ({ value, label, matches: p => p.years_owned != null && p.years_owned !== '' && Number(p.years_owned) >= min && Number(p.years_owned) < max }));
const wetlandOptions = [
  ['NONE', n => n === 0], ['LOW', n => n > 0 && n < 10], ['MODERATE', n => n >= 10 && n < 25],
  ['HIGH', n => n >= 25 && n <= 50], ['VERY_HIGH', n => n > 50],
].map(([value, predicate]) => ({ value, matches: p => p.wetland_pct != null && predicate(Number(p.wetland_pct)) }));
function lifeType(p) {
  const signal = (p.life_event_signal || '').trim().toLowerCase();
  if (!signal) return p.estate_record_detail ? 'estate' : 'none';
  if (signal.includes('(death)') || signal.includes('heirs may now hold') || signal.includes('life estate on deed') || signal.includes('estate record')) return 'estate';
  if (signal.includes('senior') || signal.includes('tax deferral')) return 'senior';
  if (signal.includes('older owner') || signal.includes('owned ')) return 'older';
  return p.estate_record_detail ? 'estate' : 'none';
}
const lifeOptions = [
  { value: 'HAS_SIGNAL', matches: p => lifeType(p) !== 'none' },
  { value: 'ESTATE', matches: p => lifeType(p) === 'estate' || Boolean(p.estate_record_detail) },
  { value: 'OLDER_OWNER', matches: p => lifeType(p) === 'older' },
  { value: 'SENIOR', matches: p => lifeType(p) === 'senior' },
];
const textCount = text => Number(text.match(/\((\d+)\)\s*$/)?.[1]);
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let checks = 0;

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const sites of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => {
        // Retired status selections must not strand returning users on an empty view.
        if (sessionStorage.getItem('test:mixed-migration')) return;
        sessionStorage.setItem('test:mixed-migration', 'seeded');
        sessionStorage.setItem('siteiq:view:v1:dashboard', JSON.stringify({
          selectedStatus: 'ALL', selectedOwnerType: [], keepFilter: 'ALL',
          parcel: 'SALISBURY|11-13', center: [42.86, -70.9], zoom: 13, minZoom: 10, scrollTop: 0,
        }));
        sessionStorage.setItem('siteiq:view:v1:sites:development', JSON.stringify('ALL'));
      });
      await page.goto(`${base}${sites ? '/sites' : '/'}`);
      await page.waitForFunction(total => document.body.textContent.includes(`(${total})`), records.length);
      const statusGroup = sites ? page.getByRole('combobox', { name: 'Development status', exact: true }) : page.getByRole('group', { name: 'Development status', exact: true });
      assert.doesNotMatch(await statusGroup.textContent(), /mixed/i, 'Only All, Vacant and Built-up should be offered');
      if (sites) assert.equal(await statusGroup.inputValue(), 'ALL', 'Restore retired Mixed filter to All');
      if (sites) await page.getByRole('combobox', { name: 'Rows per page' }).selectOption('0');
      const reset = async () => {
        const button = page.getByRole('button', { name: sites ? /Reset Filters/ : 'Reset filters', exact: !sites });
        if (await button.count()) await button.click();
      };
      const open = label => page.getByRole('button', { name: new RegExp(`^${escape(label)}:`) }).click();
      const close = () => page.keyboard.press('Escape');
      const result = async (expected, label) => {
        if (sites) {
          const actual = await page.locator('tbody tr[tabindex="0"]').evaluateAll(rows => rows.map(row => {
            const cells = row.querySelectorAll('td');
            return `${cells[2].querySelector('span').textContent}|${cells[0].textContent.match(/ID:\s*(\S+)/)[1]}`;
          }));
          assert.deepEqual(actual.sort(), expected.map(key).sort(), label);
        } else {
          const colors = await page.locator('.dashboard-parcel-overlay').evaluateAll(paths => paths.map(p => p.getAttribute('fill')));
          assert.deepEqual(colors.sort(), expected.map(p => zoning.zoningColor(p.zoning)).sort(), label);
        }
        checks++;
      };
      const chooseSingle = async (label, value, expected) => {
        if (sites || label === 'Years owned' || label === 'Wetland coverage') {
          const select = page.getByRole('combobox', { name: label, exact: true });
          const count = textCount(await select.locator(`option[value="${value}"]`).textContent());
          assert.equal(count, expected.length, `${label} ${value} displayed count`);
          await select.selectOption(value);
        } else {
          const group = page.getByRole('group', { name: label, exact: true });
          const optionName = label === 'Development status' && value === 'Mixed (vacant + built-up)' ? 'Mixed' : label === 'Screening results' ? { Y: 'Qualified', N: 'Excluded' }[value] : label === 'Listing status'
            ? { LISTED: 'Listed', NOT_LISTED: 'Not listed', NO_LINKS: 'No links' }[value] : value;
          const button = group.getByRole('button', { name: new RegExp(`^${escape(optionName)} \\(`) });
          assert.equal(textCount(await button.textContent()), expected.length, `${label} ${value} count`);
          await button.click();
        }
      };
      await result(records, 'Initial view includes only Mixed parcels within the building limit');
      const chooseMulti = async (label, option, expected) => {
        if (sites || label === 'Years owned') await open(label);
        const button = page.getByRole('group', { name: label, exact: true }).getByRole('button', { name: new RegExp(`^${escape(option.label)} \\(`) });
        assert.equal(textCount(await button.textContent()), expected.length, `${label} ${option.value} count`);
        await button.click();
        if (sites || label === 'Years owned') await close();
      };
      for (const value of ['Y', 'N']) {
        await reset(); const expected = records.filter(p => p.keep === value);
        await chooseSingle('Screening results', value, expected); await result(expected, `screening ${value}`);
      }
      const statuses = ['Vacant', 'Built-up'];
      for (const value of statuses) {
        await reset(); const expected = records.filter(p => p.status === value);
        await chooseSingle('Development status', value, expected); await result(expected, `status ${value}`);
      }
      for (const option of ownerOptions) {
        await reset(); const expected = records.filter(p => (p.owner_type?.trim() || 'Unknown') === option.value);
        await chooseMulti('Owner type', option, expected); await result(expected, `owner ${option.value}`);
      }
      for (const option of loanOptions) {
        await reset(); const expected = records.filter(p => p.loan.loan_signal === option.value);
        await chooseMulti('Loan category', option, expected); await result(expected, `loan ${option.value}`);
      }
      for (const option of yearsOptions) {
        await reset(); const expected = records.filter(option.matches);
        await chooseSingle('Years owned', option.value, expected);
        await result(expected, `years ${option.value}`);
      }
      for (const option of wetlandOptions) {
        await reset(); const expected = records.filter(option.matches);
        await chooseSingle('Wetland coverage', option.value, expected); await result(expected, `wetland ${option.value}`);
      }
      for (const value of ['LISTED', 'NOT_LISTED', 'NO_LINKS']) {
        await reset();
        const expected = records.filter(p => listingCategory(p) === value);
        await chooseSingle('Listing status', value, expected);
        await result(expected, `listing ${value}`);
        await page.reload();
        await page.waitForFunction(() => !document.body.textContent.includes('Loading'));
        await result(expected, `listing ${value} refresh`);
        const qualified = expected.filter(p => p.keep === 'Y');
        await chooseSingle('Screening results', 'Y', qualified);
        await result(qualified, `listing ${value} + qualified`);
      }
      for (const group of zoning.ZONING_GROUPS) {
        await reset();
        if (sites) await open('Zoning');
        const buttons = page.getByRole('group', { name: sites ? 'Zoning' : 'Zoning groups', exact: true });
        const button = buttons.getByRole('button', { name: new RegExp(`^${escape(group.name)} \\(`) });
        const groupRecords = records.filter(p => group.codes.includes(zoning.zoningCode(p.zoning)));
        assert.equal(textCount(await button.textContent()), groupRecords.length, `${group.name} count`);
        await button.click();
        if (sites) await close();
        await result(groupRecords, group.name);
        for (const district of zoning.ZONING_DISTRICTS.filter(d => group.codes.includes(d.code))) {
          if (sites) await open('Zoning');
          const districtGroup = page.getByRole('group', { name: sites ? `${group.name} districts` : 'Zoning district', exact: true });
          const districtButton = districtGroup.getByRole('button', { name: new RegExp(`^${escape(district.name)} \\(${escape(district.code)}\\)`) });
          const expected = records.filter(p => zoning.zoningCode(p.zoning) === district.code);
          assert.equal(textCount(await districtButton.textContent()), expected.length, `${district.code} count`);
          await districtButton.click();
          if (sites) await close();
          await result(expected, district.code);
          if (sites) await open('Zoning');
          await districtButton.click();
          if (sites) await close();
          await result(groupRecords, `${district.code} deselect restores group`);
        }
      }
      if (sites) {
        for (const option of lifeOptions) {
          await reset(); await page.getByRole('combobox', { name: 'Life events', exact: true }).selectOption(option.value);
          await result(records.filter(option.matches), `life ${option.value}`);
        }
        await reset();
        await page.getByRole('textbox', { name: 'Search sites', exact: true }).fill('main');
        const matchesSearch = p => [p.address, p.parcel_id, p.owner_name || p.owner, p.use, p.zoning, p.children_count_estate_owner, p.estate_record_detail, p.zillow_past_attempt, p.redfin_past_attempt].some(v => String(v || '').toLowerCase().includes('main'));
        const searchRecords = records.filter(matchesSearch);
        await result(searchRecords, 'search');
        assert.equal(textCount(await page.getByRole('combobox', { name: 'Screening results', exact: true }).locator('option[value="ALL"]').textContent()), searchRecords.length, 'Search must narrow facet counts');
        await page.getByRole('combobox', { name: 'Life events', exact: true }).selectOption('OLDER_OWNER');
        const context = searchRecords.filter(lifeOptions.find(o => o.value === 'OLDER_OWNER').matches);
        await result(context, 'search + life');
        assert.equal(textCount(await page.getByRole('combobox', { name: 'Screening results', exact: true }).locator('option[value="ALL"]').textContent()), context.length, 'Life Events must narrow facet counts');
        const lifeSelect = page.getByRole('combobox', { name: 'Life events', exact: true });
        for (const option of lifeOptions) {
          assert.equal(textCount(await lifeSelect.locator(`option[value="${option.value}"]`).textContent()), searchRecords.filter(option.matches).length, `Life Events ${option.value} contextual count`);
        }
        await reset();
        const recordMap = new Map(records.map(p => [key(p), p]));
        for (const mode of ['score_desc', 'qualified', 'usable_desc', 'gross_desc', 'val_desc', 'address_asc', 'owner_asc']) {
          await page.getByRole('combobox', { name: 'Sort by', exact: true }).selectOption(mode);
          const displayed = await page.locator('tbody tr[tabindex="0"]').evaluateAll(rows => rows.map(row => ({
            key: `${row.querySelectorAll('td')[2].querySelector('span').textContent}|${row.querySelector('td').textContent.match(/ID:\s*(\S+)/)[1]}`,
            rank: Number(row.querySelector('[data-parcel-rank]').getAttribute('data-parcel-rank')),
          })));
          for (let i = 1; i < displayed.length; i++) {
            const a = recordMap.get(displayed[i - 1].key), b = recordMap.get(displayed[i].key);
            let ordered;
            if (mode === 'score_desc') ordered = displayed[i - 1].rank < displayed[i].rank;
            if (mode === 'qualified') ordered = Number(a.keep === 'Y') > Number(b.keep === 'Y') || (a.keep === b.keep && Number(a.usable_acres || 0) >= Number(b.usable_acres || 0));
            if (['usable_desc', 'gross_desc', 'val_desc'].includes(mode)) {
              const field = { usable_desc: 'usable_acres', gross_desc: 'acres', val_desc: 'total_val' }[mode];
              ordered = Number(a[field] || 0) >= Number(b[field] || 0);
            }
            if (mode === 'address_asc') ordered = (a.address || a.parcel_id || '').localeCompare(b.address || b.parcel_id || '') <= 0;
            if (mode === 'owner_asc') ordered = (a.owner_name || a.owner || '').localeCompare(b.owner_name || b.owner || '') <= 0;
            assert.ok(ordered, `Sort ${mode} rows ${i}/${i + 1}`);
          }
          checks++;
        }
        await reset();
        await page.getByRole('combobox', { name: 'Rows per page' }).selectOption('50');
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        await page.reload();
        await page.locator('td[data-parcel-rank]').first().waitFor();
        assert.equal(Number(await page.locator('td[data-parcel-rank]').first().getAttribute('data-parcel-rank')), 51);
        await page.getByRole('combobox', { name: 'Screening results', exact: true }).selectOption('Y');
        assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('siteiq:view:v1:sites:page:v2'))), 1, 'Filter changes reset pagination');
        await reset();
        await page.getByRole('combobox', { name: 'Rows per page' }).selectOption('0');
      }
      await reset(); await result(records, 'final reset');
      assert.deepEqual(errors, []);
      console.log(`${sites ? 'Sites' : 'Dashboard'}: all individual filter options and deselection checks passed.`);
      await page.close();
    }
    console.log(`PASS: ${checks} result-set checks across both pages.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
