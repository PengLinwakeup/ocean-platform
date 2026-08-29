import sys, openpyxl, re
sys.stdout.reconfigure(encoding='utf-8')

path_11 = r"F:\印度洋测样\ODV\202608\20260829\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2 (11).xlsx"
path_12 = r"F:\印度洋测样\ODV\202608\20260829\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2 (12).xlsx"

wb_11 = openpyxl.load_workbook(path_11, data_only=False)
wb_12 = openpyxl.load_workbook(path_12, data_only=False)

ws_11 = wb_11['All_Columns_Sequence_QC_Master']
ws_12 = wb_12['All_Columns_Sequence_QC_Master']

diffs_11_12 = []
for r in range(6, min(ws_11.max_row, ws_12.max_row) + 1):
    c_type = str(ws_11.cell(r, 3).value or '').upper()
    if 'SAMPLE' not in c_type:
        continue
    
    st = str(ws_11.cell(r, 4).value or '').strip()
    dep = ws_11.cell(r, 5).value
    sid = str(ws_11.cell(r, 2).value or '').strip()
    
    f_11 = str(ws_11.cell(r, 10).value or '')
    f_12 = str(ws_12.cell(r, 10).value or '')
    
    rsd_11 = str(ws_11.cell(r, 11).value or '')
    rsd_12 = str(ws_12.cell(r, 11).value or '')
    
    flag_11 = ws_11.cell(r, 15).value
    flag_12 = ws_12.cell(r, 15).value
    
    comment_11 = str(ws_11.cell(r, 16).value or '')
    comment_12 = str(ws_12.cell(r, 16).value or '')
    
    if f_11 != f_12 or flag_11 != flag_12 or rsd_11 != rsd_12:
        diffs_11_12.append({
            'row': r,
            'sid': sid,
            'station': st,
            'depth': dep,
            'formula_11': f_11,
            'formula_12': f_12,
            'rsd_formula_11': rsd_11,
            'rsd_formula_12': rsd_12,
            'flag_11': flag_11,
            'flag_12': flag_12,
            'comment_11': comment_11,
            'comment_12': comment_12
        })

print(f"=== Pure Web Changes between (11) and (12) ===")
print(f"Total modified samples: {len(diffs_11_12)}")
for d in diffs_11_12:
    print(f"Row {d['row']:4d} | ST: {d['station']:6s} | Dep: {str(d['depth']):5s} | ID: {d['sid']:22s}")
    print(f"   Formula: {d['formula_11']} -> {d['formula_12']}")
    print(f"   Flag:    {d['flag_11']} -> {d['flag_12']}")
    print(f"   Comment: {d['comment_11']} -> {d['comment_12']}\n")
