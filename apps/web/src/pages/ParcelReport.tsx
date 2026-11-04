import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useRememberScroll, readSession, writeSession } from '../utils/sessionState';
import { loadParcelReport, parcelReportPath, type ParcelReportData } from '../utils/parcelReports';
import { downloadParcelReportPdf, snapshotParcelReport } from '../utils/parcelReportPdf';
import { parcelKey } from '../utils/dataLoading';
import { ZONING_DISTRICTS, zoningCode } from '../utils/parcelZoning';
import { formatLoanMoney, formatLoanPercent, loanCategoryLabel } from '../utils/parcelLoans';
import './ParcelReport.css';

const SQFT_PER_ACRE = 43560;
const M2_PER_ACRE = 4046.8564224;
// At the parcel locations, level 15 shows a 300 m / 1000 ft scale bar.
const REPORT_MIN_ZOOM = 15;
const REPORT_MAX_ZOOM = 20;
const format = (value: number, digits = 0) => value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
function number(value: unknown): number | null {
  if (value == null || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}
function available(value: unknown): boolean {
  return value != null && String(value).trim() !== '' && !/^(not checked|not looked up|unknown|not provided|not available|no zillow page|no redfin page|n\/a)\b/i.test(String(value).trim());
}
function titleCase(value: string): string { return value.toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase()); }
function ArrowLeft() {
  return <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m12 19-7-7 7-7M5 12h14" /></svg>;
}
function RecordSection({ title, fields, showNotChecked = false, className = '' }: { title: string; fields: [string, unknown][]; showNotChecked?: boolean; className?: string }) {
  const visible = fields.filter(([, value]) => available(value) || (showNotChecked && /^not checked\b/i.test(String(value))));
  if (!visible.length) return null;
  return <section className={`report-section ${className}`}><h2>{title}</h2><dl className="report-identity-grid">
    {visible.map(([label, value]) => <div key={label} className={String(value).length > 45 ? 'report-full-row' : undefined}><dt>{label}</dt><dd>{String(value)}</dd></div>)}
  </dl></section>;
}

function ReportMap({ data }: { data: ParcelReportData }) {
  const container = useRef<HTMLDivElement>(null);
  const [imageryUnavailable, setImageryUnavailable] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    setImageryUnavailable(false);
    const map = L.map(container.current, { zoomControl: false, zoomAnimation: false, minZoom: REPORT_MIN_ZOOM, maxZoom: REPORT_MAX_ZOOM });
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    L.control.scale({ position: 'bottomleft', imperial: true, metric: true, maxWidth: 100 }).addTo(map);
    const imagery = L.tileLayer(data.sources.imagery_url, {
      attribution: data.sources.imagery_attribution, maxZoom: 20,
      // World Imagery returns placeholder tiles at level 20 in this area.
      // Upscale its level-19 imagery while retaining the report's zoom range.
      maxNativeZoom: data.sources.imagery_url.includes('/World_Imagery/') ? 19 : 20,
    }).addTo(map);
    let tileErrors = 0;
    imagery.on('tileerror', () => { if (++tileErrors >= 3) setImageryUnavailable(true); });
    imagery.on('tileload', () => setImageryUnavailable(false));
    L.geoJSON(data.neighbors, { interactive: false, style: { color: '#f5e06b', weight: 1, fillOpacity: 0.02 } }).addTo(map);
    const subject = L.geoJSON(data.subject as any, { style: { className: 'report-subject-boundary', color: '#fff36b', weight: 3.5, fillColor: '#86b98a', fillOpacity: 0.21 } }).addTo(map);
    L.geoJSON(data.wetlands, { interactive: false, style: { className: 'report-wetland-overlay', color: '#43b9b2', weight: 1, fillColor: '#6dd2c7', fillOpacity: 0.55 } }).addTo(map);
    L.geoJSON(data.buildings, { interactive: false, style: { className: 'report-building-overlay', color: '#f0525c', weight: 2, fillColor: '#f8787b', fillOpacity: 0.7 } }).addTo(map);
    const bounds = subject.getBounds();
    const center = bounds.getCenter();
    const propertyZoom = Math.max(REPORT_MIN_ZOOM, Math.min(REPORT_MAX_ZOOM,
      map.getBoundsZoom(bounds, false, L.point(64, 96))));
    const viewKey = `report:${parcelKey(data.subject.properties)}:map:v2`;
    const savedZoom = readSession<{ zoom: number }>(viewKey)?.zoom;
    map.setView(center, typeof savedZoom === 'number' && Number.isFinite(savedZoom) ? Math.max(REPORT_MIN_ZOOM, Math.min(REPORT_MAX_ZOOM, savedZoom)) : propertyZoom, { animate: false });
    writeSession(viewKey, { zoom: map.getZoom() });
    map.on('zoomend', () => writeSession(viewKey, { zoom: map.getZoom() }));
    const resize = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
      map.setView(center, map.getZoom(), { animate: false });
    });
    resize.observe(container.current);
    return () => { resize.disconnect(); map.stop(); map.remove(); };
  }, [data]);
  return <section className="parcel-report-map-panel" aria-label="Aerial parcel map">
    <div ref={container} className="parcel-report-map" />
    {imageryUnavailable && <div className="report-imagery-notice" role="status">Aerial imagery is temporarily unavailable.</div>}
    <div className="report-map-legend" aria-label="Map legend">
      <span><i className="report-legend-boundary" />Parcel boundary</span><span><i className="report-legend-subject" />Subject parcel</span>
      {data.buildings.features.length > 0 && <span><i className="report-legend-building" />Building footprint</span>}
      {data.wetlands.features.length > 0 && <span><i className="report-legend-wetland" />Mapped wetland</span>}
      <span><i className="report-legend-land" />Subject land</span>
    </div>
  </section>;
}

