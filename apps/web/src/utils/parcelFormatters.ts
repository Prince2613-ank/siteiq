// Formatting utilities for parcel details, tax status, and deed records

export function formatDistance(miles?: number | string | null): string | null {
  if (miles == null || miles === '') return null;
  const num = Number(miles);
  if (isNaN(num)) return null;
  return `${num.toFixed(1)} mi`;
}

export function formatYearsOwned(years?: number | string | null): string {
  if (years == null || years === '') return '—';
  const num = Number(years);
  if (isNaN(num)) return '—';
  return `${num.toFixed(1)} yrs`;
}

export function formatSaleDate(rawDate?: string | null): string {
  if (!rawDate || !rawDate.trim()) return '—';
  const trimmed = rawDate.trim();
  // e.g. "Dec 13, 2011", "Feb 26, 2025", "May 02, 2024", "Jan 11, 1984"
  const m = trimmed.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const day = parseInt(m[2], 10);
    const mon = m[1];
    const year = m[3];
    return `${day} ${mon} ${year}`;
  }
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    const day = d.getDate();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }
  return trimmed;
}

export function formatSalePrice(rawPrice?: string | null): string {
  if (!rawPrice || !rawPrice.trim()) return '—';
  const trimmed = rawPrice.trim();
  // If already formatted like "$625,000" or "$1 (nominal...)", preserve it
  if (trimmed.startsWith('$')) return trimmed;
  const num = Number(trimmed);
  if (!isNaN(num)) {
    return `$${num.toLocaleString()}`;
  }
  return trimmed;
}

export function formatDeedBookPage(deed?: string | null, town?: string, state?: string): string {
  const isSeabrook = (town || '').toUpperCase() === 'SEABROOK' || (state || '').toUpperCase() === 'NH';
  if (!deed || !deed.trim()) {
    return isSeabrook ? 'Rockingham Registry (not on file)' : 'Not available';
  }
  const d = deed.trim();
  // Check for non-real book numbers
  if (
    d.includes('5-Dec') ||
    d.includes('LC#') ||
    d.includes('TL') ||
    /\/ Page 0\b/i.test(d) ||
    /\/0\b/i.test(d) ||
    d.includes('JTROS')
  ) {
    return 'Not available';
  }

  if (isSeabrook && !d.toLowerCase().startsWith('rockingham registry')) {
    return `Rockingham Registry ${d}`;
  }

  return d;
}

export function isAbsenteeOwner(
  ownerLivesOnLot?: string | null,
  ownerDistanceGroup?: string | null,
  ownerType?: string | null
): boolean {
  if (ownerLivesOnLot !== 'N') return false;
  if (!ownerDistanceGroup) return false;
  if (ownerType === 'Government' || ownerType === 'Religious / non-profit') return false;
  return (
    ownerDistanceGroup === '10-50 miles' ||
    ownerDistanceGroup.startsWith('Over 50 miles')
  );
}

export interface TaxSignalDisplay {
  mainText: string;
  condoNote: boolean;
  boxColor: 'red' | 'amber' | 'green' | 'grey';
  icon: string | null;
}

export function parseTaxSignal(rawSignal?: string | null, town?: string, state?: string): TaxSignalDisplay | null {
  const isSeabrook = (town || '').toUpperCase() === 'SEABROOK' || (state || '').toUpperCase() === 'NH';
  if (!rawSignal || !rawSignal.trim()) {
    if (isSeabrook) {
      return {
        mainText: 'Not checked (NH lots use a different registry)',
        condoNote: false,
        boxColor: 'grey',
        icon: null,
      };
    }
    return null;
  }

  const trimmed = rawSignal.trim();
  const condoNote = trimmed.includes('[condo unit, not the whole lot]');
  const mainText = trimmed.replace(/\[condo unit, not the whole lot\]/gi, '').trim();

  const lower = mainText.toLowerCase();

  // Rules:
  // Not checked (NH) / Public owner → grey, no icon
  if (lower.startsWith('public owner') || lower.startsWith('not checked')) {
    return {
      mainText,
      condoNote,
      boxColor: 'grey',
      icon: null,
    };
  }

  // Recent tax taking → red, warning icon
  if (lower.includes('recent tax taking') || lower.includes('possible unpaid tax')) {
    return {
      mainText,
      condoNote,
      boxColor: 'red',
      icon: '⚠️',
    };
  }

  // Older tax taking / previous owner only → amber, warning icon
  if (lower.includes('older tax taking') || lower.includes('previous owner only')) {
    return {
      mainText,
      condoNote,
      boxColor: 'amber',
      icon: '⚠️',
    };
  }

  // No tax taking recorded → green, check icon
  if (lower.includes('no tax taking')) {
    return {
      mainText,
      condoNote,
      boxColor: 'green',
      icon: '✓',
    };
  }

  return {
    mainText,
    condoNote,
    boxColor: 'grey',
    icon: null,
  };
}

export interface LifeEventDisplay {
  hasSignal: boolean;
  type: 'estate_death' | 'estate_filed' | 'life_estate' | 'senior_deferral' | 'older_owner' | 'none' | 'na';
  badgeText: string;
  badgeClass: string;
  boxColor: 'purple' | 'amber' | 'blue' | 'grey';
  icon: string;
  mainText: string;
  estateDetail: string | null;
}

