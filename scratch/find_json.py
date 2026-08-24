import os
import glob
import json
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

for p in [
    r"c:\Users\blue\.gemini\antigravity-ide\scratch\ocean-platform",
    r"F:\印度洋测样\ODV\202608"
]:
    json_files = glob.glob(os.path.join(p, "**", "*.json"), recursive=True)
    for jf in json_files:
        if "temp" in jf or "geomar" in jf or "export" in jf or "qc" in jf:
            print("Found JSON:", jf, "(Size:", os.path.getsize(jf), "bytes)")
