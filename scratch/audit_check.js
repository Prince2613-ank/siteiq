const fs = require('fs');
const path = require('path');

const geojsonDir = path.join(__dirname, '../apps/web/public/geojson');

console.log('=== PART 1 & 2 DATA AUDIT ===\n');

// 1. Check all files in public/geojson
const files = fs.readdirSync(geojsonDir);
console.log('Files in apps/web/public/geojson:');
files.forEach(f => {
  const stat = fs.statSync(path.join(geojsonDir, f));
  console.log(`  - ${f}: ${(stat.size / 1024).toFixed(2)} KB (${stat.size} bytes)`);
});

// Check geojson feature counts
const geojsonFiles = ['parcels_250m.geojson', 'roads.geojson', 'buffer_250m.geojson', 'wetlands_250m.geojson', 'buildings_250m.geojson'];

geojsonFiles.forEach(f => {
  const p = path.join(geojsonDir, f);
  if (fs.existsSync(p)) {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const count = data.features ? data.features.length : (data.geometries ? data.geometries.length : 1);
    console.log(`\nFeature count of ${f}: ${count}`);
    if (f === 'buffer_250m.geojson') {
      console.log(`  Type: ${data.type}, geometry type: ${data.features ? data.features[0]?.geometry?.type : data.geometry?.type}`);
    }
  } else {
    console.log(`\nFile ${f} DOES NOT EXIST`);
  }
});

// Check other files mentioned in PART 2
const otherFiles = [
  'parcels_250m_not_listed.geojson',
  'parcels_250m_qualified.geojson',
  'builtup_area_250m.geojson',
  'builtup_parcels_250m.geojson'
];
otherFiles.forEach(f => {
  const p = path.join(geojsonDir, f);
  console.log(`File ${f} exists in public/geojson? ${fs.existsSync(p)}`);
});

// Check by_category folder
const byCategoryDir = path.join(geojsonDir, 'by_category');
console.log(`by_category/ exists in public/geojson? ${fs.existsSync(byCategoryDir)}`);
if (fs.existsSync(byCategoryDir)) {
  const catFiles = fs.readdirSync(byCategoryDir);
  catFiles.forEach(cf => {
    const data = JSON.parse(fs.readFileSync(path.join(byCategoryDir, cf), 'utf8'));
    console.log(`  by_category/${cf}: ${data.features ? data.features.length : 0}`);
  });
}

// 2. Audit listing_check.json
const listingPath = path.join(geojsonDir, 'listing_check.json');
const parcelsPath = path.join(geojsonDir, 'parcels_250m.geojson');

const parcelsData = JSON.parse(fs.readFileSync(parcelsPath, 'utf8'));
const listingData = JSON.parse(fs.readFileSync(listingPath, 'utf8'));

console.log('\n--- LISTING CHECK AUDIT ---');
console.log(`Checked on: ${listingData.checked_on}`);
const lots = listingData.lots || {};
const lotKeys = Object.keys(lots);
console.log(`Total lots in listing_check.json: ${lotKeys.length}`);

// Status breakdown
const statusCounts = {};
let zillowCount = 0;
let redfinCount = 0;
let loopnetCount = 0;
let crexiCount = 0;
let noLinksCount = 0;
let googleLinks = [];
let realtorLinks = [];
let landLinks = [];
let searchOrCityLinks = [];

