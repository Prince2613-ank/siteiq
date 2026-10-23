import pandas as pd

df = pd.read_excel(r'C:\Users\princ\Downloads\Road 250m parcels (2).xlsx')
print('Shape:', df.shape)
col = 'children_count_estate_owner'
print('Column exists:', col in df.columns)
if col in df.columns:
    print('Non-null count:', df[col].notna().sum())
    print('\nValue counts:')
    print(df[col].dropna().value_counts().head(20))
    print('\nData type:', df[col].dtype)
    print('\nSample rows with non-null values:')
    sample_df = df[df[col].notna()].head(15)
    for idx, row in sample_df.iterrows():
        town = row.get('town') or row.get('city') or row.get('Town')
        pid = row.get('parcel_id') or row.get('map_par_id') or row.get('loc_id') or row.get('PARCEL_ID')
        addr = row.get('address') or row.get('site_address') or row.get('SITE_ADDR')
        owner = row.get('owner') or row.get('owner_name') or row.get('OWNER')
        print(f"Town: {town} | PID: {pid} | Owner: {owner} | Val: {row[col]}")
