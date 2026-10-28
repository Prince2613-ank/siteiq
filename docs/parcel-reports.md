# Parcel reports

Every source parcel has a report addressed by its town and parcel ID, including parcels with no street address. The former Country Club URL remains supported.

Run `python scripts/build_parcel_reports.py` after updating parcel, building, wetland, corridor, or listing records. Install its pinned geometry dependencies from `scripts/requirements-parcel-reports.txt` if needed. Generated JSON files and their identity index live in `apps/web/public/reports/` and are served as static assets.

The generator projects geometry to EPSG:26986 for area calculations, repairs invalid polygon topology, clips buildings and wetlands to each subject parcel, and uses union areas to avoid counting overlapping geometry twice. Neighbors are limited to parcels within 100 metres. Parcel source fields are preserved, including nulls.

Local environmental layers cover the 250 m study corridor. Complete layer coverage is not assumed for New Hampshire parcels. Reports with incomplete coverage call the measured overlays ?Mapped building footprint? and ?Mapped wetland area?. An incomplete layer with no observed feature produces a missing metric, not a claim of zero coverage. Recorded lot area, usable acreage, and recorded wetland percentage remain separate source-record values. Paved and flood areas are not fabricated. Unknown fields are hidden in the UI.

Massachusetts reports use MassGIS aerial imagery; New Hampshire reports use Esri World Imagery. Report headings, ownership, valuations, status, zoning, screening, links and history are read from the selected parcel. Scroll and zoom are persisted per parcel identity.
