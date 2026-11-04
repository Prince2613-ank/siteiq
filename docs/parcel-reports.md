# Parcel reports

Every source parcel has a report addressed by its town and parcel ID, including parcels with no street address. The former Country Club URL remains supported.

The Screening section is omitted from individual property reports and PDF
exports. The Qualified/Excluded badge remains in the report header. The
Screening Logic page at `/screening-logic`, after Sites in the main navigation,
explains exclusions, then the building-coverage threshold, listing labels, scores
and ranks. The former `/screening-report` path redirects to this page. The
"What does Qualified mean?" section is removed. Totals and first-applicable exclusion counts
are loaded through the same `loadParcels` screening pipeline used by Dashboard
and Sites. Counts are not hard-coded or shown when required data cannot load.

Listing & history contains each parcel's available external listing links from
the listing-check asset, Zillow/Redfin source fields, and any separate listing
proof. URLs are validated and deduplicated; parcels without links say "No listing
links found." These links open in a new tab and remain clickable in PDF exports.
They do not add an internal property-report URL to the PDF. Loan information
contains the supplied registry source note, Open mortgage, and Leases, easements
& restrictions; there is no separate Mortgage & restrictions section.

All 766 source parcels are visible. Development status has only Vacant and
Built-up, with an All filter. Building footprint at or below 5% of its matching
parcel area classifies a parcel as Vacant; above 5% classifies it as Built-up.
The unrounded percentage is used. Mixed is no longer a displayed status.

Report measurements take priority. For 89 parcels with a missing report building
measurement, the index uses the source workbook's `building_m2 / parcel_m2`.
Both values must be finite, parcel area positive, building area between zero
and parcel area, and the source must have no data-issue flag. Zero is valid;
missing is never zero. The workbook's `builtup_pct` includes paving and is not
used for the building-only threshold. Index entries retain both the report
metrics and the measurement source; reports label spreadsheet measurements.
If both sources are unavailable, a formerly Built-up/Mixed record stays Built-up.
The original status remains in source records and runtime audit metadata.
Current totals: 346 Vacant, 420 Built-up; 213 Qualified
and 553 Excluded. All Built-up parcels are excluded, even in a Developable land
category. Vacant parcels still must pass ownership, wetland and condo checks.
Active/partial/pending sale listings are Excluded and score zero.

Land category combines the original spreadsheet `land_category` and
`category_reason`. An explicit `town code says developable` resolves private
land to Developable, including Paved land and Non-developable wetland conflicts.
This takes precedence over the Non-developable >50% wetland exclusion; the
wetland measurement remains unchanged. It does not override listed sale,
Built-up, condo or ownership exclusions. Negative words such as undevelopable
and non-developable never count as a positive developability statement.
Other paved land may resolve to Commercial or Industrial from its reason.
An explicit town undevelopable statement excludes otherwise vacant land. A
Non-developable category whose reason identifies cemetery/conservation/Chapter
61 use also remains excluded rather than falling through to generic Vacant.
The full decision audit is `docs/audits/2026-11-04-category-screening.json`.
Original category evidence is retained as `source_land_category`. Import with
`python scripts/sync_category_reason.py "path/to/source.xlsx"`; the importer
requires exact identity matches for every project parcel and never edits Excel.
Reports load current category evidence so their classification and PDF exports
match Dashboard and Sites even before report geometry is regenerated.

Land & coverage conversions use original square-metre measurements, not rounded
acreage. Exact conversion constants are 4046.8564224 m² per acre and 0.09290304 m²
per square foot. Building/wetland percentages use their report's mapped lot area.
Vacant land uses the workbook's `open_nonwetland_m2 / parcel_m2`, preserving its
exclusion of buildings, paving and wetlands. It is not recalculated as mapped
lot area minus building/wetland area, since paving is not a mapped report layer.
These source boundaries differ, so rows are not an additive partition. The
description below the report/PDF table is omitted as requested. Missing measurements stay unavailable rather than
becoming zero; invalid vacant area above its source lot is not displayed.
The 4 November audit corrected 763 rounded square-foot values and 629 displayed
vacant-land percentages. At 47 Pike St, vacant land is 7327.1 m² = 78,868 sq ft =
1.81 displayed acres, with 90.3% based on the 8115.5 m² source lot. The mapped lot
is independently 8023.320905 m² (86,362 sq ft). These report presentation fixes do
not change qualification, scores, ranks or source `usable_acres` calculations.
Run `npm run test:areas --workspace=apps/web` to check all 766 records and report
views. The source importer also preserves `source_vacant_area_m2`.

Paved area is shown in Land & coverage and PDF exports using workbook `paved_m2`
and its matching `parcel_m2` for the percentage. Existing paving row styling
distinguishes it from buildings and vacant land. Genuine measured zero is shown
as zero. New Hampshire has no paving layer in this input, so its zero placeholders
are treated as unavailable and displayed as "Not available", rather than claiming
there is no paving. Paved measurements do not change qualification or scores.

Partial mapped coverage remains a stated limitation in reports, not a full-site
survey or proof that the remaining area is free of paving/other constraints.
Classification is applied consistently before filters, map features, rankings
and report screening. Old saved Mixed/Paved filter selections reset to All.
Listing and building-coverage checks must load before browsing or report
screening; unavailable required assets trigger a retryable data-load error.

`scripts/build_parcel_reports.py` also regenerates
`geojson/parcel_building_coverage.json`. To rebuild only this lightweight index
from existing report assets, run `python scripts/build_parcel_building_coverage.py`.

Run `python scripts/build_parcel_reports.py` after updating parcel, building, wetland, corridor, or listing records. Install its pinned geometry dependencies from `scripts/requirements-parcel-reports.txt` if needed. Generated JSON files and their identity index live in `apps/web/public/reports/` and are served as static assets.

The generator projects geometry to EPSG:26986 for area calculations, repairs invalid polygon topology, clips buildings and wetlands to each subject parcel, and uses union areas to avoid counting overlapping geometry twice. Neighbors are limited to parcels within 100 metres. Parcel source fields are preserved, including nulls.

Local environmental layers cover the 250 m study corridor. Complete layer coverage is not assumed for New Hampshire parcels. Reports with incomplete coverage call the measured overlays ?Mapped building footprint? and ?Mapped wetland area?. An incomplete layer with no observed feature produces a missing metric, not a claim of zero coverage. Recorded lot area, usable acreage, and recorded wetland percentage remain separate source-record values. Paved and flood areas are not fabricated. Unknown fields are hidden in the UI.

Massachusetts reports use MassGIS aerial imagery; New Hampshire reports use Esri World Imagery. Report headings, ownership, valuations, status, zoning, screening, links and history are read from the selected parcel. Scroll and zoom are persisted per parcel identity.
