import openpyxl
import sys

sys.stdout.reconfigure(encoding='utf-8')

file_path = r"F:\印度洋测样\ODV\202608\20260824\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2_Processed_latest.xlsx"
wb = openpyxl.load_workbook(file_path)

ws_master = wb["All_Columns_Sequence_QC_Master"]

print("Inspecting Row 19, 41, 99 cell fills in main file:")
for r in [19, 41, 99]:
    for col in [1, 10, 12, 14, 15, 16]:
        cell = ws_master.cell(r, col)
        fill = cell.fill
        fill_type = fill.fill_type if fill else None
        fg = fill.fgColor.value if (fill and fill.fgColor) else None
        rgb = fill.fgColor.rgb if (fill and fill.fgColor) else None
        print(f"Row {r:3d} | Col {col:2d} | fill_type: {fill_type} | fgColor.value: {fg} | fgColor.rgb: {rgb} | Val: {cell.value}")
