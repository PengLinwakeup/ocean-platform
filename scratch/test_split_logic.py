import json

json_path = r"temp_geomar_v2_input.json"

with open(json_path, 'r', encoding='utf-8') as f:
    jdata = json.load(f)

batches = jdata.get("batches", [])

# Group batches by fileName
file_batches = {}
for b in batches:
    fname = b.get("fileName")
    if fname not in file_batches:
        file_batches[fname] = []
    file_batches[fname].append(b)

print("File batch distribution:")
for fname, b_list in file_batches.items():
    print(f"File '{fname}': {len(b_list)} curves")
    if len(b_list) > 1:
        # Check standard curve indices in sample list
        samples = b_list[0].get("samples", [])
        std_indices = []
        for idx, s in enumerate(samples):
            name = s.get("sampleName", "")
            is_std = s.get("isStd") or "std" in name.lower() or "标准" in name.lower()
            if is_std:
                std_indices.append((idx, name))
        print(f"  Total samples in file: {len(samples)}")
        print(f"  Standard sample positions (total {len(std_indices)}):")
        for pos, sname in std_indices:
            print(f"    idx {pos:3d}: {sname}")
