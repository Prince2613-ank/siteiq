const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'../../..');
const compiled=ts.transpileModule(fs.readFileSync(path.join(root,'apps/web/src/utils/parcelScreening.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const api={};new Function('exports',compiled)(api);
const screen=api.screenParcel;
const cases=[
 ['Public vacant', {category:'Public land',status:'Vacant'},'N',1],
 ['Public mixed', {category:'Public land',status:'Mixed (vacant + built-up)'},'N',1],
 ['Non-developable above 50% wetland', {category:'Non-developable',status:'Vacant',wetland_pct:50.01},'N',2],
 ['Non-developable at exactly 50%', {category:'Non-developable',status:'Vacant',wetland_pct:50},'Y',6],
 ['Non-developable below 50%', {category:'Non-developable',status:'Vacant',wetland_pct:49.99},'Y',6],
 ['Commercial condo before open land', {category:'Commercial',status:'Vacant',use:'Residential Condominium'},'N',3],
 ['Developable condo before any-status qualification', {category:'Developable',status:'Mixed',use:'Office condo'},'N',3],
 ['Vacant commercial', {category:'Commercial',status:'Vacant'},'Y',4],
 ['Mixed industrial', {category:'Industrial',status:'Mixed (vacant + built-up)'},'Y',4],
 ['Vacant developable', {category:'Developable',status:'Vacant'},'Y',4],
 ['Built-up developable', {category:'Developable',status:'Built-up'},'Y',5],
 ['Paved developable', {category:'Developable',status:'Paved, no building'},'Y',5],
 ['Vacant residential', {category:'Built-up (other)',status:'Vacant'},'Y',6],
 ['Mixed other category', {category:'Non-developable',status:'Mixed',wetland_pct:20},'Y',6],
 ['Built-up commercial', {category:'Commercial',status:'Built-up'},'N',7],
 ['Built-up industrial', {category:'Industrial',status:'Built-up'},'N',7],
 ['Paved land', {category:'Paved land',status:'Paved, no building'},'N',8],
 ['Unknown status', {category:'Other'},'N',9],
 ['Missing data', {},'N',9],
 ['Trimmed case-insensitive values', {category:' PUBLIC LAND ',status:' vacant '},'N',1],
 ['Vacant commercial below 1 usable acre', {category:'Commercial',status:'Vacant',usable_acres:0.99},'N',9],
 ['Developable any-status below 1 usable acre', {category:'Developable',status:'Built-up',usable_acres:0.99},'N',9],
 ['Exactly 1 usable acre', {category:'Commercial',status:'Vacant',usable_acres:1},'Y',4],
 ['Above 1 usable acre', {category:'Industrial',status:'Vacant',usable_acres:1.01},'Y',4],
 ['Zero usable acreage', {category:'Developable',status:'Vacant',usable_acres:0},'N',9],
 ['Missing usable acreage', {category:'Developable',status:'Vacant',usable_acres:null},'N',9],
 ['Invalid usable acreage', {category:'Developable',status:'Vacant',usable_acres:'unknown'},'N',9],
];
for(const [name,input,keep,rule] of cases){const result=screen({usable_acres:2,...input});assert.equal(result.keep,keep,name);assert.equal(result.screening_rule,rule,name);assert.equal(result.drop_reason===null,keep==='Y',name);}
const file=path.join(root,'apps/web/public/geojson/parcels_250m.geojson');
const data=JSON.parse(fs.readFileSync(file));
const summary={total:data.features.length,qualified:0,excluded:0,changed:0,rules:{},qualifiedBelowOneUsableAcre:0};
for(const f of data.features){const result=screen(f.properties);if(result.keep==='Y'){summary.qualified++;if(f.properties.usable_acres<1)summary.qualifiedBelowOneUsableAcre++;}else summary.excluded++;if(result.keep!==f.properties.keep)summary.changed++;summary.rules[result.screening_rule]=(summary.rules[result.screening_rule]||0)+1;}
if(process.argv.includes('--apply')){
 const backup=path.join(root,'scratch/geojson-backups/parcels_250m.geojson.pre_screening_rules.bak');
 if(!fs.existsSync(backup))fs.copyFileSync(file,backup);
 data.features=data.features.map(f=>({...f,properties:{...f.properties,...screen(f.properties)}}));
 fs.writeFileSync(file,JSON.stringify(data));
}
fs.writeFileSync(path.join(root,'scratch/screening-rules-audit.json'),JSON.stringify({casesPassed:cases.length,...summary},null,2));
console.log(JSON.stringify({casesPassed:cases.length,...summary},null,2));
