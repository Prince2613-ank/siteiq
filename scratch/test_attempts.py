import pandas as pd
df = pd.read_excel(r'C:\Users\princ\Downloads\Road 250m parcels (3).xlsx')

def has_attempt(val):
    if not val or pd.isna(val):
        return False
    v = str(val).strip().lower()
    if v in ['none since last sale', 'no zillow page', 'no redfin page', 'no history on zillow', 'no history on redfin', 'none', 'nan']:
        return False
    return True

has_z = df['zillow_past_attempt'].apply(has_attempt)
has_r = df['redfin_past_attempt'].apply(has_attempt)
has_any = has_z | has_r

print(f'Total rows with real listing attempt data: {has_any.sum()} / {len(df)}')
for idx, r in df[has_any].iterrows():
    town = r.get('TOWN')
    pid = r.get('MAP_PAR_ID') or r.get('NH_PARCEL_ID')
    addr = r.get('SITE_ADDR')
    print(f'[{town}] PID: {pid} | Addr: {addr}')
    if has_attempt(r.get('zillow_past_attempt')):
        print(f'   Zillow: {r.get("zillow_past_attempt")} -> Link: {r.get("zillow_link")}')
    if has_attempt(r.get('redfin_past_attempt')):
        print(f'   Redfin: {r.get("redfin_past_attempt")} -> Link: {r.get("redfin_link")}')
