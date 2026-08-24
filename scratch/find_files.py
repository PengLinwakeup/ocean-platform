import os
import glob
import openpyxl

search_dir = r"F:\印度洋测样\ODV\202608"
files = glob.glob(os.path.join(search_dir, "**", "*.xlsx"), recursive=True)

print("Found Excel files:")
for f in sorted(files, key=os.path.getmtime, reverse=True)[:10]:
    print("  ", f, "(Size:", os.path.getsize(f), "bytes)")
