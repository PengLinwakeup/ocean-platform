import sys, openpyxl, re
sys.stdout.reconfigure(encoding='utf-8')

path_13 = r"F:\印度洋测样\ODV\202608\20260829\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2 (13).xlsx"
path_14 = r"F:\印度洋测样\ODV\202608\20260829\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2 (14).xlsx"
path_dst = r"F:\印度洋测样\ODV\202608\20260829\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2_Processed-20260829_Updated_ST51_ST21.xlsx"

wb_13 = openpyxl.load_workbook(path_13, data_only=False)
wb_14 = openpyxl.load_workbook(path_14, data_only=False)
wb_dst = openpyxl.load_workbook(path_dst, data_only=False)

ws_13 = wb_13['All_Columns_Sequence_QC_Master']
ws_14 = wb_14['All_Columns_Sequence_QC_Master']
ws_dst = wb_dst['All_Columns_Sequence_QC_Master']

diffs_13_14 = []
for r in range(6, min(ws_13.max_row, ws_14.max_row) + 1):
    c_type = str(ws_14.cell(r, 3).value or '').upper()
    if 'SAMPLE' not in c_type:
        continue
    
    st = str(ws_14.cell(r, 4).value or '').strip()
    dep = ws_14.cell(r, 5).value
    sid = str(ws_14.cell(r, 2).value or '').strip()
    
    # Injections
    injs_13 = [ws_13.cell(r, c).value for c in range(6, 10)]
    injs_14 = [ws_14.cell(r, c).value for c in range(6, 10)]
    
    f_13 = str(ws_13.cell(r, 10).value or '')
    f_14 = str(ws_14.cell(r, 10).value or '')
    
    flag_13 = ws_13.cell(r, 15).value
    flag_14 = ws_14.cell(r, 15).value
    
    flag_dst = ws_dst.cell(r, 15).value
    
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
            'flag_dst': flag_dst,
            'flag_14': flag_14,
            'comment_13': comment_13,
            'comment_14': comment_14
        })

print(f"=== Total pure changes between (13) and (14): {len(diffs_13_14)} ===")
for d in diffs_13_14:
    print(f"Row {d['row']:4d} | ST: {d['station']:6s} | Dep: {str(d['depth']):5s} | ID: {d['sid']:22s}")
    print(f"   Injections: {d['injs_13']} -> {d['injs_14']}")
    print(f"   Formula:    {d['formula_13']} -> {d['formula_14']}")
    print(f"   Flag:       {d['flag_dst']} -> {d['flag_14']}")
    print(f"   Comment:    {d['comment_13']} -> {d['comment_14']}\n")
