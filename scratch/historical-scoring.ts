// Refined ranking model, independent of the parcel qualification rules.
export interface ScoringInput {
  category?: string; acres?: number | string | null; usable_acres?: number | string | null; wetland_pct?: number | string | null;
  years_owned?: number | string | null; last_sale_date?: string | null; last_sale_price?: string | null;
  owner_type?: string; owner_distance_miles?: number | string | null;
  owner_distance_group?: string; owner_lives_on_lot?: string;
  life_event_signal?: string; unpaid_tax_signal?: string;
  past_listing_attempt?: string; zillow_past_attempt?: string; redfin_past_attempt?: string;
  open_mortgage?: string | null; lease_easement_restriction?: string | null;
  // Derived from parcel geometry by withNearbyIndustry().
  industrial_lots_within_quarter_mile?: number | null;
  // Structured findings can be supplied by a later data import.
  highway_exit_road_miles?: number | string | null; lawsuit_on_title?: boolean;
}

export type FactorId = 'highway' | 'land' | 'size' | 'industry' | 'estate' | 'tax' | 'listing' | 'tenure' | 'distance' | 'family' | 'lawsuit' | 'lease' | 'wetland' | 'recent' | 'mortgage' | 'restriction';
export interface ScoreFactor {
  id: FactorId; label: string; group: 'site' | 'seller' | 'blocker'; max: number;
  options: readonly (readonly [number, string])[];
  points: number; evidence: string; hasData: boolean;
}

export const SCORING_VERSION = 'ranking-v4';
// Seller factors can add up to more than 60; only the first 60 count.
export const SELLER_CAP = 60;
// Usable (dry, open) acres. Exact endpoints enter the higher band.
export const SIZE_SCORE_BANDS = [
  { minimum: 3, points: 15, label: '3+ usable acres' },
  { minimum: 1.5, points: 10, label: '1.5 to under 3 usable acres' },
  { minimum: 0.75, points: 5, label: '0.75 to under 1.5 usable acres' },
  { minimum: 0, points: 0, label: 'Under 0.75 usable acres' },
] as const;
export const FACTORS: readonly Omit<ScoreFactor, 'points' | 'evidence' | 'hasData'>[] = [
  { id: 'highway', label: 'Distance to highway exit', group: 'site', max: 10, options: [[10, 'Under 0.5 mile'], [5, '0.5 to 1 mile'], [0, 'Over 1 mile']] },
  { id: 'land', label: 'Land type', group: 'site', max: 10, options: [[10, 'Industrial or developable'], [5, 'Commercial or paved lot'], [0, 'House lot, non-developable or public']] },
  { id: 'size', label: 'Usable size (dry, open land)', group: 'site', max: 15, options: SIZE_SCORE_BANDS.map(band => [band.points, band.label] as const) },
  { id: 'industry', label: 'Industry nearby', group: 'site', max: 5, options: [[5, '2+ industrial lots within ¼ mile'], [0, 'Fewer']] },
  { id: 'estate', label: 'Estate after a death', group: 'seller', max: 40, options: [[40, 'Estate record for owner or same-name family'], [30, 'Life estate on deed'], [20, 'Estate record after purchase, to check'], [0, 'No estate record']] },
  { id: 'tax', label: 'Unpaid property tax', group: 'seller', max: 40, options: [[40, 'Recent tax taking, no payoff found'], [20, 'Older tax taking, status unclear'], [0, 'No tax taking by current owner']] },
  { id: 'listing', label: 'Old listing taken down', group: 'seller', max: 35, options: [[35, 'Listed and withdrawn, never sold'], [15, 'Listed right now'], [5, 'Previous owner only'], [0, 'No past listing']] },
  { id: 'tenure', label: 'Years owned', group: 'seller', max: 25, options: [[25, '40+ years'], [20, '30 to 39'], [15, '20 to 29'], [5, '10 to 19'], [0, 'Under 10']] },
  { id: 'distance', label: 'Owner lives far away', group: 'seller', max: 15, options: [[15, '50+ miles'], [10, '10 to 50 miles'], [5, 'Other town within 10 miles'], [0, 'Same town or on the lot']] },
  { id: 'family', label: 'Passed within the family', group: 'seller', max: 10, options: [[10, '$0–$100 family deed, held 10+ years'], [0, 'No qualifying family transfer']] },
  { id: 'lawsuit', label: 'Lawsuit on title', group: 'blocker', max: 10, options: [[-10, 'Lawsuit recorded'], [0, 'No lawsuit recorded']] },
  { id: 'lease', label: 'Lease on the lot', group: 'blocker', max: 10, options: [[-10, 'Lease recorded'], [0, 'No lease recorded']] },
  { id: 'recent', label: 'Bought in last 3 years', group: 'blocker', max: 10, options: [[-10, 'Bought within last 3 years'], [0, 'Not bought within last 3 years']] },
  { id: 'wetland', label: 'Wetlands', group: 'blocker', max: 10, options: [[-10, '25%+ of lot'], [-5, '10 to under 25%'], [0, 'Under 10%']] },
  { id: 'mortgage', label: 'Open mortgage', group: 'blocker', max: 5, options: [[-5, 'Open mortgage recorded'], [0, 'No open mortgage recorded']] },
  { id: 'restriction', label: 'Resale restriction or easement', group: 'blocker', max: 5, options: [[-5, 'Town housing loan or utility easement recorded'], [0, 'None recorded']] },
];

