import shutil
import sys

sys.stdout.reconfigure(encoding='utf-8')

file_path = r"F:\印度洋测样\ODV\202608\20260824\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2_Processed_latest.xlsx"
purple_file_path = r"F:\印度洋测样\ODV\202608\20260824\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2_Processed_latest_PURPLE_DSW.xlsx"

try:
    shutil.copyfile(purple_file_path, file_path)
    print("SUCCESS: Synced purple highlighted file to main file!")
except PermissionError:
    print("EXCEL_IS_OPEN: Please close Excel and try again.")
