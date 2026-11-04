# Property PDF export

Open a property report from Sites or Dashboard, then use **Export PDF** in the
report toolbar to download `SiteIQ-<TOWN>-<PARCEL>.pdf`. Export is available once
the property report has loaded. It runs in the browser and includes the displayed
report fields, area table, the report's aerial map with parcel, building and
wetland layers. The map export preserves the current
map view and its aspect ratio and includes the imagery attribution. Imagery must
be available before export can finish; a failed load allows retrying.

PDFs do not include the property-report URL, a property-report link heading,
or a URL in document metadata. Page footers show page numbers without an export
date. **Copy link** in the report toolbar copies the property-report
URL for sharing separately. Copied links use the app address where export is run;
use the deployed app when preparing reports to send to another person.

The PDF libraries load only when exporting. The download uses a snapshot of the
selected report so switching properties during export cannot mix report data.
Loading or failed reports cannot be exported, and export errors allow retrying.

Run `npm run test:report-pdf --workspace=apps/web` with the local app running on
port 5173, or set `SITEIQ_URL` to another app origin. The browser test downloads
four reports (a top-ranked property, a large parcel, a parcel without a street
address, and a New Hampshire parcel using a different imagery source), checks
the absence of embedded report URLs and clipboard sharing, and checks desktop/mobile controls, imagery
failures and failed-report handling. Test downloads are written under `tmp/pdfs`.
