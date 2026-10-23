const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://localhost:5173/sites');
  await page.locator('tbody .parcel-score-badge').first().waitFor();
  assert.equal(await page.locator('thead th').count(),14);
  assert.equal(await page.locator('tbody .parcel-score-badge').count(),50);
  await page.locator('tbody tr').first().getByRole('button',{name:'Info',exact:true}).click();
  const dialog=page.getByRole('dialog');
  assert.equal(await dialog.locator('.site-info-section').count(),8);
  assert.equal(await dialog.locator('details, .parcel-score-card, .parcel-score-badge, select').count(),0);
  assert.doesNotMatch(await dialog.innerText(),/Opportunity scor|Unverified|Provisional ranking|Scoring complete/);
  for(const name of ['Property overview','Current listing status','Tax & public records','Owner & contact','Mortgage & property restrictions','Ownership & sale history','Estate & ownership signals','Listing history']) {
   assert.ok(await dialog.getByRole('heading',{name,exact:true}).isVisible());
  }
  await page.getByRole('button',{name:'Dismiss property information'}).click();
  await page.getByRole('button',{name:'Rank all 766 sites',exact:true}).click();
  const values=(await page.locator('tbody .parcel-score-badge').allTextContents()).map(value=>Number(value.split('/')[0]));
  assert.deepEqual(values,[...values].sort((a,b)=>b-a));
  await page.locator('tbody tr').first().getByTitle('Open parcel in Corridor Map',{exact:true}).click();
  const inspector=page.locator('.dashboard-inspector');await inspector.waitFor();
  assert.equal(await inspector.locator('.dashboard-section').count(),8);
  assert.equal(await inspector.locator('.parcel-score-card, .parcel-score-badge').count(),0);
  assert.doesNotMatch(await inspector.innerText(),/Opportunity scor|Unverified|Provisional ranking|Scoring complete/);
  await page.locator('button[aria-label="Back to parcel results"]').click();
  assert.ok(await page.locator('.dashboard-directory .parcel-score-badge').first().isVisible());
  await page.getByRole('combobox',{name:'Rank parcels'}).selectOption('score');
  const directoryScores=(await page.locator('.dashboard-directory .parcel-score-badge').allTextContents()).map(value=>Number(value.split('/')[0]));
  assert.deepEqual(directoryScores,[...directoryScores].sort((a,b)=>b-a));
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://localhost:5173/sites');
  await page.locator('tbody tr').first().getByRole('button',{name:'Info',exact:true}).click();
  assert.equal(await dialog.locator('.site-info-section').count(),8);
  assert.equal(await dialog.locator('.parcel-score-card, .parcel-score-badge, select').count(),0);
  assert.ok(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1));
  await page.screenshot({path:path.resolve(__dirname,'../../../scratch/site-info-restored-mobile.png')});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:path.resolve(__dirname,'../../../scratch/site-info-restored-desktop.png')});
  await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);
  assert.deepEqual(errors,[]);
  console.log('Restored information cards passed: 8 original sections, no score/unverified/review controls, list scores and ranks retained, desktop/mobile layout and Escape.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
