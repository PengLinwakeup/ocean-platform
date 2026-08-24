import sys
import os
sys.path.append(os.path.abspath('.'))

from run_geomar_qc_processor_20260820 import parse_web_exported_excel, build_geomar_master_excel

# Input: The full 1444-row dataset (11620 injections) Excel file
target_file = r"F:\印度洋测样\ODV\202608\20260822\Ocean_DOC_MultiColumn_QC_Report_GEOMAR-再处理版_latest.xlsx"

print(f"Processing Full Dataset Excel File: {target_file}")
batches = parse_web_exported_excel(target_file)
print(f"Parsed {len(batches)} batches, total samples: {sum(len(b.samples) for b in batches)}")

output_file = r"F:\印度洋测样\ODV\202608\20260822\Ocean_DOC_MultiColumn_QC_Report_GEOMAR-再处理版_latest.xlsx"
try:
    build_geomar_master_excel(batches, output_file)
    print(f"Successfully updated and saved full report: {output_file}")
except PermissionError:
    alt_file = r"F:\印度洋测样\ODV\202608\20260822\Ocean_DOC_MultiColumn_QC_Report_GEOMAR-再处理版_full_updated.xlsx"
    build_geomar_master_excel(batches, alt_file)
    print(f"File locked by Excel, saved updated report to: {alt_file}")
