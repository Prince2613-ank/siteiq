# Parcel opportunity ranking

Implemented from the Ranking model on page 2 of the client's Off-Market Land Channel business plan. This ranking is separate from property identity confidence and from Qualified / Excluded screening. Neither screening rules nor source GeoJSON records are changed by scoring.

`score = clamp(site quality + seller likelihood + deductions, 0, 100)`

Site quality contributes up to 40 points; seller likelihood contributes up to 60. The five blockers stack and can deduct up to 55. This is an ordinal research score, not a probability that an owner will sell. Listed and excluded parcels may have scores; their existing eligibility and listing labels remain visible.

## Thresholds

| Factor | Points |
| --- | --- |
| Driving distance to highway exit | Under 1 mile: 15; 1 to under 2: 10; 2 through 3: 5; over 3: 0 |
| Land type | Commercial/Industrial: 10; verified buildable residential: 6; other: 0 |
| Total lot acres | 5+: 10; 2 to under 5: 7; 1 to under 2: 4; under 1: 1 |
| Businesses within 1 mile | Several: 5; a few: 2; none: 0 |
| Owner-specific death/probate record | 14 |
| Town-confirmed unpaid tax | 14 |
| Unsold listing taken down within 5 years | 10 |
| Owner 70+ or completed inheritance by children | 8 (once, even if both) |
| Years owned | 30+: 7; 20 to under 30: 5; 10 to under 20: 2; under 10: 0 |
| Owner distance | Another state: 7; same state and 50+ miles: 4; otherwise: 0 |
| No road access | -15 |
| Lease recorded in the source | -15 |
| Any recorded wetland coverage above zero | -10 |
| Purchased within the last 3 years | -10 |
| Open mortgage | -5 |

The PDF leaves overlapping size/distance endpoints, wetland extent and "several/a few" thresholds unspecified. Size endpoints use the higher size bracket; the 2-mile distance endpoint uses the 2–3 bracket. Total lot acres implements the PDF's lot-size factor; the existing minimum 1 **usable** acre qualification remains separate. Wetland deduction applies to any positive recorded percentage. Nearby businesses use a verified categorical finding, rather than inventing numeric cutoffs or counting inactive industrial parcels. Three-year purchase window excludes its exact anniversary; five-year listing window includes its exact anniversary.

## Missing evidence

Every parcel receives one calculated score from source records only. No proportional rescaling, manual points, estimates or possible-score ranges are used. Missing or ambiguous support contributes numeric zero, with the source reason displayed. A zero from missing evidence does not assert that a property issue is absent. The Dashboard and Sites property information cards retain their original eight sections. Clicking a list score opens a separate, read-only Scoring details dialog with all 15 factors, points, deductions, evidence and the scoring table's rules.

The current dataset lacks highway driving distances, business surveys, legal road access and owner age. Those factors receive zero where unsupported. Road corridor distance is never substituted for highway distance or legal access. Developable does not automatically establish residential buildability. A same-surname family estate, a generic estate filing, age 65+, long ownership or children named in an obituary do not prove the owner's death, age 70+, or completed inheritance. Possible tax debt and old tax takings do not prove current unpaid tax. A recorded Lease x1 (or larger count) receives the table's -15 deduction; an easement/restriction alone does not incur a lease penalty. Recent nominal/family transfers do not establish a purchase. Future/invalid sale dates and missing, blank, invalid, negative and out-of-range inputs contribute zero with the source reason shown.

Explicit source absence statements contribute zero for that factor, with the underlying text displayed. A clearly recorded open mortgage contributes -5. A historical unsold listing whose recorded years all predate the five-year window contributes zero; ambiguous or recent free-text attempts without sufficient dates also receive zero. Current listings or recorded sales never automatically earn old-unsold-listing points.

## Automatic calculation

The scoring dialog contains no dropdowns, inputs, confirmation actions or manual review controls. The scoring engine and page hook accept source records and the calculation date only. Previously stored browser point selections are never read and cannot affect any score or rank. Source parcel files are unchanged.

Scores are consistent across browsers using the same source records and calculation date.

## Sites ranks

Every parcel has a global display position among all 766 records, calculated before filtering and pagination. Higher scores come first. Equal scores use natural address order, then town/parcel identity, so positions are deterministic; different positions do not imply different scores. The Rank column preserves those global positions when filtering or sorting by other fields. Rank all clears search and filters, selects score order and returns to page 1; the chosen page size is retained. All 766 records are ranked even when only 50 rows are shown at a time.

## Verification

`node apps/web/e2e/parcel-scoring.cjs` checks scoring boundaries, stacked source penalties, missing/ambiguous evidence, date lookbacks, zero contribution for unsupported data and all 766 records.

`node apps/web/e2e/parcel-scoring-ui.cjs` checks that both information cards retain the original eight sections without scoring or Unverified content, while list scores/sorting and ranks remain available. It also checks desktop/mobile layout and Escape with the local app running on port 5173.

`node apps/web/e2e/scoring-dialog.cjs` checks all 766 clickable source-only scores, ignored legacy browser overrides, parcel identity, the separate dialog's 15 read-only factors, absence of property-row/map side effects, keyboard operation, focus trapping/restoration and responsive layout.
