import json

json_path = r"temp_geomar_v2_input.json"

with open(json_path, 'r', encoding='utf-8') as f:
    jdata = json.load(f)

batches = jdata.get("batches", [])
print(f"Batch 1 ({batches[0].get('curveName')}) sample count:", len(batches[0].get("samples", [])))
print(f"Batch 2 ({batches[1].get('curveName')}) sample count:", len(batches[1].get("samples", [])))
print(f"Batch 3 ({batches[2].get('curveName')}) sample count:", len(batches[2].get("samples", [])))
