// Business-plan ranking, independent of the parcel qualification rules.
export interface ScoringInput {
  category?: string; acres?: number | string | null; wetland_pct?: number | string | null;
  years_owned?: number | string | null; last_sale_date?: string | null; last_sale_price?: string | null;
  owner_mailing_address?: string; state?: string; owner_distance_miles?: number | string | null;
  owner_distance_group?: string; owner_lives_on_lot?: string;
  life_event_signal?: string; estate_record_detail?: string; unpaid_tax_signal?: string;
  past_listing_attempt?: string; zillow_past_attempt?: string; redfin_past_attempt?: string;
  open_mortgage?: string | null; lease_easement_restriction?: string | null;
  // Structured findings can be supplied by a later data import.
  highway_exit_road_miles?: number | string | null;
  nearby_industry?: 'several' | 'few' | 'none'; buildable_residential?: boolean;
  owner_age?: number | string | null; inherited_by_children?: boolean;
  owner_estate_confirmed?: boolean; unpaid_tax_confirmed?: boolean;
  old_listing_taken_down_date?: string; old_listing_never_sold?: boolean;
  road_access?: boolean; has_active_lease?: boolean; has_open_mortgage?: boolean;
}

export type FactorId = 'highway' | 'land' | 'size' | 'industry' | 'estate' | 'tax' | 'listing' | 'age' | 'tenure' | 'distance' | 'access' | 'lease' | 'wetland' | 'recent' | 'mortgage';
export interface ScoreFactor {
  id: FactorId; label: string; group: 'site' | 'seller' | 'blocker'; max: number;
  options: readonly (readonly [number, string])[];
  points: number; evidence: string; hasData: boolean;
}

export const SCORING_VERSION = 'business-plan-v1';
export const FACTORS: readonly Omit<ScoreFactor, 'points' | 'evidence' | 'hasData'>[] = [
  { id: 'highway', label: 'Distance to highway exit', group: 'site', max: 15, options: [[15, 'Under 1 road mile'], [10, '1 to under 2 road miles'], [5, '2 to 3 road miles'], [0, 'Over 3 road miles']] },
  { id: 'land', label: 'Land type', group: 'site', max: 10, options: [[10, 'Commercial or industrial'], [6, 'Buildable residential'], [0, 'Other land type']] },
  { id: 'size', label: 'Lot size (total acres)', group: 'site', max: 10, options: [[10, '5+ acres'], [7, '2 to under 5 acres'], [4, '1 to under 2 acres'], [1, 'Under 1 acre']] },
  { id: 'industry', label: 'Nearby industry', group: 'site', max: 5, options: [[5, 'Several businesses within 1 mile'], [2, 'A few businesses within 1 mile'], [0, 'None within 1 mile']] },
  { id: 'estate', label: 'Estate after a death', group: 'seller', max: 14, options: [[14, 'Death / probate confirmed for owner'], [0, 'No qualifying owner record']] },
  { id: 'tax', label: 'Unpaid property tax', group: 'seller', max: 14, options: [[14, 'Unpaid tax confirmed by town'], [0, 'No confirmed unpaid tax']] },
  { id: 'listing', label: 'Old listing taken down', group: 'seller', max: 10, options: [[10, 'Listed within 5 years, taken down, never sold'], [0, 'No qualifying unsold listing']] },
  { id: 'age', label: 'Owner age or heirs', group: 'seller', max: 8, options: [[8, 'Owner 70+ or land passed to children'], [0, 'Neither condition applies']] },
  { id: 'tenure', label: 'Years owned', group: 'seller', max: 7, options: [[7, '30+ years'], [5, '20 to under 30 years'], [2, '10 to under 20 years'], [0, 'Under 10 years']] },
  { id: 'distance', label: 'Owner lives far away', group: 'seller', max: 7, options: [[7, 'Owner in another state'], [4, 'Same state, 50+ miles away'], [0, 'Same town / under 50 miles']] },
  { id: 'access', label: 'No road access', group: 'blocker', max: 15, options: [[-15, 'No road access confirmed'], [0, 'Road access confirmed']] },
  { id: 'lease', label: 'Lease', group: 'blocker', max: 15, options: [[-15, 'Lease applies'], [0, 'No applicable lease']] },
  { id: 'wetland', label: 'Wetlands', group: 'blocker', max: 10, options: [[-10, 'Wetland coverage recorded'], [0, 'No wetland coverage recorded']] },
  { id: 'recent', label: 'Bought in last 3 years', group: 'blocker', max: 10, options: [[-10, 'Bought within last 3 years'], [0, 'Not bought within last 3 years']] },
  { id: 'mortgage', label: 'Open mortgage', group: 'blocker', max: 5, options: [[-5, 'Open mortgage recorded'], [0, 'No open mortgage recorded']] },
];

