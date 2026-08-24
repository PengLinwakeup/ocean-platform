import json
import run_geomar_qc_processor_20260820 as proc

json_path = r"temp_geomar_v2_input.json"

with open(json_path, 'r', encoding='utf-8') as f:
    jdata = json.load(f)

raw_batches = jdata.get("batches", [])
print(f"Original JSON batches count: {len(raw_batches)}")

# Simulate the fixed frontend grouping:
# For batches sharing the same fileName, filter samples by curveId if curveId matches or if samples have curveId!
# If samples in JSON do not have curveId yet (since input JSON was generated prior to fix), let's inspect.

for i, b in enumerate(raw_batches[:6]):
    print(f"Batch {i+1} ({b.get('curveName')}): {len(b.get('samples', []))} samples")
