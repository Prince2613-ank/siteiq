import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useRememberScroll, readSession, writeSession } from '../utils/sessionState';
import { loadParcelReport, parcelReportPath, type ParcelReportData } from '../utils/parcelReports';
import { downloadParcelReportPdf, snapshotParcelReport } from '../utils/parcelReportPdf';
import { parcelKey } from '../utils/dataLoading';
import { listingGroup } from '../utils/dashboardFilters';
import { parcelListingLinks, listingSourceLogo, type ParcelListingLink } from '../utils/parcelListing';
import { areaMeasurements, vacantLandMeasurements, pavedLandMeasurements, M2_PER_ACRE } from '../utils/parcelAreas';
import { ZONING_DISTRICTS, zoningCode } from '../utils/parcelZoning';
import { formatLoanMoney, formatLoanPercent, loanCategoryLabel } from '../utils/parcelLoans';
import { parseLifeEventSignal } from '../utils/parcelFormatters';
import { ScoreBadge } from '../components/ParcelScore';
import { ParcelScoringDialog } from '../components/ParcelScoringDialog';
import './ParcelReport.css';

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
function RecordSection({ title, fields, showNotChecked = false, className = '', description, links }: { title: string; fields: [string, unknown][]; showNotChecked?: boolean; className?: string; description?: string; links?: ParcelListingLink[] }) {
  const visible = fields.filter(([, value]) => available(value) || (showNotChecked && /^not checked\b/i.test(String(value))));
  if (!visible.length) return null;
  return <section className={`report-section ${className}`}><h2>{title}</h2>
    {description && <p data-report-description className="report-source-note">{description}</p>}
    <dl className="report-identity-grid">
    {visible.map(([label, value]) => <div key={label} className={String(value).length > 45 ? 'report-full-row' : undefined}><dt>{label}</dt><dd>{String(value)}</dd></div>)}
  </dl>
    {links && (links.length ? <div className="report-listing-links" aria-label="Listing source links">{links.map(link =>
      <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">
        {listingSourceLogo(link.href) && <img src={listingSourceLogo(link.href)} alt="" aria-hidden="true" width="20.16" height="20.16" onError={event => { event.currentTarget.style.display = 'none'; }} />}
        <span>{link.label}</span>
      </a>
    )}</div> : <p className="report-no-listing-links">No listing links found.</p>)}
  </section>;
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
    const viewKey = `report:${parcelKey(data.subject.properties)}:view`;
    const rememberedView = readSession<{ center: [number, number]; zoom: number }>(viewKey);
    const rememberedWithinLimits = rememberedView
      && rememberedView.zoom >= REPORT_MIN_ZOOM && rememberedView.zoom <= REPORT_MAX_ZOOM
      && bounds.pad(1.2).contains(rememberedView.center);
    if (rememberedWithinLimits) {
      map.setView(rememberedView.center, rememberedView.zoom);
    } else {
      map.setView(center, propertyZoom);
    }
    const onMove = () => {
      writeSession(viewKey, {
        center: [map.getCenter().lat, map.getCenter().lng],
        zoom: map.getZoom(),
      });
    };
    map.on('moveend', onMove);
    return () => {
      map.off('moveend', onMove);
      map.remove();
    };
  }, [data]);
  return <div className="parcel-report-map" ref={container}>
    {imageryUnavailable && <div className="report-imagery-warning" role="status">
      High-resolution aerial imagery is temporarily unreachable. Parcel boundary remains visible.
    </div>}
    <div className="report-map-legend">
      <span><span className="report-map-swatch report-legend-boundary" />Parcel boundary</span>
      <span><span className="report-map-swatch report-legend-subject" />Subject parcel</span>
      {data.buildings.features.length > 0 && <span><span className="report-map-swatch report-legend-building" />Building footprint</span>}
      {data.wetlands.features.length > 0 && <span><span className="report-map-swatch report-legend-wetland" />Subject land</span>}
    </div>
  </div>;
}

