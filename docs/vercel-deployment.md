# Vercel routing

SiteIQ uses React Router in a Vite single-page app. A direct request or refresh on
`/sites/report/SALISBURY/12-32` must serve the built `index.html` so React Router can
open the requested parcel report. Without this fallback, Vercel can return its own
404 before the application loads, even though navigation inside the app works.

The SPA rewrite is present in both `vercel.json` and `apps/web/vercel.json` so it is
available whether the Vercel project's Root Directory is the repository root or
`apps/web`. Keep the routing rules in these two files identical. Existing static
assets, including `/reports/*.json`, `/geojson/*`, and `/assets/*`, are served from
the build output normally.

Deploy the configuration change, then directly open and refresh a report URL on
the new deployment. Confirm the document returns 200 and the same parcel report
loads. Also check `/sites`, `/`, and a report JSON URL. Local Vite refresh checks
alone do not verify Vercel's production routing.

Reference: https://vercel.com/docs/frameworks/frontend/vite#using-vite-to-make-spas
