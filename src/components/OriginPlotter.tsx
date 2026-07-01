import { useState, useMemo, useRef, useEffect } from 'react';
import {
  LineChart, Map, Download, AlertTriangle, Wrench, Layout, Info
} from 'lucide-react';
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis,
  CartesianGrid, Tooltip, ErrorBar
} from 'recharts';
import { contours } from 'd3-contour';
import { scaleLinear } from 'd3-scale';
import { curveCardinal } from 'd3-shape';
import { normalizeStationName } from '../utils/stationParser';
import { interpolateIDW } from '../utils/calc';
import { ExcelSampleInfo, HydrologicalSample } from '../types';

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
  const [visSubTab, setVisSubTab] = useState<'profile1d' | 'contour2d'>(() => loadSavedState<'profile1d' | 'contour2d'>('ocean_visSubTab', 'profile1d'));

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

  // Custom templates/presets state for preserving work steps
  const [customPresets, setCustomPresets] = useState<{
    id: string;
    name: string;
    timestamp: string;
    visSubTab: 'profile1d' | 'contour2d';
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
      colorbarTitleOffset: 0
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
  }, [
    visSubTab, selectedStation, stationMode1D, selectedStationsMulti, focusedStation1D, multiLayout1D, docMin, docMax, contourStep, idwPower, anisotropyFactor,
    contourXAxis, minDepthFilter, maxDepthFilter, minXFilter, maxXFilter, visSettingsTab, settingsTab1D, stationSortMode1D, chartStyles, textSettings, legendPos,
    contourStartStation, contourEndStation
  ]);

  // Automatically toggle top labels based on X-Axis type to avoid duplicate redundancy by default
  useEffect(() => {
    setChartStyles(prev => ({
      ...prev,
      showTopStationLabels: contourXAxis !== 'station'
    }));
    setTextSettings(prev => ({
      ...prev,
      xAxisLabel: {
        ...prev.xAxisLabel,
        text: contourXAxis === 'longitude'
          ? 'Longitude (°E)'
          : contourXAxis === 'latitude'
            ? 'Latitude (°N)'
            : 'Station Index'
      }
    }));
  }, [contourXAxis]);

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
    const rawList = Array.from(new Set(processedSamples.map(g => g.station).filter(Boolean))) as string[];
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
      setTextSettings(prev => ({
        ...prev,
        title: {
          ...prev.title,
          text: `${selectedHydroParam} 空间断面等值线分布图`
        },
        legendLabel: {
          ...prev.legendLabel,
          text: `${selectedHydroParam} 测量值`
        },
        colorbarTitle: {
          ...prev.colorbarTitle,
          text: `${selectedHydroParam}`
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

  // Automatically align selectedStation and selectedStationsMulti to current active stations list
  useEffect(() => {
    if (sortedStationsList.length > 0) {
      // 1. Single station reset
      if (!sortedStationsList.includes(selectedStation)) {
        setSelectedStation(sortedStationsList[0]);
      }
      
      // 2. Multi stations reset: filter out any stations that are not in the new active list
      setSelectedStationsMulti(prev => {
        const valid = prev.filter(st => sortedStationsList.includes(st));
        // If nothing is valid, default to the first few stations
        if (valid.length === 0) {
          return sortedStationsList.slice(0, Math.min(3, sortedStationsList.length));
        }
        return valid;
      });

      // 3. Start/End station reset for contour
      if (!sortedStationsList.includes(contourStartStation)) {
        setContourStartStation(sortedStationsList[0]);
      }
      if (!sortedStationsList.includes(contourEndStation)) {
        setContourEndStation(sortedStationsList[sortedStationsList.length - 1]);
      }
    }
  }, [sortedStationsList]);

  // Compute data bounds
  const dataBounds = useMemo(() => {
    const valid = processedSamples.filter(s => s.station !== null && s.depth !== null && !s.isRejected);
    if (valid.length === 0) {
      return { minDepth: 0, maxDepth: 1000, minLon: 30, maxLon: 120, minLat: -40, maxLat: 20 };
    }
    const depths = valid.map(s => s.depth as number);
    const lons = valid.map(s => s.longitude || 0);
    const lats = valid.map(s => s.latitude || 0);
    return {
      minDepth: 0,
      maxDepth: Math.max(...depths, 100),
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons),
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats)
    };
  }, [processedSamples]);

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
  const [interpolatedPoints, setInterpolatedPoints] = useState<{ x: number; y: number; name: string }[]>([]);
  const [contourDataPoints, setContourDataPoints] = useState<{ cx: number; cy: number; conc: number; xNorm: number; yNorm: number }[]>([]);
  const [topStationTicks, setTopStationTicks] = useState<{ name: string; cx: number }[]>([]);
  const [bathyPath, setBathyPath] = useState<string>('');

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
        const pixelsPerUnit = 720 / span; // X-axis width is 720px
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
    const height = 540;
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
      svgImage.setAttribute('x', '80');
      svgImage.setAttribute('y', '90');
      svgImage.setAttribute('width', '720');
      svgImage.setAttribute('height', '380');
      svgImage.setAttribute('href', rasterDataUrl);
      svgImage.setAttribute('clip-path', 'url(#plot-area-clip)');

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

    // Draw background raster canvas exactly where it sits in the preview (left:80px, top:90px, size: 720x380)
    ctx.drawImage(canvas, 80, 90, 720, 380);

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

  // Draw contour plot on dependencies change
  useEffect(() => {
    if (!canvasElement) return;

    const canvas = canvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const validSamples = processedSamples.filter(
      s => s.station !== null && s.depth !== null && !s.isRejected && !s.isBlank && !s.isStd
    );

    if (validSamples.length === 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setContourSvgPaths([]);
      setContourDataPoints([]);
      setInterpolatedPoints([]);
      return;
    }

    const startIdx = sortedStationsList.indexOf(contourStartStation || sortedStationsList[0]);
    const endIdx = sortedStationsList.indexOf(contourEndStation || sortedStationsList[sortedStationsList.length - 1]);
    const minIdx = Math.min(startIdx, endIdx);
    const maxIdx = Math.max(startIdx, endIdx);

    const activeStations = sortedStationsList.filter((_, idx) => idx >= minIdx && idx <= maxIdx);

    const stationJitteredCoords: Record<string, number> = {};
    const seenCoords: Record<number, number> = {};
    activeStations.forEach(st => {
      const stSamples = validSamples.filter(s => s.station === st);
      let coord = 0;
      if (contourXAxis === 'longitude') {
        coord = stSamples[0]?.longitude || 0;
      } else if (contourXAxis === 'latitude') {
        coord = stSamples[0]?.latitude || 0;
      } else {
        coord = activeStations.indexOf(st);
      }
      const count = seenCoords[coord] || 0;
      seenCoords[coord] = count + 1;
      const jitter = count * 0.0001;
      stationJitteredCoords[st] = coord + jitter;
    });

    const getXValue = (s: typeof validSamples[0]) => {
      return stationJitteredCoords[s.station!] || 0;
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
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setContourSvgPaths([]);
      setContourDataPoints([]);
      setInterpolatedPoints([]);
      return;
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

    const gridWidth = 100;
    const gridHeight = 100;
    const gridValues = new Float32Array(gridWidth * gridHeight);

    for (let r = 0; r < gridHeight; r++) {
      const gridYNorm = (r / (gridHeight - 1)) * anisotropyFactor;
      for (let c = 0; c < gridWidth; c++) {
        const gridXNorm = c / (gridWidth - 1);
        gridValues[r * gridWidth + c] = interpolateIDW(dataPoints, gridXNorm, gridYNorm, idwPower);
      }
    }

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

    for (let cy = 0; cy < canvasHeight; cy++) {
      const gridYRatio = cy / (canvasHeight - 1);
      const gy = gridYRatio * (gridHeight - 1);
      const y0 = Math.floor(gy);
      const y1 = Math.min(y0 + 1, gridHeight - 1);
      const ty = gy - y0;

      for (let cx = 0; cx < canvasWidth; cx++) {
        const gridXRatio = cx / (canvasWidth - 1);
        const gx = gridXRatio * (gridWidth - 1);
        const x0 = Math.floor(gx);
        const x1 = Math.min(x0 + 1, gridWidth - 1);
        const tx = gx - x0;

        const v00 = gridValues[y0 * gridWidth + x0];
        const v10 = gridValues[y0 * gridWidth + x1];
        const v01 = gridValues[y1 * gridWidth + x0];
        const v11 = gridValues[y1 * gridWidth + x1];

        // Bilinear interpolation
        let val = v00 * (1 - tx) * (1 - ty) +
          v10 * tx * (1 - ty) +
          v01 * (1 - tx) * ty +
          v11 * tx * ty;

        // Apply discrete color banding if enabled
        if (chartStyles.colorBanding === 'discrete') {
          // Snap val to nearest contour step boundary
          const stepsCount = Math.floor((val - docMin) / contourStep);
          val = docMin + stepsCount * contourStep + contourStep / 2;
        }

        // SCIENTIFIC INTERPOLATION DISTANCE MASKING
        let minDistance = 999999;
        for (let idx = 0; idx < dataPoints.length; idx++) {
          const dx = gridXRatio - dataPoints[idx].rawX;
          const dy = gridYRatio - dataPoints[idx].rawY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < minDistance) {
            minDistance = dist;
          }
        }

        const pixelIdx = (cy * canvasWidth + cx) * 4;
        
        // If distance exceeds mask threshold percentage (e.g. 0.35 = 35% of plot area), mask cell to transparent/white
        if (minDistance > chartStyles.maskDistance) {
          imgData.data[pixelIdx] = 255;
          imgData.data[pixelIdx + 1] = 255;
          imgData.data[pixelIdx + 2] = 255;
          imgData.data[pixelIdx + 3] = 0; // completely transparent (or white if drawn)
          continue;
        }

        const hexColor = colorScale(val);

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
      if (contour.coordinates) {
        contour.coordinates.forEach((polygon) => {
          polygon.forEach((ring) => {
            ring.forEach((coord, i) => {
              const x = coord[0] * scaleX;
              const y = coord[1] * scaleY;
              if (i === 0) pathStr += `M${x},${y}`;
              else pathStr += `L${x},${y}`;
            });
            pathStr += "Z";
          });
        });
      }
      return {
        path: pathStr,
        value: contour.value
      };
    });
    setContourSvgPaths(paths);

    const sampleDots = filteredSamples.map(s => {
      const xVal = getXValue(s);
      const cx = ((xVal - minX) / xSpan) * canvasWidth;
      const cy = ((s.depth! - minY) / ySpan) * canvasHeight;
      return { cx, cy, conc: s.concentration, xNorm: (xVal - minX) / xSpan, yNorm: (s.depth! - minY) / ySpan };
    });
    setContourDataPoints(sampleDots);

    const ticksCount = 5;
    const labelsList = [];
    if (contourXAxis === 'station') {
      const step = Math.max(1, Math.floor(activeStations.length / ticksCount));
      for (let i = 0; i < activeStations.length; i += step) {
        labelsList.push({
          x: (i / (activeStations.length - 1 || 1)) * canvasWidth,
          y: 0,
          name: activeStations[i]!
        });
      }
    } else {
      for (let i = 0; i < ticksCount; i++) {
        const ratio = i / (ticksCount - 1);
        const val = minX + ratio * xSpan;
        const unit = contourXAxis === 'longitude' ? '°E' : '°N';
        labelsList.push({
          x: ratio * canvasWidth,
          y: 0,
          name: `${val.toFixed(1)}${unit}`
        });
      }
    }
    setInterpolatedPoints(labelsList);

    const bathyPoints = activeStations.map(st => {
      const stSamples = validSamples.filter(s => s.station === st);
      const normSt = normalizeStationName(st);
      const stCoords = stationCoords.filter(c => normalizeStationName(c.station) === normSt);
      const botDepthVal = stCoords.find(c => c.botDepth !== undefined)?.botDepth
        || Math.max(...stSamples.map(s => s.depth || 0), 100);

      const xVal = stationJitteredCoords[st] || 0;
      const cx = ((xVal - minX) / xSpan) * canvasWidth;
      const cy = ((botDepthVal - minY) / ySpan) * canvasHeight;
      return { cx, cy };
    });

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

    const ticks = activeStations.map(st => {
      const xVal = stationJitteredCoords[st] || 0;
      const cx = ((xVal - minX) / xSpan) * canvasWidth;
      return { name: st || '', cx };
    });
    setTopStationTicks(ticks);
  }, [canvasElement, processedSamples, docMin, docMax, contourStep, idwPower, anisotropyFactor, contourXAxis, minDepthFilter, maxDepthFilter, minXFilter, maxXFilter, contourStartStation, contourEndStation, chartStyles.colormap, chartStyles.colorBanding, chartStyles.maskDistance]);

  // Calculate adaptive axis and legend title variables
  const maxDepthLabelLength = Math.max(...[0.0, 0.25, 0.5, 0.75, 1.0].map(r => (minDepthFilter + (maxDepthFilter - minDepthFilter) * r).toFixed(0).length));
  const estimatedYTickWidth = maxDepthLabelLength * (textSettings.ticksLabels.fontSize || 8.5) * 0.6;
  const autoYAxisTitleX = Math.max(10, 70 - estimatedYTickWidth - 12);
  const yAxisTitleX = autoYAxisTitleX - (chartStyles.yAxisTitleOffset || 0);

  const autoXAxisTitleY = 488 + (textSettings.ticksLabels.fontSize || 8.5) + 18;
  const xAxisTitleY = autoXAxisTitleY + (chartStyles.xAxisTitleOffset || 0);

  const colorbarTitleX = 850 + chartStyles.colorbarWidth / 2;
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

        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
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
                      <strong className="text-amber-600">{Math.round(chartStyles.maskDistance * 100)}%</strong>
                    </label>
                    <input
                      type="range"
                      min="0.1"
                      max="1.0"
                      step="0.05"
                      className="w-full"
                      value={chartStyles.maskDistance}
                      onChange={e => setChartStyles(prev => ({ ...prev, maskDistance: parseFloat(e.target.value) }))}
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
                      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                      </div>

                     {/* Color Adjusters */}
                     <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
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
          <div className="card" style={{ display: 'flex', flexDirection: 'column', minWidth: '930px', overflowX: 'auto' }}>
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
            <div style={{ position: 'relative', width: '940px', height: '540px', backgroundColor: '#ffffff', userSelect: 'none', marginTop: '10px' }}>
              
              {/* Main Canvas Plot (starting at left 80px, top 90px) */}
              <canvas
                ref={setCanvasElement}
                width={720}
                height={380}
                style={{ position: 'absolute', top: '90px', left: '80px', width: '720px', height: '380px', zIndex: 1, border: `1px solid ${chartStyles.axisStroke}` }}
              />

              {/* SVG overlay (starts at 0, 0 and covers the labels area too) */}
              <svg
                width={940}
                height={540}
                style={{ position: 'absolute', top: 0, left: 0, width: '940px', height: '540px', zIndex: 2, pointerEvents: 'none' }}
              >
                {/* Clipping path definition to keep contours within the black border */}
                <defs>
                  <clipPath id="plot-area-clip">
                    <rect x={80} y={90} width={720} height={380} />
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
                <g clipPath="url(#plot-area-clip)">
                  {contourSvgPaths.map((p: { path: string; value: number }, i: number) => {
                    return (
                      <path
                        key={i}
                        d={p.path}
                        transform="translate(80, 90)"
                        fill="none"
                        stroke={chartStyles.lineStroke}
                        strokeWidth={chartStyles.lineWidth}
                      />
                    );
                  })}

                  {/* Bathymetry Sea Floor Silhouette Masking */}
                  {bathyPath && (
                    <path
                      d={bathyPath}
                      transform="translate(80, 90)"
                      fill={chartStyles.bathyFill}
                      stroke={chartStyles.bathyStroke}
                      strokeWidth={chartStyles.bathyStrokeWidth}
                    />
                  )}

                  {/* Black dots overlay representing measurement depth/locations */}
                  {contourDataPoints.map((pt, i) => (
                    <circle
                      key={i}
                      cx={pt.cx + 80}
                      cy={pt.cy + 90}
                      r={chartStyles.pointRadius}
                      fill={chartStyles.pointFill}
                      stroke={chartStyles.pointStroke}
                      strokeWidth={chartStyles.pointStrokeWidth}
                    >
                      <title>浓度: {pt.conc.toFixed(2)} µmol/L</title>
                    </circle>
                  ))}
                </g>

                {/* ODV Border Outline */}
                <rect x={80} y={90} width={720} height={380} fill="none" stroke={chartStyles.axisStroke} strokeWidth="1" />

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
                {[0.0, 0.25, 0.5, 0.75, 1.0].map((r, i) => {
                  const depthVal = (minDepthFilter + (maxDepthFilter - minDepthFilter) * r).toFixed(0);
                  const yPos = 90 + 380 * r;
                  const isOutward = chartStyles.tickDirection === 'outward';
                  const tickX = isOutward ? 75 : 85;

                  return (
                    <g key={i}>
                      {/* Left border tick */}
                      <line x1={tickX} y1={yPos} x2={80} y2={yPos} stroke={chartStyles.axisStroke} strokeWidth="1" />
                      
                      {/* Optional Right border tick (Closed Box symmetry) */}
                      {chartStyles.closedBorderTicks && (
                        <line x1={800} y1={yPos} x2={isOutward ? 805 : 795} y2={yPos} stroke={chartStyles.axisStroke} strokeWidth="1" />
                      )}
                      
                      <text
                        x={70}
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
                        textAnchor="end"
                        onDoubleClick={(e) => handleTextDoubleClick('ticksLabels', e)}
                      >
                        {depthVal}
                      </text>
                    </g>
                  );
                })}

                {/* Bottom X-Axis Title */}
                <text
                  x={420}
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
                  const xPos = pt.x + 80;
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
                    const xPos = tick.cx + 80;
                    if (xPos < 80 || xPos > 800) return null;

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
                  x={20}
                  y={130}
                  width={65}
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
                  x={20}
                  y={90}
                  width={65}
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
                  x={20}
                  y={430}
                  width={65}
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
                  x={152}
                  y={470}
                  width={576}
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
                  x={80}
                  y={470}
                  width={72}
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
                  x={728}
                  y={470}
                  width={72}
                  height={40}
                  fill="transparent"
                  cursor="ew-resize"
                  style={{ pointerEvents: 'auto', zIndex: 10 }}
                  onMouseDown={(e) => handleXAxisMouseDown('scale-max', e)}
                >
                  <title>左右拖拽：缩放横坐标上限</title>
                </rect>
              </svg>
            </div>

            <div style={{ display: 'flex', gap: '20px', marginTop: '16px', fontSize: '11px', color: '#94a3b8', flexWrap: 'wrap', justifyContent: 'center' }}>
              <span>※ 横轴：{contourXAxis === 'station' ? '测站序号' : contourXAxis === 'longitude' ? '经度' : '纬度'}</span>
              <span>※ 纵轴：海水标定深度 (米)</span>
              <span>● 黑色圆点：实际采样点</span>
              <span>■ 灰色阴影：海底地形 (海床)</span>
              <span>💡 支持直接在坐标轴上拖拽平移范围，轴两端拖拽拉伸轴距</span>
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
    </div>
  );
}
