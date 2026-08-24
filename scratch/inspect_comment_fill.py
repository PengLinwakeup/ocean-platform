import openpyxl
import sys

sys.stdout.reconfigure(encoding='utf-8')

file_path = r"F:\印度洋测样\ODV\202608\20260824\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2_Processed_latest.xlsx"
wb = openpyxl.load_workbook(file_path, data_only=False)

ws_master = wb["All_Columns_Sequence_QC_Master"]

print("Inspecting Col P (Comment) fills for rows 7 - 18 in Master:")
for r in range(7, 19):
    cell_p = ws_master.cell(r, 16)
    fill_p = cell_p.fill
    fill_type = fill_p.fill_type if fill_p else None
    fg_p = fill_p.fgColor.value if (fill_p and fill_p.fgColor) else None
    font_p = cell_p.font.color.value if (cell_p.font and cell_p.font.color) else None
    print(f"Row {r:3d} | Col P Val: {str(cell_p.value)[:35]:35s} | FillType: {fill_type} | FgColor: {fg_p} | FontColor: {font_p}")
