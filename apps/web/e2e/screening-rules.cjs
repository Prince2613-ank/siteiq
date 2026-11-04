const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'../../..');
const compiled=ts.transpileModule(fs.readFileSync(path.join(root,'apps/web/src/utils/parcelScreening.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const api={};new Function('exports',compiled)(api);
const screen=api.screenParcel;
const cases=[
 ['Town positive overrides conflicting wetland category', {category:'Non-developable',status:'Vacant',wetland_pct:61,category_reason:'over half wetland (61%); town code says developable'},'Y',4],
 ['Town negative cannot qualify as generic vacant', {category:'Non-developable',status:'Vacant',wetland_pct:0,category_reason:'town code says undevelopable; commercial/business zoning C'},'N',12],
 ['Restricted category cannot qualify as generic vacant', {category:'Non-developable',status:'Vacant',wetland_pct:0,category_reason:'cemetery / conservation / Chapter 61 use; zoned I (industrial)'},'N',11],
 ['Public vacant', {category:'Public land',status:'Vacant'},'N',1],
 ['Public mixed', {category:'Public land',status:'Mixed (vacant + built-up)'},'N',1],
 ['Non-developable above 50% wetland', {category:'Non-developable',status:'Vacant',wetland_pct:50.01},'N',2],
 ['Non-developable at exactly 50%', {category:'Non-developable',status:'Vacant',wetland_pct:50},'Y',6],
 ['Non-developable below 50%', {category:'Non-developable',status:'Vacant',wetland_pct:49.99},'Y',6],
 ['Commercial condo before open land', {category:'Commercial',status:'Vacant',use:'Residential Condominium'},'N',3],
 ['Developable condo before any-status qualification', {category:'Developable',status:'Mixed',use:'Office condo'},'N',3],
 ['Vacant commercial', {category:'Commercial',status:'Vacant'},'Y',4],
 ['Legacy Mixed must be classified first', {category:'Industrial',status:'Mixed (vacant + built-up)'},'N',9],
 ['Vacant developable', {category:'Developable',status:'Vacant'},'Y',4],
 ['Built-up developable remains excluded', {category:'Developable',status:'Built-up'},'N',7],
 ['Developable category permits paved open land', {category:'Developable',status:'Paved, no building'},'Y',4],
 ['Vacant residential', {category:'Built-up (other)',status:'Vacant'},'Y',6],
 ['Legacy Mixed other category', {category:'Non-developable',status:'Mixed',wetland_pct:20},'N',9],
 ['Built-up commercial', {category:'Commercial',status:'Built-up'},'N',7],
 ['Built-up industrial', {category:'Industrial',status:'Built-up'},'N',7],
 ['Paved land', {category:'Paved land',status:'Paved, no building'},'N',8],
 ['Unknown status', {category:'Other'},'N',9],
 ['Missing data', {},'N',9],
 ['Trimmed case-insensitive values', {category:' PUBLIC LAND ',status:' vacant '},'N',1],
 ['Vacant commercial below 1 usable acre', {category:'Commercial',status:'Vacant',usable_acres:0.99},'Y',4],
 ['Developable any-status below 1 usable acre', {category:'Developable',status:'Built-up',usable_acres:0.99},'N',7],
 ['Exactly 1 usable acre', {category:'Commercial',status:'Vacant',usable_acres:1},'Y',4],
 ['Above 1 usable acre', {category:'Industrial',status:'Vacant',usable_acres:1.01},'Y',4],
 ['Trust owner excluded', {category:'Commercial',status:'Vacant',owner_type:'Trust'},'N',1],
 ['Government owner excluded', {category:'Commercial',status:'Vacant',owner_type:'Government'},'N',1],
 ['Religious owner excluded', {category:'Commercial',status:'Vacant',owner_type:'Religious / non-profit'},'N',1],
 ['Individual owner qualified', {category:'Commercial',status:'Vacant',owner_type:'Individual'},'Y',4],
 ['Company owner qualified', {category:'Commercial',status:'Vacant',owner_type:'Company'},'Y',4],
 ['Unknown owner qualified', {category:'Commercial',status:'Vacant',owner_type:'Unknown'},'Y',4],
 ['Paved land with developable reason qualifies', {category:'Paved land',status:'Paved, no building',category_reason:'paved, no building; zoned I (industrial); town code says developable'},'Y',4],
 ['Paved land with commercial reason qualifies', {category:'Paved land',status:'Paved, no building',category_reason:'paved, no building; commercial land-use code 390; town code says developable'},'Y',4],
 ['Paved land without developable reason excluded', {category:'Paved land',status:'Paved, no building',category_reason:'paved, no building'},'N',8],
];
for(const [name,input,keep,rule] of cases){const result=screen({usable_acres:2,building_coverage_pct:input.status==='Built-up'?10:0,...input});assert.equal(result.keep,keep,name);assert.equal(result.screening_rule,rule,name);assert.equal(result.drop_reason===null,keep==='Y',name);}
const file=path.join(root,'apps/web/public/geojson/parcels_250m.geojson');
const data=JSON.parse(fs.readFileSync(file));
const {attachCoverage}=require('./parcel-coverage-fixture.cjs');
const listings=JSON.parse(fs.readFileSync(path.join(root,'apps/web/public/geojson/listing_check.json'),'utf8')).lots;
const screenSource=p=>{const listing=listings[`${p.town}|${p.parcel_id}`];return screen({...attachCoverage(p),listed_for_sale:Boolean(listing?.status&&listing.status!=='Not listed')});};
const summary={total:data.features.length,qualified:0,excluded:0,changed:0,rules:{},qualifiedBelowOneUsableAcre:0};
for(const f of data.features){const result=screenSource(f.properties);if(result.keep==='Y'){summary.qualified++;if(f.properties.usable_acres<1)summary.qualifiedBelowOneUsableAcre++;}else summary.excluded++;if(result.keep!==f.properties.keep)summary.changed++;summary.rules[result.screening_rule]=(summary.rules[result.screening_rule]||0)+1;}
if(process.argv.includes('--apply')){
 const backup=path.join(root,'scratch/geojson-backups/parcels_250m.geojson.pre_screening_rules.bak');
 if(!fs.existsSync(backup))fs.copyFileSync(file,backup);
 data.features=data.features.map(f=>({...f,properties:{...f.properties,...screenSource(f.properties)}}));
 fs.writeFileSync(file,JSON.stringify(data));
}
fs.writeFileSync(path.join(root,'scratch/screening-rules-audit.json'),JSON.stringify({casesPassed:cases.length,...summary},null,2));
console.log(JSON.stringify({casesPassed:cases.length,...summary},null,2));
