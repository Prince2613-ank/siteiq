// Requires the local web app at http://localhost:5173.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'../../..');
const records=JSON.parse(fs.readFileSync(path.join(root,'apps/web/public/geojson/parcels_250m.geojson'))).features.map(f=>f.properties);
const expected=records.filter(p=>p.usable_acres>=0&&p.usable_acres<1).length;
const api={};new Function('exports',ts.transpileModule(fs.readFileSync(path.join(root,'apps/web/src/utils/parcelScreening.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(api);
for(const [value,result] of [[0,true],[0.99,true],[1,false],[1.01,false],[null,false],[undefined,false],['',false],[' ',false],['unknown',false],[-1,false]])assert.equal(api.isUnderOneUsableAcre({usable_acres:value}),result);
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto('http://localhost:5173');
  const filter=page.getByTitle(`Filter by Under 1 usable acre (${expected})`,{exact:true});
  await filter.waitFor();await filter.click();
  assert.ok((await page.getByText(/3\. Parcel results/i).innerText()).includes(`(${expected})`));
  await page.getByRole('button',{name:/Qualified \(/}).click();
  await page.getByText('No parcels match your filters.').waitFor();
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  assert.ok((await page.getByText(/3\. Parcel results/i).innerText()).includes('(766)'));
  await page.goto('http://localhost:5173/sites');
  await page.getByRole('button',{name:'Info',exact:true}).first().waitFor();
  await page.getByRole('combobox',{name:'Rows per page'}).selectOption('0');
  await page.getByRole('combobox',{name:'Category',exact:true}).selectOption('UNDER_1_USABLE_ACRE');
  assert.equal(await page.getByRole('button',{name:'Info',exact:true}).count(),expected);
  await page.getByRole('button',{name:/Qualified \(/}).click();
  assert.equal(await page.getByRole('button',{name:'Info',exact:true}).count(),0);
  await page.getByRole('button',{name:/Excluded \(/}).click();
  assert.equal(await page.getByRole('button',{name:'Info',exact:true}).count(),expected);
  console.log(`Under 1 usable acre: ${expected} parcels; both pages, screening combinations, reset and threshold boundaries passed.`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
