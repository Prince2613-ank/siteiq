import { useQuery } from '@tanstack/react-query';
import { loadParcels } from '../utils/dataLoading';

const exclusions = [
  { rule: 10, name: 'Listed for sale', detail: 'Active, partial/unit and pending sale listings are excluded and receive score 0.' },
  { rule: 2, name: 'Non-developable land with more than 50% wetlands', detail: 'Excluded unless the category reason explicitly says the town considers the land developable.' },
  { rule: 3, name: 'Condominium unit', detail: 'The parcel is identified as a condominium unit rather than independently available land.' },
  { rule: 7, name: 'Built-up land', detail: 'Buildings cover more than 5% of the parcel. Formerly built-up or mixed parcels also remain Built-up when building coverage is unavailable.' },
  { rule: 1, name: 'Excluded ownership', detail: 'Public/government land, Trust ownership, religious/nonprofit ownership and other ownership types outside Company, Individual or Unknown.' },
  { rule: 12, name: 'Town says undevelopable', detail: 'The category reason explicitly states that town records consider the land undevelopable.' },
  { rule: 11, name: 'Cemetery, conservation or Chapter 61 use', detail: 'The source labels the land Non-developable for one of these uses.' },
  { rule: 8, name: 'Paved land without positive category evidence', detail: 'The category reason does not support Developable, Commercial or Industrial use.' },
  { rule: 9, name: 'Other / insufficient classification', detail: 'The parcel does not meet the remaining land-screening rules.' },
];

export function ScreeningReport() {
  const { data, isPending, isError, refetch } = useQuery({ queryKey: ['screening-report-parcels'], queryFn: loadParcels });
  const parcels: { properties: { keep?: string; screening_rule?: number } }[] = data?.features ?? [];
  const qualified = parcels.filter(parcel => parcel.properties.keep === 'Y').length;
  const excluded = parcels.filter(parcel => parcel.properties.keep === 'N').length;
  const card = 'rounded-2xl border border-slate-200 bg-white p-5 sm:p-7';
  return <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-10">
    <header className="mb-7">
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Screening Logic</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">Screening decides which parcels enter the Qualified list using land category, category reason, building coverage, ownership and listing status. Qualified means the parcel meets our project rules; it is not confirmation of development approval.</p>
    </header>
    {isPending && <p role="status" className="mb-6 text-sm text-slate-500">Loading current screening counts…</p>}
    {isError && <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Current parcel counts could not be loaded. <button className="font-semibold underline" onClick={() => refetch()}>Try again</button></div>}
    {data && <section aria-label="Current screening totals" className="mb-7 grid grid-cols-3 gap-3 sm:gap-5">
      {[['All parcels', parcels.length, 'text-slate-900'], ['Qualified', qualified, 'text-emerald-700'], ['Excluded', excluded, 'text-red-700']].map(([label, value, color]) =>
        <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"><p className="text-xs sm:text-sm text-slate-500">{label}</p><p className={`mt-2 text-2xl sm:text-3xl font-bold tabular-nums ${color}`}>{value}</p></div>)}
    </section>}
    <section className={`${card} mb-7`}>
      <h2 className="text-lg font-bold text-red-800">Why is a parcel Excluded?</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">The first applicable exclusion determines the displayed reason. Each parcel is counted once, even when several rules apply.</p>
      <div className="mt-5 hidden overflow-x-auto sm:block"><table className="w-full text-left text-sm">
        <thead><tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"><th className="pb-3 pr-4">Reason</th><th className="pb-3 pr-4">Rule</th><th className="pb-3 text-right">Parcels</th></tr></thead>
        <tbody>{exclusions.map(row => <tr key={row.rule} className="border-b border-slate-100 align-top"><th scope="row" className="min-w-40 py-4 pr-4 font-semibold">{row.name}</th><td className="min-w-56 py-4 pr-4 leading-6 text-slate-600">{row.detail}</td><td className="py-4 text-right font-semibold tabular-nums">{data ? parcels.filter(parcel => parcel.properties.keep === 'N' && parcel.properties.screening_rule === row.rule).length : '—'}</td></tr>)}</tbody>
        {data && <tfoot><tr><th colSpan={2} className="pt-4 font-bold">Total Excluded</th><td className="pt-4 text-right font-bold tabular-nums">{excluded}</td></tr></tfoot>}
      </table></div>
      <div className="mt-5 space-y-4 sm:hidden">
        {exclusions.map(row => <article key={row.rule} className="border-b border-slate-100 pb-4">
          <div className="flex items-start justify-between gap-3"><h3 className="text-sm font-semibold">{row.name}</h3><span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-sm font-semibold tabular-nums" aria-label={`${row.name} parcel count`}>{data ? parcels.filter(parcel => parcel.properties.keep === 'N' && parcel.properties.screening_rule === row.rule).length : '—'}</span></div>
          <p className="mt-2 text-sm leading-6 text-slate-600">{row.detail}</p>
        </article>)}
        {data && <p className="flex justify-between text-sm font-bold"><span>Total Excluded</span><span>{excluded}</span></p>}
      </div>
    </section>
    <section className={`${card} mb-7`}>
      <h2 className="text-lg font-bold">What does the 5% rule mean?</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600"><strong>Building coverage = building footprint ÷ matching parcel area × 100.</strong> It measures the ground covered by buildings, excluding paving and extra floors.</p>
      <dl className="mt-4 space-y-2 text-sm"><div className="flex justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2"><dt>5% or less</dt><dd className="font-semibold text-emerald-800">Vacant</dd></div><div className="flex justify-between gap-3 rounded-lg bg-slate-100 px-3 py-2"><dt>More than 5%</dt><dd className="font-semibold">Built-up</dd></div></dl>
      <p className="mt-3 text-sm leading-6 text-slate-600">Vacant is a project classification and can include a small building. It does not automatically mean Qualified. We use the unrounded percentage, report measurements first, then validated spreadsheet measurements if report data is missing.</p>
    </section>
    <section className={card}>
      <h2 className="text-lg font-bold">Screening, scores and ranks</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">Screening determines eligibility. Scores help compare parcels and are calculated separately. Only Qualified parcels receive ranks, from highest score to lowest. Excluded parcels display rank 0; listed-for-sale parcels also receive score 0.</p>
      <p className="mt-3 text-sm leading-6 text-slate-600">“Not listed” means no active sale listing was found and property links exist. “Not listed/Not found” means no links were found, so off-market status is unconfirmed. Neither label by itself makes a parcel Qualified.</p>
    </section>
  </div>;
}
