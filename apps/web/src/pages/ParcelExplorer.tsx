import { useCallback, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { BoundaryStatus, ResearchParcelMap } from '../components/ResearchParcelMap';
import { imageryLayers, ImageryYear, researchParcels, ResearchParcel } from '../data/parcelResearch';
import './ParcelExplorer.css';

const years: ImageryYear[] = [2021, 2022, 2023, 2024, 2025];

function Header() {
  return <header className="research-header">
    <Link to="/parcel-explorer" className="research-brand">SiteIQ <span>Parcel Research</span></Link>
    <div className="research-source">Massachusetts public GIS workspace</div>
  </header>;
}

function LayerControls({ year, setYear, wetlands, setWetlands, context, setContext }: {
  year: ImageryYear; setYear: (value: ImageryYear) => void;
  wetlands: boolean; setWetlands: (value: boolean) => void;
  context: boolean; setContext: (value: boolean) => void;
}) {
  return <div className="layer-controls">
    <div className="control-group">
      <span className="control-label">Aerial year</span>
      <div className="year-segments" aria-label="Aerial imagery year">
        {years.map((item) => <button key={item} type="button" className={year === item ? 'active' : ''}
          disabled={!imageryLayers[item].available} title={imageryLayers[item].label} onClick={() => setYear(item)}>{item}</button>)}
      </div>
    </div>
    <label className="switch-row"><input type="checkbox" checked={wetlands} onChange={(event) => setWetlands(event.target.checked)} /><span className="switch" />Wetlands</label>
    <label className="switch-row"><input type="checkbox" checked={context} onChange={(event) => setContext(event.target.checked)} /><span className="switch amber" />500 ft context</label>
  </div>;
}

function AddressList({ selected, onSelect }: { selected: ResearchParcel; onSelect: (parcel: ResearchParcel) => void }) {
  return <aside className="parcel-list">
    <div className="panel-heading"><span>Portfolio</span><strong>{researchParcels.length} parcels</strong></div>
    <div className="address-items">{researchParcels.map((parcel, index) =>
      <button type="button" key={parcel.slug} className={parcel.slug === selected.slug ? 'address-item active' : 'address-item'} onClick={() => onSelect(parcel)}>
        <span className="address-index">{String(index + 1).padStart(2, '0')}</span>
        <span><strong>{parcel.address.split(',')[0]}</strong><small>{parcel.town}, Massachusetts</small></span>
        <span className="zone-chip">{parcel.zoning}</span>
      </button>)}</div>
    <div className="source-note">Parcel boundaries load from MassGIS. Zoning should be confirmed with the municipality before permitting or acquisition.</div>
  </aside>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="fact"><span>{label}</span><strong>{value}</strong></div>;
}

function Status({ value }: { value: BoundaryStatus }) {
  const text = value === 'official' ? 'Official parcel boundary' : value === 'loading' ? 'Loading MassGIS parcel' : 'Approximate extent shown';
  return <span className={`boundary-status ${value}`}><i />{text}</span>;
}

export function ParcelExplorer() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState(researchParcels[0]);
  const [year, setYear] = useState<ImageryYear>(2025);
  const [wetlands, setWetlands] = useState(true);
  const [context, setContext] = useState(true);
  const [status, setStatus] = useState<BoundaryStatus>('loading');
  const handleStatus = useCallback((value: BoundaryStatus) => setStatus(value), []);
  const openReport = useCallback(() => navigate(`/parcel-explorer/${selected.slug}`), [navigate, selected.slug]);

  return <div className="research-shell">
    <Header />
    <LayerControls year={year} setYear={setYear} wetlands={wetlands} setWetlands={setWetlands} context={context} setContext={setContext} />
    <main className="explorer-grid">
      <AddressList selected={selected} onSelect={setSelected} />
      <section className="map-workspace">
        <ResearchParcelMap parcel={selected} imageryYear={year} showWetlands={wetlands} showContext={context} onBoundaryStatus={handleStatus} onParcelClick={openReport} />
        <div className="map-caption"><Status value={status} /><span>Click the highlighted parcel to open its full report</span></div>
      </section>
      <aside className="parcel-summary">
        <div className="summary-kicker">Selected parcel</div><h1>{selected.address.split(',')[0]}</h1><p>{selected.town}, Massachusetts</p>
        <div className="fact-grid"><Fact label="Parcel ID" value={selected.parcelId} /><Fact label="Lot area" value={selected.lotSize} /><Fact label="Zoning" value={`${selected.zoning} - ${selected.zoningName}`} /><Fact label="Imagery" value={String(year)} /></div>
        <div className="context-block"><span>Commercial context</span><p>{selected.commercialContext}</p></div>
        <button type="button" className="open-report" onClick={openReport}>Open parcel report</button>
        <a className="municipal-link" href={selected.sourceUrl} target="_blank" rel="noreferrer">Open municipal assessor map</a>
      </aside>
    </main>
  </div>;
}

