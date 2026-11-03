# Dashboard filters

Zoning initially shows six full-width group buttons. Opening groups splits the
card into group and district columns (stacked on mobile). Selecting a group
immediately filters the map and results to all districts in that group. Selecting
individual districts narrows that group, with OR between district selections
and other selected groups. Each group's selections stay applied when switching
panels, and its badge continues to show the selected district count.
Removing the last district selection restores the entire selected group.

Only one group's districts can be open at a time. Opening another group closes
the previous panel while preserving its district refinements and applying the
new group. Clicking the active group closes its panel; explicit district choices
stay applied. For a group without district refinements, clicking it again clears
that whole-group selection. Clicking a selected
district again removes it; Reset filters clears every selection and restores the
full-width list. Saved views with multiple open groups restore only the last one.
The column labels are accessible to screen readers but hidden visually; extra
helper text and per-column clear buttons are omitted. Development status, screening, owner type,
loan category, wetland coverage and years owned combine with AND.

Every option count respects the other active filters but omits its own selection.
Group and district counts omit the selected districts, so additional choices
remain available. The same predicate drives map features and counts in
`dashboardFilters.ts`.

Owner type and Loan category allow multiple selections. Choices within either
filter combine with OR, and the two filters combine with AND. Clicking a selected
option removes it; All owner types or All categories clears that filter. No
selected options means all records for that filter. Selections persist on refresh
and when returning from a report. Legacy saved single choices restore as one
selected option. Reset filters clears both groups.

Listing status is available on both pages as a single selection: All listing
statuses, Listed, Not listed, or No links. Listed includes recorded active,
pending and partial listings. Not listed contains other parcels with an HTTP(S)
listing link; No links contains the remainder. It combines with the other filters,
persists on refresh, and clears through Reset filters. Counts omit only the
listing selection while respecting all other active filters.

All current parcel records have valid recorded wetland percentages. There is no
Unknown wetland filter; legacy saved Unknown selections reset to All. Missing
values would remain in All rather than being interpreted as zero. Years-owned
ranges use the recorded ownership duration, including durations over 100 years.
The 25 records without that value remain in All but do not match a duration band.
Years owned uses a multiselect dropdown on both pages. Selected ranges combine
with OR, persist on refresh, and clear through All ownership durations or Reset
filters. Legacy saved single ranges restore as one selected range.

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
parcel fills, owner/loan multiselect, mobile layout and report framing.

Sites uses dropdown filters, with multiselect for zoning groups/districts, owner
type, loan category and years owned. Development status is single-select. Search
and Life Events narrow both the displayed sites and the other option counts.
Life Events counts respect the other filters while omitting its own selection.
Run `npm run test:all-filters --workspace=apps/web` for every current option on
both pages, exact Sites result identities, map zoning colors/counts, contextual
counts, all sort modes and pagination. It defaults to port 5173; `SITEIQ_URL`
overrides that address. The page-specific tests cover combined selections,
refresh persistence, reset and mobile layout.
