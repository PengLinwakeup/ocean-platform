import sys, openpyxl, re
sys.stdout.reconfigure(encoding='utf-8')

path_12 = r"F:\印度洋测样\ODV\202608\20260829\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2 (12).xlsx"
path_13 = r"F:\印度洋测样\ODV\202608\20260829\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2 (13).xlsx"
path_dst = r"F:\印度洋测样\ODV\202608\20260829\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2_Processed-20260829_Updated_ST51_ST31.xlsx"

wb_12 = openpyxl.load_workbook(path_12, data_only=False)
wb_13 = openpyxl.load_workbook(path_13, data_only=False)
wb_dst = openpyxl.load_workbook(path_dst, data_only=False)

ws_12 = wb_12['All_Columns_Sequence_QC_Master']
ws_13 = wb_13['All_Columns_Sequence_QC_Master']
ws_dst = wb_dst['All_Columns_Sequence_QC_Master']

# Also load data_only versions to see actual numerical RSD values
wb_12_val = openpyxl.load_workbook(path_12, data_only=True)
wb_13_val = openpyxl.load_workbook(path_13, data_only=True)
wb_dst_val = openpyxl.load_workbook(path_dst, data_only=True)

ws_12_v = wb_12_val['All_Columns_Sequence_QC_Master']
ws_13_v = wb_13_val['All_Columns_Sequence_QC_Master']
ws_dst_v = wb_dst_val['All_Columns_Sequence_QC_Master']

diffs_12_13 = []
for r in range(6, min(ws_12.max_row, ws_13.max_row) + 1):
    c_type = str(ws_13.cell(r, 3).value or '').upper()
    if 'SAMPLE' not in c_type:
        continue
    
    st = str(ws_13.cell(r, 4).value or '').strip()
    dep = ws_13.cell(r, 5).value
    sid = str(ws_13.cell(r, 2).value or '').strip()
    
    # Injections
    injs_12 = [ws_12.cell(r, c).value for c in range(6, 10)]
    injs_13 = [ws_13.cell(r, c).value for c in range(6, 10)]
    
    f_12 = str(ws_12.cell(r, 10).value or '')
    f_13 = str(ws_13.cell(r, 10).value or '')
    
    flag_12 = ws_12.cell(r, 15).value
    flag_13 = ws_13.cell(r, 15).value
    
    flag_dst = ws_dst.cell(r, 15).value
    
    comment_12 = str(ws_12.cell(r, 16).value or '')
    comment_13 = str(ws_13.cell(r, 16).value or '')
    
    # Check if there are changes between 12 and 13
    if f_12 != f_13 or flag_12 != flag_13 or injs_12 != injs_13 or comment_12 != comment_13:
        diffs_12_13.append({
            'row': r,
            'sid': sid,
            'station': st,
            'depth': dep,
            'injs_12': injs_12,
            'injs_13': injs_13,
            'formula_12': f_12,
            'formula_13': f_13,
            'flag_12': flag_12,
            'flag_13': flag_13,
            'flag_dst': flag_dst,
            'comment_12': comment_12,
            'comment_13': comment_13
        })

print(f"=== Total pure changes between (12) and (13): {len(diffs_12_13)} ===")
for d in diffs_12_13:
    print(f"Row {d['row']:4d} | ST: {d['station']:6s} | Dep: {str(d['depth']):5s} | ID: {d['sid']:22s}")
    print(f"   Injections: {d['injs_12']} -> {d['injs_13']}")
    print(f"   Formula:    {d['formula_12']} -> {d['formula_13']}")
    print(f"   Flag:       {d['flag_dst']} -> {d['flag_13']}")
    print(f"   Comment:    {d['comment_12']} -> {d['comment_13']}\n")
