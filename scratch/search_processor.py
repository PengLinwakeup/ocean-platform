with open(r"c:\Users\blue\.gemini\antigravity-ide\scratch\ocean-platform\run_geomar_qc_processor_20260820.py", "r", encoding="utf-8") as f:
    lines = f.readlines()

for idx, line in enumerate(lines, 1):
    if any(k in line.lower() for k in ["slope", "r2", "rsq", "0.055", "斜率", "0.999"]):
        print(f"Line {idx:4d}: {line.strip()[:120]}")
