import json
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

json_path = r"c:\Users\blue\.gemini\antigravity-ide\scratch\ocean-platform\temp_geomar_v2_input.json"

with open(json_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

print("Root type:", type(data))
if isinstance(data, dict):
    print("Root keys:", data.keys())
    batches = data.get("batches", data.get("processedBatches", []))
elif isinstance(data, list):
    batches = data
else:
    batches = []

print("Total batches in JSON:", len(batches))

for i, b in enumerate(batches[:6]):
    sheet_name = b.get("sheet_name", b.get("sheetName", b.get("name", "")))
    source_file = b.get("source_file", b.get("sourceFile", ""))
    samples = b.get("samples", [])
    print(f"\nBatch {i+1}: sheetName='{sheet_name}', sourceFile='{source_file}', samples_count={len(samples)}")
    if samples:
        print("  First sample:", samples[0].get("sample_name", samples[0].get("sampleName")), "areas:", samples[0].get("raw_areas", samples[0].get("areas")))
