// Include partial/unit listings and pending sales in the active-sale rule.
// Historical listings and withdrawn/sold records must not trigger it.
export function isListedForSale(status?: string | null): boolean {
  return /^(?:listed\b|for sale\b|active\b|under agreement\b|pending\b)/i.test((status ?? '').trim());
}
