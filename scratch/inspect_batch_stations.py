import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open("temp_geomar_v2_input.json", "r", encoding="utf-8") as f:
    data = json.load(f)

batches = data.get("batches", [])

print(f"{'Idx':3s} | {'File Name':35s} | {'Slope':10s} | {'R2':8s} | {'Stations'}")
print("-" * 90)

for idx, b in enumerate(batches):
    name = b.get("fileName", "")
    curve_name = b.get("curveName", "")
    col_idx = b.get("fileColIdx", idx + 1)
    slope = b.get("slope", 0)
    rsq = b.get("rsq") or b.get("r2", 0)
    samples = b.get("samples", [])
    
    stations = []
    for s in samples:
        st = s.get("station", "")
        if st and st != "-" and st not in stations:
            stations.append(st)
            
    st_str = ",".join(stations) if stations else "STD/Blank"
    print(f"{idx+1:3d} | Col{col_idx} (Curve {curve_name}) {name[:20]:20s} | {slope:.6f} | {rsq:.5f} | {st_str}")