lotKeys.forEach(k => {
  const item = lots[k];
  const st = item.status || 'EMPTY/MISSING';
  statusCounts[st] = (statusCounts[st] || 0) + 1;

  const links = item.links || {};
  const linkKeys = Object.keys(links);
  if (linkKeys.length === 0) {
    noLinksCount++;
  }
  if (links.Zillow) zillowCount++;
  if (links.Redfin) redfinCount++;
  if (links.LoopNet) loopnetCount++;
  if (links.Crexi) crexiCount++;

  linkKeys.forEach(lk => {
    const url = links[lk];
    if (/google/i.test(url) || /google/i.test(lk)) googleLinks.push({ k, url });
    if (/realtor\.com/i.test(url) || /realtor/i.test(lk)) realtorLinks.push({ k, url });
    if (/land\.com/i.test(url) || /land/i.test(lk)) landLinks.push({ k, url });
    if (/google\.com\/search/i.test(url) || /\/city\//i.test(url)) searchOrCityLinks.push({ k, url });
  });

  // check proof
  if (item.proof) {
    const pUrl = item.proof;
    if (/google/i.test(pUrl)) googleLinks.push({ k, proof: pUrl });
    if (/realtor\.com/i.test(pUrl)) realtorLinks.push({ k, proof: pUrl });
    if (/land\.com/i.test(pUrl)) landLinks.push({ k, proof: pUrl });
    if (/google\.com\/search/i.test(pUrl) || /\/city\//i.test(pUrl)) searchOrCityLinks.push({ k, proof: pUrl });
  }
});

console.log('Status counts:');
Object.entries(statusCounts).forEach(([st, cnt]) => console.log(`  "${st}": ${cnt}`));
console.log(`Lots with Zillow link: ${zillowCount}`);
console.log(`Lots with Redfin link: ${redfinCount}`);
console.log(`Lots with LoopNet link: ${loopnetCount}`);
console.log(`Lots with Crexi link: ${crexiCount}`);
console.log(`Lots with NO links at all: ${noLinksCount}`);
console.log(`Google links found: ${googleLinks.length}`);
console.log(`Realtor links found: ${realtorLinks.length}`);
console.log(`Land.com links found: ${landLinks.length}`);
console.log(`Links containing google.com/search or /city/: ${searchOrCityLinks.length}`);

// Compare parcel keys with listing keys
const parcelKeys = parcelsData.features.map(f => {
  const p = f.properties;
  return `${(p.town || '').toUpperCase().trim()}|${(p.parcel_id || '').trim()}`;
});
const parcelKeySet = new Set(parcelKeys);
const lotKeySet = new Set(lotKeys);

const missingInListing = parcelKeys.filter(k => !lotKeySet.has(k));
const extraInListing = lotKeys.filter(k => !parcelKeySet.has(k));
console.log(`Missing in listing_check: ${missingInListing.length}`, missingInListing);
console.log(`Extra in listing_check: ${extraInListing.length}`, extraInListing);

// 3. Owner fields audit from parcels_250m.geojson
console.log('\n--- OWNER & TAX FIELDS AUDIT ---');
const ownerTypes = {};
const ownerDistanceGroups = {};
const taxSignals = {};

parcelsData.features.forEach(f => {
  const p = f.properties;
  const ot = p.owner_type || 'Unknown';
  ownerTypes[ot] = (ownerTypes[ot] || 0) + 1;

  const odg = p.owner_distance_group || 'unknown / not found';
  ownerDistanceGroups[odg] = (ownerDistanceGroups[odg] || 0) + 1;

  const rawTax = p.unpaid_tax_signal || '';
  const taxGroup = rawTax ? (rawTax.split('(')[0].trim() || rawTax) : 'No tax taking recorded';
  taxSignals[taxGroup] = (taxSignals[taxGroup] || 0) + 1;
});

console.log('Owner Types:');
Object.entries(ownerTypes).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

console.log('\nOwner Distance Groups:');
Object.entries(ownerDistanceGroups).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

console.log('\nUnpaid Tax Signals (grouped before first "("):');
Object.entries(taxSignals).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

// Also check raw unpaid_tax_signal values
console.log('\nRaw Unpaid Tax Signals breakdown:');
const rawTaxSignals = {};
parcelsData.features.forEach(f => {
  const s = f.properties.unpaid_tax_signal || '[none]';
  rawTaxSignals[s] = (rawTaxSignals[s] || 0) + 1;
});
Object.entries(rawTaxSignals).forEach(([k, v]) => console.log(`  "${k}": ${v}`));
