const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=JSON.parse(fs.readFileSync('apps/web/public/geojson/parcels_250m.geojson'));
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:5173');
 await page.getByRole('button',{name:'All (766)',exact:true}).waitFor();
 const colored=()=>page.locator('.leaflet-overlay-pane path[fill-opacity="0.65"]').count();
 assert.equal(await colored(),0);
 const order=await page.locator('.dashboard-filter-card').first().locator('legend').allTextContents();
 assert.deepEqual(order,['Screening results','Zoning']);
 const refs=[['6M','#4285f4'],['6R','#ffff00'],['C','#ea4335'],['C2','#ea4335'],['C3','#ea4335'],['C4','#ea4335'],['COM','#ea4335'],['I','#7030a0'],['LM','#ea4335'],['LM-A','#ffc000'],['LM-C','#4285f4'],['OP','#ffc000'],['OSC','#34a853'],['R1','#ffff00'],['R2','#ffff00'],['R20','#ffff00'],['R-20','#ffff00'],['R40','#ffff00'],['R8','#ffff00'],['RC','#34a853'],['RCZD','#ea4335'],['RES','#ffff00'],['RESIDNTL','#ffff00']];
 for(const [code,color] of refs){
  const button=page.locator('.dashboard-zoning-option').filter({has:page.locator('strong',{hasText:new RegExp('^'+code+'$')})});
  await button.click();
  const expected=source.features.filter(f=>(f.properties.zoning==='R-8'?'R8':f.properties.zoning)===code);
  assert.equal(await colored(),expected.length,code+' count');
  assert.equal(await page.locator(`.leaflet-overlay-pane path[fill="${color}"][fill-opacity="0.65"]`).count(),expected.length,code+' color');
 }
 await page.getByTitle('I: Industrial / Light Industrial',{exact:true}).click();
 const parcel=page.locator('.leaflet-overlay-pane path[fill="#7030a0"][fill-opacity="0.65"]').first();
 await parcel.evaluate(el=>el.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:750,clientY:400})));
 await page.locator('.dashboard-parcel-card').waitFor();
 assert.equal(await page.locator('.dashboard-parcel-card').evaluate(el=>el.children.length),2);
 const address=await page.locator('.dashboard-parcel-card strong').innerText();
 await page.getByRole('button',{name:'Details',exact:true}).click();
 await page.waitForURL('**/sites?**');
 await page.getByRole('dialog',{name:address,exact:true}).waitFor();
 const url=page.url();await page.reload();await page.getByRole('dialog',{name:address,exact:true}).waitFor();
 assert.equal(page.url(),url);
 await page.goto('http://localhost:5173');
 await page.getByRole('button',{name:'All (766)',exact:true}).waitFor();
 await page.getByRole('button',{name:/^Qualified \(/}).click();assert.ok(await colored()>0);
 await page.getByRole('button',{name:'Reset filters',exact:true}).click();assert.equal(await colored(),0);
 await page.getByTitle('I: Industrial / Light Industrial',{exact:true}).click();
 await page.screenshot({path:'scratch/zoning-filter-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'scratch/zoning-filter-mobile.png'});
 assert.deepEqual(errors,[]);
 console.log('PASS: all 23 zoning filters match source counts and reference colors; neutral default/reset; screening colors; address-only popup; Sites details navigation/reload; mobile overflow; no runtime errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
