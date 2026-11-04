const fs = require('node:fs');
const path = require('node:path');
const coverage = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/geojson/parcel_building_coverage.json'), 'utf8')).parcels;
function attachCoverage(p) {
  const percent = coverage[`${p.town.trim().toUpperCase()}|${p.parcel_id.trim()}`]?.building_pct;
  const measured = typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 && percent <= 100;
  const vacant = measured ? percent <= 5 : ['vacant', 'paved, no building'].includes((p.status || '').trim().toLowerCase());
  let category = p.category;
  const reason = (p.category_reason || '').toLowerCase();
  const negative = /\b(?:undevelopable|non[ -]developable|not developable)\b/.test(reason);
  if (category !== 'Public land' && !negative) {
    if (reason.includes('town code says developable')) category = 'Developable';
    else if (!category || category === 'Paved land') {
      if (reason.includes('industrial') || reason.includes('zoned i') || reason.includes('land use 440')) category = 'Industrial';
      else if (reason.includes('commercial') || /\b(?:390|391|3900|3910|031|334|337)\b/.test(reason)) category = 'Commercial';
    }
  }
  return { ...p, category, recorded_development_status: p.status, building_coverage_pct: percent ?? null,
    building_coverage_source: coverage[`${p.town.trim().toUpperCase()}|${p.parcel_id.trim()}`]?.measurement_source,
    status: vacant ? 'Vacant' : 'Built-up' };
}
const isBrowsable = () => true;
module.exports = { attachCoverage, isBrowsable };
