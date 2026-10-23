const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'../../..');
const code=ts.transpileModule(fs.readFileSync(path.join(root,'apps/web/src/utils/parcelScoring.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const api={};new Function('exports',code)(api);
// The app scores each record with its nearby-industry count from parcel geometry.
const data=api.withNearbyIndustry(JSON.parse(fs.readFileSync(path.join(root,'apps/web/public/geojson/parcels_250m.geojson'))).features);
const expected=[...data].sort((a,b)=>api.scoreParcel(b).score-api.scoreParcel(a).score ||
 (a.address||a.parcel_id||'').localeCompare(b.address||b.parcel_id||'','en',{numeric:true,sensitivity:'base'}) || api.scoringStorageKey(a).localeCompare(api.scoringStorageKey(b),'en'));
const ranks=new Map(expected.map((p,i)=>[api.scoringStorageKey(p),i+1]));
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:5173/sites');await page.locator('td[data-parcel-rank]').first().waitFor();
  const rankAll=page.getByRole('button',{name:'Rank all 766 sites',exact:true});
  await rankAll.click();
  assert.equal(await rankAll.getAttribute('aria-pressed'),'true');
  assert.equal(await page.getByRole('combobox',{name:'Sort by'}).inputValue(),'score_desc');
  const displayed=()=>page.locator('td[data-parcel-rank]').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.parcelRank)));
  assert.deepEqual(await displayed(),Array.from({length:50},(_,i)=>i+1));
  await page.getByRole('button',{name:'Next',exact:true}).click();
  assert.deepEqual(await displayed(),Array.from({length:50},(_,i)=>i+51));
  await page.getByRole('combobox',{name:'Rows per page'}).selectOption('0');
  await page.waitForFunction(()=>document.querySelectorAll('td[data-parcel-rank]').length===766);
  assert.deepEqual(await displayed(),Array.from({length:766},(_,i)=>i+1));
  const actual=await page.locator('tbody tr').evaluateAll(rows=>rows.map(row=>({address:row.querySelector('td').querySelector('span').textContent.trim(),id:row.querySelector('td').lastElementChild.textContent.trim().replace(/^ID:\s*/,''),score:Number(row.querySelector('.parcel-score-badge').textContent.split('/')[0])})));
  assert.deepEqual(actual,expected.map(p=>({address:p.address||p.parcel_id,id:p.parcel_id,score:api.scoreParcel(p).score})));
  await page.getByRole('button',{name:/Qualified \(/}).click();
  assert.equal(await rankAll.getAttribute('aria-pressed'),'false');
  const qualified=expected.filter(p=>p.keep==='Y');
  await page.waitForFunction(()=>document.querySelectorAll('td[data-parcel-rank]').length===185);
  assert.deepEqual(await displayed(),qualified.map(p=>ranks.get(api.scoringStorageKey(p))));
  // The one-click action clears active searches and filters and restores all ranks.
  await page.getByRole('combobox',{name:'Category',exact:true}).selectOption('Commercial');
  await page.getByRole('combobox',{name:'Municipality',exact:true}).selectOption('SALISBURY');
  await page.getByRole('combobox',{name:'Road corridor',exact:true}).selectOption('Main St');
  await page.getByRole('combobox',{name:'Life events',exact:true}).selectOption('ESTATE');
  await page.getByRole('textbox',{name:'Search sites'}).fill('no-matching-site-qa');
  await rankAll.click();
  await page.waitForFunction(()=>document.querySelectorAll('td[data-parcel-rank]').length===766);
  assert.equal(await page.getByRole('textbox',{name:'Search sites'}).inputValue(),'');
  for(const name of ['Category','Municipality','Road corridor','Life events'])assert.equal(await page.getByRole('combobox',{name,exact:true}).inputValue(),'ALL');
  assert.deepEqual(await displayed(),Array.from({length:766},(_,i)=>i+1));
  await page.getByRole('combobox',{name:'Rows per page'}).selectOption('50');
  await rankAll.click();
  await page.setViewportSize({width:390,height:844});
  assert.ok(await rankAll.isVisible());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page has no mobile horizontal overflow');
  await page.screenshot({path:path.join(root,'scratch/site-ranking-mobile.png')});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:path.join(root,'scratch/site-ranking-desktop.png')});
  assert.deepEqual(errors,[]);
  console.log('Site ranks passed: all 766 positions and scores, ties, pagination, global ranks under filters, Rank all reset, mobile and no runtime errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
