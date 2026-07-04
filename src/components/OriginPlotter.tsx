import { useState, useMemo, useRef, useEffect } from 'react';
import { fromBlob } from 'geotiff';
import {
  LineChart, Map, Download, AlertTriangle, Wrench, Layout, Info
} from 'lucide-react';
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis,
  CartesianGrid, Tooltip, ErrorBar, Legend
} from 'recharts';
import { contours } from 'd3-contour';
import { scaleLinear } from 'd3-scale';
import { curveCardinal } from 'd3-shape';
import { normalizeStationName } from '../utils/stationParser';
import { interpolateIDW, calculatePotentialDensityAnomaly, calculateAOU, fitCalibrationCurve } from '../utils/calc';
import { ExcelSampleInfo, HydrologicalSample } from '../types';
import { StationMap } from './StationMap';

const loadSavedState = <T,>(key: string, defaultValue: T): T => {
  try {
    const saved = localStorage.getItem(key);
    if (saved === null) return defaultValue;
    return JSON.parse(saved) as T;
  } catch (e) {
    console.error(`Error parsing localStorage key "${key}":`, e);
    return defaultValue;
  }
};

function loessFilter(data: { x: number; y: number }[], bandwidth = 0.75) {
  const sorted = [...data].sort((a, b) => a.y - b.y);
  const n = sorted.length;
  if (n < 3) return sorted;

  return sorted.map((pt) => {
    const targetY = pt.y;
    const k = Math.max(3, Math.min(n, Math.round(n * bandwidth)));
    const dists = sorted.map((p, i) => ({ dist: Math.abs(p.y - targetY), idx: i }));
    dists.sort((a, b) => a.dist - b.dist);
    const neighbors = dists.slice(0, k);
    const maxDist = neighbors[neighbors.length - 1].dist || 1e-6;

    let sumW = 0;
    let sumWY = 0;
    let sumWY2 = 0;
    let sumWX = 0;
    let sumWXY = 0;

    neighbors.forEach(nb => {
      const p = sorted[nb.idx];
      const u = nb.dist / maxDist;
      const w = u < 1 ? Math.pow(1 - Math.pow(u, 3), 3) : 0;
      sumW += w;
      sumWY += w * p.y;
      sumWY2 += w * p.y * p.y;
      sumWX += w * p.x;
      sumWXY += w * p.x * p.y;
    });

    if (sumW < 1e-6) return pt;

    const denom = sumW * sumWY2 - sumWY * sumWY;
    if (Math.abs(denom) < 1e-6) {
      return { x: sumWX / sumW, y: targetY };
    }

    const a = (sumW * sumWXY - sumWY * sumWX) / denom;
    const b = (sumWX * sumWY2 - sumWY * sumWXY) / denom;
    return { x: a * targetY + b, y: targetY };
  });
}

const MULTI_COLORS = [
  '#2563eb', // Royal Blue
  '#dc2626', // Red
  '#16a34a', // Green
  '#d97706', // Yellow/Amber
  '#9333ea', // Purple
  '#0891b2', // Cyan
  '#db2777', // Pink
  '#ea580c', // Orange
];

const MULTI_SHAPES: ('circle' | 'square' | 'triangle' | 'diamond')[] = [
  'circle',
  'square',
  'triangle',
  'diamond',
];

const formatLatitude = (lat: number): string => {
  if (lat < 0) {
    return `${Math.abs(lat).toFixed(1)}°S`;
  }
  return `${lat.toFixed(1)}°N`;
};

const formatLongitude = (lon: number): string => {
  if (lon < 0) {
    return `${Math.abs(lon).toFixed(1)}°W`;
  }
  return `${lon.toFixed(1)}°E`;
};

const formatStationLabel = (station: string | null | undefined): string => {
  if (!station) return '';
  const trimmed = station.trim();
  
  // If it's a pure number (e.g., "50"), return "ST-50"
  if (/^\d+$/.test(trimmed)) {
    return `ST-${trimmed}`;
  }
  
  // If it matches st/ST followed by a number (optionally with separator), like "st50" or "ST-50" or "ST_50"
  const match = trimmed.match(/^st[-_]?(\d+)$/i);
  if (match) {
    return `ST-${match[1]}`;
  }
  
  // If it is something else starting with st/ST (like ST-46-200), normalize prefix to ST-
  if (trimmed.toLowerCase().startsWith('st')) {
    const rest = trimmed.slice(2).replace(/^[-_]+/, '');
    return `ST-${rest}`;
  }
  
  return trimmed;
};

const formatParamDisplayName = (param: string): string => {
  if (!param) return '';
  // Check if it's temperature
  if (param.toLowerCase().includes('temperature')) {
    return 'Temperature [°C]';
  }
  // Check if it's salinity
  if (param.toLowerCase().includes('salinity')) {
    return 'Salinity [psu]';
  }
  // Remove (ITS-90) or (PSS-78) or similar from other parameters if any
  return param
    .replace(/\s*\(ITS-90\)/gi, '')
    .replace(/\s*\(PSS-78\)/gi, '');
};

const renderCustomPointShape = (cx: number, cy: number, size: number, fill: string, stroke: string, strokeWidth: number, shapeType: string) => {
  if (shapeType === 'square') {
    return (
      <rect
        x={cx - size/2}
        y={cy - size/2}
        width={size}
        height={size}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        style={{ filter: `drop-shadow(0px 2px 4px ${fill}40)` }}
      />
    );
  }
  if (shapeType === 'triangle') {
    const points = `${cx},${cy - size/2} ${cx - size/2},${cy + size/2} ${cx + size/2},${cy + size/2}`;
    return (
      <polygon
        points={points}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        style={{ filter: `drop-shadow(0px 2px 4px ${fill}40)` }}
      />
    );
  }
  if (shapeType === 'diamond') {
    const points = `${cx},${cy - size/2} ${cx + size/2},${cy} ${cx},${cy + size/2} ${cx - size/2},${cy}`;
    return (
      <polygon
        points={points}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        style={{ filter: `drop-shadow(0px 2px 4px ${fill}40)` }}
      />
    );
  }
  return (
    <circle
      cx={cx}
      cy={cy}
      r={size/2}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      style={{ filter: `drop-shadow(0px 2px 4px ${fill}40)` }}
    />
  );
};

interface ChartStyles {
  fontFamily: string;
  fontSizeTitle: number;
  fontSizeAxisLabel: number;
  fontSizeAxisTick: number;
  stationLabelAngle: number;
  stationLabelColor: string;
  pointRadius: number;
  pointFill: string;
  pointStroke: string;
  pointStrokeWidth: number;
  lineStroke: string;
  lineWidth: number;
  bathyFill: string;
  bathyStroke: string;
  bathyStrokeWidth: number;
  axisStroke: string;
  gridStroke: string;
  colorbarWidth: number;
  
  // High-level scientific additions
  tickDirection: 'inward' | 'outward';
  closedBorderTicks: boolean;
  staggerLevels: number;
  colormap: 'odv' | 'viridis' | 'inferno' | 'coolwarm' | 'grayscale';
  colorBanding: 'continuous' | 'discrete';
  maskDistance: number; // 0.1 to 1.0 (mask threshold percentage, 1.0 means no mask)
  showTopStationLabels: boolean;
  respectBathyBarriers?: boolean; // Topography barrier support for 2D gridding
  
  // 1D profile academic additions
  symbolShape: 'circle' | 'square' | 'triangle' | 'diamond';
  lineType: 'straight' | 'smooth' | 'loess' | 'none';
  lineSmoothness: number; // 0.0 to 1.0 (smoothness percentage / LOESS bandwidth)
  showErrorBar: boolean;
  errorBarCapWidth: number;
  errorBarColor: string;
  tickDirection1D: 'inward' | 'outward';
  show1DGridX: boolean;
  show1DGridY: boolean;
  invertYAxis1D?: boolean;
  subplotMarginTop?: number;
  subplotXAxisOrientation?: 'top' | 'bottom';
  tickMargin1D?: number;

  // Decoupled 1D Colors
  pointFill1D: string;
  pointStroke1D: string;
  lineStroke1D: string;
  gridStroke1D: string;
  axisStroke1D: string;
  yAxisTitleOffset?: number;
  xAxisTitleOffset?: number;
  colorbarTitleOffset?: number;
  colorbarTitleXOffset?: number;
  showPoints2D?: boolean;
  pointRadius2D?: number;
  pointFill2D?: string;
  pointStroke2D?: string;
  pointStrokeWidth2D?: number;
}

interface TextSetting {
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  fontWeight: 'normal' | 'bold' | '600';
  fontStyle: 'normal' | 'italic';
}

interface TextSettings {
  title: TextSetting;
  subtitle: TextSetting;
  xAxisLabel: TextSetting;
  yAxisLabel: TextSetting;
  stationLabels: TextSetting;
  ticksLabels: TextSetting;
  legendLabel: TextSetting;
  colorbarTitle: TextSetting;
}

interface ProcessedSample {
  id: string;
  station: string | null;
  depth: number | null;
  concentration: number;
  error: number;
  rsd: number;
  isRejected: boolean;
  isBlank: boolean;
  isStd: boolean;
  isSeawater: boolean;
  sampleName: string;
  longitude?: number;
  latitude?: number;
  botDepth?: number;
}

interface OriginPlotterProps {
  processedSamples: ProcessedSample[];
  stationCoords: ExcelSampleInfo[];
  hydroSamples?: HydrologicalSample[];
  hydroParameters?: string[];
}

function getAdaptiveBounds(values: number[]): { min: number; max: number; step: number } {
  if (values.length === 0) return { min: 0, max: 100, step: 10 };
  const sorted = [...values].sort((a, b) => a - b);
  
  // Robust scaling: 2nd and 98th percentile
  const p2Idx = Math.floor(sorted.length * 0.02);
  const p98Idx = Math.floor(sorted.length * 0.98);
  
  let min = sorted[p2Idx];
  let max = sorted[p98Idx];
  
  if (min === max) {
    min = sorted[0];
    max = sorted[sorted.length - 1];
  }
  if (min === max) {
    max = min + 1;
  }
  
  const range = max - min;
  const step = range / 10;
  
  return {
    min: parseFloat(min.toFixed(2)),
    max: parseFloat(max.toFixed(2)),
    step: parseFloat(step.toFixed(3)) || 1
  };
}

const STANDARD_PARAMETER_RANGES: Record<string, { min: number; max: number; step: number }> = {
  doc: { min: 40, max: 70, step: 5 },
  salinity: { min: 33.0, max: 36.0, step: 0.5 },
  temperature: { min: 5.0, max: 30.0, step: 2.5 },
  oxygen: { min: 50.0, max: 250.0, step: 20 },
  fluorescence: { min: 0.0, max: 2.0, step: 0.2 },
  chlorophyll: { min: 0.0, max: 2.0, step: 0.2 },
  turbidity: { min: 0.0, max: 1.0, step: 0.1 },
  density: { min: 1022, max: 1028, step: 0.5 },
  phosphate: { min: 0.0, max: 3.0, step: 0.3 },
  silicate: { min: 0.0, max: 150.0, step: 15 },
  nitrate: { min: 0.0, max: 40.0, step: 4 }
};

function getParameterRanges(paramName: string, values: number[]): { min: number; max: number; step: number } {
  const nameLower = paramName.toLowerCase();
  for (const key of Object.keys(STANDARD_PARAMETER_RANGES)) {
    if (nameLower.includes(key)) {
      return STANDARD_PARAMETER_RANGES[key];
    }
  }
  return getAdaptiveBounds(values);
}

