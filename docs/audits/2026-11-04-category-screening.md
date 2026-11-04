# Full parcel screening review — 4 November 2026

Reviewed all 766 parcels against the original category and category_reason from
`Road 250m parcels (6).xlsx`, report building measurements, spreadsheet building
measurements, current listing data and the existing ownership rules.

| Result | Before this review | After this review |
| --- | ---: | ---: |
| Qualified | 224 | 213 |
| Excluded | 542 | 553 |
| Total | 766 | 766 |

23 previously excluded parcels now qualify. Report building coverage was missing,
but valid spreadsheet building area divided by its matching parcel area is at
or below 5%. They also pass the other screening rules. The source workbook's
`builtup_pct` includes paving, so it is not used for the building-only threshold.

34 previously Qualified parcels are corrected to Excluded: 19 explicitly say the
town considers them undevelopable, and 15 have a Non-developable category with a
cemetery/conservation/Chapter 61 reason. One additional parcel with that latter
reason would otherwise have qualified using the spreadsheet fallback and remains
Excluded. Generic Vacant status must not erase those source exclusions.

The final 553 exclusions reconcile as follows. Each parcel appears once under
its first applicable exclusion, even when other exclusions also apply.

| Primary exclusion | Parcels |
| --- | ---: |
| Building footprint above 5% | 412 |
| Existing ownership exclusion (30 Trust, 7 religious/nonprofit, 28 public) | 65 |
| Non-developable land with more than 50% wetlands | 26 |
| Explicit town undevelopable statement | 19 |
| Source cemetery/conservation/Chapter 61 classification | 16 |
| Listed for sale | 9 |
| Condominium | 5 |
| Paved land without positive developability evidence | 1 |
| **Total** | **553** |

There are 346 Vacant and 420 Built-up parcels. All 213 Qualified parcels are
Vacant. Explicit positive town developability statements still take precedence
over conflicting physical category labels, as requested. Listed parcels still
score zero and remain Excluded.

[Full decisions for all 766 parcels, including each reason and changes from the
224-Qualified baseline](2026-11-04-category-screening.json).

This review applies the supplied data and project screening rules; it does not
replace source records or edit the workbook. Reports label spreadsheet fallback
measurements separately from mapped report measurements.