export function parseLifeEventSignal(
  rawSignal?: string | null,
  rawEstateDetail?: string | null,
  town?: string,
  state?: string
): LifeEventDisplay {
  const signal = (rawSignal || '').trim();
  const detail = (rawEstateDetail || '').trim() || null;
  const isSeabrook = (town || '').toUpperCase() === 'SEABROOK' || (state || '').toUpperCase() === 'NH';

  if (!signal) {
    if (detail) {
      return {
        hasSignal: true,
        type: 'estate_filed',
        badgeText: 'Estate Record',
        badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
        boxColor: 'purple',
        icon: '📜',
        mainText: 'Estate record recorded on lot/complex',
        estateDetail: detail,
      };
    }
    return {
      hasSignal: false,
      type: isSeabrook ? 'na' : 'none',
      badgeText: isSeabrook ? 'Not checked (NH)' : 'None found',
      badgeClass: 'bg-slate-50 text-slate-500 border-slate-200',
      boxColor: 'grey',
      icon: 'ℹ️',
      mainText: isSeabrook ? 'Not checked (NH registry uses separate records)' : 'None found',
      estateDetail: null,
    };
  }

  const lower = signal.toLowerCase();

  // 1. Estate / Death / Heirs (Highest priority signal)
  if (lower.includes('(death)') || lower.includes('heirs may now hold')) {
    return {
      hasSignal: true,
      type: 'estate_death',
      badgeText: 'Estate / Heirs (Probate)',
      badgeClass: 'bg-purple-100 text-purple-800 border-purple-300 font-bold',
      boxColor: 'purple',
      icon: '🕊️',
      mainText: signal,
      estateDetail: detail,
    };
  }

  // 2. Life estate on deed
  if (lower.includes('life estate on deed')) {
    return {
      hasSignal: true,
      type: 'life_estate',
      badgeText: 'Life Estate (Deed)',
      badgeClass: 'bg-purple-100 text-purple-800 border-purple-300 font-bold',
      boxColor: 'purple',
      icon: '📜',
      mainText: signal,
      estateDetail: detail,
    };
  }

  // 3. Estate record filed after current owner bought
  if (lower.includes('estate record filed') || lower.includes('estate record')) {
    return {
      hasSignal: true,
      type: 'estate_filed',
      badgeText: 'Estate Record Filed',
      badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200 font-semibold',
      boxColor: 'purple',
      icon: '⚖️',
      mainText: signal,
      estateDetail: detail,
    };
  }

  // 4. Senior Property Tax Deferral
  if (lower.includes('senior') || lower.includes('tax deferral')) {
    return {
      hasSignal: true,
      type: 'senior_deferral',
      badgeText: 'Senior (65+) Deferral',
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-300 font-semibold',
      boxColor: 'amber',
      icon: '👵',
      mainText: signal,
      estateDetail: detail,
    };
  }

  // 5. Older owner / long tenure (30+ yrs)
  if (lower.includes('older owner') || lower.includes('owned ')) {
    const match = signal.match(/owned\s+(\d+)\s+yrs/i);
    const yrs = match ? match[1] : null;
    return {
      hasSignal: true,
      type: 'older_owner',
      badgeText: yrs ? `Owned ${yrs} yrs (older owner)` : 'Older Owner (30+ yrs)',
      badgeClass: 'bg-blue-50 text-blue-700 border-blue-200 font-medium',
      boxColor: 'blue',
      icon: '⏳',
      mainText: signal,
      estateDetail: detail,
    };
  }

  // 6. If has estateDetail despite neutral signal
  if (detail) {
    return {
      hasSignal: true,
      type: 'estate_filed',
      badgeText: 'Estate Record',
      badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
      boxColor: 'purple',
      icon: '📜',
      mainText: signal,
      estateDetail: detail,
    };
  }

  // 7. Neutral: N/A, Not checked, None found
  const isNA = lower.includes('n/a') || lower.includes('not checked');

  return {
    hasSignal: false,
    type: isNA ? 'na' : 'none',
    badgeText: signal,
    badgeClass: 'bg-slate-50 text-slate-500 border-slate-200',
    boxColor: 'grey',
    icon: 'ℹ️',
    mainText: signal,
    estateDetail: null,
  };
}

export interface ListingAttemptSource {
  source: 'Zillow' | 'Redfin';
  text: string;
  link?: string | null;
}

export function hasListingAttempt(val?: string | null): boolean {
  if (!val) return false;
  const s = val.trim().toLowerCase();
  const negatives = [
    'none since last sale',
    'no zillow page',
    'no redfin page',
    'no history on zillow',
    'no history on redfin',
    'none',
    'nan',
    'n/a',
    'not checked',
    '',
  ];
  return !negatives.includes(s);
}

export function getListingAttempts(
  zillowAttempt?: string | null,
  zillowLink?: string | null,
  redfinAttempt?: string | null,
  redfinLink?: string | null
): ListingAttemptSource[] {
  const attempts: ListingAttemptSource[] = [];

  if (hasListingAttempt(zillowAttempt)) {
    attempts.push({
      source: 'Zillow',
      text: zillowAttempt!.trim(),
      link: zillowLink?.trim() || null,
    });
  }

  if (hasListingAttempt(redfinAttempt)) {
    attempts.push({
      source: 'Redfin',
      text: redfinAttempt!.trim(),
      link: redfinLink?.trim() || null,
    });
  }

  return attempts;
}