export function ParcelReport() {
  const { town = '', parcelId = '' } = useParams();
  const identity = `${town.trim().toUpperCase()}|${parcelId.trim()}`;
  const location = useLocation();
  const navigate = useNavigate();
  const reportContent = useRef<HTMLElement>(null);
  const reportUrl = `${window.location.origin}${location.pathname}`;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [loaded, setLoaded] = useState<{ identity: string; data: ParcelReportData } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [scoringOpen, setScoringOpen] = useState(false);
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
  const score = data.score;
  const listingStatus = listingGroup(data.listing ?? undefined) === 'NO_LINKS'
    ? 'Not listed/Not found'
    : listingGroup(data.listing ?? undefined) === 'LISTED' ? data.listing?.status || 'Listed' : 'Not listed';
  const address = p.address || p.site_address_town_record;
  const heading = address ? titleCase(address) : `Parcel ${p.parcel_id}`;
  const city = titleCase(p.town);
  const recordedAcres = number(p.acres);
  const vacant = vacantLandMeasurements(p);
  const paved = pavedLandMeasurements(p);
  const wetlandPercent = number(p.wetland_pct);
  const complete = data.sources.layer_coverage === 'complete';
  const rows = [
    { label: 'Lot area (MassGIS)', ...areaMeasurements(data.metrics.gis_area_m2, null), type: 'lot' },
    { label: 'Recorded lot area', ...areaMeasurements(recordedAcres === null ? null : recordedAcres * M2_PER_ACRE, null), type: 'lot' },
    { label: complete ? 'Building footprint' : 'Mapped building footprint', ...areaMeasurements(data.metrics.building_area_m2, data.metrics.gis_area_m2), type: 'building' },
    { label: 'Paved area', ...paved, type: 'paved' },
    { label: complete ? 'Wetland area' : 'Mapped wetland area', ...areaMeasurements(data.metrics.mapped_wetland_area_m2, data.metrics.gis_area_m2), type: 'wetland' },
    { label: 'Vacant land', ...vacant, type: 'usable' },
  ].filter(row => row.type === 'paved' || (row.acres !== null && Number.isFinite(row.acres)));
  const metrics = [
    { label: 'Recorded lot area', value: recordedAcres, unit: 'ac', digits: 2 },
    { label: 'Vacant land', value: vacant.acres, unit: 'ac', digits: 2 },
    { label: 'Recorded wetland coverage', value: wetlandPercent, unit: '%', digits: 1 },
  ].filter(metric => metric.value !== null);
  const zone = ZONING_DISTRICTS.find(district => district.code === zoningCode(p.zoning));
  const valuation = number(p.total_val);

  // Live events and ownership signals displayed above Qualified
  const taxTakingsCount = number(p.tax_takings_found) ?? 0;
  const lifeInfo = parseLifeEventSignal(p.life_event_signal, p.estate_record_detail, p.town, p.state);
  const olderOwnerYears = number(p.years_owned) ?? 0;
  const hasOlderOwnerBadge = !lifeInfo.hasSignal && olderOwnerYears >= 30;
  const hasLifeEvents = taxTakingsCount > 0 || lifeInfo.hasSignal || Boolean(p.children_count_estate_owner) || hasOlderOwnerBadge;

  return <div className="parcel-report-page">
    {topbar}
    {exportError && <p className="report-export-error" role="alert">{exportError}</p>}
    <span className="report-share-feedback" role="status">{linkCopied ? 'Property report link copied.' : ''}</span>
    <div className="parcel-report-workspace">
      <ReportMap key={identity} data={data} />
      <article ref={reportContent} className="parcel-report-content" aria-label={`Parcel report for ${heading}`}>
        <header className="report-property-heading">
          <div className="report-heading-row">
            <div className="report-heading-titles">
              <div className="report-eyebrow">PARCEL REPORT</div>
              <h1>{heading}</h1>
              <p className="report-location">{city}, {p.state === 'MA' ? 'Massachusetts' : p.state === 'NH' ? 'New Hampshire' : p.state}</p>
            </div>
            {data.rank !== undefined && (
              <div className="report-heading-score report-heading-rank">
                <span className="report-heading-score-label">Rank</span>
                <button
                  type="button"
                  className="parcel-score-badge parcel-rank-badge"
                  onClick={() => score && setScoringOpen(true)}
                  title={data.rank > 0 ? `Rank #${data.rank} among Qualified parcels (Click to view scoring details)` : 'Excluded parcel: Rank 0'}
                  aria-label={`Rank ${data.rank > 0 ? '#' + data.rank : 'Unranked'}`}
                >
                  {data.rank > 0 ? `#${data.rank}` : 'Unranked'}
                </button>
              </div>
            )}
          </div>

          {/* Above Qualified: Live events and owner signals */}
          {hasLifeEvents && (
            <div className="report-life-events" aria-label="Live events and owner signals">
              {taxTakingsCount > 0 && (
                <span
                  className="report-life-event-badge report-badge-tax"
                  title={p.last_tax_taking || p.unpaid_tax_signal || 'Recorded tax taking'}
                >
                  <span aria-hidden="true">⚠️</span>
                  <span>Tax taking ({taxTakingsCount})</span>
                </span>
              )}
              {lifeInfo.hasSignal && (
                <span
                  className={`report-life-event-badge ${lifeInfo.badgeClass}`}
                  title={`${p.life_event_signal || ''}${p.estate_record_detail ? ' — ' + p.estate_record_detail : ''}`}
                >
                  <span aria-hidden="true">{lifeInfo.icon}</span>
                  <span>{lifeInfo.badgeText}</span>
                </span>
              )}
              {p.children_count_estate_owner && (
                <span
                  className="report-life-event-badge report-badge-children"
                  title={p.children_count_estate_owner}
                >
                  <span aria-hidden="true">👨‍👩‍👧‍👦</span>
                  <span>{p.children_count_estate_owner}</span>
                </span>
              )}
              {hasOlderOwnerBadge && (
                <span
                  className="report-life-event-badge report-badge-older"
                  title={`Owned ${Math.round(olderOwnerYears)} years`}
                >
                  <span aria-hidden="true">⏳</span>
                  <span>Owned {Math.round(olderOwnerYears)} yrs (older owner)</span>
                </span>
              )}
            </div>
          )}

          <div className="report-property-tags">
            <span className={p.keep === 'Y' ? 'report-tag-qualified' : 'report-tag-excluded'}>{p.keep === 'Y' ? 'Qualified' : 'Excluded'}</span>
            {available(p.zoning) && <span className="report-tag-zone">{p.zoning}{zone ? ` / ${zone.name}` : ''}</span>}
            <span className="report-tag-zone" data-listing-status>{listingStatus}</span>
          </div>
        </header>
        {metrics.length > 0 && <section className="report-key-metrics" aria-label="Key parcel figures">
          {metrics.map(metric => <div key={metric.label}><span>{metric.label}</span><strong>{format(metric.value!, metric.digits)}<small> {metric.unit}</small></strong></div>)}
        </section>}
        <RecordSection title="Property identity" fields={[
          ['Parcel ID', p.parcel_id], ['Land use', p.use], ['Owner', p.owner_name || p.owner],
          ['SiteIQ rank', data.rank && data.rank > 0 ? `#${data.rank}` : (p.keep === 'Y' ? null : 'Unranked (Excluded)')],
          ['Assessed value', valuation !== null ? `$${format(valuation)}` : null], ['Development status', p.status],
          ['Land category', p.category], ['Category reason', p.category_reason], ['Units', p.units], ['Zoning', p.zoning],
          ['Nearest road', p.road],
          ['Town-record address', p.site_address_town_record],
        ]} />
        {rows.length > 0 && <section className="report-section report-area-section"><div className="report-section-heading"><h2>Land & coverage</h2></div>
          <table className="report-area-table"><thead><tr><th scope="col">Area</th><th scope="col">sq ft</th><th scope="col">acres</th><th scope="col">% of lot</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.label} className={`report-area-${row.type}`}><th scope="row"><span className={`report-area-key report-area-key-${row.type}`} />{row.label}</th><td>{row.sqft === null ? 'Not available' : format(row.sqft)}</td><td>{row.acres === null ? '—' : format(row.acres, 2)}</td><td>{row.percent === null ? (row.type === 'paved' ? '—' : '') : `${format(row.percent, 1)}%`}</td></tr>)}</tbody></table>
        </section>}
        <RecordSection title="Ownership & records" fields={[
          ['Owner type', p.owner_type], ['Mailing address', p.owner_mailing_address],
          ['Owner lives on parcel', p.owner_lives_on_lot === 'Y' ? 'Yes' : p.owner_lives_on_lot === 'N' ? 'No' : null],
          ['Owner distance', number(p.owner_distance_miles) !== null ? `${format(Number(p.owner_distance_miles), 1)} miles` : null],
          ['Years owned', number(p.years_owned) !== null ? `${format(Number(p.years_owned), 1)} years` : null],
          ['Last transfer', p.last_sale_date], ['Transfer price', p.last_sale_price], ['Deed reference', p.deed_book_page], ['Company people', p.company_people],
        ]} />
        {data.loan && <RecordSection title="Loan information" className="report-loan-section" description="*Source: Southern Essex Registry of Deeds (salemdeeds.com), searched by property address for mortgage, discharge and UCC filings; loans recorded only under the owner’s name may not appear." fields={data.loan.loan_signal === 'Not checked' ? [
          ['Loan category', loanCategoryLabel(data.loan.loan_signal)],
          ['Open mortgage', p.open_mortgage], ['Leases, easements & restrictions', p.lease_easement_restriction],
        ] : [
          ['Loan category', loanCategoryLabel(data.loan.loan_signal)], ['Loan status', data.loan.loan_status],
          ['Open loans', data.loan.open_loans_count], ['Latest open-loan lender', data.loan.latest_open_loan_lender],
          ['Latest loan amount', formatLoanMoney(data.loan.latest_loan_amount_usd)], ['Latest loan date', data.loan.latest_loan_date],
          ['Loan age', data.loan.loan_age_years === null ? null : `${format(data.loan.loan_age_years, 1)} years`],
          ['Loan to value', formatLoanPercent(data.loan.loan_to_value_pct)],
          ['Estimated current balance', formatLoanMoney(data.loan.est_balance_now_usd)],
          ['Open mortgage', p.open_mortgage], ['Leases, easements & restrictions', p.lease_easement_restriction],
        ]} />}
        <RecordSection title="Tax & estate records" fields={[
          ['Property tax', p.unpaid_tax_signal], ['Tax takings found', p.tax_takings_found], ['Latest tax taking', p.last_tax_taking],
          ['Estate & ownership signal', p.life_event_signal], ['Estate record', p.estate_record_detail], ['Children / heirs', p.children_count_estate_owner],
        ]} />
        <RecordSection title="Listing & history" links={parcelListingLinks(data.listing, p)} fields={[
          ['Listing status', listingStatus],
        ]} />
      </article>
    </div>
    {scoringOpen && score && (
      <ParcelScoringDialog
        parcel={p}
        score={score}
        onClose={() => setScoringOpen(false)}
      />
    )}
  </div>;
}
