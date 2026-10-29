export interface ParcelLoanData {
  loan_status: string;
  open_mortgage: string | null;
  open_loans_count: number | null;
  latest_open_loan_lender: string | null;
  latest_loan_amount_usd: number | null;
  latest_loan_date: string | null;
  loan_age_years: number | null;
  loan_to_value_pct: number | null;
  est_balance_now_usd: number | null;
  est_equity_usd: number | null;
  est_equity_pct: number | null;
  loan_signal: string;
}
export const LOAN_CATEGORIES = [
  { value: 'ALL', label: 'All loan categories' },
  ...[
    'No open loan - likely free & clear',
    'Low leverage - strong equity',
    'Moderate leverage',
    'High leverage (loan >= 80% of value)',
    'Recent loan (<2 yrs) - unlikely to sell soon',
    'Not checked',
  ].map(value => ({ value, label: value === 'Not checked' ? 'Loan details unavailable' : value })),
];
export function loanCategoryLabel(value: string): string {
  return LOAN_CATEGORIES.find(category => category.value === value)?.label ?? value;
}
const LOAN_FILTER_LABELS: Record<string, string> = {
  ALL: 'All categories',
  'No open loan - likely free & clear': 'No open loan',
  'Low leverage - strong equity': 'Low loan-to-value',
  'Moderate leverage': 'Moderate loan-to-value',
  'High leverage (loan >= 80% of value)': 'High loan-to-value (80%+)',
  'Recent loan (<2 yrs) - unlikely to sell soon': 'Recent loan (under 2 years)',
  'Not checked': 'Loan details unavailable',
};
export const LOAN_FILTER_OPTIONS = LOAN_CATEGORIES.map(category => ({
  value: category.value, label: LOAN_FILTER_LABELS[category.value] ?? category.label,
}));
type LoanData = { version: number; parcels: Record<string, ParcelLoanData> };
let loansPromise: Promise<LoanData> | undefined;
export function loadParcelLoans(): Promise<LoanData> {
  loansPromise ??= fetch('/geojson/parcel_loans.json', { signal: AbortSignal.timeout(15000) }).then(async response => {
    if (!response.ok) throw new Error('Loan records could not be loaded');
    const data = await response.json() as LoanData;
    if (data.version !== 1 || !data.parcels || typeof data.parcels !== 'object' || Array.isArray(data.parcels) ||
        Object.values(data.parcels).some(record => !record || !record.loan_status ||
          !LOAN_CATEGORIES.some(category => category.value !== 'ALL' && category.value === record.loan_signal))) {
      throw new Error('Loan records are incomplete or invalid');
    }
    return data;
  }).catch(error => { loansPromise = undefined; throw error; });
  return loansPromise;
}

export function formatLoanMoney(value: number | null | undefined): string | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : null;
}
export function formatLoanPercent(value: number | null | undefined): string | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('en-US', { style: 'percent', maximumFractionDigits: 1 }) : null;
}
