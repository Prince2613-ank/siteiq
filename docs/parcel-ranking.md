# Parcel opportunity ranking

Implemented from the client's ranking model (version `ranking-v4`, 23 October 2026), which replaces the Ranking model on page 2 of the Off-Market Land Channel business plan. This ranking is separate from property identity confidence and from Qualified / Excluded screening. Neither screening rules nor source GeoJSON records are changed by scoring.

`score = clamp(site quality + min(seller likelihood, 60) + deductions, 0, 100)`

Site quality contributes up to 40 points. Seller factors can add up to 165, but only the first 60 count. The six blockers stack and can deduct up to 50. This is an ordinal research score, not a probability that an owner will sell. Listed and excluded parcels may have scores; their existing eligibility and listing labels remain visible.

## Site quality (max 40)

| Factor | Points | Parcels (of 766) |
| --- | --- | --- |
| Distance to highway exit | Under 0.5 mile: 10; 0.5 to 1 mile: 5; over 1 mile: 0 | Not in source data |
| Land type | Industrial or Developable: 10; Commercial or Paved land: 5; Built-up (house lot), Non-developable or Public land: 0 | 113 / 285 / 368 |
| Usable size (dry, open land) | 3+ acres: 15; 1.5 to under 3: 10; 0.75 to under 1.5: 5; under 0.75: 0 | 63 / 68 / 177 / 458 |
| Industry nearby | 2+ industrial lots within ¼ mile: 5; fewer: 0 | 240 / 526 |

## Seller likelihood (max 60, counted up to 60)

| Factor | Points | Parcels (of 766) |
| --- | --- | --- |
| Estate after a death | Estate record for owner or same-name family: 40; life estate on deed: 30; estate record after purchase, to check: 20 | 24 / 1 / 32 |
| Unpaid property tax | Recent tax taking, no redemption found: 40; older tax taking, status unclear: 20 | 12 / 24 |
| Old listing taken down | Listed and withdrawn, never sold: 35; listed right now: 15; previous owner only: 5 | 17 / 3 / 6 |
| Years owned | 40+: 25; 30 to 39: 20; 20 to 29: 15; 10 to 19: 5 | 65 / 65 / 117 / 184 |
| Owner lives far away | 50+ miles: 15; 10 to under 50: 10; other town within 10 miles: 5; same town or on the lot: 0 | 31 / 70 / 66 |
| Passed within the family | Last transfer $0–$100 to an individual or trust, held 10+ years: 10 | 136 |

11 parcels have seller factors above 60; each is counted as 60. The scoring dialog still lists every seller factor's points.

## Deal blockers (taken off)

| Problem | Points | Parcels (of 766) |
| --- | --- | --- |
| Lawsuit on title | -10 | Not in source data |
| Lease on the lot | -10 | 13 |
| Bought in the last 3 years | -10 | 48 |
| Wetland 25%+ / 10 to under 25% of lot | -10 / -5 | 67 / 52 |
| Open mortgage | -5 | 227 |
| Resale restriction (town housing rehab loan) or utility easement | -5, once even if both | 36 |


## How each factor reads the source

- **Endpoints** enter the higher band (3.00 usable acres earns 15; exactly 0.5 highway mile earns 5). Exactly 1 highway mile earns 5.
- **Usable size** uses `usable_acres`. Total acres no longer score; the existing minimum 1 usable acre qualification remains separate.
- **Industry nearby** counts other parcels in the Industrial category whose polygon centres lie within 402 m (¼ mile), calculated from the loaded parcel geometry. Only parcels in the 250 m corridor file are counted, so industrial lots just outside the corridor are missed.
- **Wetlands over 50%** take the 25%+ deduction. All 29 such parcels are already excluded by screening.
- **Old listings** take the best signal across the Redfin, Zillow and past-attempt columns. There is no 5-year window. A "never sold" listing that began before the current owner's priced purchase was the seller's attempt and earns the previous-owner 5 points (2 MACY ST, 297 ELM ST, 238 LAFAYETTE RD). After a $0–$100 family or trust transfer, the same family still holds the land, so the attempt keeps 35.
- **Owner distance** uses lives-on-lot first, then recorded miles (50+, 10 to 50), then the town grouping.
- **Resale restriction and mortgage**: a lot whose only open loan is a town housing rehab loan takes the -5 restriction deduction but not the -5 mortgage deduction. Another open loan adds the mortgage deduction. Several open mortgages deduct -5 once.
- **Utility easements** are easements granted to an electric, gas, telephone or water utility. Easements to people or companies deduct nothing; an easement with no recorded grantee is shown as unverified.
- **Purchased within 3 years** excludes the exact anniversary. Recent nominal/family transfers do not establish a purchase.

## Missing evidence

Every parcel receives one calculated score from source records only. No proportional rescaling, manual points, estimates or possible-score ranges are used. Missing support contributes numeric zero, with the source reason displayed; a zero from missing evidence does not assert that a property issue is absent. Clicking a list score opens a separate, read-only Scoring details dialog with all 16 factors, points, deductions, evidence and the scoring table's rules.

The current dataset has no highway driving distances and no title-litigation search, so no parcel earns highway points or a lawsuit deduction. The highest achievable score from current data is therefore 90, and the highest actual score is 80 (250 MAIN ST, Amesbury). Road corridor distance is never substituted for highway distance. "Not checked" source values (mainly the 52 Seabrook, NH lots) contribute zero.

## Automatic calculation

The scoring dialog contains no dropdowns, inputs, confirmation actions or manual review controls. The scoring engine and page hook accept source records and the calculation date only. Previously stored browser point selections are never read and cannot affect any score or rank. Source parcel files are unchanged.

Scores are consistent across browsers using the same source records and calculation date.

## Sites ranks

Every parcel has a global display position among all 766 records, calculated before filtering and pagination. Higher scores come first. Equal scores use natural address order, then town/parcel identity, so positions are deterministic; different positions do not imply different scores. The Rank column preserves those global positions when filtering or sorting by other fields. Rank all clears search and filters, selects score order and returns to page 1; the chosen page size is retained. All 766 records are ranked even when only 50 rows are shown at a time.

## Verification

`node apps/web/e2e/parcel-scoring.cjs` checks every band boundary, source-text mapping, the nearby-industry count, stacked penalties, missing evidence and the per-factor counts across all 766 records.

`node apps/web/e2e/parcel-scoring-ui.cjs` checks that both information cards retain the original eight sections without scoring or Unverified content, while list scores/sorting and ranks remain available. It also checks desktop/mobile layout and Escape with the local app running on port 5173.

`node apps/web/e2e/scoring-dialog.cjs` checks all 766 clickable source-only scores, ignored legacy browser overrides, parcel identity, the separate dialog's 16 read-only factors, absence of property-row/map side effects, keyboard operation, focus trapping/restoration and responsive layout.