export function ParcelReport() {
  const { slug } = useParams();
  const parcel = useMemo(() => researchParcels.find((item) => item.slug === slug), [slug]);
  const [year, setYear] = useState<ImageryYear>(2025);
  const [wetlands, setWetlands] = useState(true);
  const [context, setContext] = useState(true);
  const [status, setStatus] = useState<BoundaryStatus>('loading');
  const handleStatus = useCallback((value: BoundaryStatus) => setStatus(value), []);
  if (!parcel) return <Navigate to="/parcel-explorer" replace />;

  return <div className="research-shell report-shell">
    <Header />
    <div className="report-titlebar"><Link to="/parcel-explorer">Back to portfolio</Link><div><span>Parcel report</span><h1>{parcel.address}</h1></div><Status value={status} /></div>
    <LayerControls year={year} setYear={setYear} wetlands={wetlands} setWetlands={setWetlands} context={context} setContext={setContext} />
    <main className="report-content">
      <section className="report-map-band">
        <ResearchParcelMap parcel={parcel} imageryYear={year} showWetlands={wetlands} showContext={context} onBoundaryStatus={handleStatus} height="540px" />
        <div className="map-legend"><span><i className="legend-wetland" />MassDEP wetland polygons</span><span><i className="legend-context" />500 ft review area</span><span><i className="legend-parcel" />Subject parcel</span></div>
      </section>
      <section className="report-sections">
        <div className="report-section"><h2>Parcel and commercial area</h2><div className="report-facts"><Fact label="Municipality" value={parcel.town} /><Fact label="Parcel ID" value={parcel.parcelId} /><Fact label="Lot area" value={parcel.lotSize} /><Fact label="Zoning district" value={`${parcel.zoning} - ${parcel.zoningName}`} /></div><p>{parcel.commercialContext}</p></div>
        <div className="report-section"><h2>Wetland screening</h2><p>The green overlay is the MassDEP wetlands inventory. The dashed amber ring shows the surrounding 500-foot review area so nearby resources remain visible even when they do not cross the parcel.</p><div className="notice">Screening only. Wetland boundaries and jurisdiction must be confirmed through field delineation and the local Conservation Commission.</div></div>
        <div className="report-section"><h2>Sale history</h2>{parcel.saleHistory.length ? <div className="sale-table">{parcel.saleHistory.map((sale) => <div key={sale.date}><strong>{sale.date}</strong><strong>{sale.price}</strong><span>{sale.note}</span></div>)}</div> : <p>No verified arm's-length sale is included in the current municipal record. Use the Registry of Deeds link in the assessor map for a complete title and transfer history.</p>}</div>
        <div className="report-section"><h2>Imagery record: 2021-2025</h2><div className="imagery-record">{years.map((item) => <div key={item} className={imageryLayers[item].available ? 'available' : 'unavailable'}><strong>{item}</strong><span>{imageryLayers[item].label}</span></div>)}</div></div>
      </section>
    </main>
  </div>;
}
