import openpyxl
import sys

sys.stdout.reconfigure(encoding='utf-8')

file_path = r"F:\印度洋测样\ODV\202608\20260824\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2_Processed_latest.xlsx"
wb = openpyxl.load_workbook(file_path)

ws_master = wb["All_Columns_Sequence_QC_Master"]

print("================ CONDITIONAL FORMATTING IN MASTER ================")
for cf in ws_master.conditional_formatting:
    print(f"SQREF Range: {cf.sqref}")
    for rule in cf.rules:
        print(f"  Rule type: {rule.type}, formula: {rule.formula}, fill: {rule.dxf.fill.fgColor.value if rule.dxf and rule.dxf.fill else None}")

print("\n================ CONDITIONAL FORMATTING IN FULL LIST ================")
ws_all = wb["ODV_All_Samples_Full_List"]
for cf in ws_all.conditional_formatting:
    print(f"SQREF Range: {cf.sqref}")
    for rule in cf.rules:
        print(f"  Rule type: {rule.type}, formula: {rule.formula}, fill: {rule.dxf.fill.fgColor.value if rule.dxf and rule.dxf.fill else None}")
