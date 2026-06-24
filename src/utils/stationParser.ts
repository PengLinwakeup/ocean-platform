import * as xlsx from 'xlsx';
import { ExcelSampleInfo } from '../types';

/**
 * Standardizes station name or label ID for comparison.
 * e.g., "ST-39", "st39", "St_39", "ST39" all normalize to "st39".
 */
export function normalizeStationName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ''); // Remove non-alphanumeric chars
}

/**
 * Parses coordinate and metadata details from an uploaded Excel or CSV file.
 */
export function parseStationCoordinates(arrayBuffer: ArrayBuffer): ExcelSampleInfo[] {
  const data = new Uint8Array(arrayBuffer);
  const workbook = xlsx.read(data, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const jsonRows = xlsx.utils.sheet_to_json<any>(worksheet, { header: 1 });
  
  if (jsonRows.length === 0) return [];
  
  // Find header row and column mappings
  let headerRowIndex = -1;
  let labelIdCol = -1;
  let stationCol = -1;
  let depthCol = -1;
  let lonCol = -1;
  let latCol = -1;
  
  // Look for header row in the first few rows
  for (let r = 0; r < Math.min(jsonRows.length, 10); r++) {
    const row = jsonRows[r];
    if (!Array.isArray(row)) continue;
    
    const lblCol = row.findIndex(cell => {
      if (cell === null || cell === undefined) return false;
      const c = cell.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
      return c.includes('lableiddoc') || c.includes('labelid') || c.includes('label') || c === 'id' || c.includes('样品编号') || c.includes('样品名称') || c.includes('编号');
    });

    const sCol = row.findIndex(cell => {
      if (cell === null || cell === undefined) return false;
      const c = cell.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
      return c.includes('站位') || c.includes('站名') || c.includes('station') || c === 'st';
    });

    const dCol = row.findIndex(cell => {
      if (cell === null || cell === undefined) return false;
      const c = cell.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
      if (c.includes('bot') || c.includes('bottom')) return false;
      return c.includes('深度') || c.includes('depth');
    });


    const lnCol = row.findIndex(cell => {
      if (cell === null || cell === undefined) return false;
      const c = cell.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
      return c.includes('经度') || c.includes('longitude') || c.includes('lon');
    });
    
    const ltCol = row.findIndex(cell => {
      if (cell === null || cell === undefined) return false;
      const c = cell.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
      return c.includes('纬度') || c.includes('latitude') || c.includes('lat');
    });
    
    if (sCol !== -1 && lnCol !== -1 && ltCol !== -1) {
      headerRowIndex = r;
      labelIdCol = lblCol;
      stationCol = sCol;
      depthCol = dCol;
      lonCol = lnCol;
      latCol = ltCol;
      // Store bottom depth column index in a local or module scope, but we can also just use a temporary variable since we loop through again
      break;
    }
  }

  // Find bdCol again if we broke out
  let botDepthCol = -1;
  if (headerRowIndex !== -1) {
    const row = jsonRows[headerRowIndex];
    if (Array.isArray(row)) {
      botDepthCol = row.findIndex(cell => {
        if (cell === null || cell === undefined) return false;
        const c = cell.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
        return (c.includes('bot') || c.includes('bottom')) && (c.includes('depth') || c.includes('深度'));
      });
    }
  }
  
  // Fallbacks if columns not found
  if (headerRowIndex === -1) {
    stationCol = 2; // Default assume column indices
    lonCol = 0;
    latCol = 1;
    depthCol = 5;
    labelIdCol = 6;
    botDepthCol = 4; // Bot.Depth (m) is index 4 in default
    headerRowIndex = 0;
  } else {
    // If some columns are missing, use defaults
    if (labelIdCol === -1) labelIdCol = 6;
    if (depthCol === -1) depthCol = 5;
  }
  
  const sampleInfos: ExcelSampleInfo[] = [];
  
  for (let r = headerRowIndex + 1; r < jsonRows.length; r++) {
    const row = jsonRows[r];
    if (!Array.isArray(row)) continue;
    
    const rawLabel = row[labelIdCol];
    const rawSt = row[stationCol];
    const rawDepth = row[depthCol];
    const rawLon = row[lonCol];
    const rawLat = row[latCol];
    const rawBotDepth = botDepthCol !== -1 ? row[botDepthCol] : undefined;
    
    if (rawSt === undefined || rawLon === undefined || rawLat === undefined) {
      continue;
    }
    
    const labelId = rawLabel ? rawLabel.toString().trim() : '';
    const station = rawSt.toString().trim();
    const depth = rawDepth !== undefined ? parseFloat(rawDepth) : 0;
    const longitude = parseFloat(rawLon);
    const latitude = parseFloat(rawLat);
    const botDepth = rawBotDepth !== undefined ? parseFloat(rawBotDepth) : undefined;
    
    if (station && !isNaN(longitude) && !isNaN(latitude)) {
      sampleInfos.push({
        labelId,
        station,
        depth: isNaN(depth) ? 0 : depth,
        longitude,
        latitude,
        botDepth: botDepth !== undefined && !isNaN(botDepth) ? botDepth : undefined
      });
    }
  }
  
  return sampleInfos;
}
