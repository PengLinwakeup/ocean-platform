import { RawInjection } from '../types';

export function parseRawTxt(content: string, fileName: string): RawInjection[] {
  const lines = content.split(/\r?\n/);
  const injections: RawInjection[] = [];
  
  let headerIndex = -1;
  let colIndices = {
    sampleName: -1,
    sampleId: -1,
    injNo: -1,
    type: -1,
    area: -1
  };
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Check for header row
    if (line.includes('样品名称') || line.includes('Sample Name')) {
      headerIndex = i;
      const parts = line.split('\t').map(p => p.trim());
      
      colIndices.sampleName = parts.findIndex(p => p === '样品名称' || p === 'Sample Name');
      colIndices.sampleId = parts.findIndex(p => p === '样品ID' || p === 'Sample ID');
      colIndices.injNo = parts.findIndex(p => p === '注入次数' || p === 'Inj. No.' || p === 'Inj.No.');
      colIndices.type = parts.findIndex(p => p === '每次注射分析类型' || p === 'Analysis type' || p === 'Analysis Type' || p === '分析类型');
      colIndices.area = parts.findIndex(p => p === '面积' || p === 'Area');
      
      continue;
    }
    
    // Parse data rows after header is found
    if (headerIndex !== -1 && i > headerIndex) {
      const parts = line.split('\t').map(p => p.trim());
      
      // Ensure we have enough columns and the indices are valid
      if (
        colIndices.sampleName !== -1 &&
        colIndices.area !== -1 &&
        parts.length > Math.max(colIndices.sampleName, colIndices.area)
      ) {
        const sampleName = parts[colIndices.sampleName];
        
        // Skip header indicator lines like "[数据]" or sections if they appear again
        if (sampleName.startsWith('[') && sampleName.endsWith(']')) {
          continue;
        }
        
        const sampleId = colIndices.sampleId !== -1 ? parts[colIndices.sampleId] : '未命名';
        const injNo = colIndices.injNo !== -1 ? parseInt(parts[colIndices.injNo], 10) : 1;
        const type = colIndices.type !== -1 ? parts[colIndices.type] : 'NPOC';
        const areaVal = parseFloat(parts[colIndices.area]);
        
        // Skip invalid rows (e.g. where area is not a number)
        if (isNaN(areaVal)) {
          continue;
        }
        
        injections.push({
          fileName,
          sampleName,
          sampleId: sampleId || '未命名',
          injNo: isNaN(injNo) ? 1 : injNo,
          type,
          area: areaVal
        });
      }
    }
  }
  
  return injections;
}
