# Run this as a quick check — paste into Python shell or save as check.py
import os

for fname in ['crop_recommendation_model.pkl', 'season_encoder.pkl', 'scaler.pkl']:
    path = os.path.join('Rec_Models', fname)
    if os.path.exists(path):
        size = os.path.getsize(path)
        with open(path, 'rb') as f:
            first4 = f.read(4)
        print(f"{fname}")
        print(f"  Size : {size} bytes")
        print(f"  First bytes : {first4}")
        print(f"  Starts with : {first4[:1]}")
        # Valid pickle files start with \x80 (b'\x80')
        if first4[:1] == b'\x80':
            print(f"  Status : ✅ Looks like a valid pickle file")
        elif first4[:1] in [b'v', b'{', b'[', b'<']:
            print(f"  Status : ❌ NOT a pickle file — likely CSV, JSON, or HTML")
        else:
            print(f"  Status : ⚠ Unknown format")
        print()
    else:
        print(f"{fname} — ❌ FILE NOT FOUND")
        print()