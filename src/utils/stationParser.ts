import * as xlsx from 'xlsx';
import { ExcelSampleInfo, HydrologicalSample } from '../types';



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
      return c.includes('lable') || c.includes('label') || c === 'id' || c.includes('样品编号') || c.includes('样品名称') || c.includes('编号');
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

export interface HydrologicalParseResult {
  sheetNames: string[];
  selectedSheet: string;
  parameters: string[];
  samples: HydrologicalSample[];
}

export function parseHydrologicalExcel(
  arrayBuffer: ArrayBuffer,
  targetSheetName?: string
): HydrologicalParseResult {
  const data = new Uint8Array(arrayBuffer);
  const workbook = xlsx.read(data, { type: 'array' });
  const sheetNames = workbook.SheetNames;
  
  if (sheetNames.length === 0) {
    return { sheetNames: [], selectedSheet: '', parameters: [], samples: [] };
  }
  
  const selectedSheet = targetSheetName && sheetNames.includes(targetSheetName) 
    ? targetSheetName 
    : (sheetNames.includes('All StStCTD') ? 'All StStCTD' : sheetNames[0]);
    
  const worksheet = workbook.Sheets[selectedSheet];
  const jsonRows = xlsx.utils.sheet_to_json<any>(worksheet, { header: 1 });
  
  if (jsonRows.length === 0) {
    return { sheetNames, selectedSheet, parameters: [], samples: [] };
  }
  
  // Find header row and column mappings
  let headerRowIndex = -1;
  for (let r = 0; r < Math.min(jsonRows.length, 10); r++) {
    const row = jsonRows[r];
    if (!Array.isArray(row)) continue;
    const hasSt = row.some(cell => cell && cell.toString().toLowerCase().includes('station'));
    const hasLon = row.some(cell => cell && cell.toString().toLowerCase().includes('longitude'));
    if (hasSt && hasLon) {
      headerRowIndex = r;
      break;
    }
  }
  
  if (headerRowIndex === -1) {
    headerRowIndex = 0; // fallback
  }
  
  const headers = jsonRows[headerRowIndex] as any[];
  if (!headers || !headers.length) {
    return { sheetNames, selectedSheet, parameters: [], samples: [] };
  }
  
  // Find key columns
  const stationCol = headers.findIndex(h => h && h.toString().toLowerCase() === 'station');
  const shipStnCol = headers.findIndex(h => h && h.toString().toLowerCase().replace(/[^a-z0-9]/g, '').includes('shipstn'));
  const latCol = headers.findIndex(h => h && h.toString().toLowerCase().includes('latitude'));
  const lonCol = headers.findIndex(h => h && h.toString().toLowerCase().includes('longitude'));
  const depthCol = headers.findIndex(h => h && h.toString().toLowerCase().includes('depth'));
  const pressCol = headers.findIndex(h => h && h.toString().toLowerCase().includes('pressure'));
  
  // Excluded headers for parameter list
  const excludedHeaders = [
    'station', 'cast', 'sample no', 'ctd cast no', 'ship stn. no.', 'ship stn no', 'niskin bottle no', 'niskin bottle no.',
    'depth', 'pressure', 'latitude', 'longitude', 'year', 'month', 'day', 'hour', 'minute', 'second', 'flag'
  ];
  
  const parameters: string[] = [];
  const colIndices: { [key: string]: number } = {};
  
  headers.forEach((h, idx) => {
    if (!h) return;
    const hStr = h.toString();
    const hLower = hStr.toLowerCase();
    
    // Check if it's an excluded column
    const isExcluded = excludedHeaders.some(ex => hLower.includes(ex));
    if (!isExcluded) {
      parameters.push(hStr);
      colIndices[hStr] = idx;
    }
  });
  
  const samples: HydrologicalSample[] = [];
  for (let r = headerRowIndex + 1; r < jsonRows.length; r++) {
    const row = jsonRows[r];
    if (!Array.isArray(row)) continue;
    
    const rawSt = stationCol !== -1 ? row[stationCol] : undefined;
    const rawLat = latCol !== -1 ? row[latCol] : undefined;
    const rawLon = lonCol !== -1 ? row[lonCol] : undefined;
    const rawDepth = depthCol !== -1 ? row[depthCol] : undefined;
    const rawPress = pressCol !== -1 ? row[pressCol] : undefined;
    
    if (rawSt === undefined || rawLat === undefined || rawLon === undefined) {
      continue;
    }
    
    let station = rawSt.toString().trim();
    if (shipStnCol !== -1 && row[shipStnCol]) {
      const shipStn = row[shipStnCol].toString().trim();
      if (shipStn && shipStn.toLowerCase() !== 'ship_stn_unknown') {
        station = shipStn;
      }
    }
    
    const latitude = parseFloat(rawLat);
    const longitude = parseFloat(rawLon);
    const depth = rawDepth !== undefined ? parseFloat(rawDepth) : 0;
    const pressure = rawPress !== undefined ? parseFloat(rawPress) : depth; // fallback pressure to depth
    
    if (!station || isNaN(latitude) || isNaN(longitude)) {
      continue;
    }
    
    const values: Record<string, number> = {};
    parameters.forEach(p => {
      const idx = colIndices[p];
      const val = parseFloat(row[idx]);
      if (!isNaN(val)) {
        values[p] = val;
      }
    });
    
    samples.push({
      id: `${selectedSheet}_r${r}_st${station}_d${depth}`,
      station,
      latitude,
      longitude,
      depth: isNaN(depth) ? 0 : depth,
      pressure: isNaN(pressure) ? 0 : pressure,
      values
    });
  }
  
  return {
    sheetNames,
    selectedSheet,
    parameters,
    samples
  };
}

