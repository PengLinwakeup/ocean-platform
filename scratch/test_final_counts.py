import sys
import os
sys.path.append(os.path.abspath('.'))

import json
import run_geomar_qc_processor_20260820 as proc

json_path = r"temp_geomar_v2_input.json"

with open(json_path, 'r', encoding='utf-8') as f:
    jdata = json.load(f)

batches = proc.parse_json_batches(jdata)

print(f"Total sequences in Master report: {len(batches)}")
for b in batches[:10]:
    clean_name = str(b.sheet_name).encode('ascii', errors='ignore').decode('ascii')
    print(f"Sequence {b.index:2d} ({clean_name}): {len(b.samples)} samples")
