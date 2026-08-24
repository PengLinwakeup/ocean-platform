import shutil
import sys

sys.stdout.reconfigure(encoding='utf-8')

file_path = r"F:\印度洋测样\ODV\202608\20260824\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2_Processed_latest.xlsx"
inj3_file_path = r"F:\印度洋测样\ODV\202608\20260824\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2_Processed_latest_3INJ_DSW.xlsx"

try:
    shutil.copyfile(inj3_file_path, file_path)
    print("SUCCESS: Synced 3-injection DSW file to main file!")
except PermissionError:
    print("EXCEL_IS_OPEN: Please close Excel and try again.")
