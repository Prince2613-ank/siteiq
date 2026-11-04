const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true});try{
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:5173');await page.getByRole('button',{name:'All (766)',exact:true}).waitFor();
const min=page.getByRole('slider',{name:'Minimum owner age',exact:true});const max=page.getByRole('slider',{name:'Maximum owner age',exact:true});
assert.equal(await min.inputValue(),'0');assert.equal(await max.inputValue(),'100');
await min.focus();await min.press('ArrowRight');await page.getByRole('button',{name:'All (0)',exact:true}).waitFor();
await page.getByRole('button',{name:'Reset filters',exact:true}).click();assert.equal(await min.inputValue(),'0');assert.equal(await max.inputValue(),'100');
await page.route('**/geojson/parcels_250m.geojson',async route=>{const response=await route.fetch();const data=await response.json();data.features[0].properties.owner_age=50;data.features[1].properties.owner_age=100;data.features[2].properties.owner_age=0;await route.fulfill({json:data});});
await page.reload();await page.getByRole('button',{name:'All (766)',exact:true}).waitFor();
await min.fill('50');await max.fill('50');await page.getByRole('button',{name:'All (1)',exact:true}).waitFor();
await min.press('ArrowRight');assert.equal(await min.inputValue(),'50');await max.press('ArrowLeft');assert.equal(await max.inputValue(),'50');
await page.getByRole('button',{name:'Reset filters',exact:true}).click();await max.fill('0');await page.getByRole('button',{name:'All (1)',exact:true}).waitFor();
await page.getByRole('button',{name:'Reset filters',exact:true}).click();await min.fill('100');await page.getByRole('button',{name:'All (1)',exact:true}).waitFor();
await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
assert.deepEqual(errors,[]);console.log('PASS: dual slider defaults, keyboard, non-crossing endpoints, unknown ages excluded, exact ages 0/50/100, reset, mobile width, no runtime errors.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
