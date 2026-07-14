import { useState, useMemo, useRef, useEffect } from 'react';
import { Download } from 'lucide-react';
import { contours } from 'd3-contour';
import { calculatePotentialDensityAnomaly } from '../utils/calc';
import { HydrologicalSample } from '../types';

interface WaterMass {
  id: string;
  name: string;
  sMin: number;
  sMax: number;
  tMin: number;
  tMax: number;
  color: string;
  borderStyle: 'solid' | 'dashed';
  polygonPoints?: { s: number; t: number }[];
}

interface OmpEndmember {
  name: string;
  s: number;
  t: number;
  tracerVal: number;
}

interface SectionAnnotation {
  id: string;
  text: string;
  x: number;
  depth: number;
  color: string;
  fontSize: number;
}

interface TSPublicationStudioProps {
  hydroSamples: HydrologicalSample[];
  tsData: { station: string; depth: number; salinity: number; temperature: number; depthGroup: string }[];
}

// Helper to compute cumulative distance along a track using the Haversine formula
function getHaversineDistance(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function TSPublicationStudio({ hydroSamples, tsData }: TSPublicationStudioProps) {
  // --- Publication Export Studio States ---
  const [tsPubLayout, setTsPubLayout] = useState<'combined-side' | 'single-ts' | 'single-section'>('combined-side');
  const [tsPubSalMin, setTsPubSalMin] = useState<string>('33.5');
  const [tsPubSalMax, setTsPubSalMax] = useState<string>('34.8');
  const [tsPubTempMin, setTsPubTempMin] = useState<string>('-2.0');
  const [tsPubTempMax, setTsPubTempMax] = useState<string>('2.5');
  const [tsPubDepthMax, setTsPubDepthMax] = useState<string>('800');
  const [tsPubColorMode, setTsPubColorMode] = useState<'depth-gradient' | 'depth-group' | 'station' | 'uniform' | 'station-gradient' | 'longitude-gradient'>('depth-gradient');
  const [tsPubPreset, setTsPubPreset] = useState<'antarctic' | 'indian' | 'custom'>('antarctic');
  const [tsPubColormap, setTsPubColormap] = useState<'odv-rainbow' | 'jet' | 'viridis'>('odv-rainbow');
  
  const [tsSectionParam, setTsSectionParam] = useState<'temperature' | 'salinity' | 'delta_tracer'>('temperature');
  const [tsSectionAxis, setTsSectionAxis] = useState<'longitude' | 'latitude' | 'distance'>('longitude');
  const [tsSectionHorizStretch, setTsSectionHorizStretch] = useState<string>('0.08');
  const [tsSectionMaskThreshold, setTsSectionMaskThreshold] = useState<string>('0.25');

  const [enableOmp, setEnableOmp] = useState<boolean>(false);
  const [selectedOmpTracer, setSelectedOmpTracer] = useState<string>('DOC');
  const [ompEndmembers, setOmpEndmembers] = useState<OmpEndmember[]>([
    { name: 'WW', s: 34.0, t: -1.5, tracerVal: 42 },
    { name: 'TWW', s: 34.4, t: -1.2, tracerVal: 45 },
    { name: 'CDW', s: 34.7, t: 1.0, tracerVal: 38 }
  ]);

  const availableTracers = useMemo(() => {
    const keys = new Set<string>();
    hydroSamples.forEach(h => {
      if (h.values) {
        Object.keys(h.values).forEach(k => {
          if (typeof h.values[k] === 'number' && !isNaN(h.values[k])) {
            const lk = k.toLowerCase();
            if (lk !== 'salinity' && lk !== 'sal' && lk !== 'temperature' && lk !== 'temp' && lk !== 't°c' && lk !== 't') {
              keys.add(k);
            }
          }
        });
      }
    });
    return Array.from(keys).sort();
  }, [hydroSamples]);

  useEffect(() => {
    if (availableTracers.length > 0 && !availableTracers.includes(selectedOmpTracer)) {
      const hasDoc = availableTracers.find(t => t.toLowerCase() === 'doc');
      if (hasDoc) {
        setSelectedOmpTracer(hasDoc);
      } else {
        setSelectedOmpTracer(availableTracers[0]);
      }
    }
  }, [availableTracers, selectedOmpTracer]);

  const [tsPubWaterMasses, setTsPubWaterMasses] = useState<WaterMass[]>([
    {
      id: 'ww',
      name: 'WW',
      sMin: 33.5,
      sMax: 34.25,
      tMin: -1.9,
      tMax: -0.8,
      color: '#000000',
      borderStyle: 'solid',
      polygonPoints: [
        { s: 33.5, t: -1.8 },
        { s: 34.0, t: -1.8 },
        { s: 34.25, t: -1.6 },
        { s: 34.25, t: -1.0 },
        { s: 34.0, t: -0.8 },
        { s: 33.5, t: -0.8 }
      ]
    },
    { id: 'tww', name: 'TWW', sMin: 34.25, sMax: 34.6, tMin: -1.9, tMax: -0.8, color: '#000000', borderStyle: 'solid' },
    { id: 'tbw', name: 'TBW', sMin: 34.1, sMax: 34.5, tMin: -0.2, tMax: 2.2, color: '#000000', borderStyle: 'solid' },
    {
      id: 'cdw',
      name: 'CDW',
      sMin: 34.5,
      sMax: 34.75,
      tMin: -0.2,
      tMax: 2.2,
      color: '#000000',
      borderStyle: 'solid',
      polygonPoints: [
        { s: 34.5, t: 1.0 },
        { s: 34.65, t: 2.2 },
        { s: 34.75, t: 2.2 },
        { s: 34.75, t: 0.2 },
        { s: 34.5, t: -0.2 }
      ]
    }
  ]);

  const [tsPubAnnotations, setTsPubAnnotations] = useState<SectionAnnotation[]>([
    { id: '1', text: 'Winter water', x: -60.5, depth: 80, color: '#000000', fontSize: 11 },
    { id: '2', text: 'Circumpolar deep water', x: -60.8, depth: 500, color: '#000000', fontSize: 11 },
    { id: '3', text: 'Transitional Weddell water', x: -62.1, depth: 550, color: '#000000', fontSize: 11 }
  ]);

  const [tsPubScale, setTsPubScale] = useState<number>(3);
  const [tsPubGridlines, setTsPubGridlines] = useState<boolean>(true);
  const [tsPubFont, setTsPubFont] = useState<'Arial' | 'Times New Roman' | 'Helvetica' | 'Courier New'>('Arial');
  const [tsPubShowContourLabels, setTsPubShowContourLabels] = useState<boolean>(true);
  const [tsPubShowWaterMassLabels, setTsPubShowWaterMassLabels] = useState<boolean>(true);

  // Build section data from hydroSamples and compute cumulative distance
  const sectionData = useMemo(() => {
    if (!hydroSamples || hydroSamples.length === 0) return [];
    
    const findValueByKeywords = (values: Record<string, number>, keywords: string[]): number | undefined => {
      const keys = Object.keys(values);
      for (const keyword of keywords) {
        const matchedKey = keys.find(k => {
          const lowerK = k.toLowerCase();
          if (lowerK.includes(keyword.toLowerCase())) return true;
          const strippedK = lowerK.replace(/[^a-z0-9]/g, '');
          const strippedKeyword = keyword.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (strippedKeyword && strippedK.includes(strippedKeyword)) return true;
          return false;
        });
        if (matchedKey && values[matchedKey] !== undefined) {
          return values[matchedKey];
        }
      }
      return undefined;
    };

    const mapped = hydroSamples.map(h => {
      const sal = findValueByKeywords(h.values, ['salinity', 'sal', 's', '盐度', '盐']);
      const temp = findValueByKeywords(h.values, ['temperature', 'temp', 't°c', 't', '温度', '温']);
      if (sal === undefined || temp === undefined || isNaN(sal) || isNaN(temp)) return null;
      
      const T = parseFloat(temp.toFixed(4));
      const S = parseFloat(sal.toFixed(4));
      
      // Calculate OMP fractions if enabled and we have 3 endmembers
      let f1 = 0, f2 = 0, f3 = 0;
      let delta_tracer = 0;
      let tracer_cons = 0;
      let tracer_obs = 0;
      
      if (enableOmp && ompEndmembers.length >= 3) {
        const em1 = ompEndmembers[0];
        const em2 = ompEndmembers[1];
        const em3 = ompEndmembers[2];
        
        const T1 = em1.t, S1 = em1.s;
        const T2 = em2.t, S2 = em2.s;
        const T3 = em3.t, S3 = em3.s;
        
        const D = T1 * (S2 - S3) - T2 * (S1 - S3) + T3 * (S1 - S2);
        if (Math.abs(D) > 1e-6) {
          const D1 = T * (S2 - S3) - T2 * (S - S3) + T3 * (S - S2);
          const D2 = T1 * (S - S3) - T * (S1 - S3) + T3 * (S1 - S);
          const D3 = T1 * (S2 - S) - T2 * (S1 - S) + T * (S1 - S2);
          
          let rawF1 = D1 / D;
          let rawF2 = D2 / D;
          let rawF3 = D3 / D;
          
          const cF1 = Math.max(0, Math.min(1, rawF1));
          const cF2 = Math.max(0, Math.min(1, rawF2));
          const cF3 = Math.max(0, Math.min(1, rawF3));
          
          const sum = cF1 + cF2 + cF3;
          if (sum > 0) {
            f1 = cF1 / sum;
            f2 = cF2 / sum;
            f3 = cF3 / sum;
          } else {
            f1 = 1 / 3; f2 = 1 / 3; f3 = 1 / 3;
          }
        } else {
          f1 = 1 / 3; f2 = 1 / 3; f3 = 1 / 3;
        }
        
        // Find tracer value
        const tVal = h.values[selectedOmpTracer] !== undefined ? h.values[selectedOmpTracer] : findValueByKeywords(h.values, [selectedOmpTracer.toLowerCase()]);
        if (tVal !== undefined && !isNaN(tVal)) {
          tracer_obs = tVal;
          tracer_cons = f1 * em1.tracerVal + f2 * em2.tracerVal + f3 * em3.tracerVal;
          delta_tracer = parseFloat((tracer_obs - tracer_cons).toFixed(4));
        }
      }

      return {
        station: h.station,
        longitude: h.longitude,
        latitude: h.latitude,
        depth: h.depth,
        temperature: T,
        salinity: S,
        values: h.values,
        f1,
        f2,
        f3,
        delta_tracer,
        tracer_cons,
        tracer_obs
      };
    }).filter(Boolean) as { 
      station: string; 
      longitude: number; 
      latitude: number; 
      depth: number; 
      temperature: number; 
      salinity: number; 
      values: Record<string, number>;
      f1: number;
      f2: number;
      f3: number;
      delta_tracer: number;
      tracer_cons: number;
      tracer_obs: number;
    }[];

    // Extract unique stations
    const stationMap = new Map<string, { longitude: number; latitude: number }>();
    mapped.forEach(d => {
      if (!stationMap.has(d.station)) {
        stationMap.set(d.station, { longitude: d.longitude, latitude: d.latitude });
      }
    });
    const unique = Array.from(stationMap.entries()).map(([station, coords]) => ({
      station,
      ...coords
    }));

    // Sort unique stations geographically
    const lons = unique.map(s => s.longitude);
    const lats = unique.map(s => s.latitude);
    const lonSpan = lons.length > 0 ? Math.max(...lons) - Math.min(...lons) : 0;
    const latSpan = lats.length > 0 ? Math.max(...lats) - Math.min(...lats) : 0;
    
    if (lonSpan >= latSpan) {
      unique.sort((a, b) => a.longitude - b.longitude);
    } else {
      unique.sort((a, b) => a.latitude - b.latitude);
    }

    // Cumulative distances in km
    const distances = new Map<string, number>();
    if (unique.length > 0) {
      distances.set(unique[0].station, 0);
      let accumulated = 0;
      for (let i = 1; i < unique.length; i++) {
        const prev = unique[i - 1];
        const curr = unique[i];
        const d = getHaversineDistance(prev.longitude, prev.latitude, curr.longitude, curr.latitude);
        accumulated += d;
        distances.set(curr.station, accumulated);
      }
    }

    // Compute maximum depth (bottom depth) per station from the samples
    const stationBottomDepths = new Map<string, number>();
    mapped.forEach(d => {
      const curMax = stationBottomDepths.get(d.station) || 0;
      if (d.depth > curMax) {
        stationBottomDepths.set(d.station, d.depth);
      }
    });

    return mapped.map(d => ({
      ...d,
      distance: distances.get(d.station) || 0,
      botDepth: stationBottomDepths.get(d.station) || d.depth
    }));
  }, [hydroSamples, enableOmp, selectedOmpTracer, ompEndmembers]);

  // Extract numbers for limits
  const salMinVal = parseFloat(tsPubSalMin) || 33.0;
  const salMaxVal = parseFloat(tsPubSalMax) || 35.0;
  const tempMinVal = parseFloat(tsPubTempMin) || -2.5;
  const tempMaxVal = parseFloat(tsPubTempMax) || 5.0;
  const depthMaxVal = parseFloat(tsPubDepthMax) || 800;

  // Memoize heavy grid interpolation for the section plot
  const sectionGridInfo = useMemo(() => {
    if (!sectionData || sectionData.length === 0) return null;

    const xKey = tsSectionAxis === 'distance' ? 'distance' : (tsSectionAxis === 'longitude' ? 'longitude' : 'latitude');
    const valKey = tsSectionParam;

    const xs = sectionData.map(d => d[xKey]);
    const vals = sectionData.map(d => d[valKey]);

    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const valMin = Math.min(...vals);
    const valMax = Math.max(...vals);
    const valRange = valMax - valMin || 1;

    const gridCols = 150;
    const gridRows = 100;
    const power = 2;

    const gridData = new Float32Array(gridCols * gridRows);
    const cellMask = new Uint8Array(gridCols * gridRows); // 0 = normal, 1 = seabed, 2 = distance masked

    // Extract unique stations and bottom depths along the chosen X axis coordinate
    const stationDepths: { x: number; botDepth: number }[] = [];
    const seenStations = new Set<string>();
    sectionData.forEach(d => {
      if (!seenStations.has(d.station)) {
        seenStations.add(d.station);
        stationDepths.push({ x: d[xKey], botDepth: d.botDepth });
      }
    });
    stationDepths.sort((a, b) => a.x - b.x);

    const getBottomDepthAtX = (gx: number): number => {
      if (stationDepths.length === 0) return depthMaxVal;
      if (gx <= stationDepths[0].x) return stationDepths[0].botDepth;
      if (gx >= stationDepths[stationDepths.length - 1].x) return stationDepths[stationDepths.length - 1].botDepth;
      for (let i = 0; i < stationDepths.length - 1; i++) {
        const p1 = stationDepths[i];
        const p2 = stationDepths[i + 1];
        if (gx >= p1.x && gx <= p2.x) {
          const pct = (gx - p1.x) / (p2.x - p1.x || 1);
          return p1.botDepth + pct * (p2.botDepth - p1.botDepth);
        }
      }
      return depthMaxVal;
    };

    // 1. Grid Interpolation & Mask calculation
    for (let row = 0; row < gridRows; row++) {
      for (let col = 0; col < gridCols; col++) {
        const gx = xMin + (col / (gridCols - 1)) * (xMax - xMin);
        const gy = (row / (gridRows - 1)) * depthMaxVal;

        // Seafloor check
        const bottomDepth = getBottomDepthAtX(gx);
        if (gy > bottomDepth) {
          gridData[row * gridCols + col] = valMin;
          cellMask[row * gridCols + col] = 1; // Seabed
          continue;
        }

        let wSum = 0, vSum = 0, exact = false, exactV = 0;
        let minDistSq = Infinity;
        
        for (let i = 0; i < sectionData.length; i++) {
          // Stretch horizontally by scaling dx down (e.g. by 0.22), representing a horizontal search ellipse
          const dx = ((sectionData[i][xKey] - gx) / Math.max(xMax - xMin, 0.001)) * (parseFloat(tsSectionHorizStretch) || 0.08);
          const dy = (sectionData[i].depth - gy) / depthMaxVal;
          const dist2 = dx * dx + dy * dy;
          
          if (dist2 < minDistSq) {
            minDistSq = dist2;
          }
          
          if (dist2 < 1e-12) { exact = true; exactV = sectionData[i][valKey]; break; }
          const w = 1 / Math.pow(dist2, power / 2);
          wSum += w; vSum += w * sectionData[i][valKey];
        }

        const interpVal = exact ? exactV : (wSum > 0 ? vSum / wSum : valMin);
        gridData[row * gridCols + col] = interpVal;

        if (minDistSq > (parseFloat(tsSectionMaskThreshold) || 0.25)) {
          cellMask[row * gridCols + col] = 2; // Distance masked
        } else {
          cellMask[row * gridCols + col] = 0; // Normal
        }
      }
    }

    // Apply grid smoothing to get clean, smooth contour curves
    const smoothGrid = (data: Float32Array, cols: number, rows: number, passes: number = 2) => {
      let current = new Float32Array(data);
      let next = new Float32Array(data.length);
      for (let p = 0; p < passes; p++) {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const centerIdx = r * cols + c;
            if (cellMask[centerIdx] === 1) {
              next[centerIdx] = current[centerIdx];
              continue;
            }
            let sum = 0;
            let count = 0;
            for (let dr = -1; dr <= 1; dr++) {
              for (let dc = -1; dc <= 1; dc++) {
                const nr = r + dr;
                const nc = c + dc;
                if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                  const nIdx = nr * cols + nc;
                  if (cellMask[nIdx] !== 1) {
                    const weight = (dr === 0 && dc === 0) ? 2 : 1;
                    sum += current[nIdx] * weight;
                    count += weight;
                  }
                }
              }
            }
            next[centerIdx] = count > 0 ? sum / count : current[centerIdx];
          }
        }
        current.set(next);
      }
      return current;
    };

    const smoothedGridData = smoothGrid(gridData, gridCols, gridRows, 2);

    return {
      xKey,
      valKey,
      xMin,
      xMax,
      valMin,
      valMax,
      valRange,
      gridCols,
      gridRows,
      gridData,
      cellMask,
      stationDepths,
      smoothedGridData
    };
  }, [sectionData, tsSectionAxis, tsSectionParam, depthMaxVal, tsSectionHorizStretch, tsSectionMaskThreshold]);

  // Bisection solver for density contours (sigma_theta)
  const solveTemp = (S: number, targetSigma: number): number => {
    let low = -2.0;
    let high = 35.0;
    for (let iter = 0; iter < 15; iter++) {
      const mid = (low + high) / 2;
      const sigma = calculatePotentialDensityAnomaly(S, mid);
      if (sigma > targetSigma) {
        low = mid;
      } else {
        high = mid;
      }
    }
    return (low + high) / 2;
  };

  // Jet colormap color mapping helper
  const getJetColor = (t: number): [number, number, number] => {
    const clamped = Math.max(0, Math.min(1, t));
    let r = 0, g = 0, b = 0;
    if (clamped < 0.125) {
      const s = clamped / 0.125;
      r = 0; g = 0; b = Math.round(128 + s * 127);
    } else if (clamped < 0.375) {
      const s = (clamped - 0.125) / 0.25;
      r = 0; g = Math.round(s * 255); b = 255;
    } else if (clamped < 0.625) {
      const s = (clamped - 0.375) / 0.25;
      r = Math.round(s * 255); g = 255; b = Math.round(255 - s * 255);
    } else if (clamped < 0.875) {
      const s = (clamped - 0.625) / 0.25;
      r = 255; g = Math.round(255 - s * 255); b = 0;
    } else {
      const s = (clamped - 0.875) / 0.125;
      r = Math.round(255 - s * 127); g = 0; b = 0;
    }
    return [r, g, b];
  };

  // ODV-style Rainbow colormap: Magenta -> Blue -> Cyan -> Green -> Yellow -> Orange -> Red
  const getOdvRainbowColor = (t: number): [number, number, number] => {
    const clamped = Math.max(0, Math.min(1, t));
    const stops: { t: number; color: [number, number, number] }[] = [
      { t: 0.0, color: [210, 50, 210] },
      { t: 0.166, color: [0, 50, 255] },
      { t: 0.333, color: [0, 200, 255] },
      { t: 0.5, color: [0, 210, 0] },
      { t: 0.666, color: [220, 220, 0] },
      { t: 0.833, color: [255, 120, 0] },
      { t: 1.0, color: [230, 0, 0] }
    ];

    for (let i = 0; i < stops.length - 1; i++) {
      const s1 = stops[i];
      const s2 = stops[i + 1];
      if (clamped >= s1.t && clamped <= s2.t) {
        const pct = (clamped - s1.t) / (s2.t - s1.t || 1);
        const r = Math.round(s1.color[0] + pct * (s2.color[0] - s1.color[0]));
        const g = Math.round(s1.color[1] + pct * (s2.color[1] - s1.color[1]));
        const b = Math.round(s1.color[2] + pct * (s2.color[2] - s1.color[2]));
        return [r, g, b];
      }
    }
    return [230, 0, 0];
  };

  // Viridis colormap helper
  const getViridisColor = (t: number): [number, number, number] => {
    const clamped = Math.max(0, Math.min(1, t));
    const stops: { t: number; color: [number, number, number] }[] = [
      { t: 0.0, color: [68, 1, 84] },
      { t: 0.25, color: [59, 82, 139] },
      { t: 0.5, color: [33, 144, 140] },
      { t: 0.75, color: [94, 201, 98] },
      { t: 1.0, color: [253, 231, 37] }
    ];

    for (let i = 0; i < stops.length - 1; i++) {
      const s1 = stops[i];
      const s2 = stops[i + 1];
      if (clamped >= s1.t && clamped <= s2.t) {
        const pct = (clamped - s1.t) / (s2.t - s1.t || 1);
        const r = Math.round(s1.color[0] + pct * (s2.color[0] - s1.color[0]));
        const g = Math.round(s1.color[1] + pct * (s2.color[1] - s1.color[1]));
        const b = Math.round(s1.color[2] + pct * (s2.color[2] - s1.color[2]));
        return [r, g, b];
      }
    }
    return [253, 231, 37];
  };

  // Main wrapper for colormap choice
  const getColormapColor = (t: number): [number, number, number] => {
    if (tsPubColormap === 'jet') return getJetColor(t);
    if (tsPubColormap === 'viridis') return getViridisColor(t);
    return getOdvRainbowColor(t);
  };

  const getDivergentColor = (v: number, minVal: number, maxVal: number): [number, number, number] => {
    const absMax = Math.max(Math.abs(minVal), Math.abs(maxVal)) || 1;
    const t = Math.max(-1, Math.min(1, v / absMax));
    
    if (t < 0) {
      const pct = 1 + t;
      const r = Math.round(255 * pct + 30 * (1 - pct));
      const g = Math.round(255 * pct + 100 * (1 - pct));
      const b = 255;
      return [r, g, b];
    } else {
      const pct = 1 - t;
      const r = 255;
      const g = Math.round(255 * pct + 100 * (1 - pct));
      const b = Math.round(255 * pct + 30 * (1 - pct));
      return [r, g, b];
    }
  };

  // Render function for Canvas drawing
  const drawStudioCanvas = (canvas: HTMLCanvasElement, scale: number) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Dimensions & Layout
    const dpr = scale;
    const canvasW = (tsPubLayout === 'combined-side' ? 1080 : 640) * dpr;
    const canvasH = 480 * dpr;

    canvas.width = canvasW;
    canvas.height = canvasH;
    ctx.clearRect(0, 0, canvasW, canvasH);

    // Background white
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);

    const fontFamily = tsPubFont;

    // Shared margin parameters
    const marginTop = 50 * dpr;
    const marginBottom = 65 * dpr;
    const plotH = canvasH - marginTop - marginBottom;

    if (tsPubLayout === 'single-ts' || tsPubLayout === 'combined-side') {
      // T-S Plot Geometry
      const marginLeft = 65 * dpr;
      const plotW = (tsPubLayout === 'combined-side' ? 420 : 475) * dpr;
      const plotX = marginLeft;
      const plotY = marginTop;

      // Draw clean box border
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeRect(plotX, plotY, plotW, plotH);

      // Draw Gridlines
      if (tsPubGridlines) {
        ctx.save();
        ctx.strokeStyle = '#f1f5f9';
        ctx.lineWidth = 0.5 * dpr;
        for (let i = 1; i < 5; i++) {
          const px = plotX + (i / 5) * plotW;
          ctx.beginPath(); ctx.moveTo(px, plotY); ctx.lineTo(px, plotY + plotH); ctx.stroke();
        }
        for (let i = 1; i < 5; i++) {
          const py = plotY + (i / 5) * plotH;
          ctx.beginPath(); ctx.moveTo(plotX, py); ctx.lineTo(plotX + plotW, py); ctx.stroke();
        }
        ctx.restore();
      }

      // Draw density contours (Isopycnals)
      const isopycnalLevels = [24.0, 24.5, 25.0, 25.5, 26.0, 26.5, 26.8, 27.0, 27.2, 27.4, 27.6, 27.8, 28.0];
      ctx.save();
      ctx.strokeStyle = 'rgba(100,116,139,0.35)';
      ctx.lineWidth = 0.8 * dpr;
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.font = `italic ${9 * dpr}px ${fontFamily}`;
      ctx.fillStyle = 'rgba(100,116,139,0.7)';

      isopycnalLevels.forEach(sigma => {
        ctx.beginPath();
        let first = true;
        const steps = 30;
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i <= steps; i++) {
          const S = salMinVal + (i / steps) * (salMaxVal - salMinVal);
          const T = solveTemp(S, sigma);
          if (T >= tempMinVal && T <= tempMaxVal) {
            const px = plotX + ((S - salMinVal) / (salMaxVal - salMinVal)) * plotW;
            const py = plotY + (1 - (T - tempMinVal) / (tempMaxVal - tempMinVal)) * plotH;
            if (first) {
              ctx.moveTo(px, py);
              first = false;
            } else {
              ctx.lineTo(px, py);
            }
            pts.push({ x: px, y: py });
          }
        }
        ctx.stroke();

        if (pts.length > 5) {
          const labelPt = pts[Math.floor(pts.length * 0.75)];
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#64748b';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.5 * dpr;
          ctx.strokeText(`σθ = ${sigma.toFixed(1)}`, labelPt.x, labelPt.y);
          ctx.fillText(`σθ = ${sigma.toFixed(1)}`, labelPt.x, labelPt.y);
          ctx.restore();
        }
      });
      ctx.restore();

      // Draw custom water masses
      tsPubWaterMasses.forEach(wm => {
        ctx.save();
        ctx.strokeStyle = wm.color || '#000000';
        ctx.lineWidth = 1.2 * dpr;
        if (wm.borderStyle === 'dashed') {
          ctx.setLineDash([4 * dpr, 3 * dpr]);
        } else {
          ctx.setLineDash([]);
        }

        if (wm.polygonPoints && wm.polygonPoints.length > 2) {
          // Draw Polygon
          ctx.beginPath();
          wm.polygonPoints.forEach((pt, idx) => {
            const px = plotX + ((pt.s - salMinVal) / (salMaxVal - salMinVal)) * plotW;
            const py = plotY + (1 - (pt.t - tempMinVal) / (tempMaxVal - tempMinVal)) * plotH;
            if (idx === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.closePath();
          ctx.stroke();

          // Fill polygon with a very light background (approx 8% opacity)
          const fillHex = (wm.color && wm.color.startsWith('#') && wm.color.length === 7) ? wm.color + '15' : 'rgba(0, 0, 0, 0.05)';
          ctx.fillStyle = fillHex;
          ctx.fill();

          // Compute Centroid for Label
          let sumX = 0;
          let sumY = 0;
          wm.polygonPoints.forEach(pt => {
            sumX += plotX + ((pt.s - salMinVal) / (salMaxVal - salMinVal)) * plotW;
            sumY += plotY + (1 - (pt.t - tempMinVal) / (tempMaxVal - tempMinVal)) * plotH;
          });
          const cx = sumX / wm.polygonPoints.length;
          const cy = sumY / wm.polygonPoints.length;

          ctx.fillStyle = wm.color || '#000000';
          ctx.font = `bold ${10 * dpr}px ${fontFamily}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(wm.name, cx, cy);
        } else {
          // Fallback to traditional box
          if (wm.sMax <= salMinVal || wm.sMin >= salMaxVal || wm.tMax <= tempMinVal || wm.tMin >= tempMaxVal) {
            ctx.restore();
            return;
          }
          const x1 = plotX + ((Math.max(wm.sMin, salMinVal) - salMinVal) / (salMaxVal - salMinVal)) * plotW;
          const x2 = plotX + ((Math.min(wm.sMax, salMaxVal) - salMinVal) / (salMaxVal - salMinVal)) * plotW;
          const y1 = plotY + (1 - (Math.max(wm.tMin, tempMinVal) - tempMinVal) / (tempMaxVal - tempMinVal)) * plotH;
          const y2 = plotY + (1 - (Math.min(wm.tMax, tempMaxVal) - tempMinVal) / (tempMaxVal - tempMinVal)) * plotH;

          ctx.strokeRect(x1, y2, x2 - x1, y1 - y2);

          // Fill box with a light background
          const fillHex = (wm.color && wm.color.startsWith('#') && wm.color.length === 7) ? wm.color + '15' : 'rgba(0, 0, 0, 0.05)';
          ctx.fillStyle = fillHex;
          ctx.fillRect(x1, y2, x2 - x1, y1 - y2);

          ctx.fillStyle = wm.color || '#000000';
          ctx.font = `bold ${10 * dpr}px ${fontFamily}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(wm.name, (x1 + x2) / 2, (y1 + y2) / 2);
        }
        ctx.restore();
      });

      // Draw Scatter Points
      const getStationNumber = (stationName: string): number => {
        const num = parseInt(stationName.replace(/[^0-9]/g, ''), 10);
        return isNaN(num) ? 0 : num;
      };

      const stationLonMap = new Map<string, number>();
      hydroSamples.forEach(h => {
        if (!stationLonMap.has(h.station)) {
          stationLonMap.set(h.station, h.longitude);
        }
      });

      const stationNumbers = tsData.map(d => getStationNumber(d.station));
      const minStation = stationNumbers.length > 0 ? Math.min(...stationNumbers) : 0;
      const maxStation = stationNumbers.length > 0 ? Math.max(...stationNumbers) : 1;

      const lons = tsData.map(d => stationLonMap.get(d.station) ?? 0);
      const minLon = lons.length > 0 ? Math.min(...lons) : 0;
      const maxLon = lons.length > 0 ? Math.max(...lons) : 1;

      tsData.forEach(d => {
        if (d.salinity < salMinVal || d.salinity > salMaxVal || d.temperature < tempMinVal || d.temperature > tempMaxVal) return;

        const px = plotX + ((d.salinity - salMinVal) / (salMaxVal - salMinVal)) * plotW;
        const py = plotY + (1 - (d.temperature - tempMinVal) / (tempMaxVal - tempMinVal)) * plotH;

        let ptColor = '#ea580c';
        if (tsPubColorMode === 'depth-gradient') {
          const pct = d.depth / depthMaxVal;
          const [r, g, b] = getColormapColor(pct);
          ptColor = `rgb(${r},${g},${b})`;
        } else if (tsPubColorMode === 'station-gradient') {
          const val = getStationNumber(d.station);
          const pct = (val - minStation) / (maxStation - minStation || 1);
          const [r, g, b] = getColormapColor(pct);
          ptColor = `rgb(${r},${g},${b})`;
        } else if (tsPubColorMode === 'longitude-gradient') {
          const ptLon = stationLonMap.get(d.station) ?? 0;
          const pct = (ptLon - minLon) / (maxLon - minLon || 1);
          const [r, g, b] = getColormapColor(pct);
          ptColor = `rgb(${r},${g},${b})`;
        } else if (tsPubColorMode === 'depth-group') {
          if (d.depth < 200) ptColor = '#ea580c';
          else if (d.depth <= 1000) ptColor = '#059669';
          else ptColor = '#1d4ed8';
        } else if (tsPubColorMode === 'station') {
          let hash = 0;
          for (let i = 0; i < d.station.length; i++) {
            hash = d.station.charCodeAt(i) + ((hash << 5) - hash);
          }
          const hue = Math.abs(hash % 360);
          ptColor = `hsl(${hue}, 70%, 45%)`;
        } else {
          ptColor = '#475569';
        }

        ctx.beginPath();
        ctx.arc(px, py, 3.2 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = ptColor;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 0.5 * dpr;
        ctx.stroke();
      });

      // T-S Axis Labels & Ticks
      ctx.fillStyle = '#000000';
      ctx.font = `bold ${11 * dpr}px ${fontFamily}`;
      ctx.textAlign = 'center';
      ctx.fillText('Practical Salinity (psu)', plotX + plotW / 2, canvasH - 24 * dpr);

      ctx.save();
      ctx.translate(22 * dpr, plotY + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('Potential Temperature (θ, °C)', 0, 0);
      ctx.restore();

      ctx.font = `${9 * dpr}px ${fontFamily}`;
      ctx.textAlign = 'center';
      const tickCountX = 6;
      for (let i = 0; i <= tickCountX; i++) {
        const val = salMinVal + (i / tickCountX) * (salMaxVal - salMinVal);
        const px = plotX + (i / tickCountX) * plotW;

        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.moveTo(px, plotY + plotH);
        ctx.lineTo(px, plotY + plotH - 4 * dpr);
        ctx.stroke();

        ctx.fillText(val.toFixed(2), px, plotY + plotH + 13 * dpr);
      }

      ctx.textAlign = 'right';
      const tickCountY = 5;
      for (let i = 0; i <= tickCountY; i++) {
        const val = tempMinVal + (i / tickCountY) * (tempMaxVal - tempMinVal);
        const py = plotY + plotH - (i / tickCountY) * plotH;

        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.moveTo(plotX, py);
        ctx.lineTo(plotX + 4 * dpr, py);
        ctx.stroke();

        ctx.fillText(val.toFixed(1), plotX - 6 * dpr, py + 3 * dpr);
      }

      if (tsPubLayout === 'combined-side') {
        ctx.fillStyle = '#000000';
        ctx.font = `bold ${14 * dpr}px ${fontFamily}`;
        ctx.textAlign = 'left';
        ctx.fillText('(a)', plotX, plotY - 14 * dpr);
      }

      // T-S Continuous Colorbar
      if (
        tsPubColorMode === 'depth-gradient' ||
        tsPubColorMode === 'station-gradient' ||
        tsPubColorMode === 'longitude-gradient'
      ) {
        const cbW = 12 * dpr;
        const cbH = plotH;
        const cbX = plotX + plotW + 15 * dpr;
        const cbY = plotY;

        for (let i = 0; i < cbH; i++) {
          const pct = 1 - i / (cbH - 1);
          const [r, g, b] = getColormapColor(pct);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(cbX, cbY + i, cbW, 1);
        }

        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 0.8 * dpr;
        ctx.strokeRect(cbX, cbY, cbW, cbH);

        ctx.fillStyle = '#000000';
        ctx.font = `${9 * dpr}px ${fontFamily}`;
        ctx.textAlign = 'left';
        const cbTicks = 5;

        let cbMin = 0;
        let cbMax = depthMaxVal;
        let cbLabel = 'Depth (m)';

        if (tsPubColorMode === 'station-gradient') {
          cbMin = minStation;
          cbMax = maxStation;
          cbLabel = 'Station Number';
        } else if (tsPubColorMode === 'longitude-gradient') {
          cbMin = minLon;
          cbMax = maxLon;
          cbLabel = 'Longitude (°E)';
        }

        for (let i = 0; i <= cbTicks; i++) {
          const val = cbMin + (i / cbTicks) * (cbMax - cbMin);
          const py = cbY + cbH - (i / cbTicks) * cbH;

          ctx.beginPath();
          ctx.moveTo(cbX + cbW, py);
          ctx.lineTo(cbX + cbW + 3 * dpr, py);
          ctx.strokeStyle = '#000000';
          ctx.stroke();

          const formatVal = tsPubColorMode === 'longitude-gradient' ? val.toFixed(1) : Math.round(val).toString();
          ctx.fillText(formatVal, cbX + cbW + 6 * dpr, py + 3 * dpr);
        }

        ctx.save();
        ctx.translate(cbX + cbW + 32 * dpr, cbY + cbH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.font = `bold ${9.5 * dpr}px ${fontFamily}`;
        ctx.textAlign = 'center';
        ctx.fillText(cbLabel, 0, 0);
        ctx.restore();
      }
    }

    if (tsPubLayout === 'single-section' || tsPubLayout === 'combined-side') {
      const isCombined = tsPubLayout === 'combined-side';
      const marginLeft = isCombined ? 600 * dpr : 80 * dpr;
      const plotW = (isCombined ? 380 : 450) * dpr;
      const plotX = marginLeft;
      const plotY = marginTop;

      if (sectionData.length > 0 && sectionGridInfo) {
        const {
          xKey,
          valKey,
          xMin,
          xMax,
          valMin,
          valMax,
          valRange,
          gridCols,
          gridRows,
          gridData,
          cellMask,
          stationDepths,
          smoothedGridData
        } = sectionGridInfo;

        const getValColor = (v: number): [number, number, number] => {
          if (valKey === 'delta_tracer') {
            return getDivergentColor(v, valMin, valMax);
          }
          const t = (v - valMin) / valRange;
          return getColormapColor(t);
        };

        const cellW = plotW / gridCols;
        const cellH = plotH / gridRows;

        // 2. Draw Initial Colored Grid background
        ctx.save();
        ctx.beginPath();
        ctx.rect(plotX, plotY, plotW, plotH);
        ctx.clip();

        for (let row = 0; row < gridRows; row++) {
          for (let col = 0; col < gridCols; col++) {
            const mask = cellMask[row * gridCols + col];
            if (mask === 1) {
              ctx.fillStyle = '#f1f5f9';
            } else if (mask === 2) {
              ctx.fillStyle = '#ffffff';
            } else {
              const interpVal = gridData[row * gridCols + col];
              const [r, g, b] = getValColor(interpVal);
              ctx.fillStyle = `rgb(${r},${g},${b})`;
            }
            ctx.fillRect(plotX + col * cellW, plotY + row * cellH, cellW + 0.5, cellH + 0.5);
          }
        }

        // 3. Draw Contour lines using d3-contour
        let contourStep = 0.5;
        if (tsSectionParam === 'temperature' || tsSectionParam === 'salinity') {
          const rawStep = valRange / 12; // target around 12 major bands
          if (rawStep < 0.05) contourStep = 0.02;
          else if (rawStep < 0.1) contourStep = 0.05;
          else if (rawStep < 0.25) contourStep = 0.1;
          else if (rawStep < 0.5) contourStep = 0.25;
          else if (rawStep < 1.0) contourStep = 0.5;
          else if (rawStep < 2.0) contourStep = 1.0;
          else if (rawStep < 5.0) contourStep = 2.0;
          else contourStep = 5.0;
        } else if (tsSectionParam === 'delta_tracer') {
          const absMax = Math.max(Math.abs(valMin), Math.abs(valMax)) || 1;
          const rawStep = absMax / 5;
          if (rawStep < 0.1) contourStep = 0.05;
          else if (rawStep < 0.2) contourStep = 0.1;
          else if (rawStep < 0.5) contourStep = 0.2;
          else if (rawStep < 1) contourStep = 0.5;
          else if (rawStep < 2) contourStep = 1;
          else if (rawStep < 5) contourStep = 2;
          else if (rawStep < 10) contourStep = 5;
          else contourStep = 10;
        }
        const startVal = Math.ceil(valMin / contourStep) * contourStep;
        const thresholds: number[] = [];
        for (let v = startVal; v <= valMax; v += contourStep) {
          thresholds.push(v);
        }

        try {
          const contourGenerator = contours()
            .size([gridCols, gridRows])
            .thresholds(thresholds);
          const contourPolygons = contourGenerator(Array.from(smoothedGridData));

          ctx.save();
          ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.lineWidth = 0.8 * dpr;

          const placedLabels: { x: number; y: number }[] = [];

          contourPolygons.forEach(polygon => {
            const val = polygon.value;
            polygon.coordinates.forEach(ring => {
              ring.forEach(coords => {
                ctx.beginPath();
                coords.forEach((pt, idx) => {
                  const gx = pt[0];
                  const gy = pt[1];
                  const px = plotX + (gx / (gridCols - 1)) * plotW;
                  const py = plotY + (gy / (gridRows - 1)) * plotH;
                  if (idx === 0) ctx.moveTo(px, py);
                  else ctx.lineTo(px, py);
                });
                ctx.stroke();

                if (coords.length > 35) {
                  const labelIdx = Math.floor(coords.length * 0.45);
                  const labelPt = coords[labelIdx];
                  const gridX = labelPt[0];
                  const gridY = labelPt[1];

                  // Filter out labels that are too close to the borders of the plot
                  if (gridX < 5 || gridX > gridCols - 6 || gridY < 4 || gridY > gridRows - 5) {
                    return;
                  }

                  const lx = plotX + (gridX / (gridCols - 1)) * plotW;
                  const ly = plotY + (gridY / (gridRows - 1)) * plotH;
                  
                  // Check if label coordinates are inside masked regions
                  const cCol = Math.max(0, Math.min(gridCols - 1, Math.floor(gridX)));
                  const cRow = Math.max(0, Math.min(gridRows - 1, Math.floor(gridY)));
                  if (cellMask[cRow * gridCols + cCol] === 0) {
                    // Prevent overlapping labels
                    const isOverlap = placedLabels.some(l => Math.hypot(lx - l.x, ly - l.y) < 45 * dpr);
                    if (isOverlap) return;
                    placedLabels.push({ x: lx, y: ly });

                    if (tsPubShowContourLabels) {
                      ctx.save();
                      ctx.font = `600 ${8 * dpr}px ${fontFamily}`;
                      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
                      ctx.textAlign = 'center';
                      ctx.textBaseline = 'middle';
                      ctx.fillText(val.toFixed(1), lx, ly);
                      ctx.restore();
                    }
                  }
                }
              });
            });
          });
          ctx.restore();
        } catch (err) {
          console.error('Contour rendering failed:', err);
        }

        // 4. Overpaint masked areas (seabed and distance voids) to cover contour lines
        for (let row = 0; row < gridRows; row++) {
          for (let col = 0; col < gridCols; col++) {
            const mask = cellMask[row * gridCols + col];
            if (mask === 1) {
              ctx.fillStyle = '#f1f5f9'; // Seabed floor
              ctx.fillRect(plotX + col * cellW, plotY + row * cellH, cellW + 0.5, cellH + 0.5);
            } else if (mask === 2) {
              ctx.fillStyle = '#ffffff'; // Data gap void
              ctx.fillRect(plotX + col * cellW, plotY + row * cellH, cellW + 0.5, cellH + 0.5);
            }
          }
        }

        // 5. Draw dashed vertical station track lines (Casts)
        stationDepths.forEach(s => {
          if (s.x < xMin || s.x > xMax) return;
          const px = plotX + ((s.x - xMin) / (xMax - xMin || 1)) * plotW;
          const pyMax = plotY + (Math.min(s.botDepth, depthMaxVal) / depthMaxVal) * plotH;

          ctx.save();
          ctx.strokeStyle = 'rgba(100, 116, 139, 0.4)'; // soft grey
          ctx.lineWidth = 0.8 * dpr;
          ctx.setLineDash([3 * dpr, 3 * dpr]);
          ctx.beginPath();
          ctx.moveTo(px, plotY);
          ctx.lineTo(px, pyMax);
          ctx.stroke();
          ctx.restore();
        });

        // Helper to project a longitude/latitude coordinate to cumulative track distance
        const getProjectedX = (valX: number) => {
          if (tsSectionAxis !== 'distance') return valX;
          if (sectionData.length === 0) return 0;
          
          const lons = sectionData.map(d => d.longitude);
          const lats = sectionData.map(d => d.latitude);
          const lonSpan = Math.max(...lons) - Math.min(...lons);
          const latSpan = Math.max(...lats) - Math.min(...lats);
          const isLon = lonSpan >= latSpan;

          // Find the unique stations along the track and their mapped distances
          const coordsWithDist: { coord: number; dist: number }[] = [];
          const seen = new Set<string>();
          sectionData.forEach(d => {
            const coord = isLon ? d.longitude : d.latitude;
            const key = `${coord}-${d.distance}`;
            if (!seen.has(key)) {
              seen.add(key);
              coordsWithDist.push({ coord, dist: d.distance });
            }
          });
          coordsWithDist.sort((a, b) => a.coord - b.coord);

          if (coordsWithDist.length === 0) return 0;
          if (valX <= coordsWithDist[0].coord) return coordsWithDist[0].dist;
          if (valX >= coordsWithDist[coordsWithDist.length - 1].coord) return coordsWithDist[coordsWithDist.length - 1].dist;

          for (let i = 0; i < coordsWithDist.length - 1; i++) {
            const p1 = coordsWithDist[i];
            const p2 = coordsWithDist[i + 1];
            if (valX >= p1.coord && valX <= p2.coord) {
              const pct = (valX - p1.coord) / (p2.coord - p1.coord || 1);
              return p1.dist + pct * (p2.dist - p1.dist);
            }
          }
          return 0;
        };

        // Draw measurement points with thin-out filter and smaller size to prevent cluttered blobs
        const lastDrawnYByStation: { [station: string]: number } = {};
        sectionData.forEach(d => {
          if (d.depth > depthMaxVal) return;
          const px = plotX + (((d as any)[xKey] - xMin) / (xMax - xMin || 1)) * plotW;
          const py = plotY + (d.depth / depthMaxVal) * plotH;

          // Thin out dots: skip if another dot was drawn within 7px vertically on the same station cast
          const lastY = lastDrawnYByStation[d.station];
          if (lastY !== undefined && Math.abs(py - lastY) < 7 * dpr) {
            return;
          }
          lastDrawnYByStation[d.station] = py;

          ctx.beginPath();
          ctx.arc(px, py, 1.5 * dpr, 0, Math.PI * 2); // smaller radius (1.5 instead of 2.5)
          ctx.fillStyle = 'rgba(255,255,255,0.7)'; // semi-transparent
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.4)';
          ctx.lineWidth = 0.4 * dpr;
          ctx.stroke();
        });

        ctx.restore(); // Restore from grid/contour clipping

        tsPubAnnotations.forEach(ann => {
          const projX = getProjectedX(ann.x);
          if (projX < xMin || projX > xMax || ann.depth > depthMaxVal) return;
          const px = plotX + ((projX - xMin) / (xMax - xMin || 1)) * plotW;
          const py = plotY + (ann.depth / depthMaxVal) * plotH;

          ctx.save();
          ctx.fillStyle = ann.color || '#000000';
          ctx.font = `italic bold ${ann.fontSize * dpr}px ${fontFamily}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.5 * dpr;
          ctx.strokeText(ann.text, px, py);
          ctx.fillText(ann.text, px, py);
          ctx.restore();
        });

        // Draw Large Dynamics Annotations for the South Indian Ocean Transect
        if (tsSectionAxis === 'longitude' && xMin < 50 && xMax > 100) {
          const getWaterMassCentroid = (
            wm: typeof tsPubWaterMasses[0],
            minDepth: number = 0,
            maxDepth: number = depthMaxVal,
            minTemp?: number,
            maxTemp?: number
          ) => {
            let sumX = 0;
            let sumDepth = 0;
            let count = 0;

            sectionData.forEach(d => {
              if (d.depth >= minDepth && d.depth <= maxDepth) {
                const tMin = minTemp !== undefined ? minTemp : wm.tMin;
                const tMax = maxTemp !== undefined ? maxTemp : wm.tMax;
                if (
                  d.temperature >= tMin &&
                  d.temperature <= tMax &&
                  d.salinity >= wm.sMin &&
                  d.salinity <= wm.sMax
                ) {
                  sumX += (d as any)[xKey];
                  sumDepth += d.depth;
                  count++;
                }
              }
            });

            if (count >= 3) {
              return { x: sumX / count, depth: sumDepth / count };
            }
            return null;
          };

          const stuwWm = tsPubWaterMasses.find(w => w.id.toLowerCase() === 'stuw' || w.name.toUpperCase().includes('STUW'));
          const aaiwWm = tsPubWaterMasses.find(w => w.id.toLowerCase() === 'aaiw' || w.name.toUpperCase().includes('AAIW'));

          if (tsPubShowWaterMassLabels) {
            if (stuwWm) {
              // Constrain STUW calculation to the shallow subsurface layer (< 250m)
              const centroid = getWaterMassCentroid(stuwWm, 0, 250);
              if (centroid && centroid.x >= xMin && centroid.x <= xMax && centroid.depth <= depthMaxVal) {
                const px = plotX + ((centroid.x - xMin) / (xMax - xMin || 1)) * plotW;
                // Place STUW slightly deeper (140m minimum) to vertically stack with Leeuwin Current Inflow
                const py = plotY + (Math.max(140, centroid.depth) / depthMaxVal) * plotH;
                const labelText = stuwWm.name.includes('SSW')
                  ? 'Subtropical Surface/Subsurface Water (SSW/STUW)'
                  : 'Subtropical Subsurface Water (STUW)';

                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.font = `italic bold ${10.5 * dpr}px ${fontFamily}`;
                ctx.fillStyle = '#000000'; // Pure Bold Black

                const textWidth = ctx.measureText(labelText).width;
                let adjustedPx = px;
                if (px + textWidth / 2 > plotX + plotW - 6 * dpr) {
                  adjustedPx = plotX + plotW - textWidth / 2 - 6 * dpr;
                }
                if (adjustedPx - textWidth / 2 < plotX + 6 * dpr) {
                  adjustedPx = plotX + textWidth / 2 + 6 * dpr;
                }

                ctx.fillText(labelText, adjustedPx, py);
                ctx.restore();
              }
            }

            // Draw Leeuwin Current Inflow separately: narrow boundary current at Australia's west coast (~115°E), shallow (<150m)
            const lcPoints = sectionData.filter(d => d.longitude >= 110 && d.depth <= 150);
            if (lcPoints.length >= 2) {
              const sumX = lcPoints.reduce((sum, d) => sum + (d as any)[xKey], 0);
              const sumDepth = lcPoints.reduce((sum, d) => sum + d.depth, 0);
              const lcCentroid = { x: sumX / lcPoints.length, depth: sumDepth / lcPoints.length };

              if (lcCentroid.x >= xMin && lcCentroid.x <= xMax && lcCentroid.depth <= depthMaxVal) {
                const px = plotX + ((lcCentroid.x - xMin) / (xMax - xMin || 1)) * plotW;
                // Place Leeuwin Current Inflow shallower (60m minimum)
                const py = plotY + (Math.max(60, lcCentroid.depth) / depthMaxVal) * plotH;
                const labelText = 'Leeuwin Current Inflow';

                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.font = `italic bold ${10.5 * dpr}px ${fontFamily}`;
                ctx.fillStyle = '#000000'; // Pure Bold Black

                const textWidth = ctx.measureText(labelText).width;
                let adjustedPx = px;
                if (px + textWidth / 2 > plotX + plotW - 6 * dpr) {
                  adjustedPx = plotX + plotW - textWidth / 2 - 6 * dpr;
                }
                if (adjustedPx - textWidth / 2 < plotX + 6 * dpr) {
                  adjustedPx = plotX + textWidth / 2 + 6 * dpr;
                }

                ctx.fillText(labelText, adjustedPx, py);
                ctx.restore();
              }
            }

            if (aaiwWm) {
              // Constrain AAIW calculation to the deep intermediate layer (800m - 1200m) and its physical temperature core (3.0°C - 6.5°C)
              const centroid = getWaterMassCentroid(aaiwWm, 800, 1200, 3.0, 6.5);
              if (centroid && centroid.x >= xMin && centroid.x <= xMax && centroid.depth <= depthMaxVal) {
                const px = plotX + ((centroid.x - xMin) / (xMax - xMin || 1)) * plotW;
                const py = plotY + (centroid.depth / depthMaxVal) * plotH;
                const labelText = 'Antarctic Intermediate Water (AAIW)';

                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.font = `italic bold ${10.5 * dpr}px ${fontFamily}`;
                ctx.fillStyle = '#000000'; // Pure Bold Black

                const textWidth = ctx.measureText(labelText).width;
                let adjustedPx = px;
                if (px + textWidth / 2 > plotX + plotW - 6 * dpr) {
                  adjustedPx = plotX + plotW - textWidth / 2 - 6 * dpr;
                }
                if (adjustedPx - textWidth / 2 < plotX + 6 * dpr) {
                  adjustedPx = plotX + textWidth / 2 + 6 * dpr;
                }

                ctx.fillText(labelText, adjustedPx, py);
                ctx.restore();
              }
            }
          }
        }

        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5 * dpr;
        ctx.strokeRect(plotX, plotY, plotW, plotH);

        ctx.fillStyle = '#000000';
        ctx.font = `bold ${11 * dpr}px ${fontFamily}`;
        ctx.textAlign = 'center';
        
        const axisLabel = tsSectionAxis === 'distance'
          ? 'Distance along track (km)'
          : (tsSectionAxis === 'longitude' ? 'Longitude' : 'Latitude');
        ctx.fillText(axisLabel, plotX + plotW / 2, canvasH - 24 * dpr);

        ctx.font = `${9 * dpr}px ${fontFamily}`;
        const tickCountSecX = 6;
        for (let i = 0; i <= tickCountSecX; i++) {
          const val = xMin + (i / tickCountSecX) * (xMax - xMin);
          const px = plotX + (i / tickCountSecX) * plotW;

          ctx.beginPath();
          ctx.moveTo(px, plotY + plotH);
          ctx.lineTo(px, plotY + plotH - 4 * dpr);
          ctx.stroke();

          let label = '';
          if (tsSectionAxis === 'distance') {
            label = `${val.toFixed(1)} km`;
          } else if (tsSectionAxis === 'longitude') {
            label = val >= 0 ? `${val.toFixed(1)}°E` : `${Math.abs(val).toFixed(1)}°W`;
          } else {
            label = val >= 0 ? `${val.toFixed(1)}°N` : `${Math.abs(val).toFixed(1)}°S`;
          }

          ctx.fillText(label, px, plotY + plotH + 13 * dpr);
        }

        ctx.textAlign = 'right';
        const tickCountSecY = 5;
        for (let i = 0; i <= tickCountSecY; i++) {
          const val = (i / tickCountSecY) * depthMaxVal;
          const py = plotY + (i / tickCountSecY) * plotH;

          ctx.beginPath();
          ctx.moveTo(plotX, py);
          ctx.lineTo(plotX + 4 * dpr, py);
          ctx.stroke();

          ctx.fillText(`${Math.round(val)}`, plotX - 6 * dpr, py + 3 * dpr);
        }

        ctx.save();
        ctx.translate(plotX - (isCombined ? 36 : 42) * dpr, plotY + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText('Depth (m)', 0, 0);
        ctx.restore();

        if (isCombined) {
          ctx.fillStyle = '#000000';
          ctx.font = `bold ${14 * dpr}px ${fontFamily}`;
          ctx.textAlign = 'left';
          ctx.fillText('(b)', plotX, plotY - 14 * dpr);
        }

        const cbW = 12 * dpr;
        const cbH = plotH;
        const cbX = plotX + plotW + 15 * dpr;
        const cbY = plotY;

        for (let i = 0; i < cbH; i++) {
          const pct = 1 - i / (cbH - 1);
          let r = 0, g = 0, b = 0;
          if (tsSectionParam === 'delta_tracer') {
            const val = valMin + pct * valRange;
            [r, g, b] = getDivergentColor(val, valMin, valMax);
          } else {
            [r, g, b] = getColormapColor(pct);
          }
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(cbX, cbY + i, cbW, 1);
        }

        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 0.8 * dpr;
        ctx.strokeRect(cbX, cbY, cbW, cbH);

        ctx.fillStyle = '#000000';
        ctx.font = `${9 * dpr}px ${fontFamily}`;
        ctx.textAlign = 'left';
        const cbTicks = 5;
        for (let i = 0; i <= cbTicks; i++) {
          const val = valMin + (i / cbTicks) * valRange;
          const py = cbY + cbH - (i / cbTicks) * cbH;

          ctx.beginPath();
          ctx.moveTo(cbX + cbW, py);
          ctx.lineTo(cbX + cbW + 3 * dpr, py);
          ctx.stroke();

          ctx.fillText(val.toFixed(2), cbX + cbW + 6 * dpr, py + 3 * dpr);
        }

        ctx.save();
        ctx.translate(cbX + cbW + 42 * dpr, cbY + cbH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.font = `bold ${9.5 * dpr}px ${fontFamily}`;
        ctx.textAlign = 'center';
        ctx.fillText(
          tsSectionParam === 'temperature'
            ? 'Temperature (°C)'
            : tsSectionParam === 'salinity'
              ? 'Salinity (psu)'
              : `Δ${selectedOmpTracer} (anomaly)`,
          0,
          0
        );
        ctx.restore();
      }
    }
  };

  const LiveStudioPreview = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const updateSize = () => {
        const targetW = tsPubLayout === 'combined-side' ? 1080 : 640;
        canvas.style.width = '100%';
        canvas.style.maxWidth = targetW + 'px';
        canvas.style.height = 'auto';

        drawStudioCanvas(canvas, 2);
      };

      updateSize();
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }, [
      tsPubLayout, tsPubSalMin, tsPubSalMax, tsPubTempMin, tsPubTempMax, tsPubDepthMax,
      tsPubColorMode, tsPubWaterMasses, tsPubAnnotations, tsPubGridlines, tsPubFont,
      tsSectionParam, tsSectionAxis, sectionData, enableOmp, selectedOmpTracer, ompEndmembers,
      tsPubColormap, sectionGridInfo
    ]);

    return (
      <div ref={containerRef} style={{ width: '100%', display: 'flex', justifyContent: 'center', background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0', overflowX: 'auto' }}>
        <canvas ref={canvasRef} style={{ background: '#ffffff', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)', display: 'block' }} />
      </div>
    );
  };

  const applyPreset = (presetName: 'antarctic' | 'indian' | 'custom') => {
    setTsPubPreset(presetName);
    if (presetName === 'antarctic') {
      setTsPubSalMin('33.5');
      setTsPubSalMax('34.8');
      setTsPubTempMin('-2.0');
      setTsPubTempMax('2.5');
      setTsPubDepthMax('800');
      setTsPubWaterMasses([
        {
          id: 'ww',
          name: 'WW',
          sMin: 33.5,
          sMax: 34.25,
          tMin: -1.9,
          tMax: -0.8,
          color: '#000000',
          borderStyle: 'solid',
          polygonPoints: [
            { s: 33.5, t: -1.8 },
            { s: 34.0, t: -1.8 },
            { s: 34.25, t: -1.6 },
            { s: 34.25, t: -1.0 },
            { s: 34.0, t: -0.8 },
            { s: 33.5, t: -0.8 }
          ]
        },
        { id: 'tww', name: 'TWW', sMin: 34.25, sMax: 34.6, tMin: -1.9, tMax: -0.8, color: '#000000', borderStyle: 'solid' },
        { id: 'tbw', name: 'TBW', sMin: 34.1, sMax: 34.5, tMin: -0.2, tMax: 2.2, color: '#000000', borderStyle: 'solid' },
        {
          id: 'cdw',
          name: 'CDW',
          sMin: 34.5,
          sMax: 34.75,
          tMin: -0.2,
          tMax: 2.2,
          color: '#000000',
          borderStyle: 'solid',
          polygonPoints: [
            { s: 34.5, t: 1.0 },
            { s: 34.65, t: 2.2 },
            { s: 34.75, t: 2.2 },
            { s: 34.75, t: 0.2 },
            { s: 34.5, t: -0.2 }
          ]
        }
      ]);
      setOmpEndmembers([
        { name: 'WW', s: 34.0, t: -1.5, tracerVal: 42 },
        { name: 'TWW', s: 34.4, t: -1.2, tracerVal: 45 },
        { name: 'CDW', s: 34.7, t: 1.0, tracerVal: 38 }
      ]);
      setTsPubAnnotations([
        { id: '1', text: 'Winter water', x: -60.5, depth: 80, color: '#000000', fontSize: 11 },
        { id: '2', text: 'Circumpolar deep water', x: -60.8, depth: 500, color: '#000000', fontSize: 11 },
        { id: '3', text: 'Transitional Weddell water', x: -62.1, depth: 550, color: '#000000', fontSize: 11 }
      ]);
    } else if (presetName === 'indian') {
      setTsPubSalMin('33.0');
      setTsPubSalMax('36.2');
      setTsPubTempMin('0.0');
      setTsPubTempMax('22.0');
      setTsPubDepthMax('1200');
      setTsPubWaterMasses([
        { id: 'stuw', name: 'SSW/STUW', sMin: 35.2, sMax: 35.8, tMin: 15.0, tMax: 22.0, color: '#0284c7', borderStyle: 'dashed' },
        { id: 'samw', name: 'SAMW', sMin: 34.2, sMax: 34.6, tMin: 5.5, tMax: 8.5, color: '#10b981', borderStyle: 'dashed' },
        { id: 'aaiw', name: 'AAIW', sMin: 34.0, sMax: 34.4, tMin: 3.0, tMax: 7.0, color: '#6366f1', borderStyle: 'dashed' },
        { id: 'iiw', name: 'IIW', sMin: 34.4, sMax: 34.65, tMin: 4.5, tMax: 7.5, color: '#a855f7', borderStyle: 'dashed' },
        { id: 'rspgiw', name: 'RSPGIW', sMin: 34.8, sMax: 35.4, tMin: 5.0, tMax: 10.0, color: '#ea580c', borderStyle: 'dashed' },
        { id: 'cdw_nadw', name: 'CDW/NADW', sMin: 34.65, sMax: 34.85, tMin: 1.0, tMax: 2.5, color: '#1d4ed8', borderStyle: 'dashed' }
      ]);
      setOmpEndmembers([
        { name: 'SSW/STUW', s: 35.5, t: 19.5, tracerVal: 75 },
        { name: 'SAMW', s: 34.4, t: 7.0, tracerVal: 55 },
        { name: 'AAIW', s: 34.2, t: 4.5, tracerVal: 48 }
      ]);
      setTsPubAnnotations([
        { id: '1', text: 'Subtropical Surface/Subsurface Water', x: 12.0, depth: 150, color: '#000000', fontSize: 11 },
        { id: '2', text: 'Antarctic Intermediate Water', x: 15.0, depth: 700, color: '#000000', fontSize: 11 },
        { id: '3', text: 'Red Sea-Persian Gulf Int. Water', x: 18.0, depth: 800, color: '#ea580c', fontSize: 11 }
      ]);
    } else {
      setTsPubWaterMasses([]);
      setOmpEndmembers([]);
      setTsPubAnnotations([]);
    }
  };

  const handleExportPNG = () => {
    const tempCanvas = document.createElement('canvas');
    drawStudioCanvas(tempCanvas, tsPubScale);

    const link = document.createElement('a');
    link.download = `TS_Section_Publication_Figure_${tsPubPreset}.png`;
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
  };

  const handleExportCSV = () => {
    if (tsData.length === 0) return;
    const headers = 'Station,Depth (m),Salinity (psu),Potential Temperature (C),DepthGroup\n';
    const rows = tsData.map(d => `${d.station},${d.depth},${d.salinity},${d.temperature},${d.depthGroup}`).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'ts_diagram_data.csv';
    link.click();
  };

  const [newWmName, setNewWmName] = useState('');
  const [newWmSMin, setNewWmSMin] = useState('34.0');
  const [newWmSMax, setNewWmSMax] = useState('34.5');
  const [newWmTMin, setNewWmTMin] = useState('-1.0');
  const [newWmTMax, setNewWmTMax] = useState('1.0');
  const [newWmColor, setNewWmColor] = useState('#000000');

  const [newAnnText, setNewAnnText] = useState('');
  const [newAnnX, setNewAnnX] = useState('-60.0');
  const [newAnnDepth, setNewAnnDepth] = useState('200');

  const addWaterMass = () => {
    if (!newWmName) return;
    const newBox = {
      id: Math.random().toString(),
      name: newWmName,
      sMin: parseFloat(newWmSMin) || 34.0,
      sMax: parseFloat(newWmSMax) || 34.5,
      tMin: parseFloat(newWmTMin) || -1.0,
      tMax: parseFloat(newWmTMax) || 1.0,
      color: newWmColor,
      borderStyle: 'solid' as const
    };
    setTsPubWaterMasses([...tsPubWaterMasses, newBox]);
    setNewWmName('');
  };

  const addAnnotation = () => {
    if (!newAnnText) return;
    const newAnn = {
      id: Math.random().toString(),
      text: newAnnText,
      x: parseFloat(newAnnX) || -60.0,
      depth: parseFloat(newAnnDepth) || 200,
      color: '#000000',
      fontSize: 11
    };
    setTsPubAnnotations([...tsPubAnnotations, newAnn]);
    setNewAnnText('');
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', gap: '24px', alignItems: 'start' }}>
      {/* Left Controls Panel */}
      <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', margin: 0, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px' }}>
          <div style={{ width: '4px', height: '18px', background: '#0ea5e9', borderRadius: '2px' }} />
          <h4 style={{ fontSize: '15px', fontWeight: 'bold', margin: 0, color: '#0f172a' }}>发表级出图工作室</h4>
        </div>

        {/* Layout options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>图表布局 (Layout)</label>
          <select
            value={tsPubLayout}
            onChange={e => setTsPubLayout(e.target.value as any)}
            style={{ width: '100%', padding: '6px 10px', fontSize: '12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
          >
            <option value="combined-side">T-S 散点 + 深度断面 左右组合 (a) + (b)</option>
            <option value="single-ts">仅 T-S 散点图</option>
            <option value="single-section">仅 深度断面分布图</option>
          </select>
        </div>

        {/* Presets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>经典海洋学水团方案预设 (Presets)</label>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={() => applyPreset('antarctic')}
              style={{
                flex: 1, padding: '6px 4px', fontSize: '11px', fontWeight: 'bold', borderRadius: '6px',
                background: tsPubPreset === 'antarctic' ? '#0ea5e9' : '#f1f5f9',
                color: tsPubPreset === 'antarctic' ? '#ffffff' : '#475569',
                border: 'none', cursor: 'pointer', transition: 'all 0.2s'
              }}
            >威德尔海(WW/CDW)</button>
            <button
              onClick={() => applyPreset('indian')}
              style={{
                flex: 1, padding: '6px 4px', fontSize: '11px', fontWeight: 'bold', borderRadius: '6px',
                background: tsPubPreset === 'indian' ? '#0ea5e9' : '#f1f5f9',
                color: tsPubPreset === 'indian' ? '#ffffff' : '#475569',
                border: 'none', cursor: 'pointer', transition: 'all 0.2s'
              }}
            >印度洋(SAMW/AAIW)</button>
            <button
              onClick={() => applyPreset('custom')}
              style={{
                flex: 1, padding: '6px 4px', fontSize: '11px', fontWeight: 'bold', borderRadius: '6px',
                background: tsPubPreset === 'custom' ? '#0ea5e9' : '#f1f5f9',
                color: tsPubPreset === 'custom' ? '#ffffff' : '#475569',
                border: 'none', cursor: 'pointer', transition: 'all 0.2s'
              }}
            >自定义清空</button>
          </div>
        </div>

        {/* T-S plot parameters */}
        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>T-S 散点图轴线限制 (Axes Limits)</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '10px', color: '#64748b' }}>盐度下限 (S Min)</label>
              <input
                type="number" step="0.1" value={tsPubSalMin} onChange={e => setTsPubSalMin(e.target.value)}
                style={{ width: '100%', padding: '4px 8px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '10px', color: '#64748b' }}>盐度上限 (S Max)</label>
              <input
                type="number" step="0.1" value={tsPubSalMax} onChange={e => setTsPubSalMax(e.target.value)}
                style={{ width: '100%', padding: '4px 8px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '10px', color: '#64748b' }}>温度下限 (T Min)</label>
              <input
                type="number" step="0.5" value={tsPubTempMin} onChange={e => setTsPubTempMin(e.target.value)}
                style={{ width: '100%', padding: '4px 8px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '10px', color: '#64748b' }}>温度上限 (T Max)</label>
              <input
                type="number" step="0.5" value={tsPubTempMax} onChange={e => setTsPubTempMax(e.target.value)}
                style={{ width: '100%', padding: '4px 8px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              />
            </div>
          </div>
        </div>

        {/* Scatter Point Styling */}
        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>散点颜色映射模式</label>
          <select
            value={tsPubColorMode}
            onChange={e => setTsPubColorMode(e.target.value as any)}
            style={{ width: '100%', padding: '6px 10px', fontSize: '11px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
          >
            <option value="depth-gradient">连续深度渐变 (Depth Gradient)</option>
            <option value="station-gradient">采样站位渐变 (Station Number)</option>
            <option value="longitude-gradient">经度渐变 (Longitude °E)</option>
            <option value="depth-group">表中深三层水分组</option>
            <option value="station">按采样站位区分 (定性 HSL)</option>
            <option value="uniform">学术单色 (深灰色)</option>
          </select>
        </div>

        {/* Colormap Selection */}
        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>等值线与渐变色标 (Colormap)</label>
          <select
            value={tsPubColormap}
            onChange={e => setTsPubColormap(e.target.value as any)}
            style={{ width: '100%', padding: '6px 10px', fontSize: '11px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
          >
            <option value="odv-rainbow">Ocean Rainbow (ODV 经典彩虹色)</option>
            <option value="jet">Classic Jet (标准彩虹色)</option>
            <option value="viridis">Viridis (学术均匀蓝黄绿)</option>
          </select>
        </div>

        {/* Section parameters */}
        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>断面分布设置 (Section Settings)</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '10px', color: '#64748b' }}>断面参数</label>
              <select
                value={tsSectionParam} onChange={e => setTsSectionParam(e.target.value as any)}
                style={{ width: '100%', padding: '4px 6px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              >
                <option value="temperature">温度 (°C)</option>
                <option value="salinity">盐度 (psu)</option>
                {enableOmp && (
                  <option value="delta_tracer">生化残差 Δ{selectedOmpTracer}</option>
                )}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '10px', color: '#64748b' }}>剖面方向</label>
              <select
                value={tsSectionAxis} onChange={e => setTsSectionAxis(e.target.value as any)}
                style={{ width: '100%', padding: '4px 6px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              >
                <option value="longitude">按经向/经度投影</option>
                <option value="latitude">按纬向/纬度投影</option>
                <option value="distance">按测线累计/径向距离</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            <div>
              <label style={{ fontSize: '10px', color: '#64748b' }}>最大深度 (m)</label>
              <input
                type="number" step="100" value={tsPubDepthMax} onChange={e => setTsPubDepthMax(e.target.value)}
                style={{ width: '100%', padding: '4px 8px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '10px', color: '#64748b' }}>水平拉伸度</label>
              <input
                type="number" step="0.01" min="0.01" max="1.0" value={tsSectionHorizStretch} onChange={e => setTsSectionHorizStretch(e.target.value)}
                style={{ width: '100%', padding: '4px 8px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '10px', color: '#64748b' }}>遮罩阈值</label>
              <input
                type="number" step="0.05" min="0.01" max="2.0" value={tsSectionMaskThreshold} onChange={e => setTsSectionMaskThreshold(e.target.value)}
                style={{ width: '100%', padding: '4px 8px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              />
            </div>
          </div>
        </div>

        {/* Styling settings */}
        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>学术排版字体与网格</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '10px', color: '#64748b' }}>字体家族 (Font)</label>
              <select
                value={tsPubFont} onChange={e => setTsPubFont(e.target.value as any)}
                style={{ width: '100%', padding: '4px 6px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              >
                <option value="Arial">Arial (标准英文)</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Helvetica">Helvetica</option>
                <option value="Courier New">Courier New</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '100%', paddingTop: '16px' }}>
              <input
                type="checkbox" id="gridCheckbox" checked={tsPubGridlines} onChange={e => setTsPubGridlines(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="gridCheckbox" style={{ fontSize: '11px', color: '#475569', cursor: 'pointer' }}>显示等密度网格</label>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="checkbox" id="showContourLabelsCheckbox" checked={tsPubShowContourLabels} onChange={e => setTsPubShowContourLabels(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="showContourLabelsCheckbox" style={{ fontSize: '11px', color: '#475569', cursor: 'pointer' }}>显示等值线数值</label>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="checkbox" id="showWaterMassLabelsCheckbox" checked={tsPubShowWaterMassLabels} onChange={e => setTsPubShowWaterMassLabels(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="showWaterMassLabelsCheckbox" style={{ fontSize: '11px', color: '#475569', cursor: 'pointer' }}>显示水团名称</label>
            </div>
          </div>
        </div>

        {/* Custom Water Masses Manager */}
        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>管理 T-S 水团矩形框</span>
          <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid #f1f5f9', padding: '6px', borderRadius: '6px' }}>
            {tsPubWaterMasses.map(wm => (
              <div key={wm.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', padding: '4px 0', borderBottom: '1px solid #f8fafc' }}>
                <span style={{ fontWeight: 'bold', color: wm.color }}>{wm.name} (S:{wm.sMin}-{wm.sMax}, T:{wm.tMin}-{wm.tMax})</span>
                <button
                  onClick={() => setTsPubWaterMasses(tsPubWaterMasses.filter(x => x.id !== wm.id))}
                  style={{ border: 'none', background: 'none', color: '#ef4444', fontSize: '10px', cursor: 'pointer' }}
                >删除</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: '#f8fafc', padding: '8px', borderRadius: '6px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '6px' }}>
              <input
                type="text" placeholder="水团名称 (如 CDW)" value={newWmName} onChange={e => setNewWmName(e.target.value)}
                style={{ padding: '3px 6px', fontSize: '10px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              />
              <input
                type="color" value={newWmColor} onChange={e => setNewWmColor(e.target.value)}
                style={{ width: '100%', height: '20px', padding: '0', border: 'none', cursor: 'pointer' }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '4px' }}>
              <input
                type="number" step="0.1" placeholder="S Min" value={newWmSMin} onChange={e => setNewWmSMin(e.target.value)}
                style={{ padding: '2px 4px', fontSize: '9px', borderRadius: '3px', border: '1px solid #cbd5e1' }}
              />
              <input
                type="number" step="0.1" placeholder="S Max" value={newWmSMax} onChange={e => setNewWmSMax(e.target.value)}
                style={{ padding: '2px 4px', fontSize: '9px', borderRadius: '3px', border: '1px solid #cbd5e1' }}
              />
              <input
                type="number" step="0.1" placeholder="T Min" value={newWmTMin} onChange={e => setNewWmTMin(e.target.value)}
                style={{ padding: '2px 4px', fontSize: '9px', borderRadius: '3px', border: '1px solid #cbd5e1' }}
              />
              <input
                type="number" step="0.1" placeholder="T Max" value={newWmTMax} onChange={e => setNewWmTMax(e.target.value)}
                style={{ padding: '2px 4px', fontSize: '9px', borderRadius: '3px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <button
              onClick={addWaterMass}
              style={{ padding: '4px', fontSize: '10px', fontWeight: 'bold', background: '#0ea5e9', color: '#ffffff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >+ 添加水团矩形框</button>
          </div>
        </div>

        {/* Section Annotations Manager */}
        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>管理断面文字标签 (Annotations)</span>
          <div style={{ maxHeight: '100px', overflowY: 'auto', border: '1px solid #f1f5f9', padding: '6px', borderRadius: '6px' }}>
            {tsPubAnnotations.map(ann => (
              <div key={ann.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', padding: '4px 0', borderBottom: '1px solid #f8fafc' }}>
                <span style={{ color: '#334155' }}>"{ann.text}" (X:{ann.x}, D:{ann.depth}m)</span>
                <button
                  onClick={() => setTsPubAnnotations(tsPubAnnotations.filter(x => x.id !== ann.id))}
                  style={{ border: 'none', background: 'none', color: '#ef4444', fontSize: '10px', cursor: 'pointer' }}
                >删除</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: '#f8fafc', padding: '8px', borderRadius: '6px' }}>
            <input
              type="text" placeholder="标签内容 (如 Winter water)" value={newAnnText} onChange={e => setNewAnnText(e.target.value)}
              style={{ padding: '3px 6px', fontSize: '10px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <input
                type="number" step="0.1" placeholder="经纬度坐标" value={newAnnX} onChange={e => setNewAnnX(e.target.value)}
                style={{ padding: '3px 6px', fontSize: '10px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              />
              <input
                type="number" step="10" placeholder="深度 (m)" value={newAnnDepth} onChange={e => setNewAnnDepth(e.target.value)}
                style={{ padding: '3px 6px', fontSize: '10px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <button
              onClick={addAnnotation}
              style={{ padding: '4px', fontSize: '10px', fontWeight: 'bold', background: '#0ea5e9', color: '#ffffff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >+ 添加断面文字标签</button>
          </div>
        </div>

        {/* Export Panel */}
        <div style={{ borderTop: '2px solid #e2e8f0', paddingTop: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#0f172a' }}>导出与下载 (Export)</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '11px', color: '#475569' }}>导出分辨率倍数:</label>
            <select
              value={tsPubScale} onChange={e => setTsPubScale(parseInt(e.target.value) || 2)}
              style={{ padding: '3px 6px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
            >
              <option value="1">1x (普通清晰度)</option>
              <option value="2">2x (印刷级清晰)</option>
              <option value="3">3x (发表级超高清 300 DPI)</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
            <button
              onClick={handleExportPNG}
              style={{
                width: '100%', padding: '8px 12px', fontSize: '12px', fontWeight: 'bold', borderRadius: '6px',
                background: '#0ea5e9', color: '#ffffff', border: 'none', cursor: 'pointer', transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
              }}
            >
              <Download size={14} /> 导出超清 PNG 图像
            </button>
            <button
              onClick={handleExportCSV}
              style={{
                width: '100%', padding: '6px 12px', fontSize: '11px', fontWeight: 'bold', borderRadius: '6px',
                background: '#ffffff', color: '#475569', border: '1px solid #cbd5e1', cursor: 'pointer', transition: 'all 0.2s'
              }}
            >
              导出 T-S 散点数据 (CSV)
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
        <div className="card" style={{ padding: '16px', margin: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: 'bold', margin: 0, color: '#0f172a' }}>
              图表实时预览 (Canvas Real-time Preview)
            </h3>
            <p style={{ fontSize: '11px', color: '#64748b', margin: '4px 0 0 0' }}>
              预览图采用 2x 分辨率抗锯齿渲染。支持一键导出发表级图片。背景虚线为潜在密度等值线 ($\sigma_\theta$)。
            </p>
          </div>
        </div>

        {tsData.length === 0 ? (
          <div style={{ height: '480px', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#94a3b8', background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            未检测到水文温盐数据，请先上传 CTD 水文数据。
          </div>
        ) : (
          <LiveStudioPreview />
        )}

        {/* OMP Analysis Panel */}
        {tsData.length > 0 && (
          <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', margin: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '4px', height: '18px', background: '#10b981', borderRadius: '2px' }} />
                <h4 style={{ fontSize: '15px', fontWeight: 'bold', margin: 0, color: '#0f172a' }}>水团混合与生化残差量化分析 (OMP & Δ Analysis)</h4>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  id="enableOmpCheckbox"
                  checked={enableOmp}
                  onChange={e => {
                    setEnableOmp(e.target.checked);
                    if (!e.target.checked && tsSectionParam === 'delta_tracer') {
                      setTsSectionParam('temperature');
                    }
                  }}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <label htmlFor="enableOmpCheckbox" style={{ fontSize: '13px', fontWeight: 'bold', color: '#1e293b', cursor: 'pointer' }}>
                  开启端元混合分析
                </label>
              </div>
            </div>

            {enableOmp && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Inputs for selected tracer and endmembers */}
                <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '20px', alignItems: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>待分析非保守参数 (Tracer)</label>
                    <select
                      value={selectedOmpTracer}
                      onChange={e => setSelectedOmpTracer(e.target.value)}
                      style={{ padding: '6px 10px', fontSize: '12px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff' }}
                    >
                      {availableTracers.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => {
                        if (tsPubWaterMasses.length >= 3) {
                          const newEms = tsPubWaterMasses.slice(0, 3).map((wm, idx) => ({
                            name: wm.name,
                            s: (wm.sMin + wm.sMax) / 2,
                            t: (wm.tMin + wm.tMax) / 2,
                            tracerVal: idx === 0 ? 40 : idx === 1 ? 50 : 35
                          }));
                          setOmpEndmembers(newEms);
                        } else {
                          alert('需要当前列表中至少存在 3 个已定义的水团矩形框才可以自动填充。');
                        }
                      }}
                      style={{ padding: '6px 12px', fontSize: '11px', fontWeight: 'bold', color: '#0369a1', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '6px', cursor: 'pointer' }}
                    >
                      从水团矩形框自动获取端元 T/S
                    </button>
                  </div>
                </div>

                {/* 3 Endmembers config inputs */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                  {ompEndmembers.map((em, idx) => (
                    <div key={idx} style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                      <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b' }}>端元 {idx + 1} ({em.name || `EM${idx + 1}`})</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                        <div>
                          <label style={{ fontSize: '10px', color: '#475569', display: 'block' }}>名称 (Name)</label>
                          <input
                            type="text"
                            value={em.name}
                            onChange={e => {
                              const next = [...ompEndmembers];
                              next[idx].name = e.target.value;
                              setOmpEndmembers(next);
                            }}
                            style={{ width: '100%', padding: '3px 6px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                          />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          <div>
                            <label style={{ fontSize: '10px', color: '#475569', display: 'block' }}>盐度 (S)</label>
                            <input
                              type="number"
                              step="0.05"
                              value={em.s}
                              onChange={e => {
                                const next = [...ompEndmembers];
                                next[idx].s = parseFloat(e.target.value) || 0;
                                setOmpEndmembers(next);
                              }}
                              style={{ width: '100%', padding: '3px 6px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '10px', color: '#475569', display: 'block' }}>温度 (T, °C)</label>
                            <input
                              type="number"
                              step="0.1"
                              value={em.t}
                              onChange={e => {
                                const next = [...ompEndmembers];
                                next[idx].t = parseFloat(e.target.value) || 0;
                                setOmpEndmembers(next);
                              }}
                              style={{ width: '100%', padding: '3px 6px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                            />
                          </div>
                        </div>
                        <div>
                          <label style={{ fontSize: '10px', color: '#475569', display: 'block' }}>源区初值 ({selectedOmpTracer} Initial)</label>
                          <input
                            type="number"
                            step="1"
                            value={em.tracerVal}
                            onChange={e => {
                              const next = [...ompEndmembers];
                              next[idx].tracerVal = parseFloat(e.target.value) || 0;
                              setOmpEndmembers(next);
                            }}
                            style={{ width: '100%', padding: '3px 6px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Summary Metrics */}
                {(() => {
                  const validData = sectionData.filter(d => d.tracer_obs > 0);
                  if (validData.length === 0) return null;
                  const avgF1 = validData.reduce((acc, d) => acc + d.f1, 0) / validData.length;
                  const avgF2 = validData.reduce((acc, d) => acc + d.f2, 0) / validData.length;
                  const avgF3 = validData.reduce((acc, d) => acc + d.f3, 0) / validData.length;
                  const avgDelta = validData.reduce((acc, d) => acc + d.delta_tracer, 0) / validData.length;

                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px', background: '#f0fdf4', padding: '12px', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '10px', color: '#166534', fontWeight: 'bold' }}>平均 {ompEndmembers[0]?.name || 'EM1'} %</div>
                        <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#14532d' }}>{(avgF1 * 100).toFixed(1)}%</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '10px', color: '#166534', fontWeight: 'bold' }}>平均 {ompEndmembers[1]?.name || 'EM2'} %</div>
                        <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#14532d' }}>{(avgF2 * 100).toFixed(1)}%</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '10px', color: '#166534', fontWeight: 'bold' }}>平均 {ompEndmembers[2]?.name || 'EM3'} %</div>
                        <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#14532d' }}>{(avgF3 * 100).toFixed(1)}%</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '10px', color: '#166534', fontWeight: 'bold' }}>平均 Δ{selectedOmpTracer}</div>
                        <div style={{ fontSize: '16px', fontWeight: 'bold', color: avgDelta < 0 ? '#b91c1c' : '#1e3a8a' }}>
                          {avgDelta > 0 ? '+' : ''}{avgDelta.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Quantitative Results Table */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>各采样点解算详情 ({sectionData.length} 个观测点)</span>
                    <button
                      onClick={() => {
                        const headers = `Station,Depth,Temp,Sal,${ompEndmembers[0]?.name || 'f1'},${ompEndmembers[1]?.name || 'f2'},${ompEndmembers[2]?.name || 'f3'},${selectedOmpTracer}_obs,${selectedOmpTracer}_cons,delta_${selectedOmpTracer}\n`;
                        const rows = sectionData.map(d => 
                          `${d.station},${d.depth},${d.temperature},${d.salinity},${(d.f1*100).toFixed(2)}%,${(d.f2*100).toFixed(2)}%,${(d.f3*100).toFixed(2)}%,${d.tracer_obs},${d.tracer_cons.toFixed(2)},${d.delta_tracer.toFixed(2)}`
                        ).join('\n');
                        const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
                        const link = document.createElement('a');
                        link.href = URL.createObjectURL(blob);
                        link.download = `OMP_Mixing_Delta_${selectedOmpTracer}_Analysis.csv`;
                        link.click();
                      }}
                      style={{ padding: '4px 8px', fontSize: '11px', background: '#0284c7', color: '#ffffff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                      导出完整解算数据 (CSV)
                    </button>
                  </div>

                  <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: '6px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'left' }}>
                      <thead style={{ background: '#f1f5f9', position: 'sticky', top: 0, color: '#334155' }}>
                        <tr>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid #cbd5e1' }}>站位</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid #cbd5e1' }}>深度(m)</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid #cbd5e1' }}>T / S</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid #cbd5e1' }}>{ompEndmembers[0]?.name || 'f1'}</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid #cbd5e1' }}>{ompEndmembers[1]?.name || 'f2'}</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid #cbd5e1' }}>{ompEndmembers[2]?.name || 'f3'}</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid #cbd5e1' }}>实测 {selectedOmpTracer}</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid #cbd5e1' }}>保守 {selectedOmpTracer}</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid #cbd5e1' }}>生化异常 Δ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sectionData.map((d, index) => {
                          const bg = d.delta_tracer < 0 
                            ? 'rgba(239, 68, 68, 0.05)'
                            : d.delta_tracer > 0 
                              ? 'rgba(59, 130, 246, 0.05)'
                              : 'transparent';

                          return (
                            <tr key={index} style={{ background: bg, borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '6px 8px' }}>{d.station}</td>
                              <td style={{ padding: '6px 8px' }}>{d.depth}</td>
                              <td style={{ padding: '6px 8px', color: '#64748b' }}>{d.temperature.toFixed(2)} / {d.salinity.toFixed(2)}</td>
                              <td style={{ padding: '6px 8px', fontWeight: '500' }}>{(d.f1 * 100).toFixed(1)}%</td>
                              <td style={{ padding: '6px 8px', fontWeight: '500' }}>{(d.f2 * 100).toFixed(1)}%</td>
                              <td style={{ padding: '6px 8px', fontWeight: '500' }}>{(d.f3 * 100).toFixed(1)}%</td>
                              <td style={{ padding: '6px 8px' }}>{d.tracer_obs > 0 ? d.tracer_obs.toFixed(2) : '-'}</td>
                              <td style={{ padding: '6px 8px', color: '#64748b' }}>{d.tracer_obs > 0 ? d.tracer_cons.toFixed(2) : '-'}</td>
                              <td style={{ padding: '6px 8px', fontWeight: 'bold', color: d.delta_tracer < 0 ? '#ef4444' : d.delta_tracer > 0 ? '#3b82f6' : '#334155' }}>
                                {d.tracer_obs > 0 ? `${d.delta_tracer > 0 ? '+' : ''}${d.delta_tracer.toFixed(2)}` : '-'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
