import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open("temp_geomar_v2_input.json", "r", encoding="utf-8") as f:
    data = json.load(f)

batches = data.get("batches", [])
print(f"Total batches in temp_geomar_v2_input.json: {len(batches)}")

for idx, b in enumerate(batches):
    name = b.get("fileName", f"Batch_{idx+1}")
    slope = b.get("slope")
    intercept = b.get("intercept")
    rsq = b.get("rsq") or b.get("r2")
    samples = b.get("samples", [])
    std_samples = [s for s in samples if s.get("isStd") or "STD" in str(s.get("sampleName", "")).upper() or "STD" in str(s.get("station", "")).upper()]
    print(f"Batch {idx+1:2d} | Sheet/File: {name[:30]:30s} | Slope: {slope} | Intercept: {intercept} | R2: {rsq} | Std Samples Count: {len(std_samples)}")