function number(value: unknown): number | null {
  if (value == null || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function unknown(value: string): boolean { return !value || /not checked|unknown|not available|not confirmed|not found|not provided|out of date/i.test(value); }
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

export function scoreParcel(parcel: ScoringInput, asOf = new Date()) {
  if (!Number.isFinite(asOf.getTime())) throw new Error('A valid scoring date is required.');
  asOf = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate(), 12));
  const findings: Partial<Record<FactorId, [number | null, string]>> = {};
  const set = (id: FactorId, points: number | null, evidence: string) => { findings[id] = [points, evidence]; };
  const miles = number(parcel.highway_exit_road_miles);
  set('highway', miles === null ? null : miles < 1 ? 15 : miles < 2 ? 10 : miles <= 3 ? 5 : 0,
    miles === null ? 'Highway exit driving distance is not recorded. Corridor distance is not highway distance.' : `${miles} road miles to a highway exit.`);
  const category = text(parcel.category).toLowerCase();
  set('land', ['commercial', 'industrial'].includes(category) ? 10 : parcel.buildable_residential === true ? 6 :
    parcel.buildable_residential === false || ['public land', 'non-developable', 'paved land'].includes(category) ? 0 : null,
    ['commercial', 'industrial'].includes(category) ? `Recorded category: ${parcel.category}.` : parcel.buildable_residential === true ? 'Residential buildability recorded.' : `Recorded category: ${parcel.category || 'Not provided'}. No buildable residential finding recorded.`);
  const acres = number(parcel.acres);
  set('size', acres === null ? null : acres >= 5 ? 10 : acres >= 2 ? 7 : acres >= 1 ? 4 : 1,
    acres === null ? 'Total lot area is missing.' : `${acres} total acres. Qualification separately uses usable acres.`);
  set('industry', parcel.nearby_industry === 'several' ? 5 : parcel.nearby_industry === 'few' ? 2 : parcel.nearby_industry === 'none' ? 0 : null,
    parcel.nearby_industry ? `${parcel.nearby_industry} businesses within 1 mile in source data.` : 'Businesses within 1 mile are not recorded. Industrial parcel counts do not establish business activity.');
  const estate = text(parcel.life_event_signal);
  set('estate', typeof parcel.owner_estate_confirmed === 'boolean' ? (parcel.owner_estate_confirmed ? 14 : 0) :
    /^(none found|n\/a)/i.test(estate) ? 0 : null,
    typeof parcel.owner_estate_confirmed === 'boolean' ? 'Owner-specific death / probate review recorded.' :
    estate || 'No owner-specific death / probate record provided.');
  const tax = text(parcel.unpaid_tax_signal);
  set('tax', typeof parcel.unpaid_tax_confirmed === 'boolean' ? (parcel.unpaid_tax_confirmed ? 14 : 0) :
    /^(no tax taking|public owner|tax taking under a previous owner only)/i.test(tax) ? 0 : null,
    typeof parcel.unpaid_tax_confirmed === 'boolean' ? 'Town unpaid-tax finding recorded.' : tax || 'Unpaid tax has not been checked.');
  const attempts = [parcel.past_listing_attempt, parcel.zillow_past_attempt, parcel.redfin_past_attempt].map(text);
  const ended = date(parcel.old_listing_taken_down_date);
  if (parcel.old_listing_never_sold === true && ended && ended <= asOf) {
    set('listing', ended >= yearsBefore(asOf, 5) ? 10 : 0, `Verified unsold listing ended ${parcel.old_listing_taken_down_date}.`);
  } else if (parcel.old_listing_never_sold === false) {
    set('listing', 0, 'No qualifying unsold listing confirmed.');
  } else {
    // Never award recent-listing points from a year mentioned in an unrelated sale or price cut.
    const historical = attempts.find(value => /never sold|no sale recorded|listing ended/i.test(value));
    const historicalYears = historical?.match(/\b(?:19|20)\d{2}\b/g)?.map(Number) ?? [];
    const old = historicalYears.length > 0 && Math.max(...historicalYears) < yearsBefore(asOf, 5).getUTCFullYear();
    set('listing', old || (!historical && attempts.some(value => /^no unsold past listing/i.test(value))) ? 0 : null,
      old ? `Historical attempt falls outside the last 5 years: ${historical}` : historical || 'No qualifying taken-down, unsold listing within 5 years recorded.');
  }
  const parsedAge = number(parcel.owner_age);
  const age = parsedAge !== null && parsedAge <= 130 ? parsedAge : null;
  set('age', age !== null && age >= 70 || parcel.inherited_by_children === true ? 8 :
    age !== null && parcel.inherited_by_children === false ? 0 : null,
    age !== null ? `Recorded owner age: ${age}.${parcel.inherited_by_children === true ? ' Inheritance by children confirmed.' : ''}` :
    parcel.inherited_by_children === true ? 'Land passed to children recorded.' : 'No owner age 70+ or completed inheritance recorded. Long ownership, age 65+ and children named in an obituary do not establish these conditions.');
  const years = number(parcel.years_owned);
  set('tenure', years === null ? null : years >= 30 ? 7 : years >= 20 ? 5 : years >= 10 ? 2 : 0,
    years === null ? 'Years owned is missing.' : `${years} years owned in source record.`);
  const mailing = text(parcel.owner_mailing_address);
  const mailingState = mailing.match(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\s*$/i)?.[1]?.toUpperCase();
  const state = text(parcel.state).toUpperCase();
  const distance = number(parcel.owner_distance_miles);
  set('distance', mailingState && state && mailingState !== state ? 7 : parcel.owner_lives_on_lot === 'Y' || parcel.owner_distance_group === 'Same town' ? 0 :
    mailingState && state && distance !== null ? (distance >= 50 ? 4 : 0) : null,
    mailingState && state ? `Mailing state ${mailingState}; lot state ${state}${distance !== null ? `; ${distance} miles away` : ''}.` : 'Mailing state or owner distance is not recorded.');
  set('access', typeof parcel.road_access === 'boolean' ? (parcel.road_access ? 0 : -15) : null,
    typeof parcel.road_access === 'boolean' ? 'Road-access finding recorded.' : 'Legal road access is not recorded. Proximity to a road does not establish access.');
  const lease = text(parcel.lease_easement_restriction);
  set('lease', typeof parcel.has_active_lease === 'boolean' ? (parcel.has_active_lease ? -15 : 0) :
    !unknown(lease) && /\blease\s+x[1-9]\d*\b/i.test(lease) ? -15 :
    /^none found$/i.test(lease) ? 0 : !unknown(lease) && !/\blease\b/i.test(lease) ? 0 : null,
    lease || 'No lease finding recorded in the source.');
  const parsedWetlands = number(parcel.wetland_pct);
  const wetlands = parsedWetlands !== null && parsedWetlands <= 100 ? parsedWetlands : null;
  set('wetland', wetlands === null ? null : wetlands > 0 ? -10 : 0,
    wetlands === null ? 'Wetland coverage is missing.' : `${wetlands}% wetland coverage. The model deducts 10 for any recorded coverage.`);
  const saleDate = date(parcel.last_sale_date);
  const nominalRecent = saleDate && saleDate > yearsBefore(asOf, 3) && /nominal|family|trust transfer/i.test(text(parcel.last_sale_price));
  set('recent', saleDate && saleDate <= asOf && !nominalRecent ? (saleDate > yearsBefore(asOf, 3) ? -10 : 0) : null,
    nominalRecent ? `Source records a nominal / family transfer rather than a confirmed purchase: ${parcel.last_sale_date}; ${parcel.last_sale_price}.` :
    saleDate && saleDate <= asOf ? `Last recorded transfer: ${parcel.last_sale_date}.` : 'Last sale date is missing, invalid or in the future.');
  const mortgage = text(parcel.open_mortgage);
  set('mortgage', typeof parcel.has_open_mortgage === 'boolean' ? (parcel.has_open_mortgage ? -5 : 0) :
    /^\d+\s+open\b/i.test(mortgage) ? -5 : /^no (?:open )?mortgage\b/i.test(mortgage) ? 0 : null,
    mortgage || 'Open mortgage status has not been checked.');

  const factors: ScoreFactor[] = FACTORS.map(definition => {
    const finding = findings[definition.id] ?? [null, 'No supporting source data.'];
    return { ...definition, points: finding[0] ?? 0, evidence: finding[1], hasData: finding[0] !== null };
  });
  const total = (group: ScoreFactor['group']) => factors.filter(f => f.group === group).reduce((sum, f) => sum + (f.points ?? 0), 0);
  const site = total('site'), seller = total('seller'), deductions = total('blocker');
  const raw = site + seller + deductions;
  return {
    score: clamp(raw), raw, site, seller, deductions, factors,
    asOf: asOf.toISOString().slice(0, 10),
  };
}

export function scoringStorageKey(parcel: { town?: string; parcel_id?: string; address?: string }) {
  return `siteiq:ranking:${SCORING_VERSION}:${text(parcel.town).toUpperCase()}|${text(parcel.parcel_id) || text(parcel.address)}`;
}
