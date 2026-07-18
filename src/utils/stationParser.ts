import * as xlsx from 'xlsx';
import { ExcelSampleInfo, HydrologicalSample } from '../types';



/**
 * Standardizes station name or label ID for comparison.
 * e.g., "ST-39", "st39", "St_39", "ST39" all normalize to "st39".
 */
export function normalizeStationName(name: string | null | undefined): string {
  if (!name) return '';
  const clean = name.toString().toLowerCase().trim();
  
  // Custom check for SO308/1_14-1 format
  const so308Match = clean.match(/_(\d+)(?:-\d+)?$/) || clean.match(/_(\d+)-/);
  if (so308Match && so308Match[1]) {
    return 'st' + parseInt(so308Match[1], 10);
  }

  // Extract trailing digits/numbers ignoring leading zeros
  const match = clean.match(/(?:station|ctd|st|s|^)[-_:\s]*0*(\d+)/i);
  if (match && match[1]) {
    return 'st' + match[1];
  }
  
  return clean.replace(/[^a-z0-9]/g, ''); // Remove non-alphanumeric chars
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
  let cruiseCol = -1;
  let typeCol = -1;
  let timeCol = -1;
  let yearCol = -1;
  let monthCol = -1;
  let dayCol = -1;
  let hourCol = -1;
  let minuteCol = -1;
  if (headerRowIndex !== -1) {
    const row = jsonRows[headerRowIndex];
    if (Array.isArray(row)) {
      botDepthCol = row.findIndex(cell => {
        if (cell === null || cell === undefined) return false;
        const c = cell.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
        return (c.includes('bot') || c.includes('bottom')) && (c.includes('depth') || c.includes('深度'));
      });
      cruiseCol = row.findIndex(cell => cell && (cell.toString().toLowerCase().includes('cruise') || cell.toString().toLowerCase().includes('leg')));
      typeCol = row.findIndex(cell => cell && cell.toString().toLowerCase() === 'type');
      timeCol = row.findIndex(cell => cell && (cell.toString().toLowerCase().includes('time') || cell.toString().toLowerCase().includes('date')));
      yearCol = row.findIndex(cell => cell && cell.toString().toLowerCase() === 'year');
      monthCol = row.findIndex(cell => cell && cell.toString().toLowerCase() === 'month');
      dayCol = row.findIndex(cell => cell && cell.toString().toLowerCase() === 'day');
      hourCol = row.findIndex(cell => cell && cell.toString().toLowerCase() === 'hour');
      minuteCol = row.findIndex(cell => cell && cell.toString().toLowerCase() === 'minute');
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
    let longitude = parseFloat(rawLon);
    let latitude = parseFloat(rawLat);
    const botDepth = rawBotDepth !== undefined ? parseFloat(rawBotDepth) : undefined;
    
    // Check for column shift (e.g. Fluorescence columns present in headers but omitted in data rows)
    if (row.length > 16) {
      const posLat = parseFloat(row[15]);
      const posLon = parseFloat(row[16]);
      const posYear = parseFloat(row[17]);
      if (posYear === 2024 || (posLat < 0 && posLat > -40 && posLon > 30 && posLon < 120)) {
        latitude = posLat;
        longitude = posLon;
      }
    }
    
    let cruise = '';
    if (cruiseCol !== -1 && row[cruiseCol] !== undefined && row[cruiseCol] !== null) {
      cruise = row[cruiseCol].toString().trim();
    }
    let type = 'C';
    if (typeCol !== -1 && row[typeCol] !== undefined && row[typeCol] !== null) {
      type = row[typeCol].toString().trim();
    }
    let sampleTime = '';
    if (timeCol !== -1 && row[timeCol] !== undefined && row[timeCol] !== null) {
      const rawTime = row[timeCol];
      if (rawTime instanceof Date) {
        sampleTime = rawTime.toISOString().slice(0, 16);
      } else {
        sampleTime = rawTime.toString().trim();
      }
    } else if (yearCol !== -1 && row[yearCol] !== undefined && row[yearCol] !== null) {
      const year = parseInt(row[yearCol], 10);
      const month = monthCol !== -1 && row[monthCol] !== undefined && row[monthCol] !== null ? parseInt(row[monthCol], 10) : 1;
      const day = dayCol !== -1 && row[dayCol] !== undefined && row[dayCol] !== null ? parseInt(row[dayCol], 10) : 1;
      const hour = hourCol !== -1 && row[hourCol] !== undefined && row[hourCol] !== null ? parseInt(row[hourCol], 10) : 0;
      const minute = minuteCol !== -1 && row[minuteCol] !== undefined && row[minuteCol] !== null ? parseInt(row[minuteCol], 10) : 0;
      if (!isNaN(year)) {
        const pad = (num: number) => String(num).padStart(2, '0');
        sampleTime = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
      }
    }

    if (station && !isNaN(longitude) && !isNaN(latitude)) {
      sampleInfos.push({
        labelId,
        station,
        depth: isNaN(depth) ? 0 : depth,
        longitude,
        latitude,
        botDepth: botDepth !== undefined && !isNaN(botDepth) ? botDepth : undefined,
        cruise: cruise || undefined,
        time: sampleTime || undefined,
        type: type || undefined
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

  // Handle merging all sheets
  if (targetSheetName === '__MERGE_ALL__') {
    const allParametersSet = new Set<string>();
    const samplesMap = new Map<string, HydrologicalSample>();
    
    for (const sheetName of sheetNames) {
      const result = parseHydrologicalExcel(arrayBuffer, sheetName);
      result.parameters.forEach(p => allParametersSet.add(p));
      
      result.samples.forEach(sample => {
        const normSt = normalizeStationName(sample.station);
        const key = `${normSt}_d${sample.depth.toFixed(1)}`;
        
        const existing = samplesMap.get(key);
        if (existing) {
          Object.keys(sample.values).forEach(k => {
            if (sample.values[k] !== undefined && sample.values[k] !== null && !isNaN(sample.values[k])) {
              if (existing.values[k] === undefined || existing.values[k] === null || isNaN(existing.values[k])) {
                existing.values[k] = sample.values[k];
              }
            }
          });
          if (!existing.cruise && sample.cruise) existing.cruise = sample.cruise;
          if (!existing.time && sample.time) existing.time = sample.time;
          if (!existing.type && sample.type) existing.type = sample.type;
        } else {
          samplesMap.set(key, {
            ...sample,
            id: `merged_st${sample.station}_d${sample.depth}`,
            values: { ...sample.values }
          });
        }
      });
    }
    
    return {
      sheetNames,
      selectedSheet: '__MERGE_ALL__',
      parameters: Array.from(allParametersSet),
      samples: Array.from(samplesMap.values())
    };
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
  const depthCol = headers.findIndex(h => {
    if (!h) return false;
    const c = h.toString().toLowerCase();
    return c.includes('depth') && !c.includes('bot') && !c.includes('bottom');
  });
  const pressCol = headers.findIndex(h => h && h.toString().toLowerCase().includes('pressure'));
  
  const cruiseCol = headers.findIndex(h => h && (h.toString().toLowerCase().includes('cruise') || h.toString().toLowerCase().includes('leg')));
  const typeCol = headers.findIndex(h => h && h.toString().toLowerCase() === 'type');
  const timeCol = headers.findIndex(h => h && (h.toString().toLowerCase().includes('time') || h.toString().toLowerCase().includes('date')));
  
  const yearCol = headers.findIndex(h => h && h.toString().toLowerCase() === 'year');
  const monthCol = headers.findIndex(h => h && h.toString().toLowerCase() === 'month');
  const dayCol = headers.findIndex(h => h && h.toString().toLowerCase() === 'day');
  const hourCol = headers.findIndex(h => h && h.toString().toLowerCase() === 'hour');
  const minuteCol = headers.findIndex(h => h && h.toString().toLowerCase() === 'minute');

  // Excluded headers for parameter list
  const excludedHeaders = [
    'station', 'cast', 'sample no', 'ctd cast no', 'ship stn. no.', 'ship stn no', 'niskin bottle no', 'niskin bottle no.',
    'depth', 'pressure', 'latitude', 'longitude', 'year', 'month', 'day', 'hour', 'minute', 'second', 'flag', 'type', 'cruise', 'leg'
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
    
    let latitude = parseFloat(rawLat);
    let longitude = parseFloat(rawLon);
    
    // Check for column shift (e.g. Fluorescence columns present in headers but omitted in data rows)
    if (row.length > 16) {
      const posLat = parseFloat(row[15]);
      const posLon = parseFloat(row[16]);
      const posYear = parseFloat(row[17]);
      if (posYear === 2024 || (posLat < 0 && posLat > -40 && posLon > 30 && posLon < 120)) {
        latitude = posLat;
        longitude = posLon;
      }
    }
    
    const depth = rawDepth !== undefined ? parseFloat(rawDepth) : 0;
    const pressure = rawPress !== undefined ? parseFloat(rawPress) : depth; // fallback pressure to depth
    
    if (!station || isNaN(latitude) || isNaN(longitude)) {
      continue;
    }
    
    const values: Record<string, number> = {};
    parameters.forEach(p => {
      const idx = colIndices[p];
      const rawVal = row[idx];
      let val = parseFloat(rawVal);
      if (rawVal !== undefined && rawVal !== null) {
        const strVal = rawVal.toString().trim().toUpperCase();
        if (strVal.includes('LOD') || strVal.startsWith('<')) {
          val = 0;
        }
      }
      if (!isNaN(val)) {
        values[p] = val;
      }
    });
    
    let cruise = '';
    if (cruiseCol !== -1 && row[cruiseCol] !== undefined && row[cruiseCol] !== null) {
      cruise = row[cruiseCol].toString().trim();
    }
    let type = 'C';
    if (typeCol !== -1 && row[typeCol] !== undefined && row[typeCol] !== null) {
      type = row[typeCol].toString().trim();
    }
    let sampleTime = '';
    if (timeCol !== -1 && row[timeCol] !== undefined && row[timeCol] !== null) {
      const rawTime = row[timeCol];
      if (rawTime instanceof Date) {
        sampleTime = rawTime.toISOString().slice(0, 16);
      } else {
        sampleTime = rawTime.toString().trim();
      }
    } else if (yearCol !== -1 && row[yearCol] !== undefined && row[yearCol] !== null) {
      const year = parseInt(row[yearCol], 10);
      const month = monthCol !== -1 && row[monthCol] !== undefined && row[monthCol] !== null ? parseInt(row[monthCol], 10) : 1;
      const day = dayCol !== -1 && row[dayCol] !== undefined && row[dayCol] !== null ? parseInt(row[dayCol], 10) : 1;
      const hour = hourCol !== -1 && row[hourCol] !== undefined && row[hourCol] !== null ? parseInt(row[hourCol], 10) : 0;
      const minute = minuteCol !== -1 && row[minuteCol] !== undefined && row[minuteCol] !== null ? parseInt(row[minuteCol], 10) : 0;
      if (!isNaN(year)) {
        const pad = (num: number) => String(num).padStart(2, '0');
        sampleTime = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
      }
    }

    samples.push({
      id: `${selectedSheet}_r${r}_st${station}_d${depth}`,
      station,
      latitude,
      longitude,
      depth: isNaN(depth) ? 0 : depth,
      pressure: isNaN(pressure) ? 0 : pressure,
      values,
      cruise: cruise || undefined,
      time: sampleTime || undefined,
      type: type || undefined
    });
  }
  
  return {
    sheetNames,
    selectedSheet,
    parameters,
    samples
  };
}

