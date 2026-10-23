// Requires the local web app at http://localhost:5173.
// The edge audit opens all 766 cards and can take several minutes.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root=path.resolve(__dirname,'../../..');
const source=JSON.parse(fs.readFileSync(path.join(root,'apps/web/public/geojson/parcels_250m.geojson')));
const results=[];
const check=async(name,run)=>{try{await run();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL',name,e.message);}};
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(7000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:5173/sites');
  await page.getByRole('button',{name:'Info',exact:true}).first().waitFor();
  await page.getByRole('combobox',{name:'Rows per page'}).selectOption('0');
  await page.getByRole('combobox',{name:'Sort by'}).selectOption('address_asc');
  const sorted=[...source.features].sort((a,b)=>(a.properties.address||a.properties.parcel_id||'').localeCompare(b.properties.address||b.properties.parcel_id||''));
  page.on('console', message => { if(message.text().endsWith('parcel cards checked')) console.log(message.text()); });
  const cards = await page.evaluate(async (sorted) => {
    const checks=[];
    const buttons=[...document.querySelectorAll('tbody button[title="View site details"]')];
    const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
    for(let i=0;i<sorted.length;i++) {
      const record=sorted[i].properties;
      buttons[i].click(); await frame();
      const dialog=document.querySelector('.site-info-dialog');
      const name=`Parcel information ${record.town}/${record.parcel_id}`;
      try {
        if(!dialog) throw Error('Dialog did not open');
        if(dialog.querySelector('h3').textContent.trim()!==(record.address||record.parcel_id))throw Error('Wrong parcel displayed');
        if(/\b(undefined|NaN)\b/.test(dialog.textContent))throw Error('Invalid data displayed');
        if(dialog.querySelectorAll('.site-info-section').length!==8)throw Error('Missing section');
        checks.push({name,pass:true});
      } catch(error) { checks.push({name,pass:false,error:error.message}); }
      dialog?.querySelector('button')?.click(); await frame();
      if((i+1)%100===0)console.log(`${i+1} parcel cards checked`);
    }
    return checks;
  },sorted);
  results.push(...cards);
  for(const route of ['/','/sites']){
   await check(`Genuine empty dataset on ${route}`,async()=>{
    const p=await browser.newPage();await p.route('**/geojson/parcels_250m.geojson',r=>r.fulfill({contentType:'application/json',body:'{"type":"FeatureCollection","features":[]}'}));
    await p.goto('http://localhost:5173'+route);
    await p.getByText(route==='/sites'?'No sites match your search and filter criteria.':'No parcels match your filters.').waitFor();
    assert.equal(await p.getByRole('alert').count(),0);await p.close();
   });
  }
  await check('Slow parcel source shows loading before real results',async()=>{
   const p=await browser.newPage();let release;const hold=new Promise(resolve=>release=resolve);
   await p.route('**/geojson/parcels_250m.geojson',async r=>{await hold;await r.continue();});
   await p.goto('http://localhost:5173');await p.getByRole('status').waitFor();
   assert.equal(await p.getByText('No parcels match your filters.').count(),0);release();
   await p.locator('.dashboard-directory > div').first().waitFor();await p.close();
  });
  await check('Popup displays untrusted data as text',async()=>{
   const p=await browser.newPage();const data=structuredClone(source);data.features=[data.features[0]];
   data.features[0].properties.address='<img src=x onerror=window.__popupInjection=1>';
   data.features[0].properties.owner_name='<img src=x onerror=window.__popupInjection=1>';
   await p.route('**/geojson/parcels_250m.geojson',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(data)}));
   await p.goto('http://localhost:5173');await p.locator('.dashboard-directory > div').first().click();
   await p.locator('.leaflet-popup-content').waitFor();
   assert.equal(await p.locator('.leaflet-popup-content img').count(),0);
   assert.equal(await p.evaluate(()=>window.__popupInjection),undefined);
   assert.equal(await p.locator('.popup-details-btn').count(),0);await p.close();
  });
  for(const record of source.features.filter(f=>f.properties.parcel_id==='FEE')){
   await check(`Cross-town FEE deep link: ${record.properties.town}`,async()=>{
    const p=await browser.newPage();await p.goto('http://localhost:5173/?parcel=FEE&town='+encodeURIComponent(record.properties.town));
    await p.locator('.dashboard-inspector').waitFor();assert.ok((await p.locator('.dashboard-inspector').innerText()).includes(record.properties.town));await p.close();
   });
  }
  for(const query of ['?parcel=FEE','?parcel=not-real']){
   await check(`Ambiguous/invalid map link ${query}`,async()=>{
    const p=await browser.newPage();await p.goto('http://localhost:5173/'+query);await p.getByRole('alert').waitFor();assert.equal(await p.locator('.dashboard-inspector').count(),0);await p.close();
   });
  }
  for(const route of ['/sites/not-real','/sites/not-real/candidates']){
   await check(`API error does not leave infinite loading: ${route}`,async()=>{
    const p=await browser.newPage();await p.route('**/api/v1/**',r=>r.fulfill({status:404,contentType:'application/json',body:'{"error":{"message":"Site not found"}}'}));
    await p.goto('http://localhost:5173'+route);await p.getByRole('alert').waitFor();assert.ok((await p.getByRole('alert').innerText()).includes('Site not found'));await p.close();
   });
  }
  await check('All parcel cards render without uncaught JavaScript errors',()=>assert.deepEqual(errors,[]));
 } finally {await browser.close();}
 const failed=results.filter(r=>!r.pass);
 fs.writeFileSync(path.join(root,'scratch/edge-audit-results.json'),JSON.stringify({passed:results.length-failed.length,failed:failed.length,results},null,2));
 console.log(JSON.stringify({passed:results.length-failed.length,failed:failed.length,failures:failed},null,2));
 if(failed.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
