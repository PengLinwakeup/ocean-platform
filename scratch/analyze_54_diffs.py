import sys, os
sys.path.insert(0, os.path.abspath('scratch'))
from diff_13_vs_14 import diffs_13_14

print(f"Total diffs between (13) and (14): {len(diffs_13_14)}")
stations_count = {}
for d in diffs_13_14:
    st = d['station']
    stations_count[st] = stations_count.get(st, 0) + 1

print("Stations distribution:")
for st, cnt in sorted(stations_count.items()):
    print(f"  {st:6s}: {cnt} samples")

# Summary of flag transitions
flag_trans = {}
for d in diffs_13_14:
    trans = f"Flag {d['flag_13']} -> Flag {d['flag_14']}"
    flag_trans[trans] = flag_trans.get(trans, 0) + 1

print("\nFlag transitions:")
for trans, cnt in sorted(flag_trans.items()):
    print(f"  {trans}: {cnt}")
