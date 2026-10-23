import pandas as pd

df = pd.read_excel(r'C:\Users\princ\Downloads\Road 250m parcels (3).xlsx')
print('Shape:', df.shape)

cols = ['zillow_link', 'zillow_past_attempt', 'redfin_link', 'redfin_past_attempt']
for c in cols:
    print(f"\n--- {c} ---")
    print("Non-null count:", df[c].notna().sum())
    print("Sample values:")
    sample = df[df[c].notna()][c].head(5)
    for s in sample:
        print(" ", repr(s))

print("\n--- Rows where any is not null ---")
mask = df['zillow_past_attempt'].notna() | df['redfin_past_attempt'].notna() | df['zillow_link'].notna() | df['redfin_link'].notna()
print("Count of rows with any data:", mask.sum())

sample_df = df[mask].head(10)
for idx, row in sample_df.iterrows():
    town = row.get('TOWN') or row.get('town')
    pid = row.get('MAP_PAR_ID') or row.get('parcel_id')
    addr = row.get('SITE_ADDR') or row.get('address')
    print(f"\n[{town}] PID: {pid} | Addr: {addr}")
    print(f"  Zillow: {row.get('zillow_past_attempt')} | Link: {row.get('zillow_link')}")
    print(f"  Redfin: {row.get('redfin_past_attempt')} | Link: {row.get('redfin_link')}")
