import sys, openpyxl
sys.stdout.reconfigure(encoding='utf-8')

path_12 = r"F:\印度洋测样\ODV\202608\20260829\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2 (12).xlsx"
path_dst = r"F:\印度洋测样\ODV\202608\20260829\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2_Processed-20260829-7.29_Updated_ST41.xlsx"

wb_12 = openpyxl.load_workbook(path_12, data_only=True)
wb_dst = openpyxl.load_workbook(path_dst, data_only=True)

ws_12 = wb_12['ODV_All_Samples_Full_List']
ws_dst = wb_dst['ODV_All_Samples_Full_List']

target_keys = [
    ('ST-39', 3200), ('ST-37', 4800), ('ST-37', 1300), ('ST-37', 200),
    ('ST-38', 1600), ('ST-38', 950), ('ST-38', 350), ('ST-35', 4000),
    ('ST-34', 1600), ('ST-34', 500), ('ST-32', 4550), ('ST-32', 4450),
    ('ST-34', 840), ('ST-32', 2550)
]

# Map 12
map_12 = {}
for r in range(5, ws_12.max_row + 1):
    st = str(ws_12.cell(r, 3).value or '').strip()
    dep = ws_12.cell(r, 6).value
    try:
        k = (st, int(round(float(dep))))
        map_12[k] = {
            'mean': ws_12.cell(r, 9).value,
            'rsd': ws_12.cell(r, 10).value,
            'doc': ws_12.cell(r, 11).value,
            'flag': ws_12.cell(r, 12).value,
            'comment': ws_12.cell(r, 13).value
        }
    except:
        pass

for r in range(5, ws_dst.max_row + 1):
    st = str(ws_dst.cell(r, 3).value or '').strip()
    dep = ws_dst.cell(r, 6).value
    sid = ws_dst.cell(r, 4).value
    try:
        k = (st, int(round(float(dep))))
        if k in target_keys:
            old_vals = (ws_dst.cell(r, 9).value, ws_dst.cell(r, 10).value, ws_dst.cell(r, 12).value)
            new_info = map_12.get(k, {})
            print(f"ODV Row {r:3d} | Key: {k} | SID: {sid}")
            print(f"   OLD: Mean={old_vals[0]}, RSD={old_vals[1]}%, Flag={old_vals[2]}")
            print(f"   NEW: Mean={new_info.get('mean')}, RSD={new_info.get('rsd')}%, Flag={new_info.get('flag')}")
    except:
        pass
