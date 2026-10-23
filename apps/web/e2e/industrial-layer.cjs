// Requires the local web app at http://localhost:5173.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');

(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://localhost:5173');
  await page.locator('.dashboard-directory > div').first().waitFor();
  const industrial=page.getByRole('button',{name:'Industrial',exact:true});
  const parcels=page.getByRole('button',{name:'Parcels',exact:true});
  const redPaths=()=>page.locator('.leaflet-overlay-pane path').evaluateAll(elements=>elements.filter(e=>e.getAttribute('fill')==='#ef4444').length);
  const countPaths=()=>page.locator('.leaflet-overlay-pane path').evaluateAll(elements=>elements.filter(e=>['#3b82f6','#eab308','#ef4444','#a855f7','#15803d','#64748b','#94a3b8'].includes(e.getAttribute('fill'))).length);
  assert.equal(await page.getByTitle(/^Filter by Industrial/).count(),0);
  assert.equal(await redPaths(),36);assert.equal(await countPaths(),766);
  await industrial.click();assert.equal(await redPaths(),0);assert.equal(await countPaths(),730);
  assert.equal(await industrial.getAttribute('aria-pressed'),'false');
  await industrial.click();await parcels.click();
  assert.equal(await redPaths(),36);assert.equal(await countPaths(),36);
  await industrial.click();assert.equal(await countPaths(),0);
  await page.getByTitle('Reset study view and clear filters').click();
  assert.equal(await countPaths(),766);assert.equal(await industrial.getAttribute('aria-pressed'),'true');
  await page.getByTitle('Filter by Vacant (106)',{exact:true}).click();
  assert.equal(await countPaths(),106);assert.equal(await redPaths(),3);
  await industrial.click();assert.equal(await countPaths(),103);
  await page.setViewportSize({width:390,height:844});
  const bounds=await industrial.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:require('node:path').resolve(__dirname,'../../../scratch/industrial-toolbar-mobile.png')});
  assert.deepEqual(errors,[]);
  console.log('Industrial toolbar: category removal, independent visibility, counts, reset, filters and mobile layout passed.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