export default function OriginPlotter({ processedSamples: originalProcessedSamples, stationCoords, hydroSamples, hydroParameters }: OriginPlotterProps) {
  const instanceId = useMemo(() => Math.random().toString(36).substring(2, 9), []);
  const [visSubTab, setVisSubTab] = useState<'profile1d' | 'contour2d' | 'tsPlot' | 'aouDocPlot'>(() => loadSavedState<'profile1d' | 'contour2d' | 'tsPlot' | 'aouDocPlot'>('ocean_visSubTab', 'profile1d'));
  const [showDensityOverlay, setShowDensityOverlay] = useState<boolean>(() => loadSavedState<boolean>('ocean_showDensityOverlay', false));

  useEffect(() => {
    localStorage.setItem('ocean_visSubTab', JSON.stringify(visSubTab));
  }, [visSubTab]);

  useEffect(() => {
    localStorage.setItem('ocean_showDensityOverlay', JSON.stringify(showDensityOverlay));
  }, [showDensityOverlay]);

  // Utility to find values in values record by keyword matching
  const findValueByKeywords = (values: Record<string, number>, keywords: string[]): number | undefined => {
    const keys = Object.keys(values);
    for (const keyword of keywords) {
      const matchedKey = keys.find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '').includes(keyword));
      if (matchedKey && values[matchedKey] !== undefined) {
        return values[matchedKey];
      }
    }
    return undefined;
  };

  // Helper to map station + depth to closest hydro profile sample
  const findHydroDataForSample = useMemo(() => {
    return (st: string | null, depth: number | null) => {
      if (!st || depth === null || !hydroSamples || hydroSamples.length === 0) return null;
      const normSt = normalizeStationName(st);
      const stationHydro = hydroSamples.filter(h => normalizeStationName(h.station) === normSt);
      if (stationHydro.length === 0) return null;

      let closest = stationHydro[0];
      let minDiff = Math.abs(closest.depth - depth);
      for (const h of stationHydro) {
        const diff = Math.abs(h.depth - depth);
        if (diff < minDiff) {
          minDiff = diff;
          closest = h;
        }
      }
      return closest;
    };
  }, [hydroSamples]);


  const isHydroMode = !!(hydroSamples && hydroSamples.length > 0);

  const allParameters = useMemo(() => {
    const list: string[] = [];
    const hasDocData = originalProcessedSamples && originalProcessedSamples.length > 0;
    if (hasDocData) {
      list.push("DOC (µmol/L)");
    }
    if (hydroParameters && hydroParameters.length > 0) {
      hydroParameters.forEach(p => {
        list.push(p);
      });
    }
    return list;
  }, [originalProcessedSamples, hydroParameters]);

  const [selectedHydroParam, setSelectedHydroParam] = useState<string>(() => {
    const saved = localStorage.getItem('ocean_selectedHydroParam');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (allParameters.includes(parsed)) return parsed;
      } catch (e) {}
    }
    return allParameters[0] || '';
  });

  useEffect(() => {
    localStorage.setItem('ocean_selectedHydroParam', JSON.stringify(selectedHydroParam));
  }, [selectedHydroParam]);

  useEffect(() => {
    if (allParameters.length > 0) {
      setSelectedHydroParam(prev => allParameters.includes(prev) ? prev : allParameters[0]);
    }
  }, [allParameters]);

  const processedSamples = useMemo(() => {
    if (selectedHydroParam === "DOC (µmol/L)" || !isHydroMode || !hydroSamples) {
      return originalProcessedSamples;
    }
    return hydroSamples.map(h => ({
      id: h.id,
      station: h.station,
      depth: h.depth,
      concentration: h.values[selectedHydroParam] !== undefined ? h.values[selectedHydroParam] : 0,
      error: 0,
      rsd: 0,
      isRejected: false,
      isBlank: false,
      isStd: false,
      isSeawater: false,
      sampleName: `${h.station} (${h.depth}m)`,
      longitude: h.longitude,
      latitude: h.latitude
    }));
  }, [hydroSamples, originalProcessedSamples, selectedHydroParam, isHydroMode]);

  const [selectedStation, setSelectedStation] = useState<string>(() => loadSavedState('ocean_selectedStation', ''));
  const [stationMode1D, setStationMode1D] = useState<'single' | 'multi'>(() => loadSavedState<'single' | 'multi'>('ocean_stationMode1D', 'single'));
  const [selectedStationsMulti, setSelectedStationsMulti] = useState<string[]>(() => loadSavedState<string[]>('ocean_selectedStationsMulti', []));
  const [focusedStation1D, setFocusedStation1D] = useState<string>(() => loadSavedState('ocean_focusedStation1D', ''));
  const [multiLayout1D, setMultiLayout1D] = useState<'overlay' | 'grid'>(() => loadSavedState<'overlay' | 'grid'>('ocean_multiLayout1D', 'overlay'));
  const [docMin, setDocMin] = useState<number>(() => loadSavedState('ocean_docMin', 40));
  const [docMax, setDocMax] = useState<number>(() => loadSavedState('ocean_docMax', 80));
  const [contourStep, setContourStep] = useState<number>(() => loadSavedState('ocean_contourStep', 5));
  const [idwPower, setIdwPower] = useState<number>(() => loadSavedState('ocean_idwPower', 2.0));
  const [anisotropyFactor, setAnisotropyFactor] = useState<number>(() => loadSavedState('ocean_anisotropyFactor', 10));
  const [contourXAxis, setContourXAxis] = useState<'station' | 'longitude' | 'latitude'>(() => loadSavedState<'station' | 'longitude' | 'latitude'>('ocean_contourXAxis', 'station'));
  const [minDepthFilter, setMinDepthFilter] = useState<number>(() => loadSavedState('ocean_minDepthFilter', 0));
  const [maxDepthFilter, setMaxDepthFilter] = useState<number>(() => loadSavedState('ocean_maxDepthFilter', 6000));
  const [minXFilter, setMinXFilter] = useState<number>(() => loadSavedState('ocean_minXFilter', -180));
  const [maxXFilter, setMaxXFilter] = useState<number>(() => loadSavedState('ocean_maxXFilter', 180));
  const [showBackgroundMap] = useState<boolean>(() => loadSavedState('ocean_showBackgroundMap', false));
  const [visSettingsTab, setVisSettingsTab] = useState<'data' | 'style'>(() => loadSavedState('ocean_visSettingsTab', 'data'));
  const [settingsTab1D, setSettingsTab1D] = useState<'select' | 'style'>(() => loadSavedState<'select' | 'style'>('ocean_settingsTab1D', 'select'));
  const [stationSortMode1D, setStationSortMode1D] = useState<'name' | 'latitude' | 'longitude'>(() => loadSavedState<'name' | 'latitude' | 'longitude'>('ocean_stationSortMode1D', 'name'));
  const [contourStartStation, setContourStartStation] = useState<string>(() => loadSavedState('ocean_contourStartStation', ''));
  const [contourEndStation, setContourEndStation] = useState<string>(() => loadSavedState('ocean_contourEndStation', ''));
  const [showUnfilteredComparison, setShowUnfilteredComparison] = useState<boolean>(() => loadSavedState('ocean_showUnfilteredComparison', false));
  const [invertXAxis2D, setInvertXAxis2D] = useState<boolean>(() => loadSavedState('ocean_invertXAxis2D', false));
  const [depthTickStep, setDepthTickStep] = useState<number>(() => loadSavedState('ocean_depthTickStep', 100));
  const [showContourLabels, setShowContourLabels] = useState<boolean>(() => loadSavedState('ocean_showContourLabels', true));
  const [contourLabelMode, setContourLabelMode] = useState<'all' | 'multiplesOf10' | 'every2nd'>(() => loadSavedState<'all' | 'multiplesOf10' | 'every2nd'>('ocean_contourLabelMode', 'multiplesOf10'));
  const [highResBathyPoints, setHighResBathyPoints] = useState<{ xVal: number; depth: number }[]>([]);
  const [loadingBathy, setLoadingBathy] = useState<boolean>(false);
  const [localTiffFile, setLocalTiffFile] = useState<File | null>(null);
  const [bathySource, setBathySource] = useState<'api' | 'tiff' | 'fallback'>('api');
  const [hoveredPoint2D, setHoveredPoint2D] = useState<{
    station: string;
    depth: number;
    concentration: number;
    x: number;
    y: number;
  } | null>(null);

  // Custom templates/presets state for preserving work steps
  const [customPresets, setCustomPresets] = useState<{
    id: string;
    name: string;
    timestamp: string;
    visSubTab: 'profile1d' | 'contour2d' | 'tsPlot' | 'aouDocPlot';
    docMin: number;
    docMax: number;
    contourStep: number;
    idwPower: number;
    anisotropyFactor: number;
    contourXAxis: 'station' | 'longitude' | 'latitude';
    minDepthFilter: number;
    maxDepthFilter: number;
    minXFilter: number;
    maxXFilter: number;
    contourStartStation: string;
    contourEndStation: string;
    stationMode1D: 'single' | 'multi';
    selectedStationsMulti: string[];
    focusedStation1D: string;
    multiLayout1D: 'overlay' | 'grid';
    chartStyles: ChartStyles;
    textSettings: TextSettings;
    legendPos: { x: number; y: number };
  }[]>(() => {
    try {
      const saved = localStorage.getItem('ocean_custom_presets');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('ocean_custom_presets', JSON.stringify(customPresets));
  }, [customPresets]);

  const handleSaveCurrentPreset = () => {
    const name = prompt("请输入此图表配置模板名称:", `配置备份 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
    if (!name) return;
    
    const newPreset = {
      id: Math.random().toString(36).substr(2, 9),
      name: name,
      timestamp: new Date().toLocaleString(),
      visSubTab,
      docMin,
      docMax,
      contourStep,
      idwPower,
      anisotropyFactor,
      contourXAxis,
      minDepthFilter,
      maxDepthFilter,
      minXFilter,
      maxXFilter,
      contourStartStation,
      contourEndStation,
      stationMode1D,
      selectedStationsMulti,
      focusedStation1D,
      multiLayout1D,
      chartStyles,
      textSettings,
      legendPos
    };
    
    setCustomPresets(prev => [newPreset, ...prev]);
  };

  const handleApplyPreset = (preset: typeof customPresets[0]) => {
    setVisSubTab(preset.visSubTab);
    setDocMin(preset.docMin);
    setDocMax(preset.docMax);
    setContourStep(preset.contourStep);
    setIdwPower(preset.idwPower);
    setAnisotropyFactor(preset.anisotropyFactor);
    setContourXAxis(preset.contourXAxis);
    setMinDepthFilter(preset.minDepthFilter);
    setMaxDepthFilter(preset.maxDepthFilter);
    setMinXFilter(preset.minXFilter);
    setMaxXFilter(preset.maxXFilter);
    setContourStartStation(preset.contourStartStation || '');
    setContourEndStation(preset.contourEndStation || '');
    setStationMode1D(preset.stationMode1D);
    setSelectedStationsMulti(preset.selectedStationsMulti || []);
    setFocusedStation1D(preset.focusedStation1D || '');
    setMultiLayout1D(preset.multiLayout1D);
    setChartStyles(preset.chartStyles);
    setTextSettings(preset.textSettings);
    setLegendPos(preset.legendPos);
  };

  const handleDeletePreset = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("确定要删除此保存的图表配置模板吗？")) {
      setCustomPresets(prev => prev.filter(p => p.id !== id));
    }
  };

  // Double-click Editor State
  const [editor, setEditor] = useState<{
    open: boolean;
    elementId: keyof TextSettings | '';
    x: number;
    y: number;
  }>({ open: false, elementId: '', x: 0, y: 0 });

  const activeElementId = editor.elementId ? (editor.elementId as keyof TextSettings) : null;

  // Custom text setting state
  const [textSettings, setTextSettings] = useState<TextSettings>(() => {
    const saved = localStorage.getItem('ocean_text_settings');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return {
      title: {
        text: 'DOC 空间断面等值线分布图',
        fontFamily: "'Times New Roman', Times, serif",
        fontSize: 15,
        color: '#0f172a',
        fontWeight: 'bold',
        fontStyle: 'normal'
      },
      subtitle: {
        text: '※ 横轴：测站 | 纵轴：深度 (米，0 米在最顶端反向刻度) | ● 实际采样点 | ■ 海床阴影',
        fontFamily: "'Times New Roman', Times, serif",
        fontSize: 9.5,
        color: '#64748b',
        fontWeight: 'normal',
        fontStyle: 'italic'
      },
      xAxisLabel: {
        text: 'Station Index',
        fontFamily: "'Times New Roman', Times, serif",
        fontSize: 11,
        color: '#000000',
        fontWeight: 'bold',
        fontStyle: 'normal'
      },
      yAxisLabel: {
        text: 'Depth [m]',
        fontFamily: "'Times New Roman', Times, serif",
        fontSize: 11,
        color: '#000000',
        fontWeight: 'bold',
        fontStyle: 'normal'
      },
      stationLabels: {
        text: '', // placeholder
        fontFamily: "'Times New Roman', Times, serif",
        fontSize: 9,
        color: '#475569',
        fontWeight: 'bold',
        fontStyle: 'normal'
      },
      ticksLabels: {
        text: '', // placeholder
        fontFamily: "'Times New Roman', Times, serif",
        fontSize: 8.5,
        color: '#0f172a',
        fontWeight: '600',
        fontStyle: 'normal'
      },
      legendLabel: {
        text: 'DOC 测定值',
        fontFamily: "'Times New Roman', Times, serif",
        fontSize: 10,
        color: '#000000',
        fontWeight: 'normal',
        fontStyle: 'normal'
      },
      colorbarTitle: {
        text: 'DOC [µmol/L]',
        fontFamily: "'Times New Roman', Times, serif",
        fontSize: 9.5,
        color: '#0f172a',
        fontWeight: 'bold',
        fontStyle: 'normal'
      }
    };
  });

  // Global styles config state
  const [chartStyles, setChartStyles] = useState<ChartStyles>(() => {
    const saved = localStorage.getItem('ocean_chart_styles');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return {
      fontFamily: "'Times New Roman', Times, serif",
      fontSizeTitle: 14,
      fontSizeAxisLabel: 11,
      fontSizeAxisTick: 9,
      stationLabelAngle: -60,
      stationLabelColor: '#475569',
      pointRadius: 4,
      pointFill: '#000000',
      pointStroke: '#ffffff',
      pointStrokeWidth: 0.75,
      lineStroke: 'rgba(255, 255, 255, 0.45)',
      lineWidth: 1.5,
      bathyFill: 'url(#bathyGrad)',
      bathyStroke: '#0ea5e9',
      bathyStrokeWidth: 2.5,
      axisStroke: '#000000',
      gridStroke: '#cbd5e1',
      colorbarWidth: 15,
      
      // Academic extensions
      tickDirection: 'inward',
      closedBorderTicks: true,
      staggerLevels: 2,
      colormap: 'odv',
      colorBanding: 'continuous',
      maskDistance: 0.35,
      showTopStationLabels: true,
      respectBathyBarriers: true,
      
      // 1D defaults
      symbolShape: 'circle',
      lineType: 'smooth',
      lineSmoothness: 0.75, // 75% smoothness by default
      showErrorBar: true,
      errorBarCapWidth: 4,
      errorBarColor: '#94a3b8',
      tickDirection1D: 'inward',
      show1DGridX: true,
      show1DGridY: true,
      subplotMarginTop: 25,
      subplotXAxisOrientation: 'top',
      tickMargin1D: 6,

      // Decoupled 1D Colors
      pointFill1D: '#2563eb', // Vibrant Royal Blue
      pointStroke1D: '#ffffff', // High-contrast White stroke
      lineStroke1D: '#2563eb', // Sync with royal blue line
      gridStroke1D: '#cbd5e1', // Soft grid lines
      axisStroke1D: '#475569', // Professional slate grey axes
      yAxisTitleOffset: 0,
      xAxisTitleOffset: 0,
      colorbarTitleOffset: 0,
      colorbarTitleXOffset: 0,
      showPoints2D: true,
      pointRadius2D: 4,
      pointFill2D: '#000000',
      pointStroke2D: '#ffffff',
      pointStrokeWidth2D: 0.75
    };
  });

  // Drag states for axis dragging
  const [dragInfo, setDragInfo] = useState<{
    active: boolean;
    axis: 'x' | 'y';
    type: 'pan' | 'scale-min' | 'scale-max';
    startX: number;
    startY: number;
    startMin: number;
    startMax: number;
  } | null>(null);

  // Drag states for 1D chart legend
  const [legendPos, setLegendPos] = useState(() => loadSavedState('ocean_legendPos', { x: 380, y: 30 }));
  const [legendDragging, setLegendDragging] = useState<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null);

  // Preview modal state
  const [previewModal, setPreviewModal] = useState<{ open: boolean; imgUrl: string; filename: string; format: 'png' | 'svg' } | null>(null);

  // Local state for maskDistance slider to make dragging highly responsive
  const [sliderMaskDistance, setSliderMaskDistance] = useState(chartStyles.maskDistance);
  const maskDebounceTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setSliderMaskDistance(chartStyles.maskDistance);
  }, [chartStyles.maskDistance]);

  // Close double-click popover on outside click
  useEffect(() => {
    const handleOutsideClick = () => {
      setEditor(prev => prev.open ? { ...prev, open: false } : prev);
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  // Save states to LocalStorage
  useEffect(() => {
    localStorage.setItem('ocean_visSubTab', JSON.stringify(visSubTab));
    localStorage.setItem('ocean_selectedStation', JSON.stringify(selectedStation));
    localStorage.setItem('ocean_stationMode1D', JSON.stringify(stationMode1D));
    localStorage.setItem('ocean_selectedStationsMulti', JSON.stringify(selectedStationsMulti));
    localStorage.setItem('ocean_focusedStation1D', JSON.stringify(focusedStation1D));
    localStorage.setItem('ocean_multiLayout1D', JSON.stringify(multiLayout1D));
    localStorage.setItem('ocean_docMin', JSON.stringify(docMin));
    localStorage.setItem('ocean_docMax', JSON.stringify(docMax));
    localStorage.setItem('ocean_contourStep', JSON.stringify(contourStep));
    localStorage.setItem('ocean_idwPower', JSON.stringify(idwPower));
    localStorage.setItem('ocean_anisotropyFactor', JSON.stringify(anisotropyFactor));
    localStorage.setItem('ocean_contourXAxis', JSON.stringify(contourXAxis));
    localStorage.setItem('ocean_minDepthFilter', JSON.stringify(minDepthFilter));
    localStorage.setItem('ocean_maxDepthFilter', JSON.stringify(maxDepthFilter));
    localStorage.setItem('ocean_minXFilter', JSON.stringify(minXFilter));
    localStorage.setItem('ocean_maxXFilter', JSON.stringify(maxXFilter));
    localStorage.setItem('ocean_visSettingsTab', JSON.stringify(visSettingsTab));
    localStorage.setItem('ocean_settingsTab1D', JSON.stringify(settingsTab1D));
    localStorage.setItem('ocean_stationSortMode1D', JSON.stringify(stationSortMode1D));
    localStorage.setItem('ocean_chart_styles', JSON.stringify(chartStyles));
    localStorage.setItem('ocean_text_settings', JSON.stringify(textSettings));
    localStorage.setItem('ocean_legendPos', JSON.stringify(legendPos));
    localStorage.setItem('ocean_contourStartStation', JSON.stringify(contourStartStation));
    localStorage.setItem('ocean_contourEndStation', JSON.stringify(contourEndStation));
    localStorage.setItem('ocean_showUnfilteredComparison', JSON.stringify(showUnfilteredComparison));
    localStorage.setItem('ocean_invertXAxis2D', JSON.stringify(invertXAxis2D));
    localStorage.setItem('ocean_depthTickStep', JSON.stringify(depthTickStep));
    localStorage.setItem('ocean_showContourLabels', JSON.stringify(showContourLabels));
    localStorage.setItem('ocean_contourLabelMode', JSON.stringify(contourLabelMode));
  }, [
    visSubTab, selectedStation, stationMode1D, selectedStationsMulti, focusedStation1D, multiLayout1D, docMin, docMax, contourStep, idwPower, anisotropyFactor,
    contourXAxis, minDepthFilter, maxDepthFilter, minXFilter, maxXFilter, visSettingsTab, settingsTab1D, stationSortMode1D, chartStyles, textSettings, legendPos,
    contourStartStation, contourEndStation, showUnfilteredComparison, invertXAxis2D, depthTickStep, showContourLabels, contourLabelMode
  ]);

  // Unique coordinate mapping for station scatter maps
  const uniqueStationCoords = useMemo(() => {
    const uniqueMap: Record<string, { station: string; longitude: number; latitude: number }> = {};
    
    // First, populate from processedSamples if they contain coordinates (e.g. in hydro mode)
    processedSamples.forEach(s => {
      const key = normalizeStationName(s.station);
      if (key && s.longitude !== undefined && s.latitude !== undefined && !uniqueMap[key]) {
        uniqueMap[key] = { station: s.station!, longitude: s.longitude, latitude: s.latitude };
      }
    });

    // Fallback to stationCoords prop
    stationCoords.forEach(c => {
      const key = normalizeStationName(c.station);
      if (key && !uniqueMap[key]) {
        uniqueMap[key] = { station: c.station, longitude: c.longitude, latitude: c.latitude };
      }
    });
    return Object.values(uniqueMap) as { station: string; longitude: number; latitude: number }[];
  }, [processedSamples, stationCoords]);

  // Derive stations list sorted naturally (e.g. S1, S2, S10)
  const sortedStationsList = useMemo(() => {
    const validSamples = processedSamples.filter(s => s.station && !s.isStd && !s.isBlank);
    const rawList = Array.from(new Set(validSamples.map(g => g.station))) as string[];
    return rawList.sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10);
      const numB = parseInt(b.replace(/\D/g, ''), 10);
      if (isNaN(numA) || isNaN(numB)) {
        return a.localeCompare(b);
      }
      return numA - numB;
    });
  }, [processedSamples]);

  const sortedStationsList1D = useMemo(() => {
    if (stationSortMode1D === 'latitude' && uniqueStationCoords.length > 0) {
      return [...sortedStationsList].sort((a, b) => {
        const coordA = uniqueStationCoords.find(c => normalizeStationName(c.station) === normalizeStationName(a));
        const coordB = uniqueStationCoords.find(c => normalizeStationName(c.station) === normalizeStationName(b));
        if (!coordA) return 1;
        if (!coordB) return -1;
        return coordA.latitude - coordB.latitude;
      });
    }
    if (stationSortMode1D === 'longitude' && uniqueStationCoords.length > 0) {
      return [...sortedStationsList].sort((a, b) => {
        const coordA = uniqueStationCoords.find(c => normalizeStationName(c.station) === normalizeStationName(a));
        const coordB = uniqueStationCoords.find(c => normalizeStationName(c.station) === normalizeStationName(b));
        if (!coordA) return 1;
        if (!coordB) return -1;
        return coordA.longitude - coordB.longitude;
      });
    }
    return sortedStationsList;
  }, [sortedStationsList, stationSortMode1D, uniqueStationCoords]);

  const activeStations2D = useMemo(() => {
    if (sortedStationsList.length === 0) return [];
    const startIdx = sortedStationsList.indexOf(contourStartStation || sortedStationsList[0]);
    const endIdx = sortedStationsList.indexOf(contourEndStation || sortedStationsList[sortedStationsList.length - 1]);
    const minIdx = Math.min(startIdx, endIdx);
    const maxIdx = Math.max(startIdx, endIdx);
    return sortedStationsList.filter((_, idx) => idx >= minIdx && idx <= maxIdx);
  }, [sortedStationsList, contourStartStation, contourEndStation]);

  // Active station coords based on selected range for map zooming
  const mapStations = useMemo(() => {
    if (visSubTab === 'contour2d') {
      const activeNames = activeStations2D.map(normalizeStationName);
      return uniqueStationCoords.filter(s => activeNames.includes(normalizeStationName(s.station)));
    }
    return uniqueStationCoords;
  }, [visSubTab, activeStations2D, uniqueStationCoords]);

  // Automatically toggle top labels based on X-Axis type to avoid duplicate redundancy by default
  useEffect(() => {
    setChartStyles(prev => ({
      ...prev,
      showTopStationLabels: contourXAxis !== 'station'
    }));
    setTextSettings(prev => {
      let labelText = 'Station Index';
      if (contourXAxis === 'longitude') {
        const lons = mapStations.map(s => s.longitude).filter(v => v !== undefined && !isNaN(v));
        const avgLon = lons.length > 0 ? lons.reduce((a, b) => a + b, 0) / lons.length : 0;
        labelText = avgLon < 0 ? 'Longitude (°W)' : 'Longitude (°E)';
      } else if (contourXAxis === 'latitude') {
        const lats = mapStations.map(s => s.latitude).filter(v => v !== undefined && !isNaN(v));
        const avgLat = lats.length > 0 ? lats.reduce((a, b) => a + b, 0) / lats.length : 0;
        labelText = avgLat < 0 ? 'Latitude (°S)' : 'Latitude (°N)';
      }
      return {
        ...prev,
        xAxisLabel: {
          ...prev.xAxisLabel,
          text: labelText
        }
      };
    });
  }, [contourXAxis, mapStations]);

  const densityContoursTS = useMemo(() => {
    const targets = [24.0, 24.5, 25.0, 25.5, 26.0, 26.5, 26.8, 27.0, 27.2, 27.4, 27.6, 27.8, 28.0];
    const sMin = 32.5;
    const sMax = 37.0;
    const steps = 25;
    
    // Bisection solver to find T given S and target density anomaly sigma
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

    return targets.map(sigma => {
      const points = [];
      for (let i = 0; i <= steps; i++) {
        const S = sMin + (i / steps) * (sMax - sMin);
        const T = solveTemp(S, sigma);
        points.push({ salinity: S, temperature: T, sigma });
      }
      return { sigma, points };
    });
  }, []);

  const tsData = useMemo(() => {
    if (!hydroSamples || hydroSamples.length === 0) return [];
    return hydroSamples.map(h => {
      const sal = findValueByKeywords(h.values, ['salinity', 'sal']);
      const temp = findValueByKeywords(h.values, ['temperature', 'temp', 't°c']);
      if (sal === undefined || temp === undefined || isNaN(sal) || isNaN(temp)) return null;
      
      let depthGroup = 'Deep (>1000m)';
      if (h.depth < 200) depthGroup = 'Upper (<200m)';
      else if (h.depth <= 1000) depthGroup = 'Intermediate (200-1000m)';

      return {
        station: h.station,
        depth: h.depth,
        salinity: parseFloat(sal.toFixed(3)),
        temperature: parseFloat(temp.toFixed(3)),
        depthGroup
      };
    }).filter(Boolean) as { station: string; depth: number; salinity: number; temperature: number; depthGroup: string }[];
  }, [hydroSamples]);

  const aouDocData = useMemo(() => {
    const valid = originalProcessedSamples.filter(s => s.station && s.depth !== null && !s.isRejected && !s.isStd && !s.isBlank);
    return valid.map(s => {
      const closest = findHydroDataForSample(s.station, s.depth);
      if (!closest) return null;
      const sal = findValueByKeywords(closest.values, ['salinity', 'sal']);
      const temp = findValueByKeywords(closest.values, ['temperature', 'temp', 't°c']);
      const o2 = findValueByKeywords(closest.values, ['oxygen', 'o2', 'dox', 'd.o']);
      if (sal === undefined || temp === undefined || o2 === undefined || isNaN(sal) || isNaN(temp) || isNaN(o2)) return null;

      const aou = calculateAOU(sal, temp, o2);
      
      let depthGroup = 'Deep (>1000m)';
      if (s.depth! < 200) depthGroup = 'Upper (<200m)';
      else if (s.depth! <= 1000) depthGroup = 'Intermediate (200-1000m)';

      return {
        station: s.station,
        depth: s.depth!,
        doc: s.concentration,
        aou: parseFloat(aou.toFixed(2)),
        depthGroup
      };
    }).filter(Boolean) as { station: string; depth: number; doc: number; aou: number; depthGroup: string }[];
  }, [originalProcessedSamples, findHydroDataForSample]);

  const aouDocStats = useMemo(() => {
    if (aouDocData.length < 2) return null;
    const points = aouDocData.map(d => ({ x: d.aou, y: d.doc }));
    const fit = fitCalibrationCurve(points, false);
    return fit; // { slope, intercept, rsq }
  }, [aouDocData]);

  const aouDocRegressionLine = useMemo(() => {
    if (aouDocData.length < 2 || !aouDocStats) return [];
    const aous = aouDocData.map(d => d.aou);
    const minAou = Math.min(...aous);
    const maxAou = Math.max(...aous);
    return [
      { aou: minAou, doc: aouDocStats.slope * minAou + aouDocStats.intercept },
      { aou: maxAou, doc: aouDocStats.slope * maxAou + aouDocStats.intercept }
    ];
  }, [aouDocData, aouDocStats]);

  const stationJitteredCoords2D = useMemo(() => {
    const validSamples = processedSamples.filter(
      s => s.station !== null && s.depth !== null && !s.isRejected && !s.isBlank && !s.isStd
    );
    const jitteredCoords: Record<string, number> = {};
    const seenCoords: Record<number, number> = {};
    activeStations2D.forEach(st => {
      const stSamples = validSamples.filter(s => s.station === st);
      let coord = 0;
      if (contourXAxis === 'longitude') {
        coord = stSamples[0]?.longitude || 0;
      } else if (contourXAxis === 'latitude') {
        coord = stSamples[0]?.latitude || 0;
      } else {
        coord = activeStations2D.indexOf(st);
      }
      const count = seenCoords[coord] || 0;
      seenCoords[coord] = count + 1;
      const jitter = count * 0.0001;
      jitteredCoords[st] = coord + jitter;
    });
    return jitteredCoords;
  }, [activeStations2D, processedSamples, contourXAxis]);

  useEffect(() => {
    if (visSubTab !== 'contour2d' || activeStations2D.length < 2) {
      setHighResBathyPoints([]);
      return;
    }

    let isCancelled = false;
    setLoadingBathy(true);

    async function fetchBathy() {
      const validSamples = processedSamples.filter(
        s => s.station !== null && s.depth !== null && !s.isRejected && !s.isBlank && !s.isStd
      );
      
      const getStationCoords = (st: string) => {
        const normSt = normalizeStationName(st);
        const sc = stationCoords.find(c => normalizeStationName(c.station) === normSt);
        if (sc) return { latitude: sc.latitude, longitude: sc.longitude };

        const usc = uniqueStationCoords.find(c => normalizeStationName(c.station) === normSt);
        if (usc) return { latitude: usc.latitude, longitude: usc.longitude };

        const sample = processedSamples.find(s => normalizeStationName(s.station) === normSt);
        if (sample) return { latitude: sample.latitude || 0, longitude: sample.longitude || 0 };

        return { latitude: 0, longitude: 0 };
      };

      const getStationBaselineDepth = (st: string) => {
        const normSt = normalizeStationName(st);
        const sc = stationCoords.find(c => normalizeStationName(c.station) === normSt);
        if (sc && sc.botDepth !== undefined) return sc.botDepth;

        const stSamples = validSamples.filter(s => normalizeStationName(s.station) === normSt);
        const maxSampleDepth = stSamples.length > 0 ? Math.max(...stSamples.map(s => s.depth || 0)) : 0;
        return maxSampleDepth > 0 ? maxSampleDepth : 100;
      };

      const numSegments = activeStations2D.length - 1;
      const stepsPerSegment = numSegments > 0 ? Math.max(1, Math.floor(80 / numSegments)) : 1;

      interface TrackPoint {
        latitude: number;
        longitude: number;
        xVal: number;
        fallbackDepth: number;
      }

      const trackPoints: TrackPoint[] = [];

      for (let i = 0; i < numSegments; i++) {
        const st1 = activeStations2D[i];
        const st2 = activeStations2D[i + 1];

        const coord1 = getStationCoords(st1);
        const coord2 = getStationCoords(st2);

        const d1 = getStationBaselineDepth(st1);
        const d2 = getStationBaselineDepth(st2);

        const x1 = stationJitteredCoords2D[st1] || 0;
        const x2 = stationJitteredCoords2D[st2] || 0;

        const startT = (i === 0) ? 0 : (1 / stepsPerSegment);
        for (let j = Math.round(startT * stepsPerSegment); j <= stepsPerSegment; j++) {
          const t = j / stepsPerSegment;
          trackPoints.push({
            latitude: coord1.latitude + (coord2.latitude - coord1.latitude) * t,
            longitude: coord1.longitude + (coord2.longitude - coord1.longitude) * t,
            xVal: x1 + (x2 - x1) * t,
            fallbackDepth: d1 + (d2 - d1) * t
          });
        }
      }

      if (trackPoints.length === 0) {
        if (!isCancelled) {
          setHighResBathyPoints([]);
          setLoadingBathy(false);
        }
        return;
      }

      // 1. Try local GeoTIFF file first if uploaded (highly efficient on-demand windowed read)
      if (localTiffFile) {
        try {
          const tiff = await fromBlob(localTiffFile);
          const image = await tiff.getImage();
          const width = image.getWidth();
          const height = image.getHeight();
          const bbox = image.getBoundingBox(); // [minX, minY, maxX, maxY] -> [minLon, minLat, maxLon, maxLat]
          const [minLon, minLat, maxLon, maxLat] = bbox;

          const tiffPoints: { xVal: number; depth: number }[] = [];

          for (const pt of trackPoints) {
            if (isCancelled) return;
            if (
              pt.longitude >= minLon &&
              pt.longitude <= maxLon &&
              pt.latitude >= minLat &&
              pt.latitude <= maxLat
            ) {
              const xPercent = (pt.longitude - minLon) / (maxLon - minLon);
              const yPercent = (maxLat - pt.latitude) / (maxLat - minLat);
              const px = Math.max(0, Math.min(width - 1, Math.floor(xPercent * (width - 1))));
              const py = Math.max(0, Math.min(height - 1, Math.floor(yPercent * (height - 1))));

              // Read exactly 1x1 pixel window to minimize memory footprint
              const rasters = await image.readRasters({
                window: [px, py, px + 1, py + 1]
              });
              const val = rasters[0] ? (rasters[0] as any)[0] : null;

              let depth = pt.fallbackDepth;
              if (val !== null && val !== undefined && !isNaN(val) && val < 50000 && val > -50000) {
                depth = Math.abs(val);
              }
              tiffPoints.push({ xVal: pt.xVal, depth });
            } else {
              tiffPoints.push({ xVal: pt.xVal, depth: pt.fallbackDepth });
            }
          }

          if (!isCancelled) {
            setHighResBathyPoints(tiffPoints);
            setBathySource('tiff');
            setLoadingBathy(false);
          }
          return;
        } catch (err) {
          console.error("Failed to read local GeoTIFF, falling back to online API:", err);
          // Let it fall through to API fetching
        }
      }

      const fetchedPoints: { xVal: number; depth: number }[] = [];
      const CHUNK_SIZE = 100;

      try {
        for (let idx = 0; idx < trackPoints.length; idx += CHUNK_SIZE) {
          if (isCancelled) return;
          const chunk = trackPoints.slice(idx, idx + CHUNK_SIZE);
          const locationsParam = chunk
            .map(p => `${p.latitude},${p.longitude}`)
            .join('|');

          let response: Response | null = null;
          let fetchErr: any = null;

          // 1. Try local Vite proxy first
          try {
            response = await fetch(
              `/api-bathy/v1/gebco2020?locations=${encodeURIComponent(locationsParam)}`
            );
          } catch (e) {
            fetchErr = e;
          }
          // 2. If local proxy returned 404 (production) or failed, try direct fetch first (OpenTopoData supports CORS)
          if (!response || response.status === 404) {
            const target = `https://api.opentopodata.org/v1/gebco2020?locations=${encodeURIComponent(locationsParam)}`;
            try {
              response = await fetch(target);
            } catch (dirErr) {
              // 3. Fallback to CORS proxies if direct fetch fails
              try {
                response = await fetch(`https://corsproxy.io/?url=${encodeURIComponent(target)}`);
              } catch (e1) {
                try {
                  response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`);
                } catch (e2) {
                  throw new Error("Direct fetch and all CORS proxies failed: " + (fetchErr || dirErr || e1 || e2));
                }
              }
            }
          }
          if (!response || !response.ok) {
            throw new Error(`HTTP error ${response ? response.status : 'unknown'}`);
          }

          const data = await response.json();
          if (data && Array.isArray(data.results)) {
            data.results.forEach((res: any, resIdx: number) => {
              const pt = chunk[resIdx];
              const depth = res.elevation !== null ? Math.abs(res.elevation) : pt.fallbackDepth;
              fetchedPoints.push({
                xVal: pt.xVal,
                depth: depth
              });
            });
          } else {
            throw new Error("Invalid API response format");
          }

          if (idx + CHUNK_SIZE < trackPoints.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        if (!isCancelled) {
          setHighResBathyPoints(fetchedPoints);
          setBathySource('api');
          setLoadingBathy(false);
        }
      } catch (err) {
        console.warn("Failed to fetch high-res bathymetry, falling back to local interpolation:", err);
        if (!isCancelled) {
          setHighResBathyPoints(trackPoints.map(p => ({
            xVal: p.xVal,
            depth: p.fallbackDepth
          })));
          setBathySource('fallback');
          setLoadingBathy(false);
        }
      }
    }

    fetchBathy();

    return () => {
      isCancelled = true;
    };
  }, [visSubTab, activeStations2D, stationCoords, processedSamples, uniqueStationCoords, contourXAxis, stationJitteredCoords2D, localTiffFile]);

  useEffect(() => {
    if (!selectedStation && sortedStationsList.length > 0) {
      setSelectedStation(sortedStationsList[0]);
    }
  }, [sortedStationsList, selectedStation]);

  useEffect(() => {
    if (sortedStationsList.length > 0) {
      if (!contourStartStation) setContourStartStation(sortedStationsList[0]);
      if (!contourEndStation) setContourEndStation(sortedStationsList[sortedStationsList.length - 1]);
    }
  }, [sortedStationsList]);

  useEffect(() => {
    if (isHydroMode && selectedHydroParam) {
      if (selectedHydroParam === "DOC (µmol/L)") {
        // Reset to original DOC text settings and colorbar
        setTextSettings(prev => ({
          ...prev,
          title: {
            ...prev.title,
            text: 'DOC 空间断面等值线分布图'
          },
          legendLabel: {
            ...prev.legendLabel,
            text: 'DOC 测定值'
          },
          colorbarTitle: {
            ...prev.colorbarTitle,
            text: 'DOC [µmol/L]'
          }
        }));
        
        const docValues = originalProcessedSamples.filter(s => s.station !== null && !s.isRejected && !isNaN(s.concentration)).map(s => s.concentration);
        if (docValues.length > 0) {
          const rangeInfo = getParameterRanges(selectedHydroParam, docValues);
          setDocMin(rangeInfo.min);
          setDocMax(rangeInfo.max);
          setContourStep(rangeInfo.step);
        }
        return;
      }

      // Update text settings
      const displayName = formatParamDisplayName(selectedHydroParam);
      setTextSettings(prev => ({
        ...prev,
        title: {
          ...prev.title,
          text: `${displayName} 空间断面等值线分布图`
        },
        legendLabel: {
          ...prev.legendLabel,
          text: `${displayName} 测量值`
        },
        colorbarTitle: {
          ...prev.colorbarTitle,
          text: displayName
        }
      }));

      // Update color bounds
      const values = hydroSamples
        ? hydroSamples
            .map(h => h.values[selectedHydroParam])
            .filter(v => v !== undefined && !isNaN(v))
        : [];

      if (values.length > 0) {
        const rangeInfo = getParameterRanges(selectedHydroParam, values);
        setDocMin(rangeInfo.min);
        setDocMax(rangeInfo.max);
        setContourStep(rangeInfo.step);
      }
    }
  }, [selectedHydroParam, isHydroMode, originalProcessedSamples, hydroSamples]);
  // Automatically align selectedStation and selectedStationsMulti to current active stations list without force-wiping selections
  useEffect(() => {
    if (sortedStationsList.length > 0) {
      if (!selectedStation) {
        setSelectedStation(sortedStationsList[0]);
      }
      
      if (selectedStationsMulti.length === 0) {
        setSelectedStationsMulti(sortedStationsList.slice(0, Math.min(3, sortedStationsList.length)));
      }

      if (!contourStartStation) {
        setContourStartStation(sortedStationsList[0]);
      }
      if (!contourEndStation) {
        setContourEndStation(sortedStationsList[sortedStationsList.length - 1]);
      }
    }
  }, [sortedStationsList]);
  // Compute data bounds
  const dataBounds = useMemo(() => {
    const valid = processedSamples.filter(s => s.station !== null && s.depth !== null && !s.isRejected && !s.isStd && !s.isBlank);
    if (valid.length === 0) {
      return { minDepth: 0, maxDepth: 1000, minLon: 30, maxLon: 120, minLat: -40, maxLat: 20 };
    }
    const depths = valid.map(s => s.depth as number);
    const lons = valid.map(s => s.longitude || 0);
    const lats = valid.map(s => s.latitude || 0);

    const activeNormNames = Array.from(new Set(valid.map(s => normalizeStationName(s.station))));
    const activeBottomDepths = stationCoords
      .filter(c => activeNormNames.includes(normalizeStationName(c.station)))
      .map(c => c.botDepth || 0);

    const maxBathyDepth = highResBathyPoints.length > 0
      ? Math.max(...highResBathyPoints.map(p => p.depth))
      : 0;

    return {
      minDepth: 0,
      maxDepth: Math.max(...depths, ...activeBottomDepths, maxBathyDepth, 100),
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons),
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats)
    };
  }, [processedSamples, stationCoords, highResBathyPoints]);

  const prevBoundsRef = useRef(dataBounds);
  useEffect(() => {
    // Only reset depth filters if the old filter matched the old full bounds (meaning user hadn't customized it)
    // or if the filter is set to defaults
    const isMinAtPrevMax = minDepthFilter === prevBoundsRef.current.minDepth;
    const isMaxAtPrevMax = maxDepthFilter === prevBoundsRef.current.maxDepth;
    const isDefault = minDepthFilter === 0 && maxDepthFilter === 6000;
    
    if (isMinAtPrevMax || isDefault) {
      setMinDepthFilter(dataBounds.minDepth);
    }
    if (isMaxAtPrevMax || isDefault) {
      setMaxDepthFilter(dataBounds.maxDepth);
    }
    prevBoundsRef.current = dataBounds;
  }, [dataBounds]);

  const prevXBoundsRef = useRef({ minLon: dataBounds.minLon, maxLon: dataBounds.maxLon, minLat: dataBounds.minLat, maxLat: dataBounds.maxLat });
  useEffect(() => {
    if (contourXAxis === 'longitude') {
      const isMinAtPrev = minXFilter === prevXBoundsRef.current.minLon;
      const isMaxAtPrev = maxXFilter === prevXBoundsRef.current.maxLon;
      const isDefault = minXFilter === -180 && maxXFilter === 180;
      if (isMinAtPrev || isDefault) setMinXFilter(dataBounds.minLon);
      if (isMaxAtPrev || isDefault) setMaxXFilter(dataBounds.maxLon);
    } else if (contourXAxis === 'latitude') {
      const isMinAtPrev = minXFilter === prevXBoundsRef.current.minLat;
      const isMaxAtPrev = maxXFilter === prevXBoundsRef.current.maxLat;
      const isDefault = minXFilter === -180 && maxXFilter === 180;
      if (isMinAtPrev || isDefault) setMinXFilter(dataBounds.minLat);
      if (isMaxAtPrev || isDefault) setMaxXFilter(dataBounds.maxLat);
    } else {
      // For station index
      const isMinAtPrev = minXFilter === 0;
      const isMaxAtPrev = maxXFilter === (sortedStationsList.length - 2) || maxXFilter === (sortedStationsList.length - 1) || maxXFilter === 180;
      if (isMinAtPrev || minXFilter === -180) setMinXFilter(0);
      if (isMaxAtPrev || maxXFilter === 180) {
        const count = sortedStationsList.length;
        setMaxXFilter(count > 1 ? count - 1 : 1);
      }
    }
    prevXBoundsRef.current = { minLon: dataBounds.minLon, maxLon: dataBounds.maxLon, minLat: dataBounds.minLat, maxLat: dataBounds.maxLat };
  }, [contourXAxis, dataBounds.minLon, dataBounds.maxLon, dataBounds.minLat, dataBounds.maxLat, sortedStationsList.length]);


  // Cardinal spline interpolator with dynamic tension for custom 1D line smoothness
  const curveType = useMemo(() => {
    if (chartStyles.lineType === 'smooth') {
      const smoothness = chartStyles.lineSmoothness ?? 0.75;
      // tension: 0 (most smooth / curved) to 1 (straight segments / tight)
      return curveCardinal.tension(1 - smoothness);
    }
    return 'linear';
  }, [chartStyles.lineType, chartStyles.lineSmoothness]);

  // 1D Chart Data
  const chart1dData = useMemo(() => {
    if (!selectedStation) return [];

    return processedSamples
      .filter(s => s.station === selectedStation && s.depth !== null && !s.isRejected)
      .map(s => ({
        depth: s.depth as number,
        concentration: parseFloat(s.concentration.toFixed(2)),
        error: parseFloat(s.error.toFixed(2)),
        sampleName: s.sampleName,
        rsd: s.rsd
      }))
      .sort((a, b) => a.depth - b.depth);
  }, [processedSamples, selectedStation]);

  // 1D Unfiltered Chart Data
  const unfilteredChart1dData = useMemo(() => {
    if (!selectedStation) return [];

    return processedSamples
      .filter(s => s.station === selectedStation && s.depth !== null)
      .map(s => ({
        depth: s.depth as number,
        concentration: parseFloat(s.concentration.toFixed(2)),
        error: parseFloat(s.error.toFixed(2)),
        sampleName: s.sampleName,
        rsd: s.rsd,
        isRejected: s.isRejected
      }))
      .sort((a, b) => a.depth - b.depth);
  }, [processedSamples, selectedStation]);

  const lineData = useMemo(() => {
    if (chartStyles.lineType === 'loess') {
      return loessFilter(
        chart1dData.map(d => ({ x: d.concentration, y: d.depth })),
        chartStyles.lineSmoothness ?? 0.75
      ).map(pt => ({
        concentration: pt.x,
        depth: pt.y
      }));
    }
    return chart1dData;
  }, [chart1dData, chartStyles.lineType, chartStyles.lineSmoothness]);

  const sharedYDomain = useMemo(() => {
    const activeStations = selectedStationsMulti.length > 0 ? selectedStationsMulti : (selectedStation ? [selectedStation] : []);
    const validSamples = processedSamples.filter(s => activeStations.includes(s.station!) && s.depth !== null && !s.isRejected);
    if (validSamples.length === 0) return [0, 1000];
    const maxD = Math.max(...validSamples.map(s => s.depth as number));
    return [0, Math.ceil(maxD / 100) * 100 + 100];
  }, [processedSamples, selectedStationsMulti, selectedStation]);

  const sharedXDomain = useMemo(() => {
    const activeStations = selectedStationsMulti.length > 0 ? selectedStationsMulti : (selectedStation ? [selectedStation] : []);
    const validSamples = processedSamples.filter(s => activeStations.includes(s.station!) && s.depth !== null && !s.isRejected);
    if (validSamples.length === 0) return [0, 100];
    const concs = validSamples.map(s => s.concentration);
    const minC = Math.min(...concs);
    const maxC = Math.max(...concs);
    const padding = (maxC - minC) * 0.1 || 5;
    return [Math.max(0, Math.floor((minC - padding) / 5) * 5), Math.ceil((maxC + padding) / 5) * 5];
  }, [processedSamples, selectedStationsMulti, selectedStation]);

  // Canvas element state (callback ref to trigger draw when DOM mounts)
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chart1dContainerRef = useRef<HTMLDivElement>(null);

  const [contourSvgPaths, setContourSvgPaths] = useState<{ path: string; value: number }[]>([]);
  const [densityContourPaths, setDensityContourPaths] = useState<{ path: string; value: number; labelX?: number; labelY?: number; angle?: number }[]>([]);
  const [interpolatedPoints, setInterpolatedPoints] = useState<{ x: number; y: number; name: string }[]>([]);
  const [contourDataPoints, setContourDataPoints] = useState<{ cx: number; cy: number; conc: number; xNorm: number; yNorm: number }[]>([]);
  const [topStationTicks, setTopStationTicks] = useState<{ name: string; cx: number }[]>([]);
  const [bathyPath, setBathyPath] = useState<string>('');

  // Unfiltered Canvas and SVG states
  const [unfilteredCanvasElement, setUnfilteredCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [unfilteredContourSvgPaths, setUnfilteredContourSvgPaths] = useState<{ path: string; value: number }[]>([]);
  const [unfilteredInterpolatedPoints, setUnfilteredInterpolatedPoints] = useState<{ x: number; y: number; name: string }[]>([]);
  const [unfilteredContourDataPoints, setUnfilteredContourDataPoints] = useState<{ cx: number; cy: number; conc: number; xNorm: number; yNorm: number; isRejected?: boolean }[]>([]);
  const [unfilteredTopStationTicks, setUnfilteredTopStationTicks] = useState<{ name: string; cx: number }[]>([]);
  const [unfilteredBathyPath, setUnfilteredBathyPath] = useState<string>('');

  // Floating text double-click handler
  const handleTextDoubleClick = (elementId: keyof TextSettings, e: React.MouseEvent) => {
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    setEditor({
      open: true,
      elementId,
      x: clickX + 260 > rect.width ? rect.width - 270 : clickX,
      y: clickY + 220 > rect.height ? rect.height - 230 : clickY
    });
  };

  // Drag axis mouse down handlers
  const handleYAxisMouseDown = (type: 'pan' | 'scale-min' | 'scale-max', e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragInfo({
      active: true,
      axis: 'y',
      type,
      startX: e.clientX,
      startY: e.clientY,
      startMin: minDepthFilter,
      startMax: maxDepthFilter
    });
  };

  const handleXAxisMouseDown = (type: 'pan' | 'scale-min' | 'scale-max', e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragInfo({
      active: true,
      axis: 'x',
      type,
      startX: e.clientX,
      startY: e.clientY,
      startMin: minXFilter,
      startMax: maxXFilter
    });
  };

  // Drag listeners
  useEffect(() => {
    if (!dragInfo) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragInfo.startX;
      const deltaY = e.clientY - dragInfo.startY;

      if (dragInfo.axis === 'y') {
        const span = dragInfo.startMax - dragInfo.startMin;
        const pixelsPerUnit = 380 / span; // Y-axis height is 380px
        const deltaUnits = deltaY / pixelsPerUnit;

        if (dragInfo.type === 'pan') {
          // Drag down moves view shallower, so we subtract deltaUnits
          const newMin = Math.max(0, dragInfo.startMin - deltaUnits);
          const newMax = dragInfo.startMax - deltaUnits;
          setMinDepthFilter(parseFloat(newMin.toFixed(0)));
          setMaxDepthFilter(parseFloat(newMax.toFixed(0)));
        } else if (dragInfo.type === 'scale-min') {
          const newMin = Math.max(0, Math.min(dragInfo.startMax - 10, dragInfo.startMin - deltaUnits));
          setMinDepthFilter(parseFloat(newMin.toFixed(0)));
        } else if (dragInfo.type === 'scale-max') {
          const newMax = Math.max(dragInfo.startMin + 10, dragInfo.startMax - deltaUnits);
          setMaxDepthFilter(parseFloat(newMax.toFixed(0)));
        }
      } else {
        const span = dragInfo.startMax - dragInfo.startMin;
        const pixelsPerUnit = 700 / span; // X-axis width is 700px
        const deltaUnits = deltaX / pixelsPerUnit;

        if (dragInfo.type === 'pan') {
          // Drag right moves view to lower values, so subtract deltaUnits
          const newMin = dragInfo.startMin - deltaUnits;
          const newMax = dragInfo.startMax - deltaUnits;
          setMinXFilter(parseFloat(newMin.toFixed(2)));
          setMaxXFilter(parseFloat(newMax.toFixed(2)));
        } else if (dragInfo.type === 'scale-min') {
          const newMin = Math.min(dragInfo.startMax - 0.1, dragInfo.startMin - deltaUnits);
          setMinXFilter(parseFloat(newMin.toFixed(2)));
        } else if (dragInfo.type === 'scale-max') {
          const newMax = Math.max(dragInfo.startMin + 0.1, dragInfo.startMax - deltaUnits);
          setMaxXFilter(parseFloat(newMax.toFixed(2)));
        }
      }
    };

    const handleMouseUp = () => {
      setDragInfo(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragInfo]);

  // Legend drag handlers (1D Chart)
  const handleLegendMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLegendDragging({
      startX: e.clientX,
      startY: e.clientY,
      startLeft: legendPos.x,
      startTop: legendPos.y
    });
  };

  useEffect(() => {
    if (!legendDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - legendDragging.startX;
      const deltaY = e.clientY - legendDragging.startY;
      setLegendPos({
        x: Math.max(0, legendDragging.startLeft + deltaX),
        y: Math.max(0, legendDragging.startTop + deltaY)
      });
    };

    const handleMouseUp = () => {
      setLegendDragging(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [legendDragging]);

  // Apply academic theme presets
  const handleApplyTheme = (themeName: 'nature' | 'odv' | 'modern') => {
    if (themeName === 'nature') {
      setChartStyles(prev => ({
        ...prev,
        tickDirection: 'inward',
        closedBorderTicks: true,
        axisStroke: '#000000',
        gridStroke: '#e2e8f0',
        colormap: 'viridis'
      }));
    } else if (themeName === 'odv') {
      setChartStyles(prev => ({
        ...prev,
        tickDirection: 'outward',
        closedBorderTicks: false,
        axisStroke: '#000000',
        gridStroke: '#cbd5e1',
        colormap: 'odv'
      }));
    } else if (themeName === 'modern') {
      setChartStyles(prev => ({
        ...prev,
        tickDirection: 'outward',
        closedBorderTicks: true,
        axisStroke: '#1e293b',
        gridStroke: '#f1f5f9',
        colormap: 'coolwarm'
      }));
    }
  };

  // Color Presets Generator
  const colorsMap = {
    odv: ['#1e3a8a', '#0284c7', '#10b981', '#f59e0b', '#ef4444'],
    viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
    inferno: ['#000004', '#57106e', '#bc3754', '#f98e09', '#fcffa4'],
    coolwarm: ['#3b4cc0', '#88bbff', '#dddddd', '#ff9988', '#b40426'],
    grayscale: ['#000000', '#555555', '#999999', '#dddddd', '#ffffff']
  };

  // 1D Plot download handlers
  const download1DPlot = (format: 'png' | 'svg', isPreview = false) => {
    const container = chart1dContainerRef.current;
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;

    const scale = 3;
    const svgWidth = svg.clientWidth || svg.width.baseVal.value || 500;
    const svgHeight = svg.clientHeight || svg.height.baseVal.value || 400;

    // Direct SVG download
    if (format === 'svg') {
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('width', svgWidth.toString());
      clone.setAttribute('height', svgHeight.toString());
      const svgString = new XMLSerializer().serializeToString(clone);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      if (isPreview) {
        setPreviewModal({ open: true, imgUrl: url, filename: `${selectedStation || 'ST'}_1D_Profile.svg`, format: 'svg' });
      } else {
        const link = document.createElement('a');
        link.download = `${selectedStation || 'ST'}_1D_Profile.svg`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
      }
      return;
    }

    // PNG download
    const combinedCanvas = document.createElement('canvas');
    combinedCanvas.width = svgWidth * scale;
    combinedCanvas.height = svgHeight * scale;
    const ctx = combinedCanvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, svgWidth, svgHeight);

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('width', svgWidth.toString());
    clone.setAttribute('height', svgHeight.toString());
    if (!clone.getAttribute('viewBox')) {
      clone.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
    }

    const svgString = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      const pngUrl = combinedCanvas.toDataURL('image/png');
      if (isPreview) {
        setPreviewModal({ open: true, imgUrl: pngUrl, filename: `${selectedStation || 'ST'}_1D_Profile.png`, format: 'png' });
      } else {
        const link = document.createElement('a');
        link.download = `${selectedStation || 'ST'}_1D_Profile.png`;
        link.href = pngUrl;
        link.click();
      }
    };
    img.src = url;
  };

  const download2DPlot = (format: 'png' | 'svg', isPreview = false) => {
    const canvas = canvasElement;
    if (!canvas) return;

    const svg = canvas.nextElementSibling as SVGSVGElement | null;
    if (!svg) return;

    const width = 940;
    const height = 580;
    const scale = 3;

    if (format === 'svg') {
      // Direct vector SVG download with canvas embedded as base64 image
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('width', width.toString());
      clone.setAttribute('height', height.toString());
      if (!clone.getAttribute('viewBox')) {
        clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
      }

      // Embed canvas raster background as SVG Image element
      const rasterDataUrl = canvas.toDataURL('image/png');
      const svgImage = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      svgImage.setAttribute('x', '100');
      svgImage.setAttribute('y', '90');
      svgImage.setAttribute('width', '700');
      svgImage.setAttribute('height', '380');
      svgImage.setAttribute('href', rasterDataUrl);
      svgImage.setAttribute('clip-path', `url(#plot-area-clip-${instanceId})`);

      // Insert background raster image at the bottom of the SVG groups
      const firstChild = clone.firstChild;
      if (firstChild) {
        clone.insertBefore(svgImage, firstChild);
      } else {
        clone.appendChild(svgImage);
      }

      const svgString = new XMLSerializer().serializeToString(clone);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      if (isPreview) {
        setPreviewModal({ open: true, imgUrl: url, filename: `${selectedStation || 'DOC'}_2D_Contour.svg`, format: 'svg' });
      } else {
        const link = document.createElement('a');
        link.download = `${selectedStation || 'DOC'}_2D_Contour.svg`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
      }
      return;
    }

    // PNG download (100% exact replica matching preview layout sizing)
    const combinedCanvas = document.createElement('canvas');
    combinedCanvas.width = width * scale;
    combinedCanvas.height = height * scale;
    const ctx = combinedCanvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Draw background raster canvas exactly where it sits in the preview (left:100px, top:90px, size: 700x380)
    ctx.drawImage(canvas, 100, 90, 700, 380);

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('width', width.toString());
    clone.setAttribute('height', height.toString());
    if (!clone.getAttribute('viewBox')) {
      clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }

    const svgString = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      const pngUrl = combinedCanvas.toDataURL('image/png');
      if (isPreview) {
        setPreviewModal({ open: true, imgUrl: pngUrl, filename: `${selectedStation || 'DOC'}_2D_Contour.png`, format: 'png' });
      } else {
        const link = document.createElement('a');
        link.download = `${selectedStation || 'DOC'}_2D_Contour.png`;
        link.href = pngUrl;
        link.click();
      }
    };
    img.src = url;
  };

  // 1. Decoupled IDW grid and distance field calculations
  const gridData = useMemo(() => {
    const validSamples = processedSamples.filter(
      s => s.station !== null && s.depth !== null && !s.isRejected && !s.isBlank && !s.isStd
    );

    if (validSamples.length === 0) {
      return null;
    }

    const startIdx = sortedStationsList.indexOf(contourStartStation || sortedStationsList[0]);
    const endIdx = sortedStationsList.indexOf(contourEndStation || sortedStationsList[sortedStationsList.length - 1]);
    const minIdx = Math.min(startIdx, endIdx);
    const maxIdx = Math.max(startIdx, endIdx);

    const getXValue = (s: typeof validSamples[0]) => {
      return stationJitteredCoords2D[s.station!] || 0;
    };

    const filteredSamples = validSamples.filter(s => {
      const stIdx = sortedStationsList.indexOf(s.station!);
      return (
        s.depth! >= minDepthFilter &&
        s.depth! <= maxDepthFilter &&
        stIdx >= minIdx &&
        stIdx <= maxIdx
      );
    });

    if (filteredSamples.length === 0) {
      return null;
    }

    const sampleXValues = filteredSamples.map(s => getXValue(s));
    const minX = sampleXValues.length > 0 ? Math.min(...sampleXValues) : 0;
    const maxX = sampleXValues.length > 0 ? Math.max(...sampleXValues) : 1;
    const minY = minDepthFilter;
    const maxY = maxDepthFilter;
    const xSpan = maxX - minX || 1;
    const ySpan = maxY - minY || 1;

    // Normalized points for interpolation
    const dataPoints = filteredSamples.map(s => {
      let densityVal = 27.0; // default/fallback
      const closestHydro = findHydroDataForSample(s.station, s.depth);
      if (closestHydro) {
        const sal = findValueByKeywords(closestHydro.values, ['salinity', 'sal']);
        const temp = findValueByKeywords(closestHydro.values, ['temperature', 'temp', 't°c']);
        if (sal !== undefined && temp !== undefined) {
          densityVal = calculatePotentialDensityAnomaly(sal, temp);
        }
      }
      return {
        x: (getXValue(s) - minX) / xSpan,
        y: ((s.depth! - minY) / ySpan) * anisotropyFactor,
        z: s.concentration,
        rawX: (getXValue(s) - minX) / xSpan,
        rawY: (s.depth! - minY) / ySpan,
        densityVal
      };
    });

    const getBathyDepthAtX = (xVal: number): number => {
      if (!highResBathyPoints || highResBathyPoints.length === 0) {
        const sortedBathy = activeStations2D.map(st => {
          const stSamples = validSamples.filter(s => s.station === st);
          const normSt = normalizeStationName(st);
          const sc = stationCoords.find(c => normalizeStationName(c.station) === normSt);
          const botDepthVal = sc?.botDepth !== undefined ? sc.botDepth
            : (stSamples.length > 0 ? Math.max(...stSamples.map(s => s.depth || 0)) : 100);
          const stX = stationJitteredCoords2D[st] || 0;
          return { xVal: stX, depth: botDepthVal };
        }).sort((a, b) => a.xVal - b.xVal);

        if (sortedBathy.length === 0) return 6000;

        for (let i = 0; i < sortedBathy.length - 1; i++) {
          if (xVal >= sortedBathy[i].xVal && xVal <= sortedBathy[i+1].xVal) {
            const t = (xVal - sortedBathy[i].xVal) / (sortedBathy[i+1].xVal - sortedBathy[i].xVal || 1);
            return sortedBathy[i].depth + t * (sortedBathy[i+1].depth - sortedBathy[i].depth);
          }
        }
        if (xVal < sortedBathy[0].xVal) return sortedBathy[0].depth;
        return sortedBathy[sortedBathy.length - 1].depth;
      }

      const sortedBathy = [...highResBathyPoints].sort((a, b) => a.xVal - b.xVal);
      for (let i = 0; i < sortedBathy.length - 1; i++) {
        if (xVal >= sortedBathy[i].xVal && xVal <= sortedBathy[i+1].xVal) {
          const t = (xVal - sortedBathy[i].xVal) / (sortedBathy[i+1].xVal - sortedBathy[i].xVal || 1);
          return sortedBathy[i].depth + t * (sortedBathy[i+1].depth - sortedBathy[i].depth);
        }
      }
      if (xVal < sortedBathy[0].xVal) return sortedBathy[0].depth;
      return sortedBathy[sortedBathy.length - 1].depth;
    };

    const isPathBlocked = (pt: any, gridXNorm: number, gridYNorm: number) => {
      if (!chartStyles.respectBathyBarriers) return false;
      const xp = minX + gridXNorm * xSpan;
      const yp = minY + (gridYNorm / anisotropyFactor) * ySpan;
      const xs = minX + pt.rawX * xSpan;
      const ys = minY + pt.rawY * ySpan;
      
      const steps = 10;
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        const xt = xp + t * (xs - xp);
        const yt = yp + t * (ys - yp);
        const dt = getBathyDepthAtX(xt);
        if (yt > dt) {
          return true;
        }
      }
      return false;
    };

    const gridWidth = 80;
    const gridHeight = 80;
    const gridValues = new Float32Array(gridWidth * gridHeight);
    const gridDensityValues = new Float32Array(gridWidth * gridHeight);
    const gridDistSq = new Float32Array(gridWidth * gridHeight);

    for (let r = 0; r < gridHeight; r++) {
      const gridYNorm = (r / (gridHeight - 1)) * anisotropyFactor;
      const rawY = r / (gridHeight - 1);
      
      for (let c = 0; c < gridWidth; c++) {
        const gridXNorm = c / (gridWidth - 1);
        const idx = r * gridWidth + c;
        
        // Filter out points blocked by seabed topography
        const unblockedPoints = dataPoints.filter(pt => !isPathBlocked(pt, gridXNorm, gridYNorm));
        
        // 1. Interpolate value using only unblocked points (or fallback if all are blocked)
        gridValues[idx] = interpolateIDW(unblockedPoints.length > 0 ? unblockedPoints : dataPoints, gridXNorm, gridYNorm, idwPower);
        
        // Interpolate potential density anomaly
        const densityPoints = (unblockedPoints.length > 0 ? unblockedPoints : dataPoints).map(pt => ({
          x: pt.x,
          y: pt.y,
          z: (pt as any).densityVal || 27.0
        }));
        gridDensityValues[idx] = interpolateIDW(densityPoints, gridXNorm, gridYNorm, idwPower);

        // 2. Pre-calculate grid-level minimum squared distance to any data point (Grid-level Distance Field)
        let minDistSq = 999999;
        for (let i = 0; i < dataPoints.length; i++) {
          const dx = gridXNorm - dataPoints[i].rawX;
          const dy = rawY - dataPoints[i].rawY;
          const distSq = dx * dx + dy * dy;
          if (distSq < minDistSq) {
            minDistSq = distSq;
          }
        }
        gridDistSq[idx] = minDistSq;
      }
    }

    const ticksCount = 5;
    const labelsList = [];
    if (contourXAxis === 'station') {
      const step = Math.max(1, Math.floor(activeStations2D.length / ticksCount));
      for (let i = 0; i < activeStations2D.length; i += step) {
        const ratio = Math.max(0, Math.min(1, i / (activeStations2D.length - 1 || 1)));
        labelsList.push({
          x: (invertXAxis2D ? (1 - ratio) : ratio) * 700,
          y: 0,
          name: formatStationLabel(activeStations2D[i]!)
        });
      }
    } else {
      for (let i = 0; i < ticksCount; i++) {
        const ratio = Math.max(0, Math.min(1, i / (ticksCount - 1)));
        const val = minX + ratio * xSpan;
        labelsList.push({
          x: (invertXAxis2D ? (1 - ratio) : ratio) * 700,
          y: 0,
          name: contourXAxis === 'longitude' ? formatLongitude(val) : formatLatitude(val)
        });
      }
    }

    const sampleDots = filteredSamples.map(s => {
      const xVal = getXValue(s);
      const cx = Math.max(0, Math.min(700, invertXAxis2D ? (1 - (xVal - minX) / xSpan) * 700 : ((xVal - minX) / xSpan) * 700));
      const cy = ((s.depth! - minY) / ySpan) * 380;
      return { cx, cy, conc: s.concentration, xNorm: (xVal - minX) / xSpan, yNorm: (s.depth! - minY) / ySpan, station: s.station, depth: s.depth };
    });

    const ticks = activeStations2D.map(st => {
      const xVal = stationJitteredCoords2D[st] || 0;
      const cx = Math.max(0, Math.min(700, invertXAxis2D ? (1 - (xVal - minX) / xSpan) * 700 : ((xVal - minX) / xSpan) * 700));
      return { name: formatStationLabel(st) || '', cx };
    });

    return {
      gridValues,
      gridDensityValues,
      gridDistSq,
      minX,
      maxX,
      xSpan,
      minY,
      maxY,
      ySpan,
      filteredSamples,
      labelsList,
      sampleDots,
      ticks,
      validSamples
    };
  }, [processedSamples, sortedStationsList, idwPower, anisotropyFactor, minDepthFilter, maxDepthFilter, contourStartStation, contourEndStation, activeStations2D, stationJitteredCoords2D, contourXAxis, chartStyles.respectBathyBarriers, highResBathyPoints, stationCoords, invertXAxis2D]);

  // 1b. Decoupled IDW grid and distance field calculations for unfiltered raw data
  const unfilteredGridData = useMemo(() => {
    const unfilteredValidSamples = processedSamples.filter(
      s => s.station !== null && s.depth !== null && !s.isBlank && !s.isStd
    );

    if (unfilteredValidSamples.length === 0) {
      return null;
    }

    const startIdx = sortedStationsList.indexOf(contourStartStation || sortedStationsList[0]);
    const endIdx = sortedStationsList.indexOf(contourEndStation || sortedStationsList[sortedStationsList.length - 1]);
    const minIdx = Math.min(startIdx, endIdx);
    const maxIdx = Math.max(startIdx, endIdx);

    const getXValue = (s: typeof unfilteredValidSamples[0]) => {
      return stationJitteredCoords2D[s.station!] || 0;
    };

    const filteredSamples = unfilteredValidSamples.filter(s => {
      const stIdx = sortedStationsList.indexOf(s.station!);
      return (
        s.depth! >= minDepthFilter &&
        s.depth! <= maxDepthFilter &&
        stIdx >= minIdx &&
        stIdx <= maxIdx
      );
    });

    if (filteredSamples.length === 0) {
      return null;
    }

    const sampleXValues = filteredSamples.map(s => getXValue(s));
    const minX = sampleXValues.length > 0 ? Math.min(...sampleXValues) : 0;
    const maxX = sampleXValues.length > 0 ? Math.max(...sampleXValues) : 1;
    const minY = minDepthFilter;
    const maxY = maxDepthFilter;
    const xSpan = maxX - minX || 1;
    const ySpan = maxY - minY || 1;

    // Normalized points for interpolation
    const dataPoints = filteredSamples.map(s => ({
      x: (getXValue(s) - minX) / xSpan,
      y: ((s.depth! - minY) / ySpan) * anisotropyFactor,
      z: s.concentration,
      rawX: (getXValue(s) - minX) / xSpan,
      rawY: (s.depth! - minY) / ySpan
    }));

    const getBathyDepthAtX = (xVal: number): number => {
      if (!highResBathyPoints || highResBathyPoints.length === 0) {
        const sortedBathy = activeStations2D.map(st => {
          const stSamples = unfilteredValidSamples.filter(s => s.station === st);
          const normSt = normalizeStationName(st);
          const sc = stationCoords.find(c => normalizeStationName(c.station) === normSt);
          const botDepthVal = sc?.botDepth !== undefined ? sc.botDepth
            : (stSamples.length > 0 ? Math.max(...stSamples.map(s => s.depth || 0)) : 100);
          const stX = stationJitteredCoords2D[st] || 0;
          return { xVal: stX, depth: botDepthVal };
        }).sort((a, b) => a.xVal - b.xVal);

        if (sortedBathy.length === 0) return 6000;

        for (let i = 0; i < sortedBathy.length - 1; i++) {
          if (xVal >= sortedBathy[i].xVal && xVal <= sortedBathy[i+1].xVal) {
            const t = (xVal - sortedBathy[i].xVal) / (sortedBathy[i+1].xVal - sortedBathy[i].xVal || 1);
            return sortedBathy[i].depth + t * (sortedBathy[i+1].depth - sortedBathy[i].depth);
          }
        }
        if (xVal < sortedBathy[0].xVal) return sortedBathy[0].depth;
        return sortedBathy[sortedBathy.length - 1].depth;
      }

      const sortedBathy = [...highResBathyPoints].sort((a, b) => a.xVal - b.xVal);
      for (let i = 0; i < sortedBathy.length - 1; i++) {
        if (xVal >= sortedBathy[i].xVal && xVal <= sortedBathy[i+1].xVal) {
          const t = (xVal - sortedBathy[i].xVal) / (sortedBathy[i+1].xVal - sortedBathy[i].xVal || 1);
          return sortedBathy[i].depth + t * (sortedBathy[i+1].depth - sortedBathy[i].depth);
        }
      }
      if (xVal < sortedBathy[0].xVal) return sortedBathy[0].depth;
      return sortedBathy[sortedBathy.length - 1].depth;
    };

    const isPathBlocked = (pt: any, gridXNorm: number, gridYNorm: number) => {
      if (!chartStyles.respectBathyBarriers) return false;
      const xp = minX + gridXNorm * xSpan;
      const yp = minY + (gridYNorm / anisotropyFactor) * ySpan;
      const xs = minX + pt.rawX * xSpan;
      const ys = minY + pt.rawY * ySpan;
      
      const steps = 10;
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        const xt = xp + t * (xs - xp);
        const yt = yp + t * (ys - yp);
        const dt = getBathyDepthAtX(xt);
        if (yt > dt) {
          return true;
        }
      }
      return false;
    };

    const gridWidth = 80;
    const gridHeight = 80;
    const gridValues = new Float32Array(gridWidth * gridHeight);
    const gridDistSq = new Float32Array(gridWidth * gridHeight);

    for (let r = 0; r < gridHeight; r++) {
      const gridYNorm = (r / (gridHeight - 1)) * anisotropyFactor;
      const rawY = r / (gridHeight - 1);
      
      for (let c = 0; c < gridWidth; c++) {
        const gridXNorm = c / (gridWidth - 1);
        const idx = r * gridWidth + c;
        
        // Filter out points blocked by seabed topography
        const unblockedPoints = dataPoints.filter(pt => !isPathBlocked(pt, gridXNorm, gridYNorm));
        
        // 1. Interpolate value using only unblocked points (or fallback if all are blocked)
        gridValues[idx] = interpolateIDW(unblockedPoints.length > 0 ? unblockedPoints : dataPoints, gridXNorm, gridYNorm, idwPower);

        // 2. Pre-calculate grid-level minimum squared distance to any data point (Grid-level Distance Field)
        let minDistSq = 999999;
        for (let i = 0; i < dataPoints.length; i++) {
          const dx = gridXNorm - dataPoints[i].rawX;
          const dy = rawY - dataPoints[i].rawY;
          const distSq = dx * dx + dy * dy;
          if (distSq < minDistSq) {
            minDistSq = distSq;
          }
        }
        gridDistSq[idx] = minDistSq;
      }
    }

    const ticksCount = 5;
    const labelsList = [];
    if (contourXAxis === 'station') {
      const step = Math.max(1, Math.floor(activeStations2D.length / ticksCount));
      for (let i = 0; i < activeStations2D.length; i += step) {
        const ratio = Math.max(0, Math.min(1, i / (activeStations2D.length - 1 || 1)));
        labelsList.push({
          x: (invertXAxis2D ? (1 - ratio) : ratio) * 720,
          y: 0,
          name: formatStationLabel(activeStations2D[i]!)
        });
      }
    } else {
      for (let i = 0; i < ticksCount; i++) {
        const ratio = Math.max(0, Math.min(1, i / (ticksCount - 1)));
        const val = minX + ratio * xSpan;
        labelsList.push({
          x: (invertXAxis2D ? (1 - ratio) : ratio) * 720,
          y: 0,
          name: contourXAxis === 'longitude' ? formatLongitude(val) : formatLatitude(val)
        });
      }
    }

    const sampleDots = filteredSamples.map(s => {
      const xVal = getXValue(s);
      const cx = Math.max(0, Math.min(720, invertXAxis2D ? (1 - (xVal - minX) / xSpan) * 720 : ((xVal - minX) / xSpan) * 720));
      const cy = ((s.depth! - minY) / ySpan) * 380;
      return { cx, cy, conc: s.concentration, xNorm: (xVal - minX) / xSpan, yNorm: (s.depth! - minY) / ySpan, isRejected: s.isRejected, station: s.station, depth: s.depth };
    });

    const ticks = activeStations2D.map(st => {
      const xVal = stationJitteredCoords2D[st] || 0;
      const cx = Math.max(0, Math.min(720, invertXAxis2D ? (1 - (xVal - minX) / xSpan) * 720 : ((xVal - minX) / xSpan) * 720));
      return { name: formatStationLabel(st) || '', cx };
    });

    return {
      gridValues,
      gridDistSq,
      minX,
      maxX,
      xSpan,
      minY,
      maxY,
      ySpan,
      filteredSamples,
      labelsList,
      sampleDots,
      ticks,
      validSamples: unfilteredValidSamples
    };
  }, [processedSamples, sortedStationsList, idwPower, anisotropyFactor, minDepthFilter, maxDepthFilter, contourStartStation, contourEndStation, activeStations2D, stationJitteredCoords2D, contourXAxis, chartStyles.respectBathyBarriers, highResBathyPoints, stationCoords, invertXAxis2D, findHydroDataForSample]);

  // Draw contour plot on dependencies change
  useEffect(() => {
    if (!canvasElement) return;

    const canvas = canvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!gridData) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setContourSvgPaths([]);
      setContourDataPoints([]);
      setInterpolatedPoints([]);
      return;
    }

    const {
      gridValues,
      gridDensityValues,
      gridDistSq,
      minX,
      xSpan,
      minY,
      ySpan,
      labelsList,
      sampleDots,
      ticks,
      validSamples
    } = gridData;

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const imgData = ctx.createImageData(canvasWidth, canvasHeight);
    const paletteColors = colorsMap[chartStyles.colormap || 'odv'];
    
    const colorScale = scaleLinear<string>()
      .domain([
        docMin, 
        docMin + (docMax - docMin) * 0.25, 
        docMin + (docMax - docMin) * 0.5, 
        docMin + (docMax - docMin) * 0.75, 
        docMax
      ])
      .range(paletteColors)
      .clamp(true);

    // OPTIMIZATION: Pre-calculate a 256-color Lookup Table (LUT)
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const ratio = i / 255;
      const valForLut = docMin + ratio * (docMax - docMin || 1);
      const hexColor = colorScale(valForLut);
      let rVal = 0, gVal = 0, bVal = 0;
      if (hexColor.startsWith('#')) {
        rVal = parseInt(hexColor.slice(1, 3), 16);
        gVal = parseInt(hexColor.slice(3, 5), 16);
        bVal = parseInt(hexColor.slice(5, 7), 16);
      } else {
        const match = hexColor.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
        if (match) {
          rVal = parseInt(match[1], 10);
          gVal = parseInt(match[2], 10);
          bVal = parseInt(match[3], 10);
        }
      }
      lut[i * 3] = rVal;
      lut[i * 3 + 1] = gVal;
      lut[i * 3 + 2] = bVal;
    }

    // OPTIMIZATION: Use squared distance to completely avoid expensive Math.sqrt calls inside the loop.
    const maskDistanceSq = chartStyles.maskDistance * chartStyles.maskDistance;
    const gridWidth = 80;
    const gridHeight = 80;

    for (let cy = 0; cy < canvasHeight; cy++) {
      const gridYRatio = cy / (canvasHeight - 1);
      const gy = gridYRatio * (gridHeight - 1);
      const y0 = Math.floor(gy);
      const y1 = Math.min(y0 + 1, gridHeight - 1);
      const ty = gy - y0;

      for (let cx = 0; cx < canvasWidth; cx++) {
        const gridXRatio = invertXAxis2D ? (1 - cx / (canvasWidth - 1)) : (cx / (canvasWidth - 1));
        const gx = gridXRatio * (gridWidth - 1);
        const x0 = Math.floor(gx);
        const x1 = Math.min(x0 + 1, gridWidth - 1);
        const tx = gx - x0;

        // Bilinear interpolate grid values
        const v00 = gridValues[y0 * gridWidth + x0];
        const v10 = gridValues[y0 * gridWidth + x1];
        const v01 = gridValues[y1 * gridWidth + x0];
        const v11 = gridValues[y1 * gridWidth + x1];

        let val = v00 * (1 - tx) * (1 - ty) +
          v10 * tx * (1 - ty) +
          v01 * (1 - tx) * ty +
          v11 * tx * ty;

        // Bilinear interpolate distance squared values (Grid-level Distance Field Masking)
        const d00 = gridDistSq[y0 * gridWidth + x0];
        const d10 = gridDistSq[y0 * gridWidth + x1];
        const d01 = gridDistSq[y1 * gridWidth + x0];
        const d11 = gridDistSq[y1 * gridWidth + x1];

        const distSq = d00 * (1 - tx) * (1 - ty) +
          d10 * tx * (1 - ty) +
          d01 * (1 - tx) * ty +
          d11 * tx * ty;

        // Apply discrete color banding if enabled
        if (chartStyles.colorBanding === 'discrete') {
          const stepsCount = Math.floor((val - docMin) / contourStep);
          val = docMin + stepsCount * contourStep + contourStep / 2;
        }

        const pixelIdx = (cy * canvasWidth + cx) * 4;
        
        // If distance exceeds mask threshold percentage, mask cell to transparent/white
        if (distSq > maskDistanceSq) {
          imgData.data[pixelIdx] = 255;
          imgData.data[pixelIdx + 1] = 255;
          imgData.data[pixelIdx + 2] = 255;
          imgData.data[pixelIdx + 3] = 0;
          continue;
        }

        // Fast LUT lookup
        const valRatio = (val - docMin) / (docMax - docMin || 1);
        const lutIdx = Math.max(0, Math.min(255, Math.floor(valRatio * 255)));
        const rVal = lut[lutIdx * 3];
        const gVal = lut[lutIdx * 3 + 1];
        const bVal = lut[lutIdx * 3 + 2];

        imgData.data[pixelIdx] = rVal;
        imgData.data[pixelIdx + 1] = gVal;
        imgData.data[pixelIdx + 2] = bVal;
        imgData.data[pixelIdx + 3] = 230;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    const thresholds = [];
    for (let t = docMin; t <= docMax; t += contourStep) {
      thresholds.push(t);
    }

    const contourGenerator = contours()
      .size([gridWidth, gridHeight])
      .thresholds(thresholds);

    const computedContours = contourGenerator(Array.from(gridValues));
    const scaleX = canvasWidth / gridWidth;
    const scaleY = canvasHeight / gridHeight;

    const paths = computedContours.map((contour) => {
      let pathStr = "";
      let labelX = 0;
      let labelY = 0;
      let angle = 0;
      if (contour.coordinates) {
        contour.coordinates.forEach((polygon) => {
          polygon.forEach((ring) => {
            ring.forEach((coord, i) => {
              const x = invertXAxis2D ? (gridWidth - coord[0]) * scaleX : coord[0] * scaleX;
              const y = coord[1] * scaleY;
              if (i === 0) pathStr += `M${x},${y}`;
              else pathStr += `L${x},${y}`;
            });
            pathStr += "Z";
          });
        });

        if (contour.coordinates[0] && contour.coordinates[0][0]) {
          const ring = contour.coordinates[0][0];
          const midIdx = Math.floor(ring.length / 2);
          if (ring[midIdx]) {
            labelX = invertXAxis2D ? (gridWidth - ring[midIdx][0]) * scaleX : ring[midIdx][0] * scaleX;
            labelY = ring[midIdx][1] * scaleY;

            // Calculate tangent angle
            const p1 = ring[Math.max(0, midIdx - 2)] || ring[midIdx];
            const p2 = ring[Math.min(ring.length - 1, midIdx + 2)] || ring[midIdx];
            const dx = (p2[0] - p1[0]) * scaleX * (invertXAxis2D ? -1 : 1);
            const dy = (p2[1] - p1[1]) * scaleY;
            if (Math.abs(dx) > 1e-5 || Math.abs(dy) > 1e-5) {
              angle = Math.atan2(dy, dx) * (180 / Math.PI);
              if (angle > 90) angle -= 180;
              if (angle < -90) angle += 180;
            }
          }
        }
      }
      return {
        path: pathStr,
        value: contour.value,
        labelX,
        labelY,
        angle
      };
    });
    setContourSvgPaths(paths);

    if (showDensityOverlay && gridDensityValues) {
      const densityThresholds = [24.0, 24.5, 25.0, 25.5, 26.0, 26.5, 26.8, 27.0, 27.2, 27.4, 27.6, 27.8];
      const densityContourGen = contours()
        .size([gridWidth, gridHeight])
        .thresholds(densityThresholds);
      
      const computedDensityContours = densityContourGen(Array.from(gridDensityValues));
      const densityPaths = computedDensityContours.map((contour) => {
        let pathStr = "";
        let labelX = 0;
        let labelY = 0;
        let angle = 0;
        if (contour.coordinates) {
          contour.coordinates.forEach((polygon) => {
            polygon.forEach((ring) => {
              ring.forEach((coord, i) => {
                const x = invertXAxis2D ? (gridWidth - coord[0]) * scaleX : coord[0] * scaleX;
                const y = coord[1] * scaleY;
                if (i === 0) pathStr += `M${x},${y}`;
                else pathStr += `L${x},${y}`;
              });
              pathStr += "Z";
            });
          });

          if (contour.coordinates[0] && contour.coordinates[0][0]) {
            const ring = contour.coordinates[0][0];
            const midIdx = Math.floor(ring.length / 2);
            if (ring[midIdx]) {
              labelX = invertXAxis2D ? (gridWidth - ring[midIdx][0]) * scaleX : ring[midIdx][0] * scaleX;
              labelY = ring[midIdx][1] * scaleY;

              const p1 = ring[Math.max(0, midIdx - 2)] || ring[midIdx];
              const p2 = ring[Math.min(ring.length - 1, midIdx + 2)] || ring[midIdx];
              const dx = (p2[0] - p1[0]) * scaleX * (invertXAxis2D ? -1 : 1);
              const dy = (p2[1] - p1[1]) * scaleY;
              if (Math.abs(dx) > 1e-5 || Math.abs(dy) > 1e-5) {
                angle = Math.atan2(dy, dx) * (180 / Math.PI);
                if (angle > 90) angle -= 180;
                if (angle < -90) angle += 180;
              }
            }
          }
        }
        return {
          path: pathStr,
          value: contour.value,
          labelX,
          labelY,
          angle
        };
      });
      setDensityContourPaths(densityPaths);
    } else {
      setDensityContourPaths([]);
    }

    setContourDataPoints(sampleDots);
    setInterpolatedPoints(labelsList);

    let bathyPoints: { cx: number; cy: number }[] = [];

    if (highResBathyPoints && highResBathyPoints.length > 0) {
      bathyPoints = highResBathyPoints.map(pt => {
        const cx = invertXAxis2D ? (1 - (pt.xVal - minX) / xSpan) * canvasWidth : ((pt.xVal - minX) / xSpan) * canvasWidth;
        const cy = ((pt.depth - minY) / ySpan) * canvasHeight;
        return { cx, cy };
      });
    } else {
      bathyPoints = activeStations2D.map(st => {
        const stSamples = validSamples.filter(s => s.station === st);
        const normSt = normalizeStationName(st);
        const stCoords = stationCoords.filter(c => normalizeStationName(c.station) === normSt);
        const botDepthVal = stCoords.find(c => c.botDepth !== undefined)?.botDepth
          || Math.max(...stSamples.map(s => s.depth || 0), 100);

        const xVal = stationJitteredCoords2D[st] || 0;
        const cx = invertXAxis2D ? (1 - (xVal - minX) / xSpan) * canvasWidth : ((xVal - minX) / xSpan) * canvasWidth;
        const cy = ((botDepthVal - minY) / ySpan) * canvasHeight;
        return { cx, cy };
      });
    }

    bathyPoints.sort((a, b) => a.cx - b.cx);

    let pathStr = "";
    if (bathyPoints.length > 0) {
      pathStr = `M0,${canvasHeight}`;
      pathStr += ` L0,${Math.max(0, Math.min(canvasHeight, bathyPoints[0].cy))}`;
      bathyPoints.forEach(pt => {
        pathStr += ` L${Math.max(0, Math.min(canvasWidth, pt.cx))},${Math.max(0, Math.min(canvasHeight, pt.cy))}`;
      });
      pathStr += ` L${canvasWidth},${Math.max(0, Math.min(canvasHeight, bathyPoints[bathyPoints.length - 1].cy))}`;
      pathStr += ` L${canvasWidth},${canvasHeight} Z`;
    }
    setBathyPath(pathStr);
    setTopStationTicks(ticks);
  }, [canvasElement, gridData, docMin, docMax, contourStep, chartStyles.colormap, chartStyles.colorBanding, chartStyles.maskDistance, activeStations2D, stationJitteredCoords2D, highResBathyPoints, showDensityOverlay]);

  // Draw unfiltered contour plot on dependencies change
  useEffect(() => {
    if (!unfilteredCanvasElement || !showUnfilteredComparison) return;

    const canvas = unfilteredCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!unfilteredGridData) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setUnfilteredContourSvgPaths([]);
      setUnfilteredContourDataPoints([]);
      setUnfilteredInterpolatedPoints([]);
      return;
    }

    const {
      gridValues,
      gridDistSq,
      minX,
      xSpan,
      minY,
      ySpan,
      labelsList,
      sampleDots,
      ticks,
      validSamples
    } = unfilteredGridData;

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const imgData = ctx.createImageData(canvasWidth, canvasHeight);
    const paletteColors = colorsMap[chartStyles.colormap || 'odv'];
    
    const colorScale = scaleLinear<string>()
      .domain([
        docMin, 
        docMin + (docMax - docMin) * 0.25, 
        docMin + (docMax - docMin) * 0.5, 
        docMin + (docMax - docMin) * 0.75, 
        docMax
      ])
      .range(paletteColors)
      .clamp(true);

    // Pre-calculate a 256-color Lookup Table (LUT)
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const ratio = i / 255;
      const valForLut = docMin + ratio * (docMax - docMin || 1);
      const hexColor = colorScale(valForLut);
      let rVal = 0, gVal = 0, bVal = 0;
      if (hexColor.startsWith('#')) {
        rVal = parseInt(hexColor.slice(1, 3), 16);
        gVal = parseInt(hexColor.slice(3, 5), 16);
        bVal = parseInt(hexColor.slice(5, 7), 16);
      } else {
        const match = hexColor.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
        if (match) {
          rVal = parseInt(match[1], 10);
          gVal = parseInt(match[2], 10);
          bVal = parseInt(match[3], 10);
        }
      }
      lut[i * 3] = rVal;
      lut[i * 3 + 1] = gVal;
      lut[i * 3 + 2] = bVal;
    }

    const maskDistanceSq = chartStyles.maskDistance * chartStyles.maskDistance;
    const gridWidth = 80;
    const gridHeight = 80;

    for (let cy = 0; cy < canvasHeight; cy++) {
      const gridYRatio = cy / (canvasHeight - 1);
      const gy = gridYRatio * (gridHeight - 1);
      const y0 = Math.floor(gy);
      const y1 = Math.min(y0 + 1, gridHeight - 1);
      const ty = gy - y0;

      for (let cx = 0; cx < canvasWidth; cx++) {
        const gridXRatio = invertXAxis2D ? (1 - cx / (canvasWidth - 1)) : (cx / (canvasWidth - 1));
        const gx = gridXRatio * (gridWidth - 1);
        const x0 = Math.floor(gx);
        const x1 = Math.min(x0 + 1, gridWidth - 1);
        const tx = gx - x0;

        const v00 = gridValues[y0 * gridWidth + x0];
        const v10 = gridValues[y0 * gridWidth + x1];
        const v01 = gridValues[y1 * gridWidth + x0];
        const v11 = gridValues[y1 * gridWidth + x1];

        let val = v00 * (1 - tx) * (1 - ty) +
          v10 * tx * (1 - ty) +
          v01 * (1 - tx) * ty +
          v11 * tx * ty;

        const d00 = gridDistSq[y0 * gridWidth + x0];
        const d10 = gridDistSq[y0 * gridWidth + x1];
        const d01 = gridDistSq[y1 * gridWidth + x0];
        const d11 = gridDistSq[y1 * gridWidth + x1];

        const distSq = d00 * (1 - tx) * (1 - ty) +
          d10 * tx * (1 - ty) +
          d01 * (1 - tx) * ty +
          d11 * tx * ty;

        if (chartStyles.colorBanding === 'discrete') {
          const stepsCount = Math.floor((val - docMin) / contourStep);
          val = docMin + stepsCount * contourStep + contourStep / 2;
        }

        const pixelIdx = (cy * canvasWidth + cx) * 4;
        
        if (distSq > maskDistanceSq) {
          imgData.data[pixelIdx] = 255;
          imgData.data[pixelIdx + 1] = 255;
          imgData.data[pixelIdx + 2] = 255;
          imgData.data[pixelIdx + 3] = 0;
          continue;
        }

        const valRatio = (val - docMin) / (docMax - docMin || 1);
        const lutIdx = Math.max(0, Math.min(255, Math.floor(valRatio * 255)));
        const rVal = lut[lutIdx * 3];
        const gVal = lut[lutIdx * 3 + 1];
        const bVal = lut[lutIdx * 3 + 2];

        imgData.data[pixelIdx] = rVal;
        imgData.data[pixelIdx + 1] = gVal;
        imgData.data[pixelIdx + 2] = bVal;
        imgData.data[pixelIdx + 3] = 230;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    const thresholds = [];
    for (let t = docMin; t <= docMax; t += contourStep) {
      thresholds.push(t);
    }

    const contourGenerator = contours()
      .size([gridWidth, gridHeight])
      .thresholds(thresholds);

    const computedContours = contourGenerator(Array.from(gridValues));
    const scaleX = canvasWidth / gridWidth;
    const scaleY = canvasHeight / gridHeight;

    const paths = computedContours.map((contour) => {
      let pathStr = "";
      let labelX = 0;
      let labelY = 0;
      let angle = 0;
      if (contour.coordinates) {
        contour.coordinates.forEach((polygon) => {
          polygon.forEach((ring) => {
            ring.forEach((coord, i) => {
              const x = invertXAxis2D ? (gridWidth - coord[0]) * scaleX : coord[0] * scaleX;
              const y = coord[1] * scaleY;
              if (i === 0) pathStr += `M${x},${y}`;
              else pathStr += `L${x},${y}`;
            });
            pathStr += "Z";
          });
        });

        if (contour.coordinates[0] && contour.coordinates[0][0]) {
          const ring = contour.coordinates[0][0];
          const midIdx = Math.floor(ring.length / 2);
          if (ring[midIdx]) {
            labelX = invertXAxis2D ? (gridWidth - ring[midIdx][0]) * scaleX : ring[midIdx][0] * scaleX;
            labelY = ring[midIdx][1] * scaleY;

            // Calculate tangent angle
            const p1 = ring[Math.max(0, midIdx - 2)] || ring[midIdx];
            const p2 = ring[Math.min(ring.length - 1, midIdx + 2)] || ring[midIdx];
            const dx = (p2[0] - p1[0]) * scaleX * (invertXAxis2D ? -1 : 1);
            const dy = (p2[1] - p1[1]) * scaleY;
            if (Math.abs(dx) > 1e-5 || Math.abs(dy) > 1e-5) {
              angle = Math.atan2(dy, dx) * (180 / Math.PI);
              if (angle > 90) angle -= 180;
              if (angle < -90) angle += 180;
            }
          }
        }
      }
      return {
        path: pathStr,
        value: contour.value,
        labelX,
        labelY,
        angle
      };
    });
    setUnfilteredContourSvgPaths(paths);
    setUnfilteredContourDataPoints(sampleDots);
    setUnfilteredInterpolatedPoints(labelsList);

    let bathyPoints: { cx: number; cy: number }[] = [];

    if (highResBathyPoints && highResBathyPoints.length > 0) {
      bathyPoints = highResBathyPoints.map(pt => {
        const cx = invertXAxis2D ? (1 - (pt.xVal - minX) / xSpan) * canvasWidth : ((pt.xVal - minX) / xSpan) * canvasWidth;
        const cy = ((pt.depth - minY) / ySpan) * canvasHeight;
        return { cx, cy };
      });
    } else {
      bathyPoints = activeStations2D.map(st => {
        const stSamples = validSamples.filter(s => s.station === st);
        const normSt = normalizeStationName(st);
        const stCoords = stationCoords.filter(c => normalizeStationName(c.station) === normSt);
        const botDepthVal = stCoords.find(c => c.botDepth !== undefined)?.botDepth
          || Math.max(...stSamples.map(s => s.depth || 0), 100);

        const xVal = stationJitteredCoords2D[st] || 0;
        const cx = invertXAxis2D ? (1 - (xVal - minX) / xSpan) * canvasWidth : ((xVal - minX) / xSpan) * canvasWidth;
        const cy = ((botDepthVal - minY) / ySpan) * canvasHeight;
        return { cx, cy };
      });
    }

    bathyPoints.sort((a, b) => a.cx - b.cx);

    let pathStr = "";
    if (bathyPoints.length > 0) {
      pathStr = `M0,${canvasHeight}`;
      pathStr += ` L0,${Math.max(0, Math.min(canvasHeight, bathyPoints[0].cy))}`;
      bathyPoints.forEach(pt => {
        pathStr += ` L${Math.max(0, Math.min(canvasWidth, pt.cx))},${Math.max(0, Math.min(canvasHeight, pt.cy))}`;
      });
      pathStr += ` L${canvasWidth},${Math.max(0, Math.min(canvasHeight, bathyPoints[bathyPoints.length - 1].cy))}`;
      pathStr += ` L${canvasWidth},${canvasHeight} Z`;
    }
    setUnfilteredBathyPath(pathStr);
    setUnfilteredTopStationTicks(ticks);
  }, [unfilteredCanvasElement, showUnfilteredComparison, unfilteredGridData, docMin, docMax, contourStep, chartStyles.colormap, chartStyles.colorBanding, chartStyles.maskDistance, activeStations2D, stationJitteredCoords2D, highResBathyPoints]);

  // Calculate adaptive axis and legend title variables
  const maxDepthLabelLength = Math.max(...[0.0, 0.25, 0.5, 0.75, 1.0].map(r => (minDepthFilter + (maxDepthFilter - minDepthFilter) * r).toFixed(0).length));
  const estimatedYTickWidth = maxDepthLabelLength * (textSettings.ticksLabels.fontSize || 8.5) * 0.6;
  const autoYAxisTitleX = Math.max(15, 110 - estimatedYTickWidth - 12);
  const yAxisTitleX = autoYAxisTitleX - (chartStyles.yAxisTitleOffset || 0);

  const autoXAxisTitleY = 488 + (textSettings.ticksLabels.fontSize || 8.5) + 18;
  const xAxisTitleY = autoXAxisTitleY + (chartStyles.xAxisTitleOffset || 0);

  const colorbarTitleX = 850 + chartStyles.colorbarWidth / 2 + (chartStyles.colorbarTitleXOffset || 0);
  const colorbarTitleY = 80 - (chartStyles.colorbarTitleOffset || 0);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      
      {/* ================= WYSIWYG GLASSMORPHIC EDITOR POPPING OVER CLICK POSITION ================= */}
      {editor.open && activeElementId && (() => {
        const elementId = activeElementId;
        return (
          <div
            style={{
              position: 'absolute',
              left: `${editor.x}px`,
              top: `${editor.y}px`,
              zIndex: 100,
              width: '260px',
              padding: '16px',
              background: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(12px) saturate(180%)',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              fontFamily: 'system-ui, sans-serif'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Wrench size={12} />
                <span>编辑元素样式</span>
              </span>
              <button
                onClick={() => setEditor({ open: false, elementId: '', x: 0, y: 0 })}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '11px', color: '#94a3b8', fontWeight: 'bold' }}
              >
                ✕
              </button>
            </div>

            {/* Text Input (Only show if not ticks or stationLabels which are batch names) */}
            {elementId !== 'stationLabels' && elementId !== 'ticksLabels' && (
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label" style={{ fontSize: '10px' }}>内容文本</label>
                <input
                  type="text"
                  className="input-field"
                  style={{ padding: '4px 8px', fontSize: '12px' }}
                  value={textSettings[elementId].text}
                  onChange={e => setTextSettings(prev => ({
                    ...prev,
                    [elementId]: { ...prev[elementId], text: e.target.value }
                  }))}
                />
              </div>
            )}

            {/* Font Family selector */}
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label" style={{ fontSize: '10px' }}>字体 (Font Family)</label>
              <select
                className="input-field"
                style={{ padding: '4px 6px', fontSize: '11px' }}
                value={textSettings[elementId].fontFamily}
                onChange={e => setTextSettings(prev => ({
                  ...prev,
                  [elementId]: { ...prev[elementId], fontFamily: e.target.value }
                }))}
              >
                <option value="'Times New Roman', Times, serif">Times New Roman (经典学术)</option>
                <option value="Arial, Helvetica, sans-serif">Arial (无衬线)</option>
                <option value="Helvetica, sans-serif">Helvetica (精排线)</option>
                <option value="'Courier New', monospace">Courier New (技术等宽)</option>
              </select>
            </div>

            {/* Font Size slider */}
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label" style={{ fontSize: '10px', display: 'flex', justifyContent: 'space-between' }}>
                <span>字号大小</span>
                <strong style={{ color: '#0ea5e9' }}>{textSettings[elementId].fontSize} px</strong>
              </label>
              <input
                type="range"
                min="8"
                max="32"
                step="0.5"
                className="w-full"
                value={textSettings[elementId].fontSize}
                onChange={e => setTextSettings(prev => ({
                  ...prev,
                  [elementId]: { ...prev[elementId], fontSize: parseFloat(e.target.value) }
                }))}
              />
            </div>

            {/* Bold/Italic Formats */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                style={{
                  flex: 1,
                  padding: '6px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  background: textSettings[elementId].fontWeight === 'bold' ? '#e0f2fe' : '#ffffff',
                  color: textSettings[elementId].fontWeight === 'bold' ? '#0369a1' : '#475569',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
                onClick={() => setTextSettings(prev => ({
                  ...prev,
                  [elementId]: {
                    ...prev[elementId],
                    fontWeight: prev[elementId].fontWeight === 'bold' ? 'normal' : 'bold'
                  }
                }))}
              >
                B
              </button>
              <button
                style={{
                  flex: 1,
                  padding: '6px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  background: textSettings[elementId].fontStyle === 'italic' ? '#e0f2fe' : '#ffffff',
                  color: textSettings[elementId].fontStyle === 'italic' ? '#0369a1' : '#475569',
                  fontStyle: 'italic',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
                onClick={() => setTextSettings(prev => ({
                  ...prev,
                  [elementId]: {
                    ...prev[elementId],
                    fontStyle: prev[elementId].fontStyle === 'italic' ? 'normal' : 'italic'
                  }
                }))}
              >
                I
              </button>
            </div>

            {/* Academic Color Picker */}
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label" style={{ fontSize: '10px' }}>元素色彩</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px', marginTop: '4px' }}>
                {['#000000', '#475569', '#ef4444', '#0284c7', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ffffff'].map(c => (
                  <div
                    key={c}
                    onClick={() => setTextSettings(prev => ({
                      ...prev,
                      [elementId]: { ...prev[elementId], color: c }
                    }))}
                    style={{
                      height: '20px',
                      borderRadius: '4px',
                      background: c,
                      border: textSettings[elementId].color === c ? '2px solid #0284c7' : '1px solid #cbd5e1',
                      cursor: 'pointer'
                    }}
                  />
                ))}
                <input
                  type="color"
                  style={{ width: '100%', height: '20px', padding: 0, border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer' }}
                  value={textSettings[elementId].color}
                  onChange={e => setTextSettings(prev => ({
                    ...prev,
                    [elementId]: { ...prev[elementId], color: e.target.value }
                  }))}
                />
              </div>
            </div>
          </div>
        );
      })()}

      {/* Variable Selector & Sub-tab Selection */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div className="tab-group" style={{ margin: 0 }}>
          <div
            className={`tab-btn ${visSubTab === 'profile1d' ? 'active' : ''}`}
            onClick={() => setVisSubTab('profile1d')}
          >
            <LineChart size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle' }} />
            <span>1D 单站深度剖面图</span>
          </div>
          <div
            className={`tab-btn ${visSubTab === 'contour2d' ? 'active' : ''}`}
            onClick={() => setVisSubTab('contour2d')}
          >
            <Map size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle' }} />
            <span>2D 断面彩色等值线分布图</span>
          </div>
          <div
            className={`tab-btn ${visSubTab === 'tsPlot' ? 'active' : ''}`}
            onClick={() => setVisSubTab('tsPlot')}
          >
            <LineChart size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle' }} />
            <span>T-S (温盐等密度) 水团图</span>
          </div>
          <div
            className={`tab-btn ${visSubTab === 'aouDocPlot' ? 'active' : ''}`}
            onClick={() => setVisSubTab('aouDocPlot')}
          >
            <LineChart size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle' }} />
            <span>AOU vs. DOC 降解关系图</span>
          </div>
        </div>

        {isHydroMode && (
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', margin: 0, flexDirection: 'row' }}>
            <span className="text-xs font-bold text-slate-700">当前绘制参数：</span>
            <select
              className="input-field py-1 px-3 text-sm font-bold text-sky-700 bg-sky-50/20"
              style={{ width: '220px', margin: 0, border: '1px solid #cbd5e1', borderRadius: '6px' }}
              value={selectedHydroParam}
              onChange={(e) => setSelectedHydroParam(e.target.value)}
            >
              {allParameters.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Sub-tab: 1D Profile */}
      {visSubTab === 'profile1d' && (
        <div className="grid-1-2">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Template Presets for 1D */}
            <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="font-semibold text-xs text-slate-700" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Layout size={14} className="text-sky-500" />
                  💾 我的配置暂存与模板
                </span>
                <button
                  className="btn btn-primary"
                  style={{ padding: '2px 8px', fontSize: '10px', height: '22px' }}
                  onClick={handleSaveCurrentPreset}
                >
                  暂存当前
                </button>
              </div>

              {customPresets.length === 0 ? (
                <div style={{ fontSize: '10px', color: '#94a3b8', textAlign: 'center', padding: '6px 0', border: '1px dashed #e2e8f0', borderRadius: '4px' }}>
                  暂无保存的配置
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '120px', overflowY: 'auto' }}>
                  {customPresets.map(preset => (
                    <div
                      key={preset.id}
                      onClick={() => handleApplyPreset(preset)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '4px 8px',
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '4px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                      className="hover:bg-slate-100"
                      title={`保存时间: ${preset.timestamp}`}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px', fontWeight: '500', color: '#334155' }}>
                        {preset.name}
                      </span>
                      <button
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: '#94a3b8',
                          cursor: 'pointer',
                          padding: '2px 4px',
                          fontSize: '12px'
                        }}
                        className="hover:text-red-500"
                        onClick={(e) => handleDeletePreset(preset.id, e)}
                        title="删除模板"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {/* 1D Settings Tabs */}
            <div className="tab-container" style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '8px' }}>
              <div
                className={`tab-btn ${settingsTab1D === 'select' ? 'active' : ''}`}
                onClick={() => setSettingsTab1D('select')}
                style={{ padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
              >
                数据选择
              </div>
              <div
                className={`tab-btn ${settingsTab1D === 'style' ? 'active' : ''}`}
                onClick={() => setSettingsTab1D('style')}
                style={{ padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
              >
                学术样式
              </div>
            </div>

            {settingsTab1D === 'select' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <h3 className="card-title" style={{ margin: '0 0 4px 0' }}>站位地理分布图 (二维散点图)</h3>
                  <p className="text-xs text-slate-400">点击地图中的测站标记或使用下方控制面板切换右侧深度剖面图</p>
                </div>

                {/* Single/Multi Mode Switcher */}
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label" style={{ fontSize: '12px' }}>对比模式 (Comparison Mode)</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className={`btn ${stationMode1D === 'single' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ flex: 1, padding: '6px', fontSize: '12px', fontWeight: 'bold' }}
                      onClick={() => setStationMode1D('single')}
                    >
                      单站模式
                    </button>
                    <button
                      className={`btn ${stationMode1D === 'multi' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ flex: 1, padding: '6px', fontSize: '12px', fontWeight: 'bold' }}
                      onClick={() => setStationMode1D('multi')}
                    >
                      多站对比
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {stationMode1D === 'single' ? (
                    <div className="input-group" style={{ marginBottom: 0 }}>
                      <label className="input-label" style={{ fontSize: '12px' }}>选择目标站位</label>
                      <select
                        className="input-field font-semibold text-sm"
                        value={selectedStation}
                        onChange={e => setSelectedStation(e.target.value)}
                      >
                        {sortedStationsList1D.map(st => {
                          const coord = uniqueStationCoords.find(c => normalizeStationName(c.station) === normalizeStationName(st));
                          const coordText = coord ? ` (${coord.latitude.toFixed(2)}°N, ${coord.longitude.toFixed(2)}°E)` : '';
                          return (
                            <option key={st} value={st}>{st}{coordText}</option>
                          );
                        })}
                      </select>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div className="input-group" style={{ marginBottom: '4px' }}>
                        <label className="input-label" style={{ fontSize: '11px' }}>站位列表排序方式 (Sort Order)</label>
                        <select
                          className="input-field text-xs font-semibold"
                          style={{ padding: '4px 6px' }}
                          value={stationSortMode1D}
                          onChange={e => setStationSortMode1D(e.target.value as any)}
                        >
                          <option value="name">按站位名称 (默认)</option>
                          {uniqueStationCoords.length > 0 && (
                            <>
                              <option value="latitude">按纬度排序 (从南到北)</option>
                              <option value="longitude">按经度排序 (从西到东)</option>
                            </>
                          )}
                        </select>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label className="input-label" style={{ fontSize: '12px' }}>选择对比站位 (可多选)</label>
                        <div style={{ maxHeight: '140px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: 'var(--bg-secondary)' }}>
                          {sortedStationsList1D.map(st => {
                            const isChecked = selectedStationsMulti.includes(st);
                            const coord = uniqueStationCoords.find(c => normalizeStationName(c.station) === normalizeStationName(st));
                            const coordText = coord ? ` (${coord.latitude.toFixed(2)}°N, ${coord.longitude.toFixed(2)}°E)` : '';
                            return (
                              <label key={st} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', userSelect: 'none' }}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {
                                    if (isChecked) {
                                      setSelectedStationsMulti(prev => prev.filter(x => x !== st));
                                      if (focusedStation1D === st) setFocusedStation1D('');
                                    } else {
                                      setSelectedStationsMulti(prev => [...prev, st]);
                                    }
                                  }}
                                />
                                <span style={{ fontWeight: isChecked ? 'bold' : 'normal', color: isChecked ? '#0284c7' : 'inherit' }}>
                                  {st}
                                  <span style={{ fontSize: '10px', color: '#94a3b8', marginLeft: '6px' }}>{coordText}</span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      <div className="input-group" style={{ marginBottom: 0 }}>
                        <label className="input-label" style={{ fontSize: '11px' }}>对比布局方式 (Layout)</label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            className={`btn ${multiLayout1D === 'overlay' ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ flex: 1, padding: '6px', fontSize: '11px', fontWeight: 'bold' }}
                            onClick={() => setMultiLayout1D('overlay')}
                          >
                            单图叠加
                          </button>
                          <button
                            className={`btn ${multiLayout1D === 'grid' ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ flex: 1, padding: '6px', fontSize: '11px', fontWeight: 'bold' }}
                            onClick={() => setMultiLayout1D('grid')}
                          >
                            小图并列
                          </button>
                        </div>
                      </div>

                      {multiLayout1D === 'overlay' && selectedStationsMulti.length > 0 && (
                        <div className="input-group" style={{ marginBottom: 0 }}>
                          <label className="input-label" style={{ fontSize: '11px' }}>高亮焦点站位 (Focus Station)</label>
                          <select
                            className="input-field font-semibold text-xs"
                            value={focusedStation1D}
                            onChange={e => setFocusedStation1D(e.target.value)}
                          >
                            <option value="">-- 无高亮 (全部等同显示) --</option>
                            {selectedStationsMulti.map(st => (
                              <option key={st} value={st}>{st}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {stationCoords.length === 0 ? (
                  <div style={{ padding: '20px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border-color)', textAlign: 'center' }}>
                    <AlertTriangle size={24} className="text-amber-500 mx-auto mb-2" style={{ margin: '0 auto 8px' }} />
                    <p className="text-xs text-slate-500 font-semibold" style={{ margin: 0 }}>未检测到站位经纬度数据</p>
                    <p className="text-[11px] text-slate-400 mt-1" style={{ margin: '4px 0 0' }}>您可以在第一步导入样品经纬度清单（Excel/CSV）以激活此地图联动。</p>
                  </div>
                ) : (
                  <div style={{ width: '100%', height: '220px', position: 'relative' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 10, right: 10, bottom: 5, left: -20 }} style={{ position: 'relative', zIndex: 1 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis
                          type="number"
                          dataKey="longitude"
                          name="经度 (Longitude)"
                          unit="°"
                          stroke="#94a3b8"
                          fontSize={11}
                          domain={['dataMin - 0.5', 'dataMax + 0.5']}
                          tickFormatter={(v) => `${v}°`}
                        />
                        <YAxis
                          type="number"
                          dataKey="latitude"
                          name="纬度 (Latitude)"
                          unit="°"
                          stroke="#94a3b8"
                          fontSize={11}
                          domain={['dataMin - 0.5', 'dataMax + 0.5']}
                          tickFormatter={(v) => `${v}°`}
                        />
                        <Tooltip
                          cursor={{ strokeDasharray: '3 3' }}
                          formatter={(value, name) => {
                            if (name === "经度 (Longitude)") return [`${value}°E`, "经度"];
                            if (name === "纬度 (Latitude)") return [`${value}°N`, "纬度"];
                            return [value, name];
                          }}
                        />
                        <Scatter
                          name="测站"
                          data={uniqueStationCoords.map(c => {
                            const isSelected = normalizeStationName(c.station) === normalizeStationName(selectedStation);
                            return {
                              ...c,
                              fill: isSelected ? '#ef4444' : '#0284c7',
                              size: isSelected ? 120 : 60
                            };
                          })}
                          onClick={(node) => {
                            if (node && node.station) {
                              setSelectedStation(node.station);
                            }
                          }}
                          cursor="pointer"
                        />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {stationCoords.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-tertiary)', padding: '8px 12px', borderRadius: '6px' }}>
                    <span className="text-xs font-semibold text-slate-600">当前选择测站：<strong className="text-sky-600 font-bold">{selectedStation || '无'}</strong></span>
                    {selectedStation && (
                      <span className="text-[11px] text-slate-500 font-medium">
                        经度: {uniqueStationCoords.find(c => normalizeStationName(c.station) === normalizeStationName(selectedStation))?.longitude.toFixed(4) ?? '-'}°E,
                        纬度: {uniqueStationCoords.find(c => normalizeStationName(c.station) === normalizeStationName(selectedStation))?.latitude.toFixed(4) ?? '-'}°N
                      </span>
                    )}
                  </div>
                )}

                <div style={{ maxHeight: '180px', overflowY: 'auto', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                  <table className="custom-table" style={{ fontSize: '13px' }}>
                    <thead>
                      <tr>
                        <th>深度</th>
                        <th>DOC (µmol/L)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chart1dData.map((d, i) => (
                        <tr key={i}>
                          <td className="font-semibold">{d.depth} m</td>
                          <td className="text-sky-700 font-semibold">{d.concentration}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {settingsTab1D === 'style' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h4 style={{ fontSize: '12px', fontWeight: 'bold', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px', margin: '4px 0', color: '#0f172a' }}>1D 剖面图学术样式</h4>

                {/* Font Family selector for 1D */}
                 <div className="input-group">
                   <label className="input-label" style={{ fontSize: '10px' }}>图表字体风格</label>
                   <select className="input-field" style={{ fontSize: '11px' }} value={chartStyles.fontFamily} onChange={e => {
                     const font = e.target.value;
                     setChartStyles(prev => ({ ...prev, fontFamily: font }));
                   }}>
                     <option value="'Times New Roman', Times, serif">Times New Roman (衬线)</option>
                     <option value="Arial, Helvetica, sans-serif">Arial (无衬线)</option>
                     <option value="Helvetica, sans-serif">Helvetica</option>
                     <option value="'Courier New', monospace">Courier New</option>
                   </select>
                 </div>

                <div className="grid-2" style={{ gap: '8px' }}>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label" style={{ fontSize: '10px' }}>符号形状 (Symbol)</label>
                    <select className="input-field" style={{ padding: '6px', fontSize: '11px' }} value={chartStyles.symbolShape} onChange={e => setChartStyles(prev => ({ ...prev, symbolShape: e.target.value as any }))}>
                      <option value="circle">圆形 (●)</option>
                      <option value="square">正方形 (■)</option>
                      <option value="triangle">三角形 (▲)</option>
                      <option value="diamond">菱形 (◆)</option>
                    </select>
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label" style={{ fontSize: '10px' }}>符号大小 (Size)</label>
                    <input type="range" min="3" max="8" step="0.5" className="w-full" value={chartStyles.pointRadius} onChange={e => setChartStyles(prev => ({ ...prev, pointRadius: parseFloat(e.target.value) }))} />
                  </div>
                </div>

                <div className="grid-2" style={{ gap: '8px' }}>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label" style={{ fontSize: '10px' }}>连接线型 (Line)</label>
                    <select className="input-field" style={{ padding: '6px', fontSize: '11px' }} value={chartStyles.lineType} onChange={e => setChartStyles(prev => ({ ...prev, lineType: e.target.value as any }))}>
                      <option value="straight">直线折线 (Straight)</option>
                      <option value="smooth">三次样条插值 (Spline)</option>
                      <option value="loess">LOESS 局部回归平滑</option>
                      <option value="none">无连接线 (Symbol Only)</option>
                    </select>
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label" style={{ fontSize: '10px' }}>刻度朝向 (Ticks)</label>
                    <select className="input-field" style={{ padding: '6px', fontSize: '11px' }} value={chartStyles.tickDirection1D} onChange={e => setChartStyles(prev => ({ ...prev, tickDirection1D: e.target.value as any }))}>
                      <option value="outward">向外 (Outward)</option>
                      <option value="inward">向内 (Inward)</option>
                    </select>
                  </div>
                </div>

                {(chartStyles.lineType === 'smooth' || chartStyles.lineType === 'loess') && (
                  <div className="input-group" style={{ marginTop: '8px', marginBottom: 0 }}>
                    <label className="input-label" style={{ fontSize: '10px', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{chartStyles.lineType === 'smooth' ? '平滑程度 (Smoothness)' : '拟合带宽比例 (Bandwidth)'}</span>
                      <span className="font-bold text-sky-600">{Math.round((chartStyles.lineSmoothness ?? 0.75) * 100)}%</span>
                    </label>
                    <input
                      type="range"
                      min="0.1"
                      max="1.0"
                      step="0.05"
                      className="w-full"
                      value={chartStyles.lineSmoothness ?? 0.75}
                      onChange={e => setChartStyles(prev => ({ ...prev, lineSmoothness: parseFloat(e.target.value) }))}
                    />
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                  <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>
                    <input type="checkbox" checked={chartStyles.invertYAxis1D ?? true} onChange={e => setChartStyles(prev => ({ ...prev, invertYAxis1D: e.target.checked }))} />
                    <span>深度轴向底部递增 (Y-Axis Inverted)</span>
                  </label>
                  <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>
                    <input type="checkbox" checked={chartStyles.showErrorBar} onChange={e => setChartStyles(prev => ({ ...prev, showErrorBar: e.target.checked }))} />
                    <span>开启数据误差棒 (Show Error Bars)</span>
                  </label>
                  <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>
                    <input type="checkbox" checked={chartStyles.show1DGridX} onChange={e => setChartStyles(prev => ({ ...prev, show1DGridX: e.target.checked }))} />
                    <span>显示横向网格线 (Gridlines X)</span>
                  </label>
                  <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>
                    <input type="checkbox" checked={chartStyles.show1DGridY} onChange={e => setChartStyles(prev => ({ ...prev, show1DGridY: e.target.checked }))} />
                    <span>显示纵向网格线 (Gridlines Y)</span>
                  </label>
                  <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', color: 'var(--primary-color, #0284c7)' }}>
                    <input type="checkbox" checked={showUnfilteredComparison} onChange={e => setShowUnfilteredComparison(e.target.checked)} />
                    <span>显示原始未筛选对照图 (对比质控)</span>
                  </label>
                </div>

                {stationMode1D === 'multi' && multiLayout1D === 'grid' && (
                  <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '8px', marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label className="input-label" style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>并列小图专属排版微调</label>
                    <div className="grid-2" style={{ gap: '8px' }}>
                      <div className="input-group" style={{ marginBottom: 0 }}>
                        <label className="input-label" style={{ fontSize: '10px' }}>X轴数据轴位置</label>
                        <select className="input-field" style={{ padding: '6px', fontSize: '11px' }} value={chartStyles.subplotXAxisOrientation || 'top'} onChange={e => setChartStyles(prev => ({ ...prev, subplotXAxisOrientation: e.target.value as any }))}>
                          <option value="top">顶部显示 (Top)</option>
                          <option value="bottom">底部显示 (Bottom)</option>
                        </select>
                      </div>
                      <div className="input-group" style={{ marginBottom: 0 }}>
                        <label className="input-label" style={{ fontSize: '10px', display: 'flex', justifyContent: 'space-between' }}>
                          <span>刻度文字间距</span>
                          <span className="font-bold text-sky-600">{chartStyles.tickMargin1D ?? 6}px</span>
                        </label>
                        <input type="range" min="0" max="20" step="1" className="w-full" value={chartStyles.tickMargin1D ?? 6} onChange={e => setChartStyles(prev => ({ ...prev, tickMargin1D: parseInt(e.target.value, 10) }))} />
                      </div>
                    </div>
                    <div className="input-group" style={{ marginBottom: 0 }}>
                      <label className="input-label" style={{ fontSize: '10px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>小图顶部边距 (Margin Top)</span>
                        <span className="font-bold text-sky-600">{chartStyles.subplotMarginTop ?? 25}px</span>
                      </label>
                      <input type="range" min="10" max="60" step="1" className="w-full" value={chartStyles.subplotMarginTop ?? 25} onChange={e => setChartStyles(prev => ({ ...prev, subplotMarginTop: parseInt(e.target.value, 10) }))} />
                    </div>
                  </div>
                )}

                <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '8px', marginTop: '4px' }}>
                  <label className="input-label" style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>颜色细节定制</label>
                  <div className="grid-3" style={{ gap: '8px', marginTop: '4px' }}>
                    <div>
                      <span style={{ fontSize: '9px', display: 'block', textAlign: 'center' }}>数据符号</span>
                      <input type="color" style={{ width: '100%', height: '24px', cursor: 'pointer' }} value={chartStyles.pointFill1D} onChange={e => {
                        const val = e.target.value;
                        setChartStyles(prev => ({ ...prev, pointFill1D: val, lineStroke1D: val }));
                      }} />
                    </div>
                    <div>
                      <span style={{ fontSize: '9px', display: 'block', textAlign: 'center' }}>数据连线</span>
                      <input type="color" style={{ width: '100%', height: '24px', cursor: 'pointer' }} value={chartStyles.lineStroke1D} onChange={e => setChartStyles(prev => ({ ...prev, lineStroke1D: e.target.value }))} />
                    </div>
                    <div>
                      <span style={{ fontSize: '9px', display: 'block', textAlign: 'center' }}>误差棒</span>
                      <input type="color" style={{ width: '100%', height: '24px', cursor: 'pointer' }} value={chartStyles.errorBarColor} onChange={e => setChartStyles(prev => ({ ...prev, errorBarColor: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid-2" style={{ gap: '8px', marginTop: '8px' }}>
                    <div>
                      <span style={{ fontSize: '9px', display: 'block', textAlign: 'center' }}>主轴线</span>
                      <input type="color" style={{ width: '100%', height: '24px', cursor: 'pointer' }} value={chartStyles.axisStroke1D} onChange={e => setChartStyles(prev => ({ ...prev, axisStroke1D: e.target.value }))} />
                    </div>
                    <div>
                      <span style={{ fontSize: '9px', display: 'block', textAlign: 'center' }}>网格虚线</span>
                      <input type="color" style={{ width: '100%', height: '24px', cursor: 'pointer' }} value={chartStyles.gridStroke1D} onChange={e => setChartStyles(prev => ({ ...prev, gridStroke1D: e.target.value }))} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', flex: 1, minWidth: '930px' }}>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', margin: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3
                className="card-title"
                style={{
                  margin: 0,
                  fontFamily: textSettings.title.fontFamily,
                  fontSize: `${textSettings.title.fontSize + 2}px`,
                  color: textSettings.title.color,
                  fontWeight: textSettings.title.fontWeight,
                  fontStyle: textSettings.title.fontStyle,
                  cursor: 'pointer'
                }}
                onDoubleClick={(e) => handleTextDoubleClick('title', e)}
                title="双击直接编辑标题标题与样式"
              >
                {stationMode1D === 'single'
                  ? (selectedStation ? `${selectedStation} 站位 DOC 垂直剖面图` : textSettings.title.text)
                  : `多站对比 DOC 垂直剖面图 (${selectedStationsMulti.length > 0 ? selectedStationsMulti.join(', ') : '无'})`
                }
              </h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  onClick={() => download1DPlot('png', true)}
                  title="预览 PNG 出图效果"
                >
                  <Info size={12} />
                  <span>预览 PNG</span>
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  onClick={() => download1DPlot('png')}
                >
                  <Download size={12} />
                  <span>保存 PNG</span>
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  onClick={() => download1DPlot('svg', true)}
                  title="预览 SVG 出图效果"
                >
                  <Info size={12} />
                  <span>预览 SVG</span>
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  onClick={() => download1DPlot('svg')}
                >
                  <Download size={12} />
                  <span>导出 SVG</span>
                </button>
              </div>
            </div>

            {/* 1D Plot Container */}
            <div ref={chart1dContainerRef} style={{ width: '100%', minHeight: '400px', height: (stationMode1D === 'multi' && multiLayout1D === 'grid') ? 'auto' : '400px', position: 'relative', overflowY: 'auto' }}>
              {(stationMode1D === 'single' ? chart1dData.length === 0 : selectedStationsMulti.length === 0) ? (
                <div style={{ height: '400px', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#94a3b8' }}>
                  {stationMode1D === 'single' ? '该站位没有可绘制的深度数据点' : '请在左侧多选需要对比的站位'}
                </div>
              ) : (stationMode1D === 'multi' && multiLayout1D === 'grid') ? (
                /* Small Multiples Grid Layout */
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: '16px',
                  width: '100%',
                  padding: '8px'
                }}>
                  {(() => {
                        let activeStations = selectedStationsMulti.length > 0 ? selectedStationsMulti : (selectedStation ? [selectedStation] : []);
                    activeStations = [...activeStations].sort((a, b) => sortedStationsList1D.indexOf(a) - sortedStationsList1D.indexOf(b));
                    return activeStations.map((st, idx) => {
                      const stData = processedSamples
                        .filter(s => s.station === st && s.depth !== null && !s.isRejected)
                        .map(s => ({
                          depth: s.depth as number,
                          concentration: parseFloat(s.concentration.toFixed(2)),
                          error: parseFloat(s.error.toFixed(2)),
                          sampleName: s.sampleName,
                          rsd: s.rsd
                        }))
                        .sort((a, b) => a.depth - b.depth);

                      if (stData.length === 0) {
                        return (
                          <div key={st} className="card" style={{ height: '260px', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#94a3b8', fontSize: '12px' }}>
                            {st} 站无数据
                          </div>
                        );
                      }

                      const fill = MULTI_COLORS[idx % MULTI_COLORS.length];
                      const shapeType = MULTI_SHAPES[idx % MULTI_SHAPES.length];
                      
                      const stLineData = chartStyles.lineType === 'loess'
                        ? loessFilter(stData.map(d => ({ x: d.concentration, y: d.depth })), chartStyles.lineSmoothness ?? 0.75).map(pt => ({
                            concentration: pt.x,
                            depth: pt.y
                          }))
                        : stData;

                      const subplotTopMargin = chartStyles.subplotMarginTop ?? 25;
                      const subplotBottomMargin = chartStyles.subplotXAxisOrientation === 'bottom' ? 30 : 5;
                      const subplotXAxisOrientation = chartStyles.subplotXAxisOrientation ?? 'top';
                      const subplotTickMargin = chartStyles.tickMargin1D ?? 6;

                      return (
                        <div key={st} style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '4px', border: '1px solid #cbd5e1', borderRadius: '8px', backgroundColor: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '4px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>测站: {st}</span>
                            <span style={{ fontSize: '10px', color: '#64748b' }}>({stData.length}点)</span>
                          </div>
                          <div style={{ width: '100%', height: '220px', position: 'relative' }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <ScatterChart margin={{ top: subplotTopMargin, right: 15, bottom: subplotBottomMargin, left: 10 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke={chartStyles.gridStroke1D || '#cbd5e1'} vertical={chartStyles.show1DGridX} horizontal={chartStyles.show1DGridY} />
                                <XAxis
                                  type="number"
                                  dataKey="concentration"
                                  name={isHydroMode ? selectedHydroParam : "浓度"}
                                  unit={isHydroMode ? "" : " µmol/L"}
                                  stroke={chartStyles.axisStroke1D || '#475569'}
                                  fontSize={9}
                                  fontWeight="600"
                                  domain={sharedXDomain}
                                  orientation={subplotXAxisOrientation}
                                  axisLine={{ stroke: chartStyles.axisStroke1D }}
                                  tickLine={{ stroke: chartStyles.axisStroke1D }}
                                  tickSize={chartStyles.tickDirection1D === 'inward' ? -4 : 4}
                                  tickMargin={subplotTickMargin}
                                />
                                <YAxis
                                  type="number"
                                  dataKey="depth"
                                  name="深度"
                                  unit=" m"
                                  stroke={chartStyles.axisStroke1D || '#475569'}
                                  fontSize={9}
                                  fontWeight="600"
                                  reversed={chartStyles.invertYAxis1D ?? true}
                                  tickMargin={subplotTickMargin}
                                  domain={sharedYDomain}
                                  axisLine={{ stroke: chartStyles.axisStroke1D }}
                                  tickLine={{ stroke: chartStyles.axisStroke1D }}
                                  tickSize={chartStyles.tickDirection1D === 'inward' ? -4 : 4}
                                />
                                <Tooltip
                                  cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4' }}
                                  contentStyle={{
                                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                    borderRadius: '6px',
                                    border: '1px solid #e2e8f0',
                                    fontSize: '11px',
                                    padding: '6px'
                                  }}
                                  formatter={(value, name) => {
                                    const displayVal = isHydroMode ? `${value}` : `${value} µmol/L`;
                                    const displayName = isHydroMode ? selectedHydroParam : "DOC 浓度";
                                    if (name === "浓度" || name === "concentration") return [displayVal, displayName];
                                    if (name === "深度" || name === "depth") return [`${value} m`, "测量深度"];
                                    return [value, name];
                                  }}
                                />
                                {chartStyles.lineType !== 'none' && (
                                  <Scatter
                                    name="连线"
                                    data={stLineData}
                                    fill="none"
                                    line={{ stroke: fill, strokeWidth: chartStyles.lineWidth || 2, type: curveType }}
                                    shape={() => <path d="" />}
                                    legendType="none"
                                  />
                                )}
                                <Scatter
                                  name={st}
                                  data={stData}
                                  fill="none"
                                  shape={(props: any) => {
                                    const { cx, cy } = props;
                                    const size = (chartStyles.pointRadius * 2 || 10) * 0.9;
                                    const stroke = '#ffffff';
                                    return renderCustomPointShape(cx, cy, size, fill, stroke, 1.2, shapeType);
                                  }}
                                >
                                  {chartStyles.showErrorBar && (
                                    <ErrorBar
                                      dataKey="error"
                                      direction="x"
                                      stroke={chartStyles.errorBarColor || '#94a3b8'}
                                      strokeWidth={1}
                                      width={chartStyles.errorBarCapWidth || 4}
                                    />
                                  )}
                                </Scatter>
                              </ScatterChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 30, right: 30, bottom: 20, left: 30 }}>
                      <defs>
                        <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0ea5e9" />
                          <stop offset="100%" stopColor="#2563eb" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartStyles.gridStroke1D || '#cbd5e1'} vertical={chartStyles.show1DGridX} horizontal={chartStyles.show1DGridY} />
                      <XAxis
                        type="number"
                        dataKey="concentration"
                        name={isHydroMode ? selectedHydroParam : "DOC 浓度"}
                        unit={isHydroMode ? "" : " µmol/L"}
                        stroke={chartStyles.axisStroke1D || '#475569'}
                        fontSize={11}
                        fontWeight="600"
                        domain={['dataMin - 5', 'dataMax + 5']}
                        orientation="top"
                        axisLine={{ stroke: chartStyles.axisStroke1D }}
                        tickLine={{ stroke: chartStyles.axisStroke1D }}
                        tickSize={chartStyles.tickDirection1D === 'inward' ? -6 : 6}
                      />
                      <YAxis
                        type="number"
                        dataKey="depth"
                        name="深度"
                        unit=" m"
                        stroke={chartStyles.axisStroke1D || '#475569'}
                        fontSize={11}
                        fontWeight="600"
                        reversed={chartStyles.invertYAxis1D ?? true}
                        domain={[0, 'dataMax + 100']}
                        axisLine={{ stroke: chartStyles.axisStroke1D }}
                        tickLine={{ stroke: chartStyles.axisStroke1D }}
                        tickSize={chartStyles.tickDirection1D === 'inward' ? -6 : 6}
                      />
                      <Tooltip
                        cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4' }}
                        contentStyle={{
                          backgroundColor: 'rgba(255, 255, 255, 0.95)',
                          borderRadius: '8px',
                          border: '1px solid #e2e8f0',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                          fontSize: '12px'
                        }}
                        formatter={(value, name) => {
                          const displayVal = isHydroMode ? `${value}` : `${value} µmol/L`;
                          const displayName = isHydroMode ? selectedHydroParam : "DOC 浓度";
                          if (name === "DOC 浓度" || name === "concentration" || name === "浓度") return [displayVal, displayName];
                          if (name === "深度" || name === "depth") return [`${value} m`, "测量深度"];
                          return [value, name];
                        }}
                      />
                      
                      {stationMode1D === 'single' ? (
                        <>
                          {chartStyles.lineType !== 'none' && (
                            <Scatter
                              name="DOC 连线"
                              data={lineData}
                              fill="none"
                              line={{ stroke: chartStyles.lineStroke1D || '#2563eb', strokeWidth: chartStyles.lineWidth || 2, type: curveType }}
                              shape={() => <path d="" />}
                              legendType="none"
                            />
                          )}
                          <Scatter
                            name="DOC 测定值"
                            data={chart1dData}
                            fill="none"
                            shape={(props: any) => {
                              const { cx, cy } = props;
                              const size = chartStyles.pointRadius * 2 || 10;
                              const fill = chartStyles.pointFill1D || '#2563eb';
                              const stroke = chartStyles.pointStroke1D || '#ffffff';
                              const strokeWidth = chartStyles.pointStrokeWidth || 1.5;
                              const shapeType = chartStyles.symbolShape || 'circle';
                              return renderCustomPointShape(cx, cy, size, fill, stroke, strokeWidth, shapeType);
                            }}
                          >
                            {chartStyles.showErrorBar && (
                              <ErrorBar
                                dataKey="error"
                                direction="x"
                                stroke={chartStyles.errorBarColor || '#94a3b8'}
                                strokeWidth={1}
                                width={chartStyles.errorBarCapWidth || 4}
                              />
                            )}
                          </Scatter>
                        </>
                      ) : (
                        (() => {
                          const activeStations = selectedStationsMulti.length > 0 ? selectedStationsMulti : (selectedStation ? [selectedStation] : []);
                          return activeStations.flatMap((st, idx) => {
                            const stData = processedSamples
                              .filter(s => s.station === st && s.depth !== null && !s.isRejected)
                              .map(s => ({
                                depth: s.depth as number,
                                concentration: parseFloat(s.concentration.toFixed(2)),
                                error: parseFloat(s.error.toFixed(2)),
                                sampleName: s.sampleName,
                                rsd: s.rsd
                              }))
                              .sort((a, b) => a.depth - b.depth);

                            if (stData.length === 0) return [];

                            const isFocused = focusedStation1D === st;
                            const isAnyFocused = focusedStation1D !== '';
                            const isDimmed = isAnyFocused && !isFocused;
                            
                            const fill = isDimmed ? '#e2e8f0' : MULTI_COLORS[idx % MULTI_COLORS.length];
                            const stroke = isDimmed ? '#f1f5f9' : '#ffffff';
                            const opacity = isDimmed ? 0.35 : 1.0;
                            const lineWidth = isFocused ? 3.5 : (isDimmed ? 1.0 : (chartStyles.lineWidth || 2));
                            const shapeType = MULTI_SHAPES[idx % MULTI_SHAPES.length];
                            
                            const stLineData = chartStyles.lineType === 'loess'
                              ? loessFilter(stData.map(d => ({ x: d.concentration, y: d.depth })), chartStyles.lineSmoothness ?? 0.75).map(pt => ({
                                  concentration: pt.x,
                                  depth: pt.y
                                }))
                              : stData;

                            return [
                              ...(chartStyles.lineType !== 'none' ? [
                                <Scatter
                                  key={`${st}-line`}
                                  name={`${st} 连线`}
                                  data={stLineData}
                                  fill="none"
                                  line={{ stroke: fill, strokeWidth: lineWidth, type: curveType }}
                                  shape={() => <path d="" />}
                                  legendType="none"
                                  opacity={opacity}
                                />
                              ] : []),
                              <Scatter
                                key={`${st}-points`}
                                name={st}
                                data={stData}
                                fill="none"
                                opacity={opacity}
                                shape={(props: any) => {
                                  const { cx, cy } = props;
                                  const size = chartStyles.pointRadius * 2 || 10;
                                  return renderCustomPointShape(cx, cy, size, fill, stroke, 1.5, shapeType);
                                }}
                              >
                                {chartStyles.showErrorBar && (
                                  <ErrorBar
                                    dataKey="error"
                                    direction="x"
                                    stroke={isDimmed ? '#cbd5e1' : (chartStyles.errorBarColor || '#94a3b8')}
                                    strokeWidth={isFocused ? 1.5 : 1}
                                    width={chartStyles.errorBarCapWidth || 4}
                                  />
                                )}
                              </Scatter>
                            ];
                          });
                        })()
                      )}

                      {/* Render Legend directly inside SVG for export compatibility */}
                      <g
                        transform={`translate(${legendPos.x}, ${legendPos.y})`}
                        style={{ cursor: legendDragging ? 'grabbing' : 'grab', userSelect: 'none' }}
                        onMouseDown={handleLegendMouseDown}
                      >
                        {stationMode1D === 'single' ? (
                          <>
                            {/* Legend Background Box */}
                            <rect
                              width={Math.max(120, 36 + textSettings.legendLabel.text.length * 8 + 12)}
                              height={30}
                              fill="rgba(255, 255, 255, 0.95)"
                              stroke="#cbd5e1"
                              strokeWidth={1}
                              rx={6}
                              ry={6}
                            />
                            {/* Legend Line symbol */}
                            {chartStyles.lineType !== 'none' && (
                              <line
                                x1={8}
                                y1={15}
                                x2={24}
                                y2={15}
                                stroke={chartStyles.lineStroke1D || '#2563eb'}
                                strokeWidth={chartStyles.lineWidth || 2}
                              />
                            )}
                            {/* Legend Point symbol matching the actual shape, color, and size! */}
                            {(() => {
                              const cx = 16;
                              const cy = 15;
                              const fill = chartStyles.pointFill1D || '#2563eb';
                              const stroke = chartStyles.pointStroke1D || '#ffffff';
                              const strokeWidth = 1.5;
                              const shapeType = chartStyles.symbolShape || 'circle';
                              const size = 8;

                              if (shapeType === 'square') {
                                return (
                                  <rect
                                    x={cx - size/2}
                                    y={cy - size/2}
                                    width={size}
                                    height={size}
                                    fill={fill}
                                    stroke={stroke}
                                    strokeWidth={strokeWidth}
                                  />
                                );
                              }
                              if (shapeType === 'triangle') {
                                const points = `${cx},${cy - size/2} ${cx - size/2},${cy + size/2} ${cx + size/2},${cy + size/2}`;
                                return (
                                  <polygon
                                    points={points}
                                    fill={fill}
                                    stroke={stroke}
                                    strokeWidth={strokeWidth}
                                  />
                                );
                              }
                              if (shapeType === 'diamond') {
                                const points = `${cx},${cy - size/2} ${cx + size/2},${cy} ${cx},${cy + size/2} ${cx - size/2},${cy}`;
                                return (
                                  <polygon
                                    points={points}
                                    fill={fill}
                                    stroke={stroke}
                                    strokeWidth={strokeWidth}
                                  />
                                );
                              }
                              return (
                                <circle
                                  cx={cx}
                                  cy={cy}
                                  r={size/2}
                                  fill={fill}
                                  stroke={stroke}
                                  strokeWidth={strokeWidth}
                                />
                              );
                            })()}
                            {/* Legend Text */}
                            <text
                              x={30}
                              y={19}
                              fontFamily={textSettings.legendLabel.fontFamily}
                              fontSize={`${textSettings.legendLabel.fontSize}px`}
                              fill={textSettings.legendLabel.color}
                              fontWeight={textSettings.legendLabel.fontWeight}
                              fontStyle={textSettings.legendLabel.fontStyle}
                              onDoubleClick={(e) => handleTextDoubleClick('legendLabel', e)}
                              style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                            >
                              {textSettings.legendLabel.text}
                            </text>
                          </>
                        ) : (
                          <>
                            {/* Multi station legend box */}
                            {(() => {
                              const activeStations = selectedStationsMulti.length > 0 ? selectedStationsMulti : (selectedStation ? [selectedStation] : []);
                              const itemHeight = 22;
                              const padding = 10;
                              const boxHeight = padding * 2 + activeStations.length * itemHeight;
                              
                              let maxLabelWidth = 0;
                              activeStations.forEach(st => {
                                if (st.length > maxLabelWidth) maxLabelWidth = st.length;
                              });
                              const boxWidth = Math.max(140, 36 + maxLabelWidth * 8 + 12);

                              return (
                                <>
                                  <rect
                                    width={boxWidth}
                                    height={boxHeight}
                                    fill="rgba(255, 255, 255, 0.95)"
                                    stroke="#cbd5e1"
                                    strokeWidth={1}
                                    rx={6}
                                    ry={6}
                                  />
                                  {activeStations.map((st, idx) => {
                                    const yPos = padding + idx * itemHeight + itemHeight / 2;
                                    
                                    const isFocused = focusedStation1D === st;
                                    const isAnyFocused = focusedStation1D !== '';
                                    const isDimmed = isAnyFocused && !isFocused;
                                    
                                    const fill = isDimmed ? '#e2e8f0' : MULTI_COLORS[idx % MULTI_COLORS.length];
                                    const shapeType = MULTI_SHAPES[idx % MULTI_SHAPES.length];
                                    const size = 8;
                                    const cx = 16;
                                    const cy = yPos;
                                    const stroke = isDimmed ? '#cbd5e1' : '#ffffff';
                                    const strokeWidth = 1;
                                    const opacity = isDimmed ? 0.35 : 1.0;

                                    return (
                                      <g
                                        key={st}
                                        style={{ cursor: 'pointer', opacity }}
                                        onClick={() => setFocusedStation1D(focusedStation1D === st ? '' : st)}
                                      >
                                        {chartStyles.lineType !== 'none' && (
                                          <line
                                            x1={8}
                                            y1={yPos}
                                            x2={24}
                                            y2={yPos}
                                            stroke={fill}
                                            strokeWidth={isFocused ? 3.5 : (chartStyles.lineWidth || 2)}
                                          />
                                        )}
                                        {(() => {
                                          if (shapeType === 'square') {
                                            return (
                                              <rect
                                                x={cx - size/2}
                                                y={cy - size/2}
                                                width={size}
                                                height={size}
                                                fill={fill}
                                                stroke={stroke}
                                                strokeWidth={strokeWidth}
                                              />
                                            );
                                          }
                                          if (shapeType === 'triangle') {
                                            const points = `${cx},${cy - size/2} ${cx - size/2},${cy + size/2} ${cx + size/2},${cy + size/2}`;
                                            return (
                                              <polygon
                                                points={points}
                                                fill={fill}
                                                stroke={stroke}
                                                strokeWidth={strokeWidth}
                                              />
                                            );
                                          }
                                          if (shapeType === 'diamond') {
                                            const points = `${cx},${cy - size/2} ${cx + size/2},${cy} ${cx},${cy + size/2} ${cx - size/2},${cy}`;
                                            return (
                                              <polygon
                                                points={points}
                                                fill={fill}
                                                stroke={stroke}
                                                strokeWidth={strokeWidth}
                                              />
                                            );
                                          }
                                          return (
                                            <circle
                                              cx={cx}
                                              cy={cy}
                                              r={size/2}
                                              fill={fill}
                                              stroke={stroke}
                                              strokeWidth={strokeWidth}
                                            />
                                          );
                                        })()}
                                        <text
                                          x={30}
                                          y={yPos + 4}
                                          fontFamily={textSettings.legendLabel.fontFamily}
                                          fontSize={`${textSettings.legendLabel.fontSize}px`}
                                          fill={isFocused ? "#0284c7" : "#0f172a"}
                                          fontWeight={isFocused ? "bold" : "600"}
                                        >
                                          {st}
                                        </text>
                                      </g>
                                    );
                                  })}
                                </>
                              );
                            })()}
                          </>
                        )}
                      </g>
                    </ScatterChart>
                  </ResponsiveContainer>
                </>
              )}
            </div>
            
            <div style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'center', marginTop: '6px' }}>
              <Info size={10} style={{ display: 'inline', marginRight: '3px', verticalAlign: 'middle' }} />
              <span>拖拽上方的图例框可以自由改变其位置，双击主标题、图例均可触发即时样式配置。</span>
            </div>
          </div>

          {showUnfilteredComparison && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', margin: '20px 0 0 0', border: '1px dashed #ef4444' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <h3 style={{ margin: 0, fontFamily: textSettings.title.fontFamily, fontSize: `${textSettings.title.fontSize + 2}px`, color: '#dc2626', fontWeight: 'bold' }}>
                    {stationMode1D === 'single'
                      ? (selectedStation ? `${selectedStation} 站位 DOC 垂直剖面图 (原始未筛选对比)` : '原始未筛选对比图')
                      : `多站对比 DOC 垂直剖面图 (原始未筛选对比)`
                    }
                  </h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: '#dc2626', fontWeight: 600 }}>
                    ⚠️ 此对照图包含已被废弃的数据点（以红色方形标记呈现），可与上方质控后的图表进行直观对比。
                  </p>
                </div>
              </div>

              {/* 1D Plot Container for unfiltered */}
              <div style={{ width: '100%', minHeight: '400px', height: (stationMode1D === 'multi' && multiLayout1D === 'grid') ? 'auto' : '400px', position: 'relative', overflowY: 'auto' }}>
                {(stationMode1D === 'single' ? unfilteredChart1dData.length === 0 : selectedStationsMulti.length === 0) ? (
                  <div style={{ height: '400px', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#94a3b8' }}>
                    {stationMode1D === 'single' ? '该站位没有可绘制的深度数据点' : '请在左侧多选需要对比的站位'}
                  </div>
                ) : (stationMode1D === 'multi' && multiLayout1D === 'grid') ? (
                  /* Small Multiples Grid Layout */
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: '16px',
                    width: '100%',
                    padding: '8px'
                  }}>
                    {(() => {
                      let activeStations = selectedStationsMulti.length > 0 ? selectedStationsMulti : (selectedStation ? [selectedStation] : []);
                      activeStations = [...activeStations].sort((a, b) => sortedStationsList1D.indexOf(a) - sortedStationsList1D.indexOf(b));
                      return activeStations.map((st, idx) => {
                        const stData = processedSamples
                          .filter(s => s.station === st && s.depth !== null)
                          .map(s => ({
                            depth: s.depth as number,
                            concentration: parseFloat(s.concentration.toFixed(2)),
                            error: parseFloat(s.error.toFixed(2)),
                            sampleName: s.sampleName,
                            rsd: s.rsd,
                            isRejected: s.isRejected
                          }))
                          .sort((a, b) => a.depth - b.depth);

                        if (stData.length === 0) {
                          return (
                            <div key={st} className="card" style={{ height: '260px', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#94a3b8', fontSize: '12px' }}>
                              {st} 站无数据
                            </div>
                          );
                        }

                        const fill = MULTI_COLORS[idx % MULTI_COLORS.length];
                        
                        const stLineData = chartStyles.lineType === 'loess'
                          ? loessFilter(stData.map(d => ({ x: d.concentration, y: d.depth })), chartStyles.lineSmoothness ?? 0.75).map(pt => ({
                              concentration: pt.x,
                              depth: pt.y
                            }))
                          : stData;

                        const subplotTopMargin = chartStyles.subplotMarginTop ?? 25;
                        const subplotBottomMargin = chartStyles.subplotXAxisOrientation === 'bottom' ? 30 : 5;
                        const subplotXAxisOrientation = chartStyles.subplotXAxisOrientation ?? 'top';
                        const subplotTickMargin = chartStyles.tickMargin1D ?? 6;

                        return (
                          <div key={st} style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '4px', border: '1px dashed #fca5a5', borderRadius: '8px', backgroundColor: '#fff5f5', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #fee2e2', paddingBottom: '4px' }}>
                              <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#dc2626' }}>测站: {st} (未筛选)</span>
                            </div>
                            <div style={{ width: '100%', height: '220px', position: 'relative' }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <ScatterChart margin={{ top: subplotTopMargin, right: 15, bottom: subplotBottomMargin, left: 10 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke={chartStyles.gridStroke1D || '#cbd5e1'} vertical={chartStyles.show1DGridX} horizontal={chartStyles.show1DGridY} />
                                  <XAxis
                                    type="number"
                                    dataKey="concentration"
                                    name={isHydroMode ? selectedHydroParam : "浓度"}
                                    unit={isHydroMode ? "" : " µmol/L"}
                                    stroke={chartStyles.axisStroke1D || '#475569'}
                                    fontSize={9}
                                    fontWeight="600"
                                    domain={sharedXDomain}
                                    orientation={subplotXAxisOrientation}
                                    axisLine={{ stroke: chartStyles.axisStroke1D }}
                                    tickLine={{ stroke: chartStyles.axisStroke1D }}
                                    tickSize={chartStyles.tickDirection1D === 'inward' ? -4 : 4}
                                    tickMargin={subplotTickMargin}
                                  />
                                  <YAxis
                                    type="number"
                                    dataKey="depth"
                                    name="深度"
                                    unit=" m"
                                    stroke={chartStyles.axisStroke1D || '#475569'}
                                    fontSize={9}
                                    fontWeight="600"
                                    reversed={chartStyles.invertYAxis1D ?? true}
                                    tickMargin={subplotTickMargin}
                                    domain={sharedYDomain}
                                    axisLine={{ stroke: chartStyles.axisStroke1D }}
                                    tickLine={{ stroke: chartStyles.axisStroke1D }}
                                    tickSize={chartStyles.tickDirection1D === 'inward' ? -4 : 4}
                                  />
                                  <Tooltip
                                    cursor={{ stroke: '#dc2626', strokeWidth: 1, strokeDasharray: '4 4' }}
                                    contentStyle={{
                                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                      borderRadius: '6px',
                                      border: '1px solid #fca5a5',
                                      fontSize: '11px',
                                      padding: '6px'
                                    }}
                                  />
                                  {chartStyles.lineType !== 'none' && (
                                    <Scatter
                                      name="连线"
                                      data={stLineData}
                                      fill="none"
                                      line={{ stroke: fill, strokeWidth: chartStyles.lineWidth || 2, type: curveType }}
                                      shape={() => <path d="" />}
                                      legendType="none"
                                    />
                                  )}
                                  <Scatter
                                    name={st}
                                    data={stData}
                                    fill="none"
                                    shape={(props: any) => {
                                      const { cx, cy, payload } = props;
                                      const isPointRejected = payload && payload.isRejected;
                                      const size = isPointRejected ? 10 : (chartStyles.pointRadius * 2 || 10) * 0.9;
                                      const pFill = isPointRejected ? 'rgba(239, 68, 68, 0.4)' : fill;
                                      const pStroke = isPointRejected ? '#dc2626' : '#ffffff';
                                      const pStrokeWidth = isPointRejected ? 2 : 1.2;
                                      const shapeType = isPointRejected ? 'square' : MULTI_SHAPES[idx % MULTI_SHAPES.length];
                                      return renderCustomPointShape(cx, cy, size, pFill, pStroke, pStrokeWidth, shapeType);
                                    }}
                                  >
                                    {chartStyles.showErrorBar && (
                                      <ErrorBar
                                        dataKey="error"
                                        direction="x"
                                        stroke={chartStyles.errorBarColor || '#94a3b8'}
                                        strokeWidth={1}
                                        width={chartStyles.errorBarCapWidth || 4}
                                      />
                                    )}
                                  </Scatter>
                                </ScatterChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                ) : (
                  /* Overlay Mode */
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 30, right: 30, bottom: 20, left: 30 }}>
                      <defs>
                        <linearGradient id="lineGradUnfiltered" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#fca5a5" />
                          <stop offset="100%" stopColor="#dc2626" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartStyles.gridStroke1D || '#cbd5e1'} vertical={chartStyles.show1DGridX} horizontal={chartStyles.show1DGridY} />
                      <XAxis
                        type="number"
                        dataKey="concentration"
                        name={isHydroMode ? selectedHydroParam : "DOC 浓度"}
                        unit={isHydroMode ? "" : " µmol/L"}
                        stroke={chartStyles.axisStroke1D || '#475569'}
                        fontSize={11}
                        fontWeight="600"
                        domain={['dataMin - 5', 'dataMax + 5']}
                        orientation="top"
                        axisLine={{ stroke: chartStyles.axisStroke1D }}
                        tickLine={{ stroke: chartStyles.axisStroke1D }}
                        tickSize={chartStyles.tickDirection1D === 'inward' ? -6 : 6}
                      />
                      <YAxis
                        type="number"
                        dataKey="depth"
                        name="深度"
                        unit=" m"
                        stroke={chartStyles.axisStroke1D || '#475569'}
                        fontSize={11}
                        fontWeight="600"
                        reversed={chartStyles.invertYAxis1D ?? true}
                        domain={[0, 'dataMax + 100']}
                        axisLine={{ stroke: chartStyles.axisStroke1D }}
                        tickLine={{ stroke: chartStyles.axisStroke1D }}
                        tickSize={chartStyles.tickDirection1D === 'inward' ? -6 : 6}
                      />
                      <Tooltip
                        cursor={{ stroke: '#dc2626', strokeWidth: 1, strokeDasharray: '4 4' }}
                        contentStyle={{
                          backgroundColor: 'rgba(255, 255, 255, 0.95)',
                          borderRadius: '8px',
                          border: '1px solid #fca5a5',
                          fontSize: '12px'
                        }}
                      />
                      
                      {stationMode1D === 'single' ? (
                        <>
                          {chartStyles.lineType !== 'none' && (
                            <Scatter
                              name="DOC 连线"
                              data={chartStyles.lineType === 'smooth'
                                ? loessFilter(unfilteredChart1dData.map(d => ({ x: d.concentration, y: d.depth })), chartStyles.lineSmoothness ?? 0.75).map(pt => ({ concentration: pt.x, depth: pt.y }))
                                : unfilteredChart1dData
                              }
                              fill="none"
                              line={{ stroke: '#dc2626', strokeWidth: chartStyles.lineWidth || 2, type: curveType }}
                              shape={() => <path d="" />}
                              legendType="none"
                            />
                          )}
                          <Scatter
                            name="DOC 原始值"
                            data={unfilteredChart1dData}
                            fill="none"
                            shape={(props: any) => {
                              const { cx, cy, payload } = props;
                              const isPointRejected = payload && payload.isRejected;
                              const size = isPointRejected ? 10 : (chartStyles.pointRadius * 2 || 10);
                              const pFill = isPointRejected ? 'rgba(239, 68, 68, 0.4)' : '#dc2626';
                              const pStroke = isPointRejected ? '#dc2626' : '#ffffff';
                              const pStrokeWidth = isPointRejected ? 2 : (chartStyles.pointStrokeWidth || 1.5);
                              const shapeType = isPointRejected ? 'square' : (chartStyles.symbolShape || 'circle');
                              return renderCustomPointShape(cx, cy, size, pFill, pStroke, pStrokeWidth, shapeType);
                            }}
                          >
                            {chartStyles.showErrorBar && (
                              <ErrorBar
                                dataKey="error"
                                direction="x"
                                stroke={chartStyles.errorBarColor || '#94a3b8'}
                                strokeWidth={1}
                                width={chartStyles.errorBarCapWidth || 4}
                              />
                            )}
                          </Scatter>
                        </>
                      ) : (
                        (() => {
                          const activeStations = selectedStationsMulti.length > 0 ? selectedStationsMulti : (selectedStation ? [selectedStation] : []);
                          return activeStations.flatMap((st, idx) => {
                            const stData = processedSamples
                              .filter(s => s.station === st && s.depth !== null)
                              .map(s => ({
                                depth: s.depth as number,
                                concentration: parseFloat(s.concentration.toFixed(2)),
                                error: parseFloat(s.error.toFixed(2)),
                                sampleName: s.sampleName,
                                rsd: s.rsd,
                                isRejected: s.isRejected
                              }))
                              .sort((a, b) => a.depth - b.depth);

                            if (stData.length === 0) return [];

                            const isFocused = focusedStation1D === st;
                            const isAnyFocused = focusedStation1D !== '';
                            const isDimmed = isAnyFocused && !isFocused;
                            
                            const fill = isDimmed ? '#cbd5e1' : MULTI_COLORS[idx % MULTI_COLORS.length];
                            const stroke = isDimmed ? '#f1f5f9' : '#ffffff';
                            const opacity = isDimmed ? 0.35 : 1.0;
                            const lineWidth = isFocused ? 3.5 : (isDimmed ? 1.0 : (chartStyles.lineWidth || 2));
                            const shapeType = MULTI_SHAPES[idx % MULTI_SHAPES.length];
                            
                            const stLineData = chartStyles.lineType === 'loess'
                              ? loessFilter(stData.map(d => ({ x: d.concentration, y: d.depth })), chartStyles.lineSmoothness ?? 0.75).map(pt => ({
                                  concentration: pt.x,
                                  depth: pt.y
                                }))
                              : stData;

                            return [
                              ...(chartStyles.lineType !== 'none' ? [
                                <Scatter
                                  key={`${st}-line-unf`}
                                  name={`${st} 连线`}
                                  data={stLineData}
                                  fill="none"
                                  line={{ stroke: fill, strokeWidth: lineWidth, type: curveType }}
                                  shape={() => <path d="" />}
                                  legendType="none"
                                  opacity={opacity}
                                />
                              ] : []),
                              <Scatter
                                key={`${st}-points-unf`}
                                name={st}
                                data={stData}
                                fill="none"
                                opacity={opacity}
                                shape={(props: any) => {
                                  const { cx, cy, payload } = props;
                                  const isPointRejected = payload && payload.isRejected;
                                  const size = isPointRejected ? 10 : (chartStyles.pointRadius * 2 || 10);
                                  const pFill = isPointRejected ? 'rgba(239, 68, 68, 0.4)' : fill;
                                  const pStroke = isPointRejected ? '#dc2626' : stroke;
                                  const pStrokeWidth = isPointRejected ? 2 : 1.5;
                                  const pShapeType = isPointRejected ? 'square' : shapeType;
                                  return renderCustomPointShape(cx, cy, size, pFill, pStroke, pStrokeWidth, pShapeType);
                                }}
                              >
                                {chartStyles.showErrorBar && (
                                  <ErrorBar
                                    dataKey="error"
                                    direction="x"
                                    stroke={isDimmed ? '#cbd5e1' : (chartStyles.errorBarColor || '#94a3b8')}
                                    strokeWidth={isFocused ? 1.5 : 1}
                                    width={chartStyles.errorBarCapWidth || 4}
                                  />
                                )}
                              </Scatter>
                            ];
                          });
                        })()
                      )}
                    </ScatterChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )}

          <StationMap
            stations={mapStations}
            selectedStation={selectedStation}
            selectedStationsMulti={selectedStationsMulti}
            focusedStation1D={focusedStation1D}
            stationMode1D={stationMode1D}
            onSelectStation={setSelectedStation}
            onToggleStationMulti={(st) => {
              setSelectedStationsMulti(prev =>
                prev.includes(st) ? prev.filter(x => x !== st) : [...prev, st]
              );
            }}
          />
        </div>
      </div>
      )}

      {/* Sub-tab: 2D Contour */}
      {visSubTab === 'contour2d' && (
        <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '24px', alignItems: 'start' }}>
          
          {/* ================= LEFT SIDEBAR: ORIGIN STYLE MICROPANEL ================= */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {/* Template Presets */}
            <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <h4 className="font-semibold text-xs text-slate-700" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Layout size={14} className="text-sky-500" />
                <span>一键应用学术主题模板</span>
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                <button className="btn btn-secondary" style={{ padding: '6px 4px', fontSize: '10px' }} onClick={() => handleApplyTheme('nature')}>Nature</button>
                <button className="btn btn-secondary" style={{ padding: '6px 4px', fontSize: '10px' }} onClick={() => handleApplyTheme('odv')}>ODV</button>
                <button className="btn btn-secondary" style={{ padding: '6px 4px', fontSize: '10px' }} onClick={() => handleApplyTheme('modern')}>现代蓝色</button>
              </div>

              <div style={{ borderTop: '1px solid #f1f5f9', marginTop: '6px', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="font-semibold text-xs text-slate-700" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    💾 我的配置暂存与模板
                  </span>
                  <button
                    className="btn btn-primary"
                    style={{ padding: '2px 8px', fontSize: '10px', height: '22px' }}
                    onClick={handleSaveCurrentPreset}
                  >
                    暂存当前
                  </button>
                </div>

                {customPresets.length === 0 ? (
                  <div style={{ fontSize: '10px', color: '#94a3b8', textAlign: 'center', padding: '6px 0', border: '1px dashed #e2e8f0', borderRadius: '4px' }}>
                    暂无保存的配置
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '120px', overflowY: 'auto' }}>
                    {customPresets.map(preset => (
                      <div
                        key={preset.id}
                        onClick={() => handleApplyPreset(preset)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '4px 8px',
                          backgroundColor: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          borderRadius: '4px',
                          fontSize: '11px',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                        className="hover:bg-slate-100"
                        title={`保存时间: ${preset.timestamp}`}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px', fontWeight: '500', color: '#334155' }}>
                          {preset.name}
                        </span>
                        <button
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: '#94a3b8',
                            cursor: 'pointer',
                            padding: '2px 4px',
                            fontSize: '12px'
                          }}
                          className="hover:text-red-500"
                          onClick={(e) => handleDeletePreset(preset.id, e)}
                          title="删除模板"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Top-Left Station scatter map on 2D tab */}
            {stationCoords.length > 0 && (
              <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h4 className="font-semibold text-sm text-slate-700" style={{ margin: 0 }}>站位地理分布图</h4>
                <div style={{ width: '100%', height: '150px', position: 'relative' }}>
                  {showBackgroundMap && (
                    <img
                      src="/station_map.jpg"
                      alt="station map"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        opacity: 0.65,
                        pointerEvents: 'none'
                      }}
                    />
                  )}
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 5, right: 5, bottom: -5, left: -20 }} style={{ position: 'relative', zIndex: 1 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis
                        type="number"
                        dataKey="longitude"
                        name="经度"
                        unit="°"
                        stroke="#94a3b8"
                        fontSize={9}
                        domain={['dataMin - 0.5', 'dataMax + 0.5']}
                        tickFormatter={(v) => `${v}°`}
                      />
                      <YAxis
                        type="number"
                        dataKey="latitude"
                        name="纬度"
                        unit="°"
                        stroke="#94a3b8"
                        fontSize={9}
                        domain={['dataMin - 0.5', 'dataMax + 0.5']}
                        tickFormatter={(v) => `${v}°`}
                      />
                      <Tooltip
                        cursor={{ strokeDasharray: '3 3' }}
                        formatter={(value, name) => [`${value}°`, name === "longitude" ? "经度" : "纬度"]}
                      />
                      <Scatter
                        name="测站"
                        data={uniqueStationCoords}
                        fill="#0284c7"
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <div className="card">
              <div className="tab-group" style={{ marginBottom: '12px' }}>
                <div className={`tab-btn ${visSettingsTab === 'data' ? 'active' : ''}`} onClick={() => setVisSettingsTab('data')}>数据过滤</div>
                <div className={`tab-btn ${visSettingsTab === 'style' ? 'active' : ''}`} onClick={() => setVisSettingsTab('style')}>学术样式</div>
              </div>

              {/* Bathymetry Status & Optional Local TIFF Uploader */}
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '6px', padding: '10px', marginBottom: '12px', backgroundColor: 'var(--bg-secondary)' }}>
                <div style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>洋底地形线 (Bathymetry)</span>
                  {localTiffFile && (
                    <button
                      onClick={() => setLocalTiffFile(null)}
                      style={{ fontSize: '10px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      title="清除本地 GeoTIFF 文件，还原为在线 API 模式"
                    >
                      [还原默认 API]
                    </button>
                  )}
                </div>

                {loadingBathy && (
                  <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', padding: '4px 8px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}>
                    <div className="animate-spin" style={{ display: 'inline-block', width: '10px', height: '10px', border: '1.5px solid #0284c7', borderTopColor: 'transparent', borderRadius: '50%' }} />
                    正在{localTiffFile ? '从本地 GeoTIFF 中' : '在线'}解析高精度洋底地形...
                  </div>
                )}

                {!loadingBathy && highResBathyPoints.length > 0 && (
                  <div style={{
                    fontSize: '11px',
                    color: bathySource === 'fallback' ? '#d97706' : '#10b981',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginBottom: '8px',
                    padding: '4px 8px',
                    backgroundColor: bathySource === 'fallback' ? '#fffbeb' : '#ecfdf5',
                    borderRadius: '4px',
                    wordBreak: 'break-all'
                  }}>
                    <span style={{
                      display: 'inline-block',
                      width: '6px',
                      height: '6px',
                      backgroundColor: bathySource === 'fallback' ? '#d97706' : '#10b981',
                      borderRadius: '50%'
                    }} />
                    {bathySource === 'tiff'
                      ? `已启用本地 TIFF 地形: ${localTiffFile?.name}`
                      : bathySource === 'api'
                        ? '已启用 GEBCO 2020 Grid (在线 API)'
                        : '已启用本地线性插值地形 (离线模式)'}
                  </div>
                )}

                {/* File Uploader Input */}
                <div style={{ position: 'relative', marginTop: '6px' }}>
                  <label style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '8px',
                    border: '1px dashed var(--border-color)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    backgroundColor: 'var(--bg-tertiary)',
                    textAlign: 'center',
                    fontSize: '11px',
                    color: 'var(--text-muted)'
                  }}>
                    <span style={{ fontWeight: '500', color: '#0284c7' }}>点击或拖拽上传本地 GeoTIFF (.tif)</span>
                    <span style={{ fontSize: '9px', marginTop: '2px' }}>(可选：用于 GEBCO 2026 等离线高精度地形)</span>
                    <input
                      type="file"
                      accept=".tif,.tiff"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setLocalTiffFile(file);
                        }
                      }}
                    />
                  </label>
                </div>
              </div>

              {visSettingsTab === 'data' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div className="input-group">
                    <label className="input-label">色彩最小值 (µmol C / L)</label>
                    <input
                      type="number"
                      className="input-field"
                      value={docMin}
                      onChange={e => setDocMin(parseFloat(e.target.value) || 0)}
                    />
                  </div>

                  <div className="input-group">
                    <label className="input-label">色彩最大值 (µmol C / L)</label>
                    <input
                      type="number"
                      className="input-field"
                      value={docMax}
                      onChange={e => setDocMax(parseFloat(e.target.value) || 0)}
                    />
                  </div>

                  <div className="input-group">
                    <label className="input-label">等值线分布步长</label>
                    <input
                      type="number"
                      className="input-field"
                      value={contourStep}
                      onChange={e => setContourStep(parseFloat(e.target.value) || 1)}
                    />
                  </div>

                  <div className="input-group">
                    <label className="input-label">深度轴刻度步长 (m)</label>
                    <input
                      type="number"
                      className="input-field"
                      value={depthTickStep}
                      onChange={e => setDepthTickStep(parseFloat(e.target.value) || 100)}
                      step="50"
                      min="10"
                    />
                  </div>

                  <div className="input-group">
                    <label className="input-label">IDW 插值权重幂次方 (Power)</label>
                    <input
                      type="number"
                      className="input-field"
                      value={idwPower}
                      onChange={e => setIdwPower(parseFloat(e.target.value) || 1)}
                      step="0.5"
                      min="1"
                      max="4"
                    />
                  </div>

                  <div className="input-group">
                    <label className="input-label">横/纵向各向异性比例 (Anisotropy)</label>
                    <input
                      type="number"
                      className="input-field"
                      value={anisotropyFactor}
                      onChange={e => setAnisotropyFactor(parseFloat(e.target.value) || 1)}
                      step="1"
                      min="1"
                      max="50"
                    />
                  </div>

                  {/* distance masking threshold slider */}
                  <div className="input-group">
                    <label className="input-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>数据插值截断阈值 (Masking)</span>
                      <strong className="text-amber-600">{Math.round(sliderMaskDistance * 100)}%</strong>
                    </label>
                    <input
                      type="range"
                      min="0.1"
                      max="1.0"
                      step="0.05"
                      className="w-full"
                      value={sliderMaskDistance}
                      onChange={e => {
                        const val = parseFloat(e.target.value);
                        setSliderMaskDistance(val);
                        if (maskDebounceTimer.current) clearTimeout(maskDebounceTimer.current);
                        maskDebounceTimer.current = setTimeout(() => {
                           setChartStyles(prev => ({ ...prev, maskDistance: val }));
                        }, 60);
                      }}
                    />
                    <p style={{ margin: '2px 0 0 0', fontSize: '9.5px', color: '#94a3b8' }}>阈值越小，插值边界越靠近实际测量点，越严谨。</p>
                  </div>

                  <div className="input-group">
                    <label className="input-label">横轴数据类型 (X-Axis)</label>
                    <select
                      className="input-field"
                      value={contourXAxis}
                      onChange={e => setContourXAxis(e.target.value as any)}
                      style={{ fontWeight: '600' }}
                    >
                      <option value="station">站位序号 (Station Index)</option>
                      <option value="longitude">经度 (Longitude)</option>
                      <option value="latitude">纬度 (Latitude)</option>
                    </select>
                  </div>

                  <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                      <input
                        type="checkbox"
                        checked={invertXAxis2D}
                        onChange={e => setInvertXAxis2D(e.target.checked)}
                      />
                      <span>反转横轴方向 (Invert X-Axis)</span>
                    </label>
                    <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                      <input
                        type="checkbox"
                        checked={showContourLabels}
                        onChange={e => setShowContourLabels(e.target.checked)}
                      />
                      <span>显示等值线标签 (Show Contour Labels)</span>
                    </label>
                  </div>

                  {showContourLabels && (
                    <div className="input-group">
                      <label className="input-label" style={{ fontSize: '11px' }}>等值线标签显示范围</label>
                      <select
                        className="input-field text-xs font-semibold"
                        style={{ padding: '4px 6px' }}
                        value={contourLabelMode}
                        onChange={e => setContourLabelMode(e.target.value as any)}
                      >
                        <option value="multiplesOf10">仅标注整十数值 (推荐，如 50, 60, 70)</option>
                        <option value="every2nd">每隔一条线标注 (每 2 级标注一次)</option>
                        <option value="all">标注所有等值线 (可能较凌乱)</option>
                      </select>
                    </div>
                  )}

                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <h4 className="font-semibold text-xs text-slate-600" style={{ margin: 0 }}>断面范围筛选 (Zoom/Filter)</h4>

                    <div className="grid-2" style={{ gap: '8px' }}>
                      <div className="input-group" style={{ marginBottom: 0 }}>
                        <label className="input-label" style={{ fontSize: '11px' }}>最小深度 (m)</label>
                        <input
                          type="number"
                          className="input-field"
                          style={{ padding: '6px' }}
                          value={minDepthFilter}
                          onChange={e => setMinDepthFilter(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="input-group" style={{ marginBottom: 0 }}>
                        <label className="input-label" style={{ fontSize: '11px' }}>最大深度 (m)</label>
                        <input
                          type="number"
                          className="input-field"
                          style={{ padding: '6px' }}
                          value={maxDepthFilter}
                          onChange={e => setMaxDepthFilter(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                    </div>

                    {contourXAxis === 'station' ? (
                      <div className="grid-2" style={{ gap: '8px' }}>
                        <div className="input-group" style={{ marginBottom: 0 }}>
                          <label className="input-label" style={{ fontSize: '11px' }}>起始站位</label>
                          <select
                            className="input-field font-semibold text-xs"
                            style={{ padding: '6px' }}
                            value={sortedStationsList[Math.max(0, Math.min(sortedStationsList.length - 1, Math.round(minXFilter)))] || ''}
                            onChange={e => {
                              const idx = sortedStationsList.indexOf(e.target.value);
                              if (idx !== -1) setMinXFilter(idx);
                            }}
                          >
                            {sortedStationsList.map(st => (
                              <option key={st} value={st}>{st}</option>
                            ))}
                          </select>
                        </div>
                        <div className="input-group" style={{ marginBottom: 0 }}>
                          <label className="input-label" style={{ fontSize: '11px' }}>结束站位</label>
                          <select
                            className="input-field font-semibold text-xs"
                            style={{ padding: '6px' }}
                            value={sortedStationsList[Math.max(0, Math.min(sortedStationsList.length - 1, Math.round(maxXFilter)))] || ''}
                            onChange={e => {
                              const idx = sortedStationsList.indexOf(e.target.value);
                              if (idx !== -1) setMaxXFilter(idx);
                            }}
                          >
                            {sortedStationsList.map(st => (
                              <option key={st} value={st}>{st}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {uniqueStationCoords.length > 0 && (
                          <div className="grid-2" style={{ gap: '8px' }}>
                            <div className="input-group" style={{ marginBottom: 0 }}>
                              <label className="input-label" style={{ fontSize: '11px' }}>参考起始站位</label>
                              <select
                                className="input-field font-semibold text-xs"
                                style={{ padding: '6px' }}
                                value={contourStartStation}
                                onChange={e => {
                                  const val = e.target.value;
                                  setContourStartStation(val);
                                  const coord = uniqueStationCoords.find(c => c.station === val);
                                  if (coord) {
                                    setMinXFilter(contourXAxis === 'longitude' ? coord.longitude : coord.latitude);
                                  }
                                }}
                              >
                                <option value="">-- 自定义数值 --</option>
                                {[...uniqueStationCoords]
                                  .sort((a, b) => 
                                    contourXAxis === 'longitude' 
                                      ? a.longitude - b.longitude 
                                      : a.latitude - b.latitude
                                  )
                                  .map(c => (
                                    <option key={c.station} value={c.station}>
                                      {c.station} ({contourXAxis === 'longitude' ? `${c.longitude.toFixed(2)}°E` : `${c.latitude.toFixed(2)}°N`})
                                    </option>
                                  ))
                                }
                              </select>
                            </div>
                            <div className="input-group" style={{ marginBottom: 0 }}>
                              <label className="input-label" style={{ fontSize: '11px' }}>参考结束站位</label>
                              <select
                                className="input-field font-semibold text-xs"
                                style={{ padding: '6px' }}
                                value={contourEndStation}
                                onChange={e => {
                                  const val = e.target.value;
                                  setContourEndStation(val);
                                  const coord = uniqueStationCoords.find(c => c.station === val);
                                  if (coord) {
                                    setMaxXFilter(contourXAxis === 'longitude' ? coord.longitude : coord.latitude);
                                  }
                                }}
                              >
                                <option value="">-- 自定义数值 --</option>
                                {[...uniqueStationCoords]
                                  .sort((a, b) => 
                                    contourXAxis === 'longitude' 
                                      ? a.longitude - b.longitude 
                                      : a.latitude - b.latitude
                                  )
                                  .map(c => (
                                    <option key={c.station} value={c.station}>
                                      {c.station} ({contourXAxis === 'longitude' ? `${c.longitude.toFixed(2)}°E` : `${c.latitude.toFixed(2)}°N`})
                                    </option>
                                  ))
                                }
                              </select>
                            </div>
                          </div>
                        )}
                        <div className="grid-2" style={{ gap: '8px' }}>
                          <div className="input-group" style={{ marginBottom: 0 }}>
                            <label className="input-label" style={{ fontSize: '11px' }}>
                              {contourXAxis === 'longitude' ? '最小经度 (°)' : '最小纬度 (°)'}
                            </label>
                            <input
                              type="number"
                              className="input-field"
                              style={{ padding: '6px' }}
                              value={minXFilter}
                              onChange={e => {
                                const val = parseFloat(e.target.value) || 0;
                                setMinXFilter(val);
                                const currentCoord = uniqueStationCoords.find(c => c.station === contourStartStation);
                                if (currentCoord) {
                                  const targetCoord = contourXAxis === 'longitude' ? currentCoord.longitude : currentCoord.latitude;
                                  if (Math.abs(targetCoord - val) > 0.0001) {
                                    setContourStartStation('');
                                  }
                                } else {
                                  setContourStartStation('');
                                }
                              }}
                              step="any"
                            />
                          </div>
                          <div className="input-group" style={{ marginBottom: 0 }}>
                            <label className="input-label" style={{ fontSize: '11px' }}>
                              {contourXAxis === 'longitude' ? '最大经度 (°)' : '最大纬度 (°)'}
                            </label>
                            <input
                              type="number"
                              className="input-field"
                              style={{ padding: '6px' }}
                              value={maxXFilter}
                              onChange={e => {
                                const val = parseFloat(e.target.value) || 0;
                                setMaxXFilter(val);
                                const currentCoord = uniqueStationCoords.find(c => c.station === contourEndStation);
                                if (currentCoord) {
                                  const targetCoord = contourXAxis === 'longitude' ? currentCoord.longitude : currentCoord.latitude;
                                  if (Math.abs(targetCoord - val) > 0.0001) {
                                    setContourEndStation('');
                                  }
                                } else {
                                  setContourEndStation('');
                                }
                              }}
                              step="any"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px', marginTop: '10px' }}>
                    <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', color: 'var(--primary-color, #0284c7)' }}>
                      <input type="checkbox" checked={showUnfilteredComparison} onChange={e => setShowUnfilteredComparison(e.target.checked)} />
                      <span>显示原始未筛选对照图 (对比质控)</span>
                    </label>
                  </div>
                </div>
              )}

              {/* 🎨 ACADEMIC STYLE CONTROLS */}
              {visSettingsTab === 'style' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* Global controls */}
                  <div className="input-group">
                     <label className="input-label">图表全局字体</label>
                     <select className="input-field" style={{ fontSize: '12px' }} value={chartStyles.fontFamily} onChange={e => {
                       const font = e.target.value;
                       setChartStyles(prev => ({ ...prev, fontFamily: font }));
                       setTextSettings(prev => {
                         const copy = { ...prev };
                         Object.keys(copy).forEach(k => {
                           copy[k as keyof TextSettings].fontFamily = font;
                         });
                         return copy;
                       });
                     }}>
                       <option value="'Times New Roman', Times, serif">Times New Roman (经典衬线)</option>
                       <option value="Arial, Helvetica, sans-serif">Arial (标准无衬线)</option>
                       <option value="Helvetica, sans-serif">Helvetica (高规格排版)</option>
                       <option value="'Courier New', monospace">Courier New (等宽技术型)</option>
                     </select>
                   </div>

                   {/* 2D specific styles */}
                   <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                     <h4 style={{ fontSize: '12px', fontWeight: 'bold', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px', margin: '4px 0', color: '#0f172a' }}>2D 断面图专属学术样式</h4>

                     {/* Colormap selection */}
                     <div className="input-group">
                       <label className="input-label">学术色盘选择</label>
                       <select className="input-field" style={{ fontSize: '12px' }} value={chartStyles.colormap} onChange={e => setChartStyles(prev => ({ ...prev, colormap: e.target.value as any }))}>
                         <option value="odv">Ocean Data View Standard (经典彩虹)</option>
                         <option value="viridis">Viridis (对色盲友好感知均匀)</option>
                         <option value="inferno">Inferno (冷黑色到明黄色)</option>
                         <option value="coolwarm">Coolwarm (冷暖分立)</option>
                         <option value="grayscale">Grayscale (黑白灰印刷专供)</option>
                       </select>
                     </div>

                     {/* Colormap Banding type */}
                     <div className="input-group">
                       <label className="input-label">填充渲染模式</label>
                       <select className="input-field" style={{ fontSize: '12px' }} value={chartStyles.colorBanding} onChange={e => setChartStyles(prev => ({ ...prev, colorBanding: e.target.value as any }))}>
                         <option value="continuous">连续光滑渐变 (Continuous Raster)</option>
                         <option value="discrete">分步固体色块 (Discrete Bands / Filled Contour)</option>
                       </select>
                     </div>

                      <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                        <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                          <input type="checkbox" checked={chartStyles.showTopStationLabels} onChange={e => setChartStyles(prev => ({ ...prev, showTopStationLabels: e.target.checked }))} />
                          <span>显示顶部测站标签 (Show Top Station Labels)</span>
                        </label>
                        <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                          <input type="checkbox" checked={chartStyles.closedBorderTicks} onChange={e => setChartStyles(prev => ({ ...prev, closedBorderTicks: e.target.checked }))} />
                          <span>开启四周对称封闭轴框 (Closed Box Ticks)</span>
                        </label>
                        <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', color: 'var(--primary-color, #0284c7)' }}>
                          <input type="checkbox" checked={chartStyles.respectBathyBarriers ?? true} onChange={e => setChartStyles(prev => ({ ...prev, respectBathyBarriers: e.target.checked }))} />
                          <span>遵循水深地形屏障 (Respect Bathymetry Barriers)</span>
                        </label>
                        <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', color: '#16a34a' }}>
                          <input type="checkbox" checked={showDensityOverlay} onChange={e => setShowDensityOverlay(e.target.checked)} />
                          <span>叠加等密度水团线 (Overlay Density Contours)</span>
                        </label>
                      </div>

                      {/* 2D Sampling Points customization */}
                      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label className="input-label" style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>实际采样点样式设置</label>
                        
                        <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                          <input 
                            type="checkbox" 
                            checked={chartStyles.showPoints2D ?? true} 
                            onChange={e => setChartStyles(prev => ({ ...prev, showPoints2D: e.target.checked }))} 
                          />
                          <span>显示实际采样点</span>
                        </label>

                        {(chartStyles.showPoints2D ?? true) && (
                          <>
                            <div className="grid-2" style={{ gap: '8px' }}>
                              <div className="input-group" style={{ marginBottom: 0 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#475569', marginBottom: '2px' }}>
                                  <span>采样点半径: {chartStyles.pointRadius2D ?? chartStyles.pointRadius ?? 4}px</span>
                                </div>
                                <input 
                                  type="range" 
                                  min="0" 
                                  max="8" 
                                  step="0.5" 
                                  className="w-full" 
                                  value={chartStyles.pointRadius2D ?? chartStyles.pointRadius ?? 4} 
                                  onChange={e => setChartStyles(prev => ({ ...prev, pointRadius2D: parseFloat(e.target.value) }))} 
                                />
                              </div>
                              <div className="input-group" style={{ marginBottom: 0 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#475569', marginBottom: '2px' }}>
                                  <span>描边粗细: {chartStyles.pointStrokeWidth2D ?? chartStyles.pointStrokeWidth ?? 0.75}px</span>
                                </div>
                                <input 
                                  type="range" 
                                  min="0" 
                                  max="3" 
                                  step="0.25" 
                                  className="w-full" 
                                  value={chartStyles.pointStrokeWidth2D ?? chartStyles.pointStrokeWidth ?? 0.75} 
                                  onChange={e => setChartStyles(prev => ({ ...prev, pointStrokeWidth2D: parseFloat(e.target.value) }))} 
                                />
                              </div>
                            </div>

                            <div className="grid-2" style={{ gap: '8px', marginTop: '4px' }}>
                              <div className="input-group" style={{ marginBottom: 0 }}>
                                <label className="input-label" style={{ fontSize: '10px' }}>填充颜色</label>
                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                  <input 
                                    type="color" 
                                    style={{ width: '40px', height: '24px', cursor: 'pointer', padding: 0, border: '1px solid #cbd5e1', borderRadius: '4px' }} 
                                    value={chartStyles.pointFill2D ?? chartStyles.pointFill ?? '#000000'} 
                                    onChange={e => setChartStyles(prev => ({ ...prev, pointFill2D: e.target.value }))} 
                                  />
                                  <span style={{ fontSize: '11px', color: '#475569', fontFamily: 'monospace' }}>{chartStyles.pointFill2D ?? chartStyles.pointFill ?? '#000000'}</span>
                                </div>
                              </div>
                              <div className="input-group" style={{ marginBottom: 0 }}>
                                <label className="input-label" style={{ fontSize: '10px' }}>描边颜色</label>
                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                  <input 
                                    type="color" 
                                    style={{ width: '40px', height: '24px', cursor: 'pointer', padding: 0, border: '1px solid #cbd5e1', borderRadius: '4px' }} 
                                    value={chartStyles.pointStroke2D ?? chartStyles.pointStroke ?? '#ffffff'} 
                                    onChange={e => setChartStyles(prev => ({ ...prev, pointStroke2D: e.target.value }))} 
                                  />
                                  <span style={{ fontSize: '11px', color: '#475569', fontFamily: 'monospace' }}>{chartStyles.pointStroke2D ?? chartStyles.pointStroke ?? '#ffffff'}</span>
                                </div>
                              </div>
                            </div>
                          </>
                        )}
                      </div>

                     {/* Tick Marks Direction & Stagger Controls */}
                     <div className="grid-2" style={{ gap: '8px' }}>
                       <div className="input-group">
                         <label className="input-label" style={{ fontSize: '10px' }}>刻度朝向</label>
                         <select className="input-field" style={{ padding: '6px', fontSize: '11px' }} value={chartStyles.tickDirection} onChange={e => setChartStyles(prev => ({ ...prev, tickDirection: e.target.value as any }))}>
                           <option value="inward">向内 (Inward)</option>
                           <option value="outward">向外 (Outward)</option>
                         </select>
                       </div>
                       <div className="input-group">
                         <label className="input-label" style={{ fontSize: '10px' }}>顶轴防重叠等级</label>
                         <select className="input-field" style={{ padding: '6px', fontSize: '11px' }} value={chartStyles.staggerLevels} onChange={e => setChartStyles(prev => ({ ...prev, staggerLevels: parseInt(e.target.value) }))}>
                           <option value={1}>不启用 (隐藏重叠)</option>
                           <option value={2}>2 级错位排列</option>
                           <option value={3}>3 级错位排列</option>
                         </select>
                       </div>
                     </div>

                     <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                       <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                         <input type="checkbox" checked={chartStyles.showTopStationLabels} onChange={e => setChartStyles(prev => ({ ...prev, showTopStationLabels: e.target.checked }))} />
                         <span>显示顶部测站标签 (Show Top Station Labels)</span>
                       </label>
                       <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                         <input type="checkbox" checked={chartStyles.closedBorderTicks} onChange={e => setChartStyles(prev => ({ ...prev, closedBorderTicks: e.target.checked }))} />
                         <span>开启四周对称封闭轴框 (Closed Box Ticks)</span>
                       </label>
                     </div>

                      {/* Title Offset sliders */}
                      <div style={{ borderTop: '1px solid #border-color', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label className="input-label" style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>文字标题位置微调 (自适应基础)</label>
                        
                        <div className="input-group">
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#475569', marginBottom: '2px' }}>
                            <span>纵轴(深度)标题左偏: {chartStyles.yAxisTitleOffset || 0}px</span>
                            <span>向左移动</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="40"
                            step="1"
                            value={chartStyles.yAxisTitleOffset || 0}
                            onChange={e => setChartStyles(prev => ({ ...prev, yAxisTitleOffset: parseInt(e.target.value) }))}
                            style={{ width: '100%' }}
                          />
                        </div>

                        <div className="input-group">
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#475569', marginBottom: '2px' }}>
                            <span>横轴(站位)标题下偏: {chartStyles.xAxisTitleOffset || 0}px</span>
                            <span>向下移动</span>
                          </div>
                          <input
                            type="range"
                            min="-10"
                            max="40"
                            step="1"
                            value={chartStyles.xAxisTitleOffset || 0}
                            onChange={e => setChartStyles(prev => ({ ...prev, xAxisTitleOffset: parseInt(e.target.value) }))}
                            style={{ width: '100%' }}
                          />
                        </div>

                        <div className="input-group" style={{ marginBottom: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#475569', marginBottom: '2px' }}>
                            <span>色标标题上偏: {chartStyles.colorbarTitleOffset || 0}px</span>
                            <span>向上移动</span>
                          </div>
                          <input
                            type="range"
                            min="-10"
                            max="40"
                            step="1"
                            value={chartStyles.colorbarTitleOffset || 0}
                            onChange={e => setChartStyles(prev => ({ ...prev, colorbarTitleOffset: parseInt(e.target.value) }))}
                            style={{ width: '100%' }}
                          />
                        </div>

                        <div className="input-group" style={{ marginBottom: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#475569', marginBottom: '2px' }}>
                            <span>色标标题右偏: {chartStyles.colorbarTitleXOffset || 0}px</span>
                            <span>左右移动</span>
                          </div>
                          <input
                            type="range"
                            min="-80"
                            max="80"
                            step="1"
                            value={chartStyles.colorbarTitleXOffset || 0}
                            onChange={e => setChartStyles(prev => ({ ...prev, colorbarTitleXOffset: parseInt(e.target.value) }))}
                            style={{ width: '100%' }}
                          />
                        </div>
                      </div>

                      {/* Axis Fonts settings */}
                      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label className="input-label" style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>轴与刻度文字设置 (可双击图形微调)</label>
                        
                        <div className="grid-2" style={{ gap: '8px' }}>
                          <div className="input-group" style={{ marginBottom: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#475569', marginBottom: '2px' }}>
                              <span>纵轴(Depth)字号: {textSettings.yAxisLabel.fontSize}px</span>
                            </div>
                            <input
                              type="range"
                              min="8"
                              max="24"
                              step="0.5"
                              value={textSettings.yAxisLabel.fontSize}
                              onChange={e => setTextSettings(prev => ({
                                ...prev,
                                yAxisLabel: { ...prev.yAxisLabel, fontSize: parseFloat(e.target.value) }
                              }))}
                              style={{ width: '100%' }}
                            />
                          </div>

                          <div className="input-group" style={{ marginBottom: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#475569', marginBottom: '2px' }}>
                              <span>刻度数字字号: {textSettings.ticksLabels.fontSize}px</span>
                            </div>
                            <input
                              type="range"
                              min="6"
                              max="18"
                              step="0.5"
                              value={textSettings.ticksLabels.fontSize}
                              onChange={e => setTextSettings(prev => ({
                                ...prev,
                                ticksLabels: { ...prev.ticksLabels, fontSize: parseFloat(e.target.value) }
                              }))}
                              style={{ width: '100%' }}
                            />
                          </div>
                        </div>

                        <div className="grid-2" style={{ gap: '8px', marginTop: '4px' }}>
                          <div className="input-group" style={{ marginBottom: 0 }}>
                            <label className="input-label" style={{ fontSize: '10px' }}>纵轴标题粗细</label>
                            <select
                              className="input-field"
                              style={{ padding: '4px', fontSize: '11px' }}
                              value={textSettings.yAxisLabel.fontWeight}
                              onChange={e => setTextSettings(prev => ({
                                ...prev,
                                yAxisLabel: { ...prev.yAxisLabel, fontWeight: e.target.value as any }
                              }))}
                            >
                              <option value="normal">正常 (Normal)</option>
                              <option value="bold">加粗 (Bold)</option>
                            </select>
                          </div>
                          
                          <div className="input-group" style={{ marginBottom: 0 }}>
                            <label className="input-label" style={{ fontSize: '10px' }}>刻度数字粗细</label>
                            <select
                              className="input-field"
                              style={{ padding: '4px', fontSize: '11px' }}
                              value={textSettings.ticksLabels.fontWeight}
                              onChange={e => setTextSettings(prev => ({
                                ...prev,
                                ticksLabels: { ...prev.ticksLabels, fontWeight: e.target.value as any }
                              }))}
                            >
                              <option value="normal">正常 (Normal)</option>
                              <option value="bold">加粗 (Bold)</option>
                            </select>
                          </div>
                        </div>
                      </div>

                     {/* Color Adjusters */}
                     <div style={{ borderTop: '1px solid #border-color', paddingTop: '10px' }}>
                       <label className="input-label" style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>线框网格配色微调</label>
                       <div className="grid-3" style={{ gap: '8px', marginTop: '6px' }}>
                         <div>
                           <span style={{ fontSize: '9px', display: 'block', textAlign: 'center' }}>等值线</span>
                           <input type="color" style={{ width: '100%', height: '24px', cursor: 'pointer' }} value={chartStyles.lineStroke} onChange={e => setChartStyles(prev => ({ ...prev, lineStroke: e.target.value }))} />
                         </div>
                         <div>
                           <span style={{ fontSize: '9px', display: 'block', textAlign: 'center' }}>主轴线</span>
                           <input type="color" style={{ width: '100%', height: '24px', cursor: 'pointer' }} value={chartStyles.axisStroke} onChange={e => setChartStyles(prev => ({ ...prev, axisStroke: e.target.value }))} />
                         </div>
                         <div>
                           <span style={{ fontSize: '9px', display: 'block', textAlign: 'center' }}>网格虚线</span>
                           <input type="color" style={{ width: '100%', height: '24px', cursor: 'pointer' }} value={chartStyles.gridStroke} onChange={e => setChartStyles(prev => ({ ...prev, gridStroke: e.target.value }))} />
                         </div>
                       </div>
                     </div>
                   </div>
                </div>
              )}
            </div>
          </div>

          {/* ================= RIGHT SIDEBAR: HIGH-DEF LANDSCAPE CANVAS WINDOW ================= */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', flex: 1, minWidth: '930px' }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', minWidth: '930px', overflowX: 'auto', margin: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', width: '100%' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <h3
                  style={{
                    margin: 0,
                    fontFamily: textSettings.title.fontFamily,
                    fontSize: `${textSettings.title.fontSize}px`,
                    color: textSettings.title.color,
                    fontWeight: textSettings.title.fontWeight,
                    fontStyle: textSettings.title.fontStyle,
                    cursor: 'pointer'
                  }}
                  onDoubleClick={(e) => handleTextDoubleClick('title', e)}
                  title="双击直接在图上修改文字与样式"
                >
                  {textSettings.title.text}
                </h3>
                <p
                  style={{
                    margin: '2px 0 0 0',
                    fontFamily: textSettings.subtitle.fontFamily,
                    fontSize: `${textSettings.subtitle.fontSize}px`,
                    color: textSettings.subtitle.color,
                    fontWeight: textSettings.subtitle.fontWeight,
                    fontStyle: textSettings.subtitle.fontStyle,
                    cursor: 'pointer'
                  }}
                  onDoubleClick={(e) => handleTextDoubleClick('subtitle', e)}
                >
                  {textSettings.subtitle.text}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  onClick={() => download2DPlot('png', true)}
                  title="预览 PNG 出图效果"
                >
                  <Info size={12} />
                  <span>预览 PNG</span>
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  onClick={() => download2DPlot('png')}
                >
                  <Download size={12} />
                  <span>保存 PNG</span>
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  onClick={() => download2DPlot('svg', true)}
                  title="预览 SVG 出图效果"
                >
                  <Info size={12} />
                  <span>预览 SVG</span>
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  onClick={() => download2DPlot('svg')}
                >
                  <Download size={12} />
                  <span>导出矢量 SVG</span>
                </button>
              </div>
            </div>

            {/* ODV styled window container */}
            <div style={{ position: 'relative', width: '940px', height: '580px', backgroundColor: '#ffffff', userSelect: 'none', marginTop: '10px' }}>
              
              {/* Main Canvas Plot (starting at left 100px, top 90px) */}
              <canvas
                ref={setCanvasElement}
                width={700}
                height={380}
                style={{ position: 'absolute', top: '90px', left: '100px', width: '700px', height: '380px', zIndex: 1, border: `1px solid ${chartStyles.axisStroke}` }}
              />

              {/* SVG overlay (starts at 0, 0 and covers the labels area too) */}
              <svg
                width={940}
                height={580}
                style={{ position: 'absolute', top: 0, left: 0, width: '940px', height: '580px', zIndex: 2, pointerEvents: 'none' }}
              >
                {/* Clipping path definition to keep contours within the black border */}
                <defs>
                  <clipPath id={`plot-area-clip-${instanceId}`}>
                    <rect x={100} y={90} width={700} height={380} />
                  </clipPath>
                  <linearGradient id="bathyGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1e293b" stopOpacity="0.85" />
                    <stop offset="100%" stopColor="#0b0f19" stopOpacity="0.95" />
                  </linearGradient>
                  
                  {/* Dynamic Colorbar Gradient */}
                  <linearGradient id="colorbarGrad" x1="0" y1="1" x2="0" y2="0">
                    {colorsMap[chartStyles.colormap || 'odv'].map((color, idx, arr) => (
                      <stop
                        key={idx}
                        offset={`${(idx / (arr.length - 1)) * 100}%`}
                        stopColor={color}
                      />
                    ))}
                  </linearGradient>
                </defs>

                 {/* Contour lines (clipped to canvas box) */}
                <g clipPath={`url(#plot-area-clip-${instanceId})`}>
                  {contourSvgPaths.map((p: { path: string; value: number }, i: number) => {
                    return (
                      <path
                        key={i}
                        d={p.path}
                        transform="translate(100, 90)"
                        fill="none"
                        stroke={chartStyles.lineStroke}
                        strokeWidth={chartStyles.lineWidth}
                      />
                    );
                  })}

                  {/* Density Contours overlay (if enabled) */}
                  {showDensityOverlay && densityContourPaths.map((p, i) => {
                    return (
                      <path
                        key={`density-${i}`}
                        d={p.path}
                        transform="translate(100, 90)"
                        fill="none"
                        stroke="#000000"
                        strokeWidth={1.75}
                        strokeDasharray="4 4"
                      />
                    );
                  })}

                  {/* Density Contour value labels */}
                  {showDensityOverlay && showContourLabels && densityContourPaths.map((p, i) => {
                    if (p.labelX === undefined || p.labelY === undefined || p.labelX === 0 || p.labelY === 0) return null;
                    return (
                      <g key={`density-label-${i}`} transform={`translate(${p.labelX + 100}, ${p.labelY + 90}) rotate(${p.angle || 0})`}>
                        <rect
                          x={-16}
                          y={-6}
                          width={32}
                          height={12}
                          fill="#ffffff"
                          opacity={0.85}
                          rx={2}
                          ry={2}
                        />
                        <text
                          x={0}
                          y={3.5}
                          textAnchor="middle"
                          fill="#000000"
                          style={{
                            fontSize: '8px',
                            fontFamily: chartStyles.fontFamily,
                            fontWeight: 'bold'
                          }}
                        >
                          {p.value.toFixed(1)}
                        </text>
                      </g>
                    );
                  })}


                  {/* Contour value labels */}
                  {showContourLabels && contourSvgPaths.map((p: { path: string; value: number; labelX?: number; labelY?: number; angle?: number }, i: number) => {
                    if (p.labelX === undefined || p.labelY === undefined || p.labelX === 0 || p.labelY === 0) return null;
                    
                    let shouldShow = true;
                    if (contourLabelMode === 'multiplesOf10') {
                      shouldShow = Math.round(p.value * 10) % 100 === 0;
                    } else if (contourLabelMode === 'every2nd') {
                      shouldShow = i % 2 === 0;
                    }
                    if (!shouldShow) return null;

                    return (
                      <g key={`label-${i}`} transform={`translate(${p.labelX + 100}, ${p.labelY + 90}) rotate(${p.angle || 0})`}>
                        <rect
                          x={-14}
                          y={-6}
                          width={28}
                          height={12}
                          fill="#ffffff"
                          opacity={0.85}
                          rx={2}
                          ry={2}
                        />
                        <text
                          x={0}
                          y={3}
                          textAnchor="middle"
                          fill={chartStyles.axisStroke === '#ffffff' ? '#000000' : chartStyles.axisStroke}
                          style={{
                            fontSize: '8px',
                            fontFamily: chartStyles.fontFamily,
                            fontWeight: 'bold'
                          }}
                        >
                          {p.value}
                        </text>
                      </g>
                    );
                  })}

                  {/* Bathymetry Sea Floor Silhouette Masking */}
                  {bathyPath && (
                    <path
                      d={bathyPath}
                      transform="translate(100, 90)"
                      fill={chartStyles.bathyFill}
                      stroke={chartStyles.bathyStroke}
                      strokeWidth={chartStyles.bathyStrokeWidth}
                    />
                  )}

                  {/* Black dots overlay representing measurement depth/locations */}
                  {(chartStyles.showPoints2D ?? true) && contourDataPoints.map((pt: any, i) => (
                    <circle
                      key={i}
                      cx={pt.cx + 100}
                      cy={pt.cy + 90}
                      r={chartStyles.pointRadius2D ?? chartStyles.pointRadius ?? 4}
                      fill={chartStyles.pointFill2D ?? chartStyles.pointFill ?? '#000000'}
                      stroke={chartStyles.pointStroke2D ?? chartStyles.pointStroke ?? '#ffffff'}
                      strokeWidth={chartStyles.pointStrokeWidth2D ?? chartStyles.pointStrokeWidth ?? 0.75}
                      style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const containerRect = containerRef.current?.getBoundingClientRect();
                        if (containerRect) {
                          setHoveredPoint2D({
                            station: pt.station || '',
                            depth: pt.depth || 0,
                            concentration: pt.conc,
                            x: rect.left - containerRect.left + rect.width / 2,
                            y: rect.top - containerRect.top - 8
                          });
                        }
                      }}
                      onMouseLeave={() => setHoveredPoint2D(null)}
                    >
                      <title>站位: {pt.station || '未知'} | 深度: {pt.depth || 0}m | 浓度: {pt.conc.toFixed(2)}</title>
                    </circle>
                  ))}
                </g>

                {/* ODV Border Outline */}
                <rect x={100} y={90} width={700} height={380} fill="none" stroke={chartStyles.axisStroke} strokeWidth="1" />

                {/* Left Y-Axis Title (Depth [m]) */}
                <text
                  x={yAxisTitleX}
                  y={280}
                  fill={textSettings.yAxisLabel.color}
                  style={{
                    fontFamily: textSettings.yAxisLabel.fontFamily,
                    fontSize: `${textSettings.yAxisLabel.fontSize}px`,
                    fontWeight: textSettings.yAxisLabel.fontWeight,
                    fontStyle: textSettings.yAxisLabel.fontStyle,
                    cursor: 'pointer',
                    pointerEvents: 'auto'
                  }}
                  textAnchor="middle"
                  transform={`rotate(-90 ${yAxisTitleX} 280)`}
                  onDoubleClick={(e) => handleTextDoubleClick('yAxisLabel', e)}
                >
                  {textSettings.yAxisLabel.text}
                </text>

                {/* Left Y-Axis Ticks & Labels */}
                {(() => {
                  const ticks = [];
                  const start = Math.ceil(minDepthFilter / depthTickStep) * depthTickStep;
                  for (let val = start; val <= maxDepthFilter; val += depthTickStep) {
                    ticks.push(val);
                  }
                  if (ticks.length === 0) {
                    return [0.0, 0.25, 0.5, 0.75, 1.0].map(r => {
                      const depthVal = (minDepthFilter + (maxDepthFilter - minDepthFilter) * r).toFixed(0);
                      const yPos = 90 + 380 * r;
                      return { depthVal, yPos };
                    });
                  }
                  return ticks.map(val => {
                    const r = (val - minDepthFilter) / (maxDepthFilter - minDepthFilter || 1);
                    const yPos = 90 + 380 * r;
                    return { depthVal: val.toFixed(0), yPos };
                  });
                })().map((tick, i) => {
                  const isOutward = chartStyles.tickDirection === 'outward';
                  const tickX = isOutward ? 95 : 105;

                  return (
                    <g key={i}>
                      {/* Left border tick */}
                      <line x1={tickX} y1={tick.yPos} x2={100} y2={tick.yPos} stroke={chartStyles.axisStroke} strokeWidth="1" />
                      
                      {/* Optional Right border tick (Closed Box symmetry) */}
                      {chartStyles.closedBorderTicks && (
                        <line x1={800} y1={tick.yPos} x2={isOutward ? 805 : 795} y2={tick.yPos} stroke={chartStyles.axisStroke} strokeWidth="1" />
                      )}
                      
                      <text
                        x={90}
                        y={tick.yPos + 4}
                        fill={textSettings.ticksLabels.color}
                        style={{
                          fontFamily: textSettings.ticksLabels.fontFamily,
                          fontSize: `${textSettings.ticksLabels.fontSize}px`,
                          fontWeight: textSettings.ticksLabels.fontWeight,
                          fontStyle: textSettings.ticksLabels.fontStyle,
                          cursor: 'pointer',
                          pointerEvents: 'auto'
                        }}
                        textAnchor="end"
                        onDoubleClick={(e) => handleTextDoubleClick('ticksLabels', e)}
                      >
                        {tick.depthVal}
                      </text>
                    </g>
                  );
                })}

                {/* Bottom X-Axis Title */}
                <text
                  x={450}
                  y={xAxisTitleY}
                  fill={textSettings.xAxisLabel.color}
                  style={{
                    fontFamily: textSettings.xAxisLabel.fontFamily,
                    fontSize: `${textSettings.xAxisLabel.fontSize}px`,
                    fontWeight: textSettings.xAxisLabel.fontWeight,
                    fontStyle: textSettings.xAxisLabel.fontStyle,
                    cursor: 'pointer',
                    pointerEvents: 'auto'
                  }}
                  textAnchor="middle"
                  onDoubleClick={(e) => handleTextDoubleClick('xAxisLabel', e)}
                >
                  {textSettings.xAxisLabel.text}
                </text>

                {/* Bottom X-Axis Ticks & Labels */}
                {interpolatedPoints.map((pt: { x: number; y: number; name: string }, i: number) => {
                  const xPos = pt.x + 100;
                  const isOutward = chartStyles.tickDirection === 'outward';
                  const tickY = isOutward ? 475 : 465;

                  return (
                    <g key={i}>
                      {/* Bottom border tick */}
                      <line x1={xPos} y1={470} x2={xPos} y2={tickY} stroke={chartStyles.axisStroke} strokeWidth="1" />
                      
                      <text
                        x={xPos}
                        y={488}
                        fill={textSettings.ticksLabels.color}
                        style={{
                          fontFamily: textSettings.ticksLabels.fontFamily,
                          fontSize: `${textSettings.ticksLabels.fontSize}px`,
                          fontWeight: textSettings.ticksLabels.fontWeight,
                          fontStyle: textSettings.ticksLabels.fontStyle,
                          cursor: 'pointer',
                          pointerEvents: 'auto'
                        }}
                        textAnchor="middle"
                        onDoubleClick={(e) => handleTextDoubleClick('ticksLabels', e)}
                      >
                        {pt.name}
                      </text>
                    </g>
                  );
                })}

                {/* Top Axis Ticks & Labels (Station Name Indicators with Stagger Alignment) */}
                {(() => {
                  const hideLabels = !chartStyles.showTopStationLabels;
                  const sortedTicks = [...topStationTicks].sort((a, b) => a.cx - b.cx);
                  
                  const levelsCount = chartStyles.staggerLevels;
                  const occupied: { start: number; end: number }[][] = Array.from({ length: levelsCount }, () => [
                    { start: 815, end: 890 } // obstacle for shifted colorbar title region [815, 890]
                  ]);

                  return sortedTicks.map((tick, i) => {
                    const xPos = tick.cx + 100;
                    if (xPos < 100 || xPos > 800) return null;

                    const isOutward = chartStyles.tickDirection === 'outward';
                    const tickY = isOutward ? 86 : 94;

                    if (hideLabels) {
                      return (
                        <g key={i}>
                          <line x1={xPos} y1={90} x2={xPos} y2={tickY} stroke={chartStyles.axisStroke} strokeWidth="1" />
                        </g>
                      );
                    }

                    // Uniform alignment going upwards and rightwards
                    const textAnchor = 'start';
                    const spanLength = 28; // estimated text width projection in px
                    const labelStart = xPos;
                    const labelEnd = xPos + spanLength;

                    // Find non-overlapping level
                    let selectedLevel = -1;
                    const padding = 2; // minimum spacing padding

                    for (let L = 0; L < levelsCount; L++) {
                      let hasOverlap = false;
                      for (const interval of occupied[L]) {
                        const overlap = Math.max(labelStart, interval.start) < Math.min(labelEnd, interval.end) + padding;
                        if (overlap) {
                          hasOverlap = true;
                          break;
                        }
                      }
                      if (!hasOverlap) {
                        selectedLevel = L;
                        break;
                      }
                    }

                    // Fallback to round-robin level if completely blocked, so labels NEVER disappear!
                    if (selectedLevel === -1) {
                      selectedLevel = i % levelsCount;
                    }

                    occupied[selectedLevel].push({ start: labelStart, end: labelEnd });

                    let yOffset = 0;
                    if (levelsCount === 2) {
                      yOffset = (selectedLevel === 0) ? 0 : -20;
                    } else if (levelsCount === 3) {
                      yOffset = (selectedLevel === 0) ? 0 : (selectedLevel === 1) ? -15 : -30;
                    }

                    const yText = 82 + yOffset;
                    const drawLine = yOffset !== 0;

                    return (
                      <g key={i}>
                        <line x1={xPos} y1={90} x2={xPos} y2={tickY} stroke={chartStyles.axisStroke} strokeWidth="1" />
                        
                        {drawLine && (
                          <line
                            x1={xPos}
                            y1={88}
                            x2={xPos}
                            y2={yText + 3}
                            stroke={chartStyles.gridStroke}
                            strokeWidth="0.75"
                            strokeDasharray="2,2"
                          />
                        )}

                        <text
                          x={xPos}
                          y={yText}
                          fill={textSettings.stationLabels.color}
                          style={{
                            fontFamily: textSettings.stationLabels.fontFamily,
                            fontSize: `${textSettings.stationLabels.fontSize}px`,
                            fontWeight: textSettings.stationLabels.fontWeight,
                            fontStyle: textSettings.stationLabels.fontStyle,
                            cursor: 'pointer',
                            pointerEvents: 'auto'
                          }}
                          textAnchor={textAnchor}
                          transform={`rotate(${chartStyles.stationLabelAngle}, ${xPos}, ${yText})`}
                          onDoubleClick={(e) => handleTextDoubleClick('stationLabels', e)}
                        >
                          {tick.name}
                        </text>
                      </g>
                    );
                  });
                })()}

                {/* Colorbar Tick Labels (drawn on the right side of color bar) */}
                {[0.0, 0.25, 0.5, 0.75, 1.0].map((r, i) => {
                  const val = docMin + (docMax - docMin) * r;
                  const xLineStart = 850 + 5 + chartStyles.colorbarWidth;
                  const yPos = 470 - 380 * r;
                  return (
                    <g key={i}>
                      <line x1={xLineStart} y1={yPos} x2={xLineStart + 5} y2={yPos} stroke={chartStyles.axisStroke} strokeWidth="1" />
                      <text
                        x={xLineStart + 9}
                        y={yPos + 4}
                        fill={textSettings.ticksLabels.color}
                        style={{
                          fontFamily: textSettings.ticksLabels.fontFamily,
                          fontSize: `${textSettings.ticksLabels.fontSize}px`,
                          fontWeight: textSettings.ticksLabels.fontWeight,
                          fontStyle: textSettings.ticksLabels.fontStyle,
                          cursor: 'pointer',
                          pointerEvents: 'auto'
                        }}
                        textAnchor="start"
                        onDoubleClick={(e) => handleTextDoubleClick('ticksLabels', e)}
                      >
                        {val.toFixed(1)}
                      </text>
                    </g>
                  );
                })}

                {/* SVG Colorbar Panel */}
                <rect
                  x={850}
                  y={90}
                  width={chartStyles.colorbarWidth}
                  height={380}
                  fill="url(#colorbarGrad)"
                  stroke={chartStyles.axisStroke}
                  strokeWidth="1"
                  style={{ pointerEvents: 'auto' }}
                />

                {/* SVG Colorbar Title */}
                <text
                  x={colorbarTitleX}
                  y={colorbarTitleY}
                  textAnchor="middle"
                  fill={textSettings.colorbarTitle.color}
                  style={{
                    fontFamily: textSettings.colorbarTitle.fontFamily,
                    fontSize: `${textSettings.colorbarTitle.fontSize}px`,
                    fontWeight: textSettings.colorbarTitle.fontWeight,
                    fontStyle: textSettings.colorbarTitle.fontStyle,
                    cursor: 'pointer',
                    pointerEvents: 'auto'
                  }}
                  onDoubleClick={(e) => handleTextDoubleClick('colorbarTitle', e)}
                >
                  {textSettings.colorbarTitle.text}
                </text>

                {/* ================= INTERACTION GATES: INVISIBLE AXIS DRAG PANELS ================= */}
                {/* Y-Axis Pan Rectangle (middle 80% range) */}
                <rect
                  x={10}
                  y={130}
                  width={90}
                  height={300}
                  fill="transparent"
                  cursor="grab"
                  style={{ pointerEvents: 'auto', zIndex: 10 }}
                  onMouseDown={(e) => handleYAxisMouseDown('pan', e)}
                >
                  <title>按住鼠标拖拽：平移深度坐标范围</title>
                </rect>
                {/* Y-Axis Scale Min Rectangle (top 10%) */}
                <rect
                  x={10}
                  y={90}
                  width={90}
                  height={40}
                  fill="transparent"
                  cursor="ns-resize"
                  style={{ pointerEvents: 'auto', zIndex: 10 }}
                  onMouseDown={(e) => handleYAxisMouseDown('scale-min', e)}
                >
                  <title>上下拖拽：缩放深度上限</title>
                </rect>
                {/* Y-Axis Scale Max Rectangle (bottom 10%) */}
                <rect
                  x={10}
                  y={430}
                  width={90}
                  height={40}
                  fill="transparent"
                  cursor="ns-resize"
                  style={{ pointerEvents: 'auto', zIndex: 10 }}
                  onMouseDown={(e) => handleYAxisMouseDown('scale-max', e)}
                >
                  <title>上下拖拽：缩放深度下限</title>
                </rect>

                {/* X-Axis Pan Rectangle (middle 80% range) */}
                <rect
                  x={170}
                  y={470}
                  width={560}
                  height={40}
                  fill="transparent"
                  cursor="grab"
                  style={{ pointerEvents: 'auto', zIndex: 10 }}
                  onMouseDown={(e) => handleXAxisMouseDown('pan', e)}
                >
                  <title>按住鼠标拖拽：平移横坐标范围</title>
                </rect>
                {/* X-Axis Scale Min Rectangle (left 10%) */}
                <rect
                  x={100}
                  y={470}
                  width={70}
                  height={40}
                  fill="transparent"
                  cursor="ew-resize"
                  style={{ pointerEvents: 'auto', zIndex: 10 }}
                  onMouseDown={(e) => handleXAxisMouseDown('scale-min', e)}
                >
                  <title>左右拖拽：缩放横坐标下限</title>
                </rect>
                {/* X-Axis Scale Max Rectangle (right 10%) */}
                <rect
                  x={730}
                  y={470}
                  width={70}
                  height={40}
                  fill="transparent"
                  cursor="ew-resize"
                  style={{ pointerEvents: 'auto', zIndex: 10 }}
                  onMouseDown={(e) => handleXAxisMouseDown('scale-max', e)}
                >
                </rect>
              </svg>
            </div>

            <div style={{ display: 'flex', gap: '20px', marginTop: '16px', fontSize: '11px', color: '#94a3b8', flexWrap: 'wrap', justifyContent: 'center' }}>
              <span>※ 横轴：{contourXAxis === 'station' ? '测站序号' : contourXAxis === 'longitude' ? '经度' : '纬度'}</span>
              <span>※ 纵轴：海水标定深度 (米)</span>
              <span>● 黑色圆点：实际采样点</span>
              <span>■ 灰色阴影：海底地形 (海床)</span>
            </div>
          </div>

          {showUnfilteredComparison && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', minWidth: '930px', overflowX: 'auto', margin: '20px 0 0 0', border: '1px dashed #ef4444' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', width: '100%' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <h3
                    style={{
                      margin: 0,
                      fontFamily: textSettings.title.fontFamily,
                      fontSize: `${textSettings.title.fontSize + 2}px`,
                      color: '#dc2626',
                      fontWeight: 'bold',
                      fontStyle: textSettings.title.fontStyle,
                    }}
                  >
                    {textSettings.title.text} (原始未筛选对比)
                  </h3>
                  <p
                    style={{
                      margin: '4px 0 0 0',
                      fontFamily: textSettings.subtitle.fontFamily,
                      fontSize: `${textSettings.subtitle.fontSize}px`,
                      color: '#dc2626',
                      fontWeight: 600,
                      fontStyle: 'normal',
                    }}
                  >
                    ⚠️ 此对照图包含已被废弃的数据点（以红色方形标记呈现），可与上方质控后的图表进行直观对比。
                  </p>
                </div>
              </div>

              {/* ODV styled window container */}
              <div style={{ position: 'relative', width: '940px', height: '580px', backgroundColor: '#ffffff', userSelect: 'none', marginTop: '10px' }}>
                
                {/* Main Canvas Plot */}
                <canvas
                  ref={setUnfilteredCanvasElement}
                  width={700}
                  height={380}
                  style={{
                    position: 'absolute',
                    left: '100px',
                    top: '90px',
                    width: '700px',
                    height: '380px',
                    border: `1px solid ${chartStyles.axisStroke || '#000'}`
                  }}
                />

                {/* SVG Overlay */}
                <svg
                  width={940}
                  height={580}
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: '940px',
                    height: '580px',
                    pointerEvents: 'none',
                    zIndex: 2
                  }}
                >
                  <defs>
                    <linearGradient id="unfBathyGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#e2e8f0" />
                      <stop offset="100%" stopColor="#94a3b8" />
                    </linearGradient>
                  </defs>

                  {/* Bathymetry Shadow */}
                  {unfilteredBathyPath && (
                    <path
                      d={unfilteredBathyPath}
                      transform="translate(100, 90)"
                      fill={chartStyles.bathyFill || 'url(#unfBathyGrad)'}
                      stroke={chartStyles.bathyStroke || '#94a3b8'}
                      strokeWidth={chartStyles.bathyStrokeWidth || 2}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}

                  {/* Contours */}
                  <g transform="translate(100, 90)">
                    {unfilteredContourSvgPaths.map((path, idx) => (
                      <path
                        key={`unf-contour-${idx}`}
                        d={path.path}
                        fill="none"
                        stroke={chartStyles.lineStroke || 'rgba(255,255,255,0.45)'}
                        strokeWidth={chartStyles.lineWidth || 1.5}
                      />
                    ))}

                    {/* Contour value labels (unfiltered) */}
                    {showContourLabels && unfilteredContourSvgPaths.map((p: { path: string; value: number; labelX?: number; labelY?: number; angle?: number }, i: number) => {
                      if (p.labelX === undefined || p.labelY === undefined || p.labelX === 0 || p.labelY === 0) return null;
                      
                      let shouldShow = true;
                      if (contourLabelMode === 'multiplesOf10') {
                        shouldShow = Math.round(p.value * 10) % 100 === 0;
                      } else if (contourLabelMode === 'every2nd') {
                        shouldShow = i % 2 === 0;
                      }
                      if (!shouldShow) return null;

                      return (
                        <g key={`unf-label-${i}`} transform={`translate(${p.labelX}, ${p.labelY}) rotate(${p.angle || 0})`}>
                          <rect
                            x={-14}
                            y={-6}
                            width={28}
                            height={12}
                            fill="#ffffff"
                            opacity={0.85}
                            rx={2}
                            ry={2}
                          />
                          <text
                            x={0}
                            y={3}
                            textAnchor="middle"
                            fill={chartStyles.axisStroke === '#ffffff' ? '#000000' : (chartStyles.axisStroke || '#000')}
                            style={{
                              fontSize: '8px',
                              fontFamily: chartStyles.fontFamily,
                              fontWeight: 'bold'
                            }}
                          >
                            {p.value}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                  
                  {/* Y-Axis Label and Ticks */}
                  <g transform="translate(80, 90)">
                    {(() => {
                      const ticks = [];
                      const start = Math.ceil(minDepthFilter / depthTickStep) * depthTickStep;
                      for (let val = start; val <= maxDepthFilter; val += depthTickStep) {
                        ticks.push(val);
                      }
                      if (ticks.length === 0) {
                        return [0.0, 0.25, 0.5, 0.75, 1.0].map(r => {
                          const val = minDepthFilter + (maxDepthFilter - minDepthFilter) * r;
                          const yPos = r * 380;
                          return { val, yPos };
                        });
                      }
                      return ticks.map(val => {
                        const r = (val - minDepthFilter) / (maxDepthFilter - minDepthFilter || 1);
                        const yPos = r * 380;
                        return { val, yPos };
                      });
                    })().map((tick, idx) => {
                      return (
                        <g key={`unf-y-tick-${idx}`}>
                          <line x1={0} y1={tick.yPos} x2={chartStyles.tickDirection === 'inward' ? 5 : -5} y2={tick.yPos} stroke={chartStyles.axisStroke || '#000'} strokeWidth={1} />
                          {chartStyles.closedBorderTicks && (
                            <line x1={720} y1={tick.yPos} x2={chartStyles.tickDirection === 'inward' ? 715 : 725} y2={tick.yPos} stroke={chartStyles.axisStroke || '#000'} strokeWidth={1} />
                          )}
                          <text
                            x={-10}
                            y={tick.yPos + 4}
                            textAnchor="end"
                            fontFamily={textSettings.ticksLabels.fontFamily}
                            fontSize={`${textSettings.ticksLabels.fontSize}px`}
                            fill={textSettings.ticksLabels.color}
                            fontWeight={textSettings.ticksLabels.fontWeight}
                          >
                            {tick.val.toFixed(0)}
                          </text>
                        </g>
                      );
                    })}
                  </g>

                  {/* X-Axis Ticks (Bottom) */}
                  <g transform="translate(100, 90)">
                    {unfilteredInterpolatedPoints.map((pt, idx) => (
                      <g key={`unf-x-tick-${idx}`}>
                        <line x1={pt.x} y1={380} x2={pt.x} y2={chartStyles.tickDirection === 'inward' ? 375 : 385} stroke={chartStyles.axisStroke || '#000'} strokeWidth={1} />
                        {chartStyles.closedBorderTicks && (
                          <line x1={pt.x} y1={0} x2={pt.x} y2={chartStyles.tickDirection === 'inward' ? 5 : -5} stroke={chartStyles.axisStroke || '#000'} strokeWidth={1} />
                        )}
                        <text
                          x={pt.x}
                          y={398}
                          textAnchor="middle"
                          transform={`rotate(${chartStyles.stationLabelAngle || -60}, ${pt.x}, 398)`}
                          fontFamily={textSettings.ticksLabels.fontFamily}
                          fontSize={`${textSettings.ticksLabels.fontSize}px`}
                          fill={chartStyles.stationLabelColor || textSettings.ticksLabels.color}
                          fontWeight={textSettings.ticksLabels.fontWeight}
                        >
                          {pt.name}
                        </text>
                      </g>
                    ))}
                  </g>

                  {/* Top Station Indicators */}
                  {chartStyles.showTopStationLabels && (
                    <g transform="translate(100, 90)">
                      {unfilteredTopStationTicks.map((tick, idx) => (
                        <g key={`unf-top-tick-${idx}`}>
                          <line x1={tick.cx} y1={0} x2={tick.cx} y2={-5} stroke={chartStyles.axisStroke || '#000'} strokeWidth={1} />
                          <text
                            x={tick.cx}
                            y={-10}
                            textAnchor="middle"
                            fontFamily={textSettings.ticksLabels.fontFamily}
                            fontSize="8px"
                            fill="#64748b"
                          >
                            {tick.name}
                          </text>
                        </g>
                      ))}
                    </g>
                  )}

                  {/* Colorbar */}
                  <g transform="translate(830, 90)">
                    <rect x={0} y={0} width={chartStyles.colorbarWidth || 15} height={380} fill="none" stroke={chartStyles.axisStroke || '#000'} strokeWidth={1} />
                    {/* Draw discrete color blocks if discrete banding enabled */}
                    {(() => {
                      const blocksCount = 50;
                      const blockHeight = 380 / blocksCount;
                      const paletteColors = colorsMap[chartStyles.colormap || 'odv'];
                      const scale = scaleLinear<string>()
                        .domain([
                          docMin, 
                          docMin + (docMax - docMin) * 0.25, 
                          docMin + (docMax - docMin) * 0.5, 
                          docMin + (docMax - docMin) * 0.75, 
                          docMax
                        ])
                        .range(paletteColors)
                        .clamp(true);

                      return Array.from({ length: blocksCount }).map((_, i) => {
                        const ratio = i / (blocksCount - 1);
                        let val = docMin + (1 - ratio) * (docMax - docMin);
                        if (chartStyles.colorBanding === 'discrete') {
                          const stepsCount = Math.floor((val - docMin) / contourStep);
                          val = docMin + stepsCount * contourStep + contourStep / 2;
                        }
                        const fill = scale(val);
                        return (
                          <rect
                            key={`unf-cb-${i}`}
                            x={0}
                            y={i * blockHeight}
                            width={chartStyles.colorbarWidth || 15}
                            height={blockHeight + 0.5}
                            fill={fill}
                            stroke="none"
                          />
                        );
                      });
                    })()}

                    {/* Colorbar Ticks and Labels */}
                    {(() => {
                      const ticks = [];
                      for (let t = docMin; t <= docMax; t += contourStep) {
                        ticks.push(t);
                      }
                      return ticks.map((val, idx) => {
                        const ratio = (val - docMin) / (docMax - docMin || 1);
                        const yPos = 380 - ratio * 380;
                        return (
                          <g key={`unf-cb-tick-${idx}`}>
                            <line x1={chartStyles.colorbarWidth || 15} y1={yPos} x2={(chartStyles.colorbarWidth || 15) + 5} y2={yPos} stroke={chartStyles.axisStroke || '#000'} strokeWidth={1} />
                            <text
                              x={(chartStyles.colorbarWidth || 15) + 8}
                              y={yPos + 3}
                              textAnchor="start"
                              fontFamily={textSettings.colorbarTitle.fontFamily}
                              fontSize="8.5px"
                              fill="#334155"
                              fontWeight="600"
                            >
                              {val.toFixed(1)}
                            </text>
                          </g>
                        );
                      });
                    })()}
                  </g>

                  {/* Data Points */}
                  {chartStyles.showPoints2D && unfilteredContourDataPoints.map((dot, idx) => {
                    const isDotRejected = dot.isRejected;
                    const size = isDotRejected ? 8 : (chartStyles.pointRadius2D || 4);
                    const fill = isDotRejected ? '#ef4444' : (chartStyles.pointFill2D || '#000');
                    const stroke = isDotRejected ? '#ffffff' : (chartStyles.pointStroke2D || '#fff');
                    const strokeWidth = isDotRejected ? 1.5 : (chartStyles.pointStrokeWidth2D || 0.75);

                    if (isDotRejected) {
                      return (
                        <rect
                          key={`unf-dot-${idx}`}
                          x={100 + dot.cx - size/2}
                          y={90 + dot.cy - size/2}
                          width={size}
                          height={size}
                          fill={fill}
                          stroke={stroke}
                          strokeWidth={strokeWidth}
                          style={{ pointerEvents: 'none' }}
                        />
                      );
                    }
                    return (
                      <circle
                        key={`unf-dot-${idx}`}
                        cx={100 + dot.cx}
                        cy={90 + dot.cy}
                        r={size}
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={strokeWidth}
                        style={{ pointerEvents: 'none' }}
                      />
                    );
                  })}
                </svg>
              </div>
              <div style={{ display: 'flex', gap: '20px', marginTop: '16px', fontSize: '11px', color: '#dc2626', flexWrap: 'wrap', justifyContent: 'center', fontWeight: 600 }}>
                <span>※ 横轴：{contourXAxis === 'station' ? '测站序号' : contourXAxis === 'longitude' ? '经度' : '纬度'}</span>
                <span>※ 纵轴：海水标定深度 (米)</span>
                <span>● 黑色圆点：实际采样点 | 🟥 红色方点：已废弃采样点</span>
                <span>■ 灰色阴影：海底地形 (海床)</span>
              </div>
            </div>
          )}

          <StationMap
              stations={mapStations}
              selectedStation={selectedStation}
              selectedStationsMulti={selectedStationsMulti}
              focusedStation1D={focusedStation1D}
              stationMode1D={stationMode1D}
              onSelectStation={setSelectedStation}
              onToggleStationMulti={(st) => {
                setSelectedStationsMulti(prev =>
                  prev.includes(st) ? prev.filter(x => x !== st) : [...prev, st]
                );
              }}
            />
          </div>
        </div>
      )}

      {/* Sub-tab: T-S Diagram */}
      {visSubTab === 'tsPlot' && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '24px', alignItems: 'start' }}>
          <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 'bold', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px', margin: 0, color: '#0f172a' }}>
              温盐等密度 (T-S) 分析
            </h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              T-S 关系图是海洋学中识别海水物理水团的核心工具。背景中的灰色虚线表示特定的潜在密度异常等值线 ($\sigma_\theta$)。
            </p>
            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
              <span className="text-xs font-bold text-slate-700 block mb-2">主要印度洋中深层水团特征：</span>
              <ul className="text-xs text-slate-600 space-y-2 list-disc list-inside">
                <li><strong className="text-sky-600">STUW</strong>: 副热带表层水，高盐最大值（盐度 &gt; 35.5）</li>
                <li><strong className="text-emerald-600">SAMW</strong>: 亚南极模态水，$\sigma_\theta \approx 26.5 - 26.8$</li>
                <li><strong className="text-indigo-600">AAIW</strong>: 南极中层水，盐度极小值 &lt; 34.4, $\sigma_\theta \approx 27.0 - 27.3$</li>
                <li><strong className="text-slate-600">CDW/NADW</strong>: 绕极深层水/北大西洋深层水，偏高盐，低温 ($\sigma_\theta &gt; 27.6$)</li>
              </ul>
            </div>
            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px', fontSize: '11px', color: '#64748b' }}>
              <span>共计绘制了 <strong className="text-slate-800">{tsData.length}</strong> 个 CTD 水文温盐采样点。</span>
            </div>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', margin: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 className="card-title" style={{ margin: 0 }}>
                南印度洋水文温盐等密度 (T-S) 分布图
              </h3>
            </div>
            <div style={{ width: '100%', height: '500px', background: '#ffffff', borderRadius: '8px', padding: '10px' }}>
              {tsData.length === 0 ? (
                <div style={{ height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#94a3b8' }}>
                  未检测到水文温盐数据，请先上传 CTD 水文数据
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 20, right: 30, bottom: 30, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis
                      type="number"
                      dataKey="salinity"
                      name="Salinity"
                      unit=" psu"
                      domain={['dataMin - 0.2', 'dataMax + 0.2']}
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      label={{ value: 'Salinity [psu]', position: 'insideBottom', offset: -15, fill: '#334155', fontSize: 12, fontWeight: 'bold' }}
                    />
                    <YAxis
                      type="number"
                      dataKey="temperature"
                      name="Temperature"
                      unit=" °C"
                      domain={['dataMin - 1', 'dataMax + 1']}
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      label={{ value: 'Potential Temperature [°C]', angle: -90, position: 'insideLeft', offset: 0, fill: '#334155', fontSize: 12, fontWeight: 'bold' }}
                    />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                    <Legend verticalAlign="top" height={36} iconType="circle" />
                    
                    {/* Background Isopycnals */}
                    {densityContoursTS.map((c) => (
                      <Scatter
                        key={`sig-ts-${c.sigma}`}
                        name={`σθ = ${c.sigma}`}
                        data={c.points}
                        fill="none"
                        line={{ stroke: '#cbd5e1', strokeWidth: 0.75, strokeDasharray: '4 4' }}
                        shape={<g />}
                        legendType="none"
                      />
                    ))}

                    <Scatter name="表层水团 (<200m)" data={tsData.filter(d => d.depthGroup === 'Upper (<200m)')} fill="#ea580c" shape="circle" />
                    <Scatter name="中层水团 (200-1000m)" data={tsData.filter(d => d.depthGroup === 'Intermediate (200-1000m)')} fill="#059669" shape="circle" />
                    <Scatter name="深层水团 (&gt;1000m)" data={tsData.filter(d => d.depthGroup === 'Deep (>1000m)')} fill="#1d4ed8" shape="circle" />
                  </ScatterChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sub-tab: AOU vs. DOC Scatter Plot */}
      {visSubTab === 'aouDocPlot' && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '24px', alignItems: 'start' }}>
          <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 'bold', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px', margin: 0, color: '#0f172a' }}>
              AOU vs. DOC 呼吸关系分析
            </h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              表观耗氧量 (AOU) 反应了水团生物地球化学的老化与有机物矿化消耗氧气的程度。DOC 与 AOU 的负相关斜率代表 DOC 降解对海水总呼吸消耗的贡献率。
            </p>
            {aouDocStats && (
              <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <span className="text-xs font-bold text-slate-700 block mb-2">线性回归分析结果：</span>
                <div className="space-y-1 text-xs text-slate-600 font-medium">
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>拟合公式:</span>
                    <strong className="text-sky-700">DOC = {aouDocStats.slope.toFixed(4)} * AOU + {aouDocStats.intercept.toFixed(2)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>消耗贡献率 (Slope):</span>
                    <strong className="text-sky-700">{(Math.abs(aouDocStats.slope) * 100).toFixed(2)}%</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>决定系数 (R²):</span>
                    <strong className="text-amber-600">{aouDocStats.rsq.toFixed(4)}</strong>
                  </div>
                </div>
              </div>
            )}
            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px', fontSize: '11px', color: '#64748b' }}>
              <span>成功匹配 DOC 测定值与水文 AOU 值的样本点：<strong className="text-slate-800">{aouDocData.length}</strong> 个。</span>
            </div>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', margin: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 className="card-title" style={{ margin: 0 }}>
                南印度洋 AOU 与 DOC 生物地球化学降解关系图
              </h3>
            </div>
            <div style={{ width: '100%', height: '500px', background: '#ffffff', borderRadius: '8px', padding: '10px' }}>
              {aouDocData.length === 0 ? (
                <div style={{ height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#94a3b8' }}>
                  未匹配到相同站位和深度上的 AOU 与 DOC 观测值
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 20, right: 30, bottom: 30, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis
                      type="number"
                      dataKey="aou"
                      name="AOU"
                      unit=" µmol/kg"
                      domain={['dataMin - 10', 'dataMax + 10']}
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      label={{ value: 'Apparent Oxygen Utilization (AOU) [µmol/kg]', position: 'insideBottom', offset: -15, fill: '#334155', fontSize: 12, fontWeight: 'bold' }}
                    />
                    <YAxis
                      type="number"
                      dataKey="doc"
                      name="DOC"
                      unit=" µmol/L"
                      domain={['dataMin - 5', 'dataMax + 5']}
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      label={{ value: 'Dissolved Organic Carbon (DOC) [µmol/L]', angle: -90, position: 'insideLeft', offset: 0, fill: '#334155', fontSize: 12, fontWeight: 'bold' }}
                    />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                    <Legend verticalAlign="top" height={36} iconType="circle" />
                    
                    {/* Linear Regression Fit Line */}
                    {aouDocRegressionLine.length > 0 && (
                      <Scatter
                        name="线性拟合趋势线 (All Samples)"
                        data={aouDocRegressionLine}
                        fill="none"
                        line={{ stroke: '#dc2626', strokeWidth: 1.5 }}
                        shape={<g />}
                      />
                    )}

                    <Scatter name="表层水团 (<200m)" data={aouDocData.filter(d => d.depthGroup === 'Upper (<200m)')} fill="#ea580c" shape="circle" />
                    <Scatter name="中层水团 (200-1000m)" data={aouDocData.filter(d => d.depthGroup === 'Intermediate (200-1000m)')} fill="#059669" shape="circle" />
                    <Scatter name="深层水团 (&gt;1000m)" data={aouDocData.filter(d => d.depthGroup === 'Deep (>1000m)')} fill="#1d4ed8" shape="circle" />
                  </ScatterChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 出图预览 Modal */}
      {previewModal && previewModal.open && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999,
          fontFamily: 'system-ui, sans-serif'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            padding: '24px',
            maxWidth: '90%',
            maxHeight: '90%',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold', color: '#1e293b' }}>
                出图效果预览 ({previewModal.format.toUpperCase()} 格式)
              </h3>
              <button
                style={{
                  border: 'none',
                  background: 'none',
                  fontSize: '20px',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '4px'
                }}
                onClick={() => setPreviewModal(null)}
              >
                &times;
              </button>
            </div>
            
            <div style={{
              overflow: 'auto',
              maxHeight: '60vh',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center'
            }}>
              {previewModal.format === 'svg' ? (
                <object
                  data={previewModal.imgUrl}
                  type="image/svg+xml"
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', minWidth: '400px' }}
                />
              ) : (
                <img
                  src={previewModal.imgUrl}
                  alt="Plot Preview"
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                />
              )}
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setPreviewModal(null)}
                style={{ padding: '8px 16px', fontSize: '14px' }}
              >
                关闭预览
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const link = document.createElement('a');
                  link.download = previewModal.filename;
                  link.href = previewModal.imgUrl;
                  link.click();
                  setPreviewModal(null);
                }}
                style={{ padding: '8px 16px', fontSize: '14px', background: '#0284c7', color: '#ffffff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                确认下载此图
              </button>
            </div>
          </div>
        </div>
      )}
      
      {hoveredPoint2D && (
        <div
          style={{
            position: 'absolute',
            left: `${hoveredPoint2D.x}px`,
            top: `${hoveredPoint2D.y}px`,
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'none',
            zIndex: 1000,
            background: 'rgba(15, 23, 42, 0.95)',
            color: '#ffffff',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '11px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            lineHeight: '1.4',
            whiteSpace: 'nowrap',
            fontFamily: 'system-ui, sans-serif'
          }}
        >
          <div style={{ fontWeight: 'bold', borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: '2px', marginBottom: '2px', color: '#38bdf8' }}>
            测站: {hoveredPoint2D.station}
          </div>
          <div>深度: {hoveredPoint2D.depth} m</div>
          <div>浓度: <strong style={{ color: '#fbbf24' }}>{hoveredPoint2D.concentration.toFixed(2)}</strong> {isHydroMode ? (selectedHydroParam.includes(' ') ? selectedHydroParam.split(' ')[1] : '') : 'µmol/L'}</div>
          <div
            style={{
              position: 'absolute',
              bottom: '-4px',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '0',
              height: '0',
              borderLeft: '4px solid transparent',
              borderRight: '4px solid transparent',
              borderTop: '4px solid rgba(15, 23, 42, 0.95)'
            }}
          />
        </div>
      )}
    </div>
  );
}