function number(value: unknown): number | null {
  if (value == null || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function date(value: unknown): Date | null {
  const raw = text(value);
  // Accept the source's month-name dates and explicit ISO dates only.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) && !/^[A-Za-z]{3}\s+\d{1,2},?\s+\d{4}$/.test(raw)) return null;
  const parsed = new Date(raw.length === 10 ? `${raw}T12:00:00Z` : `${raw} 12:00:00 GMT`);
  if (!Number.isFinite(parsed.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && parsed.toISOString().slice(0, 10) !== raw) return null;
  const parts = raw.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (parts && (parsed.getUTCDate() !== Number(parts[2]) || parsed.getUTCFullYear() !== Number(parts[3]))) return null;
  return parsed;
}
function yearsBefore(value: Date, years: number) {
  const result = new Date(value); result.setUTCFullYear(result.getUTCFullYear() - years); return result;
}
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const UTILITY = /ELECTRIC|GAS CO|VERIZON|TELEPHONE|TELEGRAP|NATIONAL GRID|EVERSOURCE|UNITIL|COMCAST|WATER/i;

export function scoreParcel(parcel: ScoringInput, asOf = new Date()) {
  if (!Number.isFinite(asOf.getTime())) throw new Error('A valid scoring date is required.');
  asOf = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate(), 12));
  const findings: Partial<Record<FactorId, [number | null, string]>> = {};
  const set = (id: FactorId, points: number | null, evidence: string) => { findings[id] = [points, evidence]; };

  const miles = number(parcel.highway_exit_road_miles);
  set('highway', miles === null ? null : miles < 0.5 ? 10 : miles <= 1 ? 5 : 0,
    miles === null ? 'Highway exit driving distance is not recorded. Corridor distance is not highway distance.' : `${miles} road miles to a highway exit.`);
  const category = text(parcel.category).toLowerCase();
  const landPoints: Record<string, number> = { industrial: 10, developable: 10, commercial: 5, 'paved land': 5, 'built-up (other)': 0, 'non-developable': 0, 'public land': 0 };
  set('land', category in landPoints ? landPoints[category] : null, `Recorded category: ${parcel.category || 'Not provided'}.`);
  const usable = number(parcel.usable_acres);
  const sizeBand = usable === null ? undefined : SIZE_SCORE_BANDS.find(band => usable >= band.minimum);
  set('size', sizeBand?.points ?? null,
    sizeBand ? `${usable} usable acres (${parcel.acres ?? '?'} total): ${sizeBand.label}.` : 'Usable lot area is missing.');
  const industrial = number(parcel.industrial_lots_within_quarter_mile);
  set('industry', industrial === null ? null : industrial >= 2 ? 5 : 0,
    industrial === null ? 'Nearby industrial lots have not been counted.' : `${industrial} other industrial lot${industrial === 1 ? '' : 's'} within ¼ mile (centre to centre, corridor parcels only).`);

  const estate = text(parcel.life_event_signal);
  set('estate', /estate record for owner or a family member/i.test(estate) ? 40 : /life estate on deed/i.test(estate) ? 30 :
    /estate record filed after current owner bought/i.test(estate) ? 20 : estate && !/^not checked/i.test(estate) ? 0 : null,
    estate || 'Estate records have not been checked.');
  const tax = text(parcel.unpaid_tax_signal);
  set('tax', /^recent tax taking.*no redemption/i.test(tax) ? 40 : /^older tax taking/i.test(tax) ? 20 :
    /^(no tax taking|tax taking under a previous owner only|public owner)/i.test(tax) ? 0 : null,
    tax || 'Unpaid tax has not been checked.');

  const saleDate = date(parcel.last_sale_date);
  const price = text(parcel.last_sale_price).match(/^\$(\d[\d,]*)/);
  const nominal = price ? Number(price[1].replace(/,/g, '')) <= 100 : null;
  const attempts = [parcel.past_listing_attempt, parcel.zillow_past_attempt, parcel.redfin_past_attempt].map(text).filter(Boolean);
  // A listing that began before a priced purchase was the seller's attempt. After a
  // $0–$100 family or trust transfer, the same family still holds the land.
  const listedBeforePurchase = (value: string) => {
    const first = Array.from(value.matchAll(/\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})\b/g))
      .map(match => date(`${match[2]} ${match[1]}, ${match[3]}`)).filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime())[0];
    return Boolean(first && saleDate && nominal === false && first < saleDate);
  };
  const listingPoints = (value: string) =>
    /previous owner/i.test(value) ? 5 :
    /not sold|never sold|no sale recorded - listing ended/i.test(value) ? (listedBeforePurchase(value) ? 5 : 35) :
    /for sale now|under agreement now|currently listed|currently under agreement/i.test(value) ? 15 :
    /^(no unsold past listing|none since last sale|no history on)/i.test(value) || /^sold\b/i.test(value) ? 0 : null;
  const scoredAttempts = attempts.map(value => [listingPoints(value), value] as const).filter(([points]) => points !== null);
  const bestAttempt = scoredAttempts.sort((a, b) => (b[0] ?? 0) - (a[0] ?? 0))[0];
  set('listing', bestAttempt?.[0] ?? null, bestAttempt ? `${bestAttempt[1]}${bestAttempt[0] === 5 && !/previous owner/i.test(bestAttempt[1]) ? ` Listed before the current owner bought on ${parcel.last_sale_date}.` : ''}` : 'No listing history checked.');

  const years = number(parcel.years_owned);
  set('tenure', years === null ? null : years >= 40 ? 25 : years >= 30 ? 20 : years >= 20 ? 15 : years >= 10 ? 5 : 0,
    years === null ? 'Years owned is missing.' : `${years} years owned in source record.`);
  const distance = number(parcel.owner_distance_miles);
  const group = text(parcel.owner_distance_group);
  set('distance', parcel.owner_lives_on_lot === 'Y' ? 0 : distance !== null && distance >= 50 ? 15 : distance !== null && distance >= 10 ? 10 :
    group === 'Within 10 miles' ? 5 : group === 'Same town' ? 0 : null,
    parcel.owner_lives_on_lot === 'Y' ? 'Owner mailing address is the lot.' :
    distance !== null && group ? `${group}; ${distance} miles from the lot.` : 'Owner mailing address is not recorded.');
  const personOrTrust = ['individual', 'trust'].includes(text(parcel.owner_type).toLowerCase());
  set('family', nominal === null ? null : nominal && personOrTrust && years === null ? null : nominal && personOrTrust && years !== null && years >= 10 ? 10 : 0,
    nominal === null ? 'Last transfer price is not recorded.' : `Last transfer ${price![0]} to ${parcel.owner_type || 'unknown owner type'}${years !== null ? `, held ${years} years` : ''}.`);

  set('lawsuit', typeof parcel.lawsuit_on_title === 'boolean' ? (parcel.lawsuit_on_title ? -10 : 0) : null,
    typeof parcel.lawsuit_on_title === 'boolean' ? 'Title-litigation search recorded.' : 'No lawsuit (lis pendens) search recorded.');
  const restrictions = text(parcel.lease_easement_restriction);
  const restrictionsChecked = restrictions && !/^not checked/i.test(restrictions);
  set('lease', /\blease\s+x[1-9]/i.test(restrictions) ? -10 : restrictionsChecked ? 0 : null,
    restrictions.match(/Lease x[^|]*/i)?.[0].trim() || restrictions || 'Leases have not been checked.');
  const parsedWetlands = number(parcel.wetland_pct);
  const wetlands = parsedWetlands !== null && parsedWetlands <= 100 ? parsedWetlands : null;
  set('wetland', wetlands === null ? null : wetlands >= 25 ? -10 : wetlands >= 10 ? -5 : 0,
    wetlands === null ? 'Wetland coverage is missing.' : `${wetlands}% wetland coverage.`);
  const nominalRecent = saleDate && saleDate > yearsBefore(asOf, 3) && /nominal|family|trust transfer/i.test(text(parcel.last_sale_price));
  set('recent', saleDate && saleDate <= asOf && !nominalRecent ? (saleDate > yearsBefore(asOf, 3) ? -10 : 0) : null,
    nominalRecent ? `Source records a nominal / family transfer rather than a confirmed purchase: ${parcel.last_sale_date}; ${parcel.last_sale_price}.` :
    saleDate && saleDate <= asOf ? `Last recorded transfer: ${parcel.last_sale_date}.` : 'Last sale date is missing, invalid or in the future.');
  const mortgage = text(parcel.open_mortgage);
  const mortgageChecked = mortgage && !/^not checked/i.test(mortgage);
  const townLoan = /town housing rehab loan/i.test(mortgage);
  const openLoans = Number(mortgage.match(/^(\d+)\s+open\b/i)?.[1] ?? 0);
  // A single open town housing loan is the resale restriction, not a second deduction.
  set('mortgage', openLoans > (townLoan ? 1 : 0) ? -5 : openLoans || /^no (?:open )?mortgage\b/i.test(mortgage) ? 0 : null,
    openLoans === 1 && townLoan ? 'Only open loan is the town housing loan, deducted as a resale restriction.' : mortgage || 'Open mortgage status has not been checked.');
  // A town housing loan and a utility easement together still deduct once.
  const grantees = Array.from(restrictions.matchAll(/Easement x\d+ \(([^)]*)\)/gi)).map(match => match[1].match(/^to ([^;]+)/i)?.[1] ?? '');
  const utility = grantees.find(name => UTILITY.test(name));
  set('restriction', townLoan || utility ? -5 : grantees.some(name => !name) || !mortgageChecked || !restrictionsChecked ? null : 0,
    [townLoan && 'Town housing rehab loan recorded.', utility && `Utility easement to ${utility}.`].filter(Boolean).join(' ') ||
    (grantees.length ? `Easement to ${grantees.map(name => name || 'unnamed grantee').join('; ')}; not a utility.` : mortgageChecked && restrictionsChecked ? 'No town housing loan or easement recorded.' : 'Not fully checked.'));

  const factors: ScoreFactor[] = FACTORS.map(definition => {
    const finding = findings[definition.id] ?? [null, 'No supporting source data.'];
    return { ...definition, points: finding[0] ?? 0, evidence: finding[1], hasData: finding[0] !== null };
  });
  const total = (group: ScoreFactor['group']) => factors.filter(f => f.group === group).reduce((sum, f) => sum + f.points, 0);
  const site = total('site'), seller = Math.min(SELLER_CAP, total('seller')), deductions = total('blocker');
  const raw = site + seller + deductions;
  return {
    score: clamp(raw), raw, site, seller, deductions, factors,
    asOf: asOf.toISOString().slice(0, 10),
  };
}

