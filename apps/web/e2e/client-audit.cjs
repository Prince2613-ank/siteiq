// Requires the local web app at http://localhost:5173.
// The edge audit opens all 766 cards and can take several minutes.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const fixtures = path.join(root, 'apps/web/public/geojson');
const parcels = JSON.parse(fs.readFileSync(path.join(fixtures, 'parcels_250m.geojson'))).features;
const listings = JSON.parse(fs.readFileSync(path.join(fixtures, 'listing_check.json')));
const records = parcels.map(f => f.properties);
const results = [];
let browser;
const test = async (name, run) => {
  try { await run(); results.push({ name, pass: true }); if (results.length % 20 === 0) console.log(`${results.length} checks completed`); }
  catch (error) { results.push({ name, pass: false, error: error.message }); console.log('FAIL', name, error.message); }
};
const key = p => `${p.town.toUpperCase().trim()}|${p.parcel_id.trim()}`;

(async () => {
  await test('All 766 source parcels have unique town/parcel IDs', () => {
    assert.equal(records.length, 766); assert.equal(new Set(records.map(key)).size, 766);
  });
  await test('Every parcel has valid screening and numeric land area', () => {
    for (const p of records) {
      assert.ok(['Y', 'N'].includes(p.keep));
      assert.ok(Number.isFinite(p.acres) && p.acres >= 0);
      assert.ok(Number.isFinite(p.usable_acres) && p.usable_acres >= 0);
      assert.ok(p.usable_acres <= p.acres + 0.02);
      assert.ok(p.wetland_pct == null || (p.wetland_pct >= 0 && p.wetland_pct <= 100));
    }
  });
  await test('All supplied source links use HTTP or HTTPS', () => {
    const walk = (value) => {
      if (typeof value === 'string' && /^\w+:\/\//.test(value)) assert.ok(/^https?:\/\//.test(value), value);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    }; walk(records); walk(listings);
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(7000);
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.goto('http://localhost:5173/sites');
  await page.locator('tbody tr').filter({has: page.getByRole('button', {name:'Info', exact:true})}).first().waitFor();
  const rowCount = () => page.getByRole('button', { name: 'Info', exact: true }).count();
  await page.getByRole('combobox', { name: 'Rows per page' }).selectOption('0');
  await test('All rows option shows exactly 766 sites', async () => assert.equal(await rowCount(), 766));
  for (const [name, predicate] of [['Qualified',p=>p.keep==='Y'], ['Excluded',p=>p.keep==='N'], ['Listed',p=>listings.lots[key(p)]?.status && listings.lots[key(p)].status!=='Not listed']]) {
    await test(`${name} Sites filter matches source records`, async () => {
      await page.getByRole('button', { name: new RegExp(`${name} \\(`) }).click();
      assert.equal(await rowCount(), records.filter(predicate).length);
      await page.getByRole('button', { name: /^All \(/ }).click();
    });
  }
  for (const category of [...new Set(records.map(p=>p.category))]) {
    for (const town of [...new Set(records.map(p=>p.town))]) {
      for (const road of [...new Set(records.map(p=>p.road))]) {
        await test(`Sites combination: ${category} / ${town} / ${road}`, async () => {
          await page.getByRole('combobox',{name:'Category',exact:true}).selectOption(category);
          await page.getByRole('combobox',{name:'Municipality',exact:true}).selectOption(town);
          await page.getByRole('combobox',{name:'Road corridor',exact:true}).selectOption(road);
          assert.equal(await rowCount(), records.filter(p=>p.category===category&&p.town===town&&p.road===road).length);
        });
      }
    }
  }
  await page.getByRole('button',{name:/Reset Filters/}).click();
  await test('Pasted spaces and case do not break Sites search', async () => {
    await page.getByRole('textbox',{name:'Search sites'}).fill('  94 monroe st  ');
    assert.equal(await rowCount(), records.filter(p=>(p.address||'').toLowerCase().includes('94 monroe st')).length);
    await page.getByRole('textbox',{name:'Search sites'}).fill('');
  });
  for (const sort of ['qualified','usable_desc','gross_desc','val_desc','address_asc','owner_asc']) {
    await test(`Sites sorting: ${sort}`, async () => {
      await page.getByRole('combobox',{name:'Sort by'}).selectOption(sort);
      const sorted=[...records].sort((a,b)=> {
        if(sort==='qualified') return Number(b.keep==='Y')-Number(a.keep==='Y') || b.usable_acres-a.usable_acres;
        if(sort==='usable_desc')return b.usable_acres-a.usable_acres;
        if(sort==='gross_desc')return b.acres-a.acres;
        if(sort==='val_desc')return (Number(b.total_val)||0)-(Number(a.total_val)||0);
        if(sort==='address_asc')return (a.address||a.parcel_id||'').localeCompare(b.address||b.parcel_id||'');
        return (a.owner_name||a.owner||'').localeCompare(b.owner_name||b.owner||'');
      });
      const addresses=await page.locator('tbody tr td:first-child > div:first-child > span:first-child').allTextContents();
      assert.deepEqual(addresses.map(t=>t.trim()),sorted.map(p=>p.address||p.parcel_id));
    });
  }
  await test('Pagination next/previous and filter reset',async()=>{
    await page.getByRole('combobox',{name:'Rows per page'}).selectOption('25');
    assert.equal(await rowCount(),25);
    await page.getByRole('button',{name:'Next',exact:true}).click();
    await page.getByRole('button',{name:'Previous',exact:true}).click();
    assert.ok(await page.getByRole('button',{name:'Previous',exact:true}).isDisabled());
    await page.getByRole('button',{name:'Next',exact:true}).click();
    await page.getByRole('textbox',{name:'Search sites'}).fill('does-not-exist-qa');
    assert.equal(await rowCount(),0);
    assert.ok(await page.getByText('No sites match your search and filter criteria.').isVisible());
    await page.getByRole('button',{name:'Clear all filters'}).click();
    assert.equal(await rowCount(),25);
  });
  await test('Info dialog sections, missing footer, focus, and Escape',async()=>{
    await page.getByRole('button',{name:'Info',exact:true}).first().click();
    const dialog=page.getByRole('dialog');
    assert.equal(await dialog.locator('.site-info-section').count(),8);
    assert.equal(await dialog.locator('details').count(),0);
    assert.equal(await dialog.getByText('View on Corridor Map').count(),0);
    assert.equal(await dialog.getByText('Assessed Value',{exact:true}).count(),1);
    const last=dialog.locator('button, a[href], input, select, textarea, [tabindex="0"]').last(); await last.focus();
    await page.keyboard.press('Tab');
    assert.ok(await dialog.getByRole('button',{name:'Dismiss property information'}).evaluate(e=>e===document.activeElement));
    await page.keyboard.press('Escape'); assert.equal(await dialog.count(),0);
    assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Info');
  });
  await test('Sites Map action opens requested parcel',async()=>{
    const row=page.locator('tbody tr').filter({has:page.getByRole('button',{name:'Info',exact:true})}).first();
    const pid=(await row.locator('td').first().innerText()).match(/ID:\s*(\S+)/)[1];
    await row.getByTitle('Open parcel in Corridor Map',{exact:true}).click();
    assert.equal(new URL(page.url()).searchParams.get('parcel'),pid);assert.ok(new URL(page.url()).searchParams.get('town'));
    await page.locator('.dashboard-inspector').waitFor();
    assert.ok((await page.locator('.dashboard-inspector').innerText()).includes(pid));
  });
  await page.goto('http://localhost:5173');
  await page.locator('.dashboard-directory > div').first().waitFor();
  await test('Dashboard search trims spaces and shows empty state',async()=>{
    const search=page.getByPlaceholder('Search address, parcel ID, or owner...');
    await search.fill('  94 MONROE ST  ');
    assert.equal(await page.locator('.dashboard-directory > div').count(),1);
    await search.fill('does-not-exist-qa');
    assert.ok(await page.getByText('No parcels match your filters.').isVisible());
    await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  });
  await test('Dashboard owner search matches the displayed owner name',async()=>{
    const owner=records.find(p=>p.owner_name&&p.owner_name!==p.owner)?.owner_name || records[0].owner_name;
    await page.getByPlaceholder('Search address, parcel ID, or owner...').fill(owner);
    const count=records.filter(p=>(p.owner_name||p.owner||'').toLowerCase().includes(owner.toLowerCase())).length;
    assert.ok((await page.getByText(/3\. Parcel results/i).innerText()).includes(`(${count})`));
    await page.getByTitle('Clear search',{exact:true}).click();
  });
  for(const width of [390,768,1024,1440,1920]) {
    await test(`Responsive dashboard ${width}px`,async()=>{
      await page.setViewportSize({width,height:1000});
      const sizes=await page.locator('.dashboard-sidebar').evaluate(e=>({a:e.getBoundingClientRect().width,m:e.nextElementSibling.getBoundingClientRect().width,w:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth}));
      assert.equal(sizes.overflow,false);
      if(width>=1024){assert.ok(Math.abs(sizes.a-width/3)<1);assert.ok(Math.abs(sizes.m-2*width/3)<1);}
    });
  }
  await page.setViewportSize({width:1440,height:1000});
  for(const mode of ['http','malformed','network']) {
    for(const route of ['/','/sites']) {
      await test(`Parcel load failure ${mode} on ${route}`,async()=>{
        const failurePage=await browser.newPage();
        await failurePage.route('**/geojson/parcels_250m.geojson',r=>mode==='network'?r.abort():r.fulfill({status:mode==='http'?503:200,contentType:'application/json',body:mode==='http'?'{}':'{"features":null}'}));
        await failurePage.goto('http://localhost:5173'+route);
        await failurePage.getByRole('alert').waitFor();
        assert.ok((await failurePage.getByRole('alert').innerText()).includes('Parcel data could not be loaded'));
        await failurePage.unroute('**/geojson/parcels_250m.geojson');
        await failurePage.getByRole('button',{name:'Retry data load'}).click();
        if(route==='/sites')await failurePage.getByRole('button',{name:'Info',exact:true}).first().waitFor();
        else await failurePage.locator('.dashboard-directory > div').first().waitFor();
        assert.equal(await failurePage.getByRole('alert').count(),0);
        await failurePage.close();
      });
    }
  }
  for(const route of ['/','/sites']) {
    await test(`Listing source unavailable on ${route}`,async()=>{
      const p=await browser.newPage();await p.route('**/geojson/listing_check.json',r=>r.abort());
      await p.goto('http://localhost:5173'+route);await p.getByRole('alert').waitFor();
      assert.ok((await p.getByRole('alert').innerText()).toLowerCase().includes('listing'));
      if(route==='/sites'){await p.getByRole('button',{name:'Info',exact:true}).first().click();assert.ok(await p.getByRole('dialog').getByText('Listing not checked',{exact:true}).first().isVisible());}
      await p.close();
    });
  }
  await test('Unknown routes recover to dashboard',async()=>{
    await page.goto('http://localhost:5173/not-a-real-route');await page.locator('.dashboard-directory > div').first().waitFor();assert.equal(new URL(page.url()).pathname,'/');
  });
  await test('No uncaught JavaScript errors in client workflows',()=>assert.deepEqual(runtimeErrors,[]));
  await browser.close();
  const failed=results.filter(r=>!r.pass);
  fs.writeFileSync(path.join(root,'scratch/client-audit-results.json'),JSON.stringify({passed:results.length-failed.length,failed:failed.length,results},null,2));
  console.log(JSON.stringify({passed:results.length-failed.length,failed:failed.length,failures:failed},null,2));
  if(failed.length)process.exitCode=1;
})().catch(async e=>{console.error(e);await browser?.close();process.exitCode=1;});
