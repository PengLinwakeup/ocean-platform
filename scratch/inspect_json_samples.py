import json

json_path = r"temp_geomar_v2_input.json"

with open(json_path, 'r', encoding='utf-8') as f:
    jdata = json.load(f)

batches = jdata.get("batches", [])

print("=== Checking Batches 1, 2, 3 in JSON ===")
for idx in range(min(3, len(batches))):
    b = batches[idx]
    print(f"\n--- Batch {idx+1} ---")
    print("curveId:", b.get("curveId"))
    print("curveName:", b.get("curveName"))
    print("fileName:", b.get("fileName"))
    print("slope:", b.get("slope"))
    print("rsq:", b.get("rsq"))
    samples = b.get("samples", [])
    print(f"Sample count: {len(samples)}")
    print("First 3 sample names & IDs:")
    for s in samples[:3]:
        print("  name:", s.get("sampleName"), "id:", s.get("sampleId"), "calculatedConc:", s.get("calculatedConc"), "qcFlag:", s.get("qcFlag"))

print("\n=== Checking sample curveIds across all batches ===")
for idx, b in enumerate(batches[:6]):
    samples = b.get("samples", [])
    names = [s.get("sampleName") for s in samples[:5]]
    print(f"Batch {idx+1} ({b.get('curveName')}): first 5 samples = {names}")