// Count other Industrial-category lots whose centres lie within a quarter mile.
// Only lots in the loaded corridor are counted.
type Ring = number[][];
interface ParcelGeometry { type: string; coordinates: unknown }
const QUARTER_MILE_METRES = 402.336;
function centre(geometry?: ParcelGeometry | null): [number, number] | null {
  const rings: Ring[] = geometry?.type === 'Polygon' ? [(geometry.coordinates as Ring[])[0]] :
    geometry?.type === 'MultiPolygon' ? (geometry.coordinates as Ring[][]).map(polygon => polygon[0]) : [];
  let area = 0, x = 0, y = 0;
  for (const ring of rings) for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1], cross = x1 * y2 - x2 * y1;
    area += cross; x += (x1 + x2) * cross; y += (y1 + y2) * cross;
  }
  return area ? [x / (3 * area), y / (3 * area)] : null;
}
export function withNearbyIndustry<T extends ScoringInput>(features: readonly { properties: T; geometry?: ParcelGeometry | null }[]): T[] {
  const centres = features.map(feature => centre(feature.geometry));
  const industrial = features.map((feature, index) => text(feature.properties.category).toLowerCase() === 'industrial' ? index : -1).filter(index => index >= 0);
  return features.map((feature, index) => {
    const here = centres[index];
    if (!here) return { ...feature.properties, industrial_lots_within_quarter_mile: null };
    const metresPerDegree = [111320 * Math.cos(here[1] * Math.PI / 180), 110540];
    const count = industrial.filter(other => {
      const there = centres[other];
      return other !== index && there !== null &&
        Math.hypot((here[0] - there[0]) * metresPerDegree[0], (here[1] - there[1]) * metresPerDegree[1]) <= QUARTER_MILE_METRES;
    }).length;
    return { ...feature.properties, industrial_lots_within_quarter_mile: count };
  });
}

export function scoringStorageKey(parcel: { town?: string; parcel_id?: string; address?: string }) {
  return `siteiq:ranking:${SCORING_VERSION}:${text(parcel.town).toUpperCase()}|${text(parcel.parcel_id) || text(parcel.address)}`;
}
