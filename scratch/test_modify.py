import openpyxl
import json
import re

file_path = r"F:\印度洋测样\ODV\202608\20260824\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2_Processed_latest.xlsx"
wb = openpyxl.load_workbook(file_path)

print("Workbook loaded successfully.")
print("Sheets:", wb.sheetnames)
