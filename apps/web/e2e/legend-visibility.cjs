// Requires the local web app at http://localhost:5173.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const records=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../public/geojson/parcels_250m.geojson'))).features.map(f=>f.properties);
const definitions={
 'Commercial':p=>p.category==='Commercial',
 'Developable':p=>p.category==='Developable',
 'Non-Developable':p=>p.category==='Non-developable',
 'Public Land':p=>p.category==='Public land',
 'Built-up (other)':p=>p.category==='Built-up (other)',
 'Paved Land':p=>p.category==='Paved land',
 'Vacant':p=>p.status==='Vacant',
 'Mixed (Vacant + Built-up)':p=>p.status==='Mixed (vacant + built-up)',
 'Built-up':p=>p.status==='Built-up',
 'Paved, no building':p=>p.status==='Paved, no building',
 'Under 1 usable acre':p=>p.usable_acres>=0&&p.usable_acres<1,
};
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto('http://localhost:5173');await page.locator('.dashboard-directory > div').first().waitFor();
  const legend=page.locator('.dashboard-map-legend');
  const verify=async(items)=>{
   const expected=Object.fromEntries(Object.entries(definitions).map(([label,match])=>[label,items.filter(match).length]).filter(([,count])=>count>0));
   const titles=await legend.locator('button[title]').evaluateAll(elements=>elements.map(e=>e.title));
   const actual=Object.fromEntries(titles.map(title=>{const match=title.match(/^Filter by (.+) \((\d+)\)$/);assert.ok(match,title);return [match[1],Number(match[2])];}));
   assert.deepEqual(actual,expected);
   for(const label of ['Map layers','Industrial','Wetlands','Buildings','Roads'])assert.equal(await legend.getByText(label,{exact:true}).count(),0);
  };
  await verify(records);
  for(const name of ['Parcels','Wetlands','Industrial','Buildings','Roads'])assert.ok(await page.getByRole('button',{name,exact:true}).isVisible());
  await page.getByRole('button',{name:/Qualified \(/}).click();
  const qualified=records.filter(p=>p.keep==='Y');await verify(qualified);
  assert.equal(await legend.getByRole('heading',{name:'Land size',exact:true}).count(),0);
  await legend.getByTitle(/^Filter by Vacant /).click();
  await verify(qualified.filter(p=>p.status==='Vacant'));
  await page.locator('.dashboard-filter-card').getByText('Main St',{exact:true}).click();
  await verify(qualified.filter(p=>p.status==='Vacant'&&p.road==='Main St'));
  await legend.getByRole('button',{name:'Reset Filters',exact:true}).click();await verify(records);
  await page.getByPlaceholder('Search address, parcel ID, or owner...').fill('12 RABBIT RD');
  await verify(records.filter(p=>(p.address||'').includes('12 RABBIT RD')));
  assert.equal(await legend.getByRole('heading',{name:'Land category',exact:true}).count(),0);
  await page.getByPlaceholder('Search address, parcel ID, or owner...').fill('does-not-exist-qa');
  await verify([]);assert.equal(await legend.locator('.dashboard-legend-group').count(),0);
  assert.ok(await legend.getByText('No matching parcels.',{exact:true}).isVisible());
  await legend.getByRole('button',{name:'Reset Filters',exact:true}).click();await verify(records);
  console.log('Legend-only checks passed: matching counts, hidden zero entries/groups, removed map-layer section, unchanged toolbar, combined filters, search, empty state and reset.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
