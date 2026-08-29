import sys, openpyxl, re
sys.stdout.reconfigure(encoding='utf-8')

src_path = r"F:\印度洋测样\ODV\202608\20260829\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2 (12).xlsx"
dst_path = r"F:\印度洋测样\ODV\202608\20260829\Ocean_DOC_MultiColumn_QC_Report_GEOMAR_Validated_v2_Processed-20260829-7.29_Updated_ST41.xlsx"

wb_src = openpyxl.load_workbook(src_path, data_only=False)
wb_dst = openpyxl.load_workbook(dst_path, data_only=False)

ws_s = wb_src['All_Columns_Sequence_QC_Master']
ws_d = wb_dst['All_Columns_Sequence_QC_Master']

diffs = []
for r in range(6, min(ws_d.max_row, ws_s.max_row) + 1):
    c_type = str(ws_d.cell(r, 3).value or '').upper()
    if 'SAMPLE' not in c_type:
        continue
    
    st = str(ws_d.cell(r, 4).value or '').strip()
    dep = ws_d.cell(r, 5).value
    sid = str(ws_d.cell(r, 2).value or '').strip()
    
    f_d = str(ws_d.cell(r, 10).value or '')
    f_s = str(ws_s.cell(r, 10).value or '')
    
    rsd_f_d = str(ws_d.cell(r, 11).value or '')
    rsd_f_s = str(ws_s.cell(r, 11).value or '')
    
    flag_d = ws_d.cell(r, 15).value
    flag_s = ws_s.cell(r, 15).value
    
    comment_d = str(ws_d.cell(r, 16).value or '')
    comment_s = str(ws_s.cell(r, 16).value or '')
    
    # Check if this station is in ST-31 to ST-51
    # Check numeric station number if possible
    st_match = re.search(r'ST-?(\d+)', st, re.IGNORECASE)
    st_num = int(st_match.group(1)) if st_match else None
    
    if f_d != f_s or flag_d != flag_s:
        diffs.append({
            'row': r,
            'sid': sid,
            'station': st,
            'st_num': st_num,
            'depth': dep,
            'mean_formula_old': f_d,
            'mean_formula_new': f_s,
            'rsd_formula_old': rsd_f_d,
            'rsd_formula_new': rsd_f_s,
            'flag_old': flag_d,
            'flag_new': flag_s,
            'comment_old': comment_d,
            'comment_new': comment_s
        })

print(f"Total diffs in Master: {len(diffs)}")
for d in diffs:
    print(f"Row {d['row']:4d} | ST: {d['station']:6s} | Dep: {str(d['depth']):5s} | ID: {d['sid']:22s}")
    print(f"   Mean Formula: {d['mean_formula_old']} -> {d['mean_formula_new']}")
    print(f"   RSD Formula:  {d['rsd_formula_old']} -> {d['rsd_formula_new']}")
    print(f"   Flag:         {d['flag_old']} -> {d['flag_new']}")
    print(f"   Comment:      {d['comment_old']} -> {d['comment_new']}\n")
