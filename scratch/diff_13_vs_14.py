import sys, openpyxl, json
sys.stdout.reconfigure(encoding='utf-8')

path_13 = r"F:\印度洋测样\ODV\202608\20260829\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2 (13).xlsx"
path_14 = r"F:\印度洋测样\ODV\202608\20260829\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2 (14).xlsx"

wb_13 = openpyxl.load_workbook(path_13, data_only=False)
wb_14 = openpyxl.load_workbook(path_14, data_only=False)

ws_13 = wb_13['All_Columns_Sequence_QC_Master']
ws_14 = wb_14['All_Columns_Sequence_QC_Master']

wb_13_v = openpyxl.load_workbook(path_13, data_only=True)
wb_14_v = openpyxl.load_workbook(path_14, data_only=True)

ws_13_v = wb_13_v['All_Columns_Sequence_QC_Master']
ws_14_v = wb_14_v['All_Columns_Sequence_QC_Master']

diffs_13_14 = []
for r in range(6, min(ws_13.max_row, ws_14.max_row) + 1):
    c_type = str(ws_14.cell(r, 3).value or '').upper()
    if 'SAMPLE' not in c_type:
        continue
    
    st = str(ws_14.cell(r, 4).value or '').strip()
    dep = ws_14.cell(r, 5).value
    sid = str(ws_14.cell(r, 2).value or '').strip()
    
    injs_13 = [ws_13.cell(r, c).value for c in range(6, 10)]
    injs_14 = [ws_14.cell(r, c).value for c in range(6, 10)]
    
    f_13 = str(ws_13.cell(r, 10).value or '')
    f_14 = str(ws_14.cell(r, 10).value or '')
    
    flag_13 = ws_13.cell(r, 15).value
    flag_14 = ws_14.cell(r, 15).value
    
    comment_13 = str(ws_13.cell(r, 16).value or '')
    comment_14 = str(ws_14.cell(r, 16).value or '')
    
    # Check if there are changes between 13 and 14
    if f_13 != f_14 or flag_13 != flag_14 or injs_13 != injs_14 or comment_13 != comment_14:
        diffs_13_14.append({
            'row': r,
            'sid': sid,
            'station': st,
            'depth': dep,
            'injs_13': injs_13,
            'injs_14': injs_14,
            'formula_13': f_13,
            'formula_14': f_14,
            'flag_13': flag_13,
            'flag_14': flag_14,
            'comment_13': comment_13,
            'comment_14': comment_14
        })

print(f"=== Total pure changes between (13) and (14): {len(diffs_13_14)} ===")
for d in diffs_13_14:
    print(f"Row {d['row']:4d} | ST: {d['station']:6s} | Dep: {str(d['depth']):5s} | ID: {d['sid']:22s}")
    print(f"   Formula: {d['formula_13']} -> {d['formula_14']}")
    print(f"   Flag:    {d['flag_13']} -> {d['flag_14']}")
    print(f"   Comment: {d['comment_13']} -> {d['comment_14']}\n")
