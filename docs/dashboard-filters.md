# Dashboard filters

Zoning initially shows six full-width group buttons. Opening groups splits the
card into group and district columns (stacked on mobile). Groups only reveal
available district options; opening one does not change the map or select all its
districts. Only explicitly selected districts apply zoning filtering, with OR
between them, including districts from different groups. No districts selected
means no zoning filter. There is no automatic All districts selection.

Only one group's districts can be open at a time. Opening another group closes
the previous panel while preserving all district choices, map results and group
selection badges. Closing a panel also preserves choices. Clicking a selected
district again removes it; Reset filters clears every selection and restores the
full-width list. Saved views with multiple open groups restore only the last one.
The column labels are accessible to screen readers but hidden visually; extra
helper text and per-column clear buttons are omitted. Development status, screening, owner type,
wetland coverage, listing status and years owned combine with AND.

Every option count respects the other active filters but omits its own selection.
Group and district counts omit the selected districts, so additional choices
remain available. The same predicate drives map features, listing cards and
counts in `dashboardFilters.ts`.

Listing groups partition the complete result set. Known active/pending/partial
listings are Listed. Other parcels with an HTTP(S) listing link are Not listed.
The remaining parcels are No links. With no other filters applied, the current
766 records split into 9 Listed, 530 Not listed with links, and 227 No links.

All current parcel records have valid recorded wetland percentages. There is no
Unknown wetland filter; legacy saved Unknown selections reset to All. Missing
values would remain in All rather than being interpreted as zero. Years-owned
ranges use the recorded ownership duration, including durations over 100 years.
The 25 records without that value remain in All but do not match a duration band.

Parcels have zoning-colored fills by default. Roads use a separate pane above
parcel fills and highlights, with pointer events disabled to preserve parcel
clicks. Reset clears all filters and the popup and fits the complete parcel data,
rather than the previously filtered layer. The view and filters persist on
refresh and when returning from a parcel report.

Fresh reports fit and center the subject parcel between zoom levels 15 and 20.
The lower bound retains the 300 m / 1000 ft maximum zoom-out scale. Saved zooms
use a new versioned key so an older broad default does not override this framing.

With the local app on port 5174, run `npm run test:dashboard --workspace=apps/web`.
Set `SITEIQ_URL` to check a different local or deployed app. The browser check
covers real-data counts, combined filters, persistence, reset, road stacking,
parcel fills, no-link cards, mobile layout and report framing.
