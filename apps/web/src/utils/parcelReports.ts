import { parcelKey } from './dataLoading';
import { screenParcel } from './parcelScreening';
import { loadParcelLoans, type ParcelLoanData } from './parcelLoans';

export const COUNTRY_CLUB_REPORT_PATH = '/sites/report/2-country-club-ln';
export const PARCEL_REPORT_ROUTE = '/sites/report/:town/:parcelId';
export function parcelReportPath(parcel: { town?: string; parcel_id?: string }) {
  return `/sites/report/${encodeURIComponent((parcel.town ?? '').trim().toUpperCase())}/${encodeURIComponent((parcel.parcel_id ?? '').trim())}`;
}
export type ParcelReportData = {
  subject: { type: 'Feature'; properties: Record<string, any>; geometry: any };
  neighbors: any; buildings: any; wetlands: any;
  listing?: { status?: string; links?: Record<string, string>; note?: string } | null;
  loan?: ParcelLoanData;
  metrics: { gis_area_m2: number; corridor_coverage_fraction: number; building_area_m2: number | null; building_count: number | null; mapped_wetland_area_m2: number | null };
  sources: { imagery_url: string; imagery_attribution: string; layer_coverage: 'complete' | 'partial' };
};
type ReportIndex = { version: number; parcels: Record<string, { file: string }> };
let indexPromise: Promise<ReportIndex> | undefined;
export async function loadParcelReport(town: string, parcelId: string, signal?: AbortSignal): Promise<ParcelReportData> {
  indexPromise ??= fetch('/reports/index.json').then(async response => {
    if (!response.ok) throw new Error('Parcel index unavailable');
    return response.json() as Promise<ReportIndex>;
  }).catch(error => { indexPromise = undefined; throw error; });
  const index = await indexPromise;
  const key = parcelKey({ town, parcel_id: parcelId });
  const entry = index.parcels[key];
  if (!entry) throw new Error('Parcel report not found');
  const response = await fetch(`/reports/${entry.file}`, { signal });
  if (!response.ok) throw new Error('Parcel report unavailable');
  const [data, loans] = await Promise.all([response.json() as Promise<ParcelReportData>, loadParcelLoans()]);
  if (parcelKey(data.subject.properties) !== key || !data.subject.geometry) throw new Error('Parcel report identity does not match');
  data.subject.properties = { ...data.subject.properties, ...screenParcel(data.subject.properties) };
  data.loan = loans.parcels[key];
  if (!data.loan) throw new Error('Loan record does not match this parcel');
  return data;
}
