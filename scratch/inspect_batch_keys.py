import json

json_path = r"temp_geomar_v2_input.json"

with open(json_path, 'r', encoding='utf-8') as f:
    jdata = json.load(f)

batches = jdata.get("batches", [])
print(f"Total batches in JSON: {len(batches)}")

for idx, b in enumerate(batches[:6]):
    print(f"\nBatch {idx+1}: curveId={b.get('curveId')}, curveName={b.get('curveName')}, fileName={b.get('fileName')}")
    samples = b.get("samples", [])
    print(f"  sample count: {len(samples)}")
    # Check if samples have curveId
    first_sample = samples[0] if samples else {}
    print(f"  sample keys: {list(first_sample.keys())}")
    if "curveId" in first_sample:
        print("  first sample curveId:", first_sample.get("curveId"))