export function ParcelReport() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ town: string; parcelId: string }>();
  const town = params.town ?? 'AMESBURY';
  const parcelId = params.parcelId ?? '42-15';
  const identity = parcelKey({ town, parcel_id: parcelId });
  const reportUrl = new URL(parcelReportPath({ town, parcel_id: parcelId }), window.location.origin).href;
  const reportContent = useRef<HTMLElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [loaded, setLoaded] = useState<{ identity: string; data: ParcelReportData } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const data = loaded?.identity === identity ? loaded.data : null;
  const exportPdf = async () => {
    if (!data || !reportContent.current || exporting) return;
    setExporting(true); setExportError(null);
    try {
      const mapElement = document.querySelector<HTMLElement>('.parcel-report-map');
      if (!mapElement) throw new Error('The report map is not ready. Please try again.');
      const snapshot = await snapshotParcelReport(reportContent.current, data, mapElement);
      await downloadParcelReportPdf(snapshot);
    } catch (error) {
      setExportError(error instanceof Error && /^(Aerial imagery|The report map)/.test(error.message) ? error.message : 'PDF export could not be completed. Please try again.');
    } finally { setExporting(false); }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(reportUrl); setLinkCopied(true); }
    catch { setExportError('The link could not be copied. Copy the report URL from your browser address bar.'); }
  };
  useRememberScroll(`report:${identity}:content`, '.parcel-report-content', Boolean(data));
  useRememberScroll(`report:${identity}:page`, undefined, Boolean(data));
  useEffect(() => {
    const controller = new AbortController();
    setFailed(null);
    setLinkCopied(false); setExportError(null);
    loadParcelReport(town, parcelId, controller.signal).then(data => {
      if (!controller.signal.aborted) setLoaded({ identity, data });
    }).catch(error => { if (!controller.signal.aborted) setFailed(error.message); });
    return () => controller.abort();
  }, [identity, town, parcelId]);
  const topbar = <header className="parcel-report-topbar">
    <div className="report-breadcrumbs"><button type="button" onClick={() => {
      writeSession('sites:selectedSite', null);
      navigate('/sites');
    }}><ArrowLeft /><span>Sites</span></button><span className="report-breadcrumb-divider">/</span><span>Parcel report</span></div>
    {location.state?.fromDashboard && <button type="button" className="report-return-map" onClick={() => navigate('/')}><ArrowLeft />Go back to map</button>}
    <div className="report-toolbar-actions">
      <span className="report-record-reference">{titleCase(town)}{data?.subject.properties.state ? `, ${data.subject.properties.state}` : ''}<span>{parcelId}</span></span>
      <button type="button" className="report-copy-link" onClick={copyLink} disabled={!data}>{linkCopied ? 'Link copied' : 'Copy link'}</button>
      <button type="button" className="report-export-pdf" onClick={exportPdf} disabled={!data || exporting} aria-busy={exporting}>
        {exporting ? 'Exporting...' : 'Export PDF'}
      </button>
    </div>
  </header>;
  if (!data) return <div className="parcel-report-page">{topbar}<div className="parcel-report-loading">
    <p role={failed ? 'alert' : 'status'}>{failed ? 'The parcel report could not be loaded.' : 'Opening parcel report...'}</p>
    {failed && <button type="button" onClick={() => window.location.reload()} className="report-retry">Try again</button>}
  </div></div>;
  const p = data.subject.properties;
  const address = p.address || p.site_address_town_record;
  const heading = address ? titleCase(address) : `Parcel ${p.parcel_id}`;
  const city = titleCase(p.town);
  const gisAcres = number(data.metrics.gis_area_m2) === null ? null : data.metrics.gis_area_m2 / M2_PER_ACRE;
  const recordedAcres = number(p.acres);
  const usableAcres = number(p.usable_acres);
  const wetlandPercent = number(p.wetland_pct);
  const buildingAcres = data.metrics.building_area_m2 === null ? null : data.metrics.building_area_m2 / M2_PER_ACRE;
  const wetlandAcres = data.metrics.mapped_wetland_area_m2 === null ? null : data.metrics.mapped_wetland_area_m2 / M2_PER_ACRE;
  const complete = data.sources.layer_coverage === 'complete';
  const percentOf = (part: number | null, whole: number | null) => part !== null && whole !== null && whole > 0 ? part / whole * 100 : null;
  const rows = [
    { label: 'Lot area (GIS)', acres: gisAcres, percent: null, type: 'lot' },
    { label: 'Recorded lot area', acres: recordedAcres, percent: null, type: 'lot' },
    { label: complete ? 'Building footprint' : 'Mapped building footprint', acres: buildingAcres, percent: percentOf(buildingAcres, gisAcres), type: 'building' },
    { label: complete ? 'Wetland area' : 'Mapped wetland area', acres: wetlandAcres, percent: percentOf(wetlandAcres, gisAcres), type: 'wetland' },
    { label: 'Usable land', acres: usableAcres, percent: percentOf(usableAcres, recordedAcres), type: 'usable' },
  ].filter(row => row.acres !== null && Number.isFinite(row.acres));
  const metrics = [
    { label: 'Recorded lot area', value: recordedAcres, unit: 'ac', digits: 2 },
    { label: 'Usable land', value: usableAcres, unit: 'ac', digits: 2 },
    { label: 'Recorded wetland coverage', value: wetlandPercent, unit: '%', digits: 1 },
  ].filter(metric => metric.value !== null);
  const zone = ZONING_DISTRICTS.find(district => district.code === zoningCode(p.zoning));
  const valuation = number(p.total_val);
  return <div className="parcel-report-page">
    {topbar}
    {exportError && <p className="report-export-error" role="alert">{exportError}</p>}
    <span className="report-share-feedback" role="status">{linkCopied ? 'Property report link copied.' : ''}</span>
    <div className="parcel-report-workspace">
      <ReportMap key={identity} data={data} />
      <article ref={reportContent} className="parcel-report-content" aria-label={`Parcel report for ${heading}`}>
        <header className="report-property-heading">
          <div className="report-eyebrow">PARCEL REPORT</div>
          <h1>{heading}</h1><p className="report-location">{city}, {p.state === 'MA' ? 'Massachusetts' : p.state === 'NH' ? 'New Hampshire' : p.state}</p>
          <div className="report-property-tags">
            <span className={p.keep === 'Y' ? 'report-tag-qualified' : 'report-tag-excluded'}>{p.keep === 'Y' ? 'Qualified' : 'Excluded'}</span>
            {available(p.zoning) && <span className="report-tag-zone">{p.zoning}{zone ? ` / ${zone.name}` : ''}</span>}
            {available(data.listing?.status) && <span className="report-tag-zone">{data.listing?.status}</span>}
          </div>
        </header>
        {metrics.length > 0 && <section className="report-key-metrics" aria-label="Key parcel figures">
          {metrics.map(metric => <div key={metric.label}><span>{metric.label}</span><strong>{format(metric.value!, metric.digits)}<small> {metric.unit}</small></strong></div>)}
        </section>}
        <RecordSection title="Property identity" fields={[
          ['Parcel ID', p.parcel_id], ['Land use', p.use], ['Owner', p.owner_name || p.owner],
          ['Assessed value', valuation !== null ? `$${format(valuation)}` : null], ['Development status', p.status],
          ['Land category', p.category], ['Units', p.units], ['Zoning', p.zoning],
          ['Nearest road', p.road], ['Distance to road', number(p.road_dist_m) !== null ? `${format(Number(p.road_dist_m), 1)} m` : null],
          ['Town-record address', p.site_address_town_record],
        ]} />
        {rows.length > 0 && <section className="report-section report-area-section"><div className="report-section-heading"><h2>Land & coverage</h2></div>
          <table className="report-area-table"><thead><tr><th scope="col">Area</th><th scope="col">sq ft</th><th scope="col">acres</th><th scope="col">% of lot</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.label} className={`report-area-${row.type}`}><th scope="row"><span className={`report-area-key report-area-key-${row.type}`} />{row.label}</th><td>{format(row.acres! * SQFT_PER_ACRE)}</td><td>{format(row.acres!, 2)}</td><td>{row.percent === null ? '' : `${format(row.percent, 1)}%`}</td></tr>)}</tbody></table>
        </section>}
        <RecordSection title="Screening" fields={[
          ['Result', p.keep === 'Y' ? 'Qualified' : 'Excluded'], ['Reason', p.screening_reason],
          ['Building coverage', number(p.building_coverage_pct) !== null ? `${format(Number(p.building_coverage_pct), 2)}% of ${p.building_coverage_source === 'source_workbook' ? 'spreadsheet lot area (source workbook measurement)' : `GIS lot area${p.building_layer_coverage === 'partial' ? ' (partial mapped coverage)' : ''}`}` : null],
        ]} />
        <RecordSection title="Ownership & records" fields={[
          ['Owner type', p.owner_type], ['Mailing address', p.owner_mailing_address],
          ['Owner lives on parcel', p.owner_lives_on_lot === 'Y' ? 'Yes' : p.owner_lives_on_lot === 'N' ? 'No' : null],
          ['Owner distance', number(p.owner_distance_miles) !== null ? `${format(Number(p.owner_distance_miles), 1)} miles` : null],
          ['Years owned', number(p.years_owned) !== null ? `${format(Number(p.years_owned), 1)} years` : null],
          ['Last transfer', p.last_sale_date], ['Transfer price', p.last_sale_price], ['Deed reference', p.deed_book_page], ['Company people', p.company_people],
        ]} />
        {data.loan && <RecordSection title="Loan information" className="report-loan-section" fields={data.loan.loan_signal === 'Not checked' ? [
          ['Loan category', loanCategoryLabel(data.loan.loan_signal)],
        ] : [
          ['Loan category', loanCategoryLabel(data.loan.loan_signal)], ['Loan status', data.loan.loan_status],
          ['Open loans', data.loan.open_loans_count], ['Latest open-loan lender', data.loan.latest_open_loan_lender],
          ['Latest loan amount', formatLoanMoney(data.loan.latest_loan_amount_usd)], ['Latest loan date', data.loan.latest_loan_date],
          ['Loan age', data.loan.loan_age_years === null ? null : `${format(data.loan.loan_age_years, 1)} years`],
          ['Loan to value', formatLoanPercent(data.loan.loan_to_value_pct)],
          ['Estimated current balance', formatLoanMoney(data.loan.est_balance_now_usd)],
        ]} />}
        <RecordSection title="Mortgage & restrictions" fields={[
          ['Open mortgage', p.open_mortgage], ['Leases, easements & restrictions', p.lease_easement_restriction],
        ]} />
        <RecordSection title="Tax & estate records" fields={[
          ['Property tax', p.unpaid_tax_signal], ['Tax takings found', p.tax_takings_found], ['Latest tax taking', p.last_tax_taking],
          ['Estate & ownership signal', p.life_event_signal], ['Estate record', p.estate_record_detail], ['Children / heirs', p.children_count_estate_owner],
        ]} />
        <RecordSection title="Listing & history" fields={[
          ['Listing status', data.listing?.status], ['Past listing attempt', p.past_listing_attempt],
          ['Zillow history', p.zillow_past_attempt], ['Redfin history', p.redfin_past_attempt],
        ]} />
      </article>
    </div>
  </div>;
}
