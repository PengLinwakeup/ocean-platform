import json

json_path = r"temp_geomar_v2_input.json"

with open(json_path, 'r', encoding='utf-8') as f:
    jdata = json.load(f)

raw_batches = jdata.get("batches", [])

# Group raw_batches by fileName
batches_by_file = {}
for b in raw_batches:
    fname = b.get("fileName")
    if fname not in batches_by_file:
        batches_by_file[fname] = []
    batches_by_file[fname].append(b)

for fname, b_list in batches_by_file.items():
    if len(b_list) <= 1:
        continue
    
    # We have multiple curves for fname
    # Let's inspect samples in b_list[0]
    all_samples = b_list[0].get("samples", [])
    
    # Find start indices of each standard curve block
    std_block_starts = []
    in_std = False
    for idx, s in enumerate(all_samples):
        sname = (s.get("sampleName") or "").lower()
        is_std = s.get("isStd") or "std" in sname or "标准" in sname
        if is_std:
            if not in_std:
                std_block_starts.append(idx)
                in_std = True
        else:
            in_std = False
            
    print(f"\nFile: '{fname}' has {len(b_list)} curves and {len(std_block_starts)} standard blocks at indices: {std_block_starts}")
    
    # Assign sample slices
    for c_idx, b in enumerate(b_list):
        if c_idx < len(std_block_starts):
            start_i = std_block_starts[c_idx]
            # For first curve, if start_i > 0, include leading DSW/SSW/MQ blanks before standards
            if c_idx == 0:
                start_i = 0
            end_i = std_block_starts[c_idx + 1] if (c_idx + 1) < len(std_block_starts) else len(all_samples)
            sliced = all_samples[start_i:end_i]
        else:
            sliced = all_samples
        print(f"  Curve {c_idx+1} ({b.get('curveName')}): sliced sample count = {len(sliced)} (range {start_i}..{end_i})")
