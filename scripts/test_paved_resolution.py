import re

def is_developable_reason(reason):
    if not reason:
        return False
    r = str(reason).lower()
    return 'town code says developable' in r or 'developable' in r

def resolve_category(category, reason):
    cat = (category or '').strip()
    r = (reason or '').strip().lower()
    cat_lower = cat.lower()
    
    # If category is Paved land or empty, or if reason provides strong zoning/town code
    if cat_lower in ['paved land', ''] or 'town code says developable' in r:
        if 'zoned i' in r or 'industrial' in r or '440' in r:
            return 'Industrial'
        if 'commercial' in r or '390' in r or '391' in r or '031' in r or '334' in r or '337' in r:
            return 'Commercial'
        if 'town code says developable' in r or 'developable' in r:
            return 'Developable'
    return cat

paved_parcels = [
    ('AMESBURY 56-21', 'Paved land', 'paved, no building; zoned I (industrial); town code says developable', 'Company', False, 0.0, 0.0),
    ('AMESBURY 79-10', 'Paved land', 'paved, no building; commercial land-use code 3910; town code says developable', 'Company', False, 0.0, 0.0),
    ('SALISBURY 18-125', 'Paved land', 'paved, no building; zoned I (industrial); town code says developable', 'Company', True, 0.0, 8.7),
    ('SALISBURY 18-139', 'Paved land', 'paved, no building; land use 440 (industrial); zoned I (industrial); town code says developable', 'Company', False, 6.1, 0.0),
    ('SALISBURY 18-140', 'Paved land', 'paved, no building; land use 440 (industrial); zoned I (industrial); town code says developable', 'Individual', False, 0.0, 0.0),
    ('SALISBURY 18-15', 'Paved land', 'paved, no building; commercial land-use code 390; town code says developable', 'Company', False, 0.0, 0.0),
    ('SALISBURY 18-17', 'Paved land', 'paved, no building; commercial land-use code 390; town code says developable', 'Company', False, 0.0, 0.0),
    ('SALISBURY 19-110', 'Paved land', 'paved, no building; commercial land-use code 390; town code says developable', 'Trust', False, 0.0, 0.0),
    ('SALISBURY 19-210', 'Paved land', 'paved, no building; commercial land-use code 390; town code says developable', 'Company', False, 0.0, 0.0),
    ('SALISBURY 23-19', 'Paved land', 'paved, no building; commercial land-use code 390; town code says developable', 'Individual', False, 0.0, 0.0),
    ('SALISBURY 9-60', 'Paved land', 'paved, no building; commercial land-use code 390; town code says developable', 'Company', False, 0.0, 0.0),
    ('SALISBURY 23-17', 'Paved land', 'paved, no building; commercial land-use code 031', 'Company', False, 0.0, 0.0),
    ('SALISBURY 19-41', 'Paved land', 'paved, no building; commercial land-use code 334', 'Company', False, 0.0, 0.0),
    ('SALISBURY 19-236', 'Paved land', 'paved, no building; commercial land-use code 337', 'Individual', False, 0.0, 0.0),
    ('SALISBURY FEE', 'Paved land', 'paved, no building', 'Unknown', False, 0.0, 0.0),
]

for pid, cat, reason, owner_type, listed, wetland, bldg in paved_parcels:
    resolved = resolve_category(cat, reason)
    print(f"{pid:18} | Orig: {cat:10} -> Resolved: {resolved:10} | Owner: {owner_type:10} | Listed: {str(listed):5}")

