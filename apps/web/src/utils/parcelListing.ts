// Include partial/unit listings and pending sales in the active-sale rule.
// Historical listings and withdrawn/sold records must not trigger it.
export function isListedForSale(status?: string | null): boolean {
  return /^(?:listed\b|for sale\b|active\b|under agreement\b|pending\b)/i.test((status ?? '').trim());
}

export type ParcelListingLink = { label: string; href: string };
export function parcelListingLinks(
  listing?: { links?: Record<string, string>; proof?: string | null } | null,
  parcel?: { zillow_link?: string | null; redfin_link?: string | null },
): ParcelListingLink[] {
  const result: ParcelListingLink[] = [];
  const seen = new Set<string>();
  const add = (label: string, value: unknown) => {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) return;
    try {
      const url = new URL(value.trim());
      const key = url.href.replace(/\/$/, '');
      if (seen.has(key)) return;
      seen.add(key);
      result.push({ label, href: value.trim() });
    } catch { /* Ignore unavailable or malformed source URLs. */ }
  };
  for (const [label, href] of Object.entries(listing?.links ?? {})) add(label, href);
  add('Zillow', parcel?.zillow_link);
  add('Redfin', parcel?.redfin_link);
  add('Listing proof', listing?.proof);
  return result;
}
