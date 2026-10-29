# Parcel loan information

Loan data is imported from Sheet1 of `Road 250m parcels (5).xlsx`, using `TOWN`
and `MAP_PAR_ID` to match all 766 parcel identities. Importing does not modify the
workbook, original parcel fields, source GeoJSON or generated geometry reports.

Install `scripts/requirements-parcel-loans.txt`, then run:

```powershell
python scripts/import_parcel_loans.py "C:\path\Road 250m parcels (5).xlsx"
```

The importer writes `apps/web/public/geojson/parcel_loans.json`. It rejects
duplicate, missing or extra parcel identities and missing category/status values.
It preserves the loan status from AP, mortgage record from AO and the FQ:FZ loan
fields. Blank cells become null; actual zero counts and values remain zero. Dates
become ISO dates. Loan-to-value and equity percentages retain their original
fraction values and are formatted as percentages by the UI.

Loan categories use the workbook's `loan_signal` values directly. Initial counts:

| Category | Parcels |
| --- | ---: |
| No open loan - likely free & clear | 444 |
| Low leverage - strong equity | 92 |
| Moderate leverage | 56 |
| High leverage (loan >= 80% of value) | 47 |
| Recent loan (<2 yrs) - unlikely to sell soon | 37 |
| Not checked | 90 |
| All | 766 |

The category labels are source classifications, not new calculations. The report
identifies the current balance as estimated and uses the workbook's cached values;
it does not recalculate amortization or treat an unverified loan as paid off.
The Not checked source category displays as Loan details unavailable. For these
parcels the loan section contains only that category. Estimated equity amount and
percentage are omitted from every report. Other unavailable lender/amount/date
and estimate fields are omitted. The source filename, sheet, row and workbook hash
are retained in the imported asset for auditing.

Both `loadParcels` and `loadParcelReport` attach this same record by town and parcel
ID. The Dashboard loan filter combines with the existing filters; counts omit its
own selected category, persistence includes it, and Reset restores All.
