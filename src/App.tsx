import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Upload, FileText, Download, Trash2, CheckCircle, AlertTriangle,
  Settings, ChevronLeft, ChevronRight, Check, Printer, FileSpreadsheet
} from 'lucide-react';
import { parseRawTxt } from './utils/parser';
import { selectBestSubset, fitCalibrationCurve, calculateMean, calculateStdev } from './utils/calc';
import { parseStationCoordinates, normalizeStationName, parseHydrologicalExcel } from './utils/stationParser';
import { RawInjection, SampleGroup, ExcelSampleInfo, HydrologicalSample } from './types';
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend
} from 'recharts';
import * as xlsx from 'xlsx';
import OriginPlotter from './components/OriginPlotter';
import QCDashboard from './components/QCDashboard';
import { exportMultiSheetQCExcel, exportODVPlottingCSV, ColumnBatchExportData } from './utils/excelExporter';
import { evaluateSampleQC, correctCrmIdentity } from './utils/qcEvaluator';

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

// ChartStyles interface removed, now defined inside OriginPlotter

export default function App() {
  const [currentStep, setCurrentStep] = useState<number>(() => loadSavedState('ocean_currentStep', 1));

  // File management state
  const [files, setFiles] = useState<{ name: string; size: number }[]>(() => loadSavedState('ocean_files', []));
  const [rawInjections, setRawInjections] = useState<RawInjection[]>(() => loadSavedState('ocean_rawInjections', []));
  const [stationCoords, setStationCoords] = useState<ExcelSampleInfo[]>(() => loadSavedState('ocean_stationCoords', []));
  const [hydroSamples, setHydroSamples] = useState<HydrologicalSample[]>(() => loadSavedState('ocean_hydroSamples', []));
  const [hydroParameters, setHydroParameters] = useState<string[]>(() => loadSavedState('ocean_hydroParameters', []));
  const [hydroSheetNames, setHydroSheetNames] = useState<string[]>(() => loadSavedState('ocean_hydroSheetNames', []));
  const [hydroSelectedSheet, setHydroSelectedSheet] = useState<string>(() => loadSavedState('ocean_hydroSelectedSheet', ''));
  const [hydroFileBuffer, setHydroFileBuffer] = useState<ArrayBuffer | null>(null);

  // Standard curve parameters
  const [stdStockC, setStdStockC] = useState<number>(() => loadSavedState('ocean_stdStockC', 10000)); // standard stock concentration (µmol C / L)
  const [stdDilutionFactor, setStdDilutionFactor] = useState<number>(() => loadSavedState('ocean_stdDilutionFactor', 25.2525)); // standard dilution factor
  const [stdUsedC, setStdUsedC] = useState<number>(() => loadSavedState('ocean_stdUsedC', 396)); // used standard uM C
  const [dilutionFactors] = useState<number[]>(() => loadSavedState('ocean_dilutionFactors', [21, 10, 6, 5, 4, 3]));

  const handleStdStockCChange = (val: number) => {
    setStdStockC(val);
    if (stdDilutionFactor > 0) {
      setStdUsedC(Number((val / stdDilutionFactor).toFixed(4)));
    }
  };

  const handleStdDilutionFactorChange = (val: number) => {
    setStdDilutionFactor(val);
    if (val > 0) {
      setStdUsedC(Number((stdStockC / val).toFixed(4)));
    }
  };

  const handleStdUsedCChange = (val: number) => {
    setStdUsedC(val);
    if (val > 0) {
      setStdDilutionFactor(Number((stdStockC / val).toFixed(4)));
    }
  };

  const [enabledStds, setEnabledStds] = useState<Record<string, boolean>>(() => loadSavedState('ocean_enabledStds', {})); // standard group id -> enabled
  const [customDilutions, setCustomDilutions] = useState<Record<string, number>>(() => loadSavedState('ocean_customDilutions', {})); // standard group id -> dilution factor

  // Sample manual overrides
  const [excludedInjections, setExcludedInjections] = useState<Record<string, boolean[]>>(() => loadSavedState('ocean_excludedInjections', {})); // group id -> boolean array of excluded injections
  const [rejectedSamples, setRejectedSamples] = useState<Record<string, boolean>>(() => loadSavedState('ocean_rejectedSamples', {})); // group id -> rejected boolean
  const [customSampleNames, setCustomSampleNames] = useState<Record<string, string>>(() => loadSavedState('ocean_customSampleNames', {}));
  const [activeQcModalCurveId, setActiveQcModalCurveId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [disabledCurves, setDisabledCurves] = useState<Record<string, boolean>>(() => loadSavedState('ocean_disabledCurves', {}));
  const [customStdUsedCs, setCustomStdUsedCs] = useState<Record<string, number>>(() => loadSavedState('ocean_customStdUsedCs', {}));

  const [sampleSortOrder, setSampleSortOrder] = useState<'import' | 'category' | 'name' | 'concentration'>(() => loadSavedState<'import' | 'category' | 'name' | 'concentration'>('ocean_sampleSortOrder', 'category'));
  const [selectedCurveId, setSelectedCurveId] = useState<string>(() => loadSavedState('ocean_selectedCurveId', ''));
  const [emptyInjectionThreshold, setEmptyInjectionThreshold] = useState<number>(() => loadSavedState('ocean_emptyInjectionThreshold', 0.1));
  const [dswMin, setDswMin] = useState<number>(() => loadSavedState('ocean_dswMin', 41));
  const [dswMax, setDswMax] = useState<number>(() => loadSavedState('ocean_dswMax', 45));
  const [sswMin, setSswMin] = useState<number>(() => loadSavedState('ocean_sswMin', 70));
  const [sswMax, setSswMax] = useState<number>(() => loadSavedState('ocean_sswMax', 80));
  const [curveOffsets, setCurveOffsets] = useState<Record<string, number>>(() => loadSavedState('ocean_curveOffsets', {}));
  const [enableBlankCorrection, setEnableBlankCorrection] = useState<boolean>(() => loadSavedState('ocean_enableBlankCorrection', false));
  const [forceZeroIntercept, setForceZeroIntercept] = useState<boolean>(() => loadSavedState('ocean_forceZeroIntercept', false));

  // Reset active page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [sampleSortOrder]);

  // Save state to LocalStorage for persistence
  useEffect(() => {
    localStorage.setItem('ocean_currentStep', JSON.stringify(currentStep));
    localStorage.setItem('ocean_files', JSON.stringify(files));
    localStorage.setItem('ocean_rawInjections', JSON.stringify(rawInjections));
    localStorage.setItem('ocean_stationCoords', JSON.stringify(stationCoords));
    localStorage.setItem('ocean_stdStockC', JSON.stringify(stdStockC));
    localStorage.setItem('ocean_stdDilutionFactor', JSON.stringify(stdDilutionFactor));
    localStorage.setItem('ocean_stdUsedC', JSON.stringify(stdUsedC));
    localStorage.setItem('ocean_dilutionFactors', JSON.stringify(dilutionFactors));
    localStorage.setItem('ocean_enabledStds', JSON.stringify(enabledStds));
    localStorage.setItem('ocean_customDilutions', JSON.stringify(customDilutions));
    localStorage.setItem('ocean_excludedInjections', JSON.stringify(excludedInjections));
    localStorage.setItem('ocean_rejectedSamples', JSON.stringify(rejectedSamples));
    localStorage.setItem('ocean_customSampleNames', JSON.stringify(customSampleNames));
    localStorage.setItem('ocean_sampleSortOrder', JSON.stringify(sampleSortOrder));
    localStorage.setItem('ocean_selectedCurveId', JSON.stringify(selectedCurveId));
    localStorage.setItem('ocean_emptyInjectionThreshold', JSON.stringify(emptyInjectionThreshold));
    localStorage.setItem('ocean_dswMin', JSON.stringify(dswMin));
    localStorage.setItem('ocean_dswMax', JSON.stringify(dswMax));
    localStorage.setItem('ocean_sswMin', JSON.stringify(sswMin));
    localStorage.setItem('ocean_sswMax', JSON.stringify(sswMax));
    localStorage.setItem('ocean_curveOffsets', JSON.stringify(curveOffsets));
    localStorage.setItem('ocean_disabledCurves', JSON.stringify(disabledCurves));
    localStorage.setItem('ocean_customStdUsedCs', JSON.stringify(customStdUsedCs));
    localStorage.setItem('ocean_hydroSamples', JSON.stringify(hydroSamples));
    localStorage.setItem('ocean_hydroParameters', JSON.stringify(hydroParameters));
    localStorage.setItem('ocean_hydroSheetNames', JSON.stringify(hydroSheetNames));
    localStorage.setItem('ocean_hydroSelectedSheet', JSON.stringify(hydroSelectedSheet));
    localStorage.setItem('ocean_enableBlankCorrection', JSON.stringify(enableBlankCorrection));
    localStorage.setItem('ocean_forceZeroIntercept', JSON.stringify(forceZeroIntercept));
  }, [
    currentStep, files, rawInjections, stationCoords, stdStockC,
    stdDilutionFactor, stdUsedC, dilutionFactors, enabledStds, customDilutions,
    excludedInjections, rejectedSamples, customSampleNames, sampleSortOrder, selectedCurveId,
    emptyInjectionThreshold, dswMin, dswMax, sswMin, sswMax, curveOffsets, disabledCurves, customStdUsedCs,
    hydroSamples, hydroParameters, hydroSheetNames, hydroSelectedSheet, enableBlankCorrection, forceZeroIntercept
  ]);




  // File Upload Handling
  const rawFileInputRef = useRef<HTMLInputElement>(null);
  const coordFileInputRef = useRef<HTMLInputElement>(null);
  const [isDragActiveRaw, setIsDragActiveRaw] = useState<boolean>(false);
  const [isDragActiveCoord, setIsDragActiveCoord] = useState<boolean>(false);

  const handleDragRaw = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActiveRaw(true);
    } else if (e.type === "dragleave") {
      setIsDragActiveRaw(false);
    }
  };

  const handleDropRaw = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActiveRaw(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processRawFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileChangeRaw = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processRawFiles(Array.from(e.target.files));
    }
  };

  const handleDragCoord = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActiveCoord(true);
    } else if (e.type === "dragleave") {
      setIsDragActiveCoord(false);
    }
  };

  const handleDropCoord = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActiveCoord(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processCoordFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileChangeCoord = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processCoordFiles(Array.from(e.target.files));
    }
  };

  // Helper to extract physical date timestamp/priority for sorting files chromatically
  const getFileSortPriority = (fileName: string): number => {
    const fn = fileName.toLowerCase();
    // Highest priority (earliest): indian ocean-51, 50, etc.
    if (fn.includes('indian ocean-51') || fn.includes('indian ocean 51')) return 10051;
    if (fn.includes('indian ocean-50') || fn.includes('indian ocean 50')) return 10050;
    if (fn.includes('indian ocean')) return 10099;

    // Regular date pattern matching (e.g., 6.10, 6.14, 6.18, 6.21, 6.25, 6.29, 7.3, 11-7.3)
    const dateMatch = fn.match(/(\d{1,2})\.(\d{1,2})/);
    if (dateMatch) {
      const month = parseInt(dateMatch[1], 10);
      const day = parseInt(dateMatch[2], 10);
      
      // Batch index prefix (e.g. 1-6.21 -> 1, 9-6.29 -> 9)
      const batchMatch = fn.match(/^(\d+)-/);
      const batchNo = batchMatch ? parseInt(batchMatch[1], 10) : 0;
      
      return 200000 + month * 10000 + day * 100 + batchNo;
    }

    return 900000;
  };

  const processRawFiles = async (fileList: File[]) => {
    // Sort incoming files by physical measurement date & batch priority
    const sortedFileList = [...fileList].sort((a, b) => getFileSortPriority(a.name) - getFileSortPriority(b.name));

    const newFiles: { name: string; size: number }[] = [];
    let accumulatedInjections: RawInjection[] = [...rawInjections];
    let detectedConc: number | null = null;

    for (const file of sortedFileList) {
      if (files.some(f => f.name === file.name)) continue;
      newFiles.push({ name: file.name, size: file.size });

      try {
        const content = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.readAsArrayBuffer(file);
          reader.onload = () => {
            const buffer = reader.result as ArrayBuffer;
            const arr = new Uint8Array(buffer);

            // 1. Check Byte Order Mark (BOM)
            if (arr.length >= 2) {
              if (arr[0] === 0xFF && arr[1] === 0xFE) {
                resolve(new TextDecoder('utf-16le').decode(buffer));
                return;
              }
              if (arr[0] === 0xFE && arr[1] === 0xFF) {
                resolve(new TextDecoder('utf-16be').decode(buffer));
                return;
              }
            }
            if (arr.length >= 3 && arr[0] === 0xEF && arr[1] === 0xBB && arr[2] === 0xBF) {
              resolve(new TextDecoder('utf-8').decode(buffer.slice(3)));
              return;
            }

            // 2. Try UTF-8 (strict)
            try {
              const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
              resolve(utf8Decoder.decode(buffer));
            } catch (e) {
              // 3. Fallback to GB18030/GBK
              const gbkDecoder = new TextDecoder('gb18030');
              resolve(gbkDecoder.decode(buffer));
            }
          };
        });

        const parsed = parseRawTxt(content, file.name);
        accumulatedInjections = [...accumulatedInjections, ...parsed];

        // Auto-detect standard concentration (e.g. std(419.4uM-0604) -> 419.4)
        if (detectedConc === null) {
          for (const inj of parsed) {
            const cMatch = inj.sampleName.match(/std\((\d+\.?\d*)uM/i);
            if (cMatch) {
              const val = parseFloat(cMatch[1]);
              if (!isNaN(val) && val > 0) {
                detectedConc = val;
                break;
              }
            }
          }
        }
      } catch (err) {
        console.error("Error reading raw data file:", err);
      }
    }

    if (newFiles.length > 0) {
      setFiles(prev => [...prev, ...newFiles]);
      if (accumulatedInjections.length > rawInjections.length) {
        setRawInjections(accumulatedInjections);
      }
      if (detectedConc !== null) {
        setStdUsedC(detectedConc);
        setStdDilutionFactor(Number((stdStockC / detectedConc).toFixed(4)));
      }
    }
  };

  const processCoordFiles = async (fileList: File[]) => {
    const newFiles: { name: string; size: number }[] = [];
    let newCoords: ExcelSampleInfo[] = [];

    for (const file of fileList) {
      if (files.some(f => f.name === file.name)) continue;
      newFiles.push({ name: file.name, size: file.size });

      try {
        const buffer = await file.arrayBuffer();
        
        // Check if workbook contains CTD/hydrological data sheets or columns
        const data = new Uint8Array(buffer);
        const workbook = xlsx.read(data, { type: 'array' });
        const sheetNames = workbook.SheetNames;
        
        let isHydro = sheetNames.some(name => 
          name.toLowerCase().includes('ctd') || name.toLowerCase().includes('stst') || name.includes('基础数据')
        );
        
        // Double check by reading first sheet's headers
        if (!isHydro && sheetNames.length > 0) {
          const firstSheet = workbook.Sheets[sheetNames[0]];
          const jsonRows = xlsx.utils.sheet_to_json<any>(firstSheet, { header: 1 });
          if (jsonRows.length > 0) {
            const headers = jsonRows.find(row => Array.isArray(row) && row.some(cell => cell && cell.toString().toLowerCase().includes('station')));
            if (headers) {
              const hLower = headers.map((h: any) => h ? h.toString().toLowerCase() : '');
              isHydro = hLower.some((h: string) => h.includes('salinity') || h.includes('oxygen') || h.includes('temperature') || h.includes('盐度') || h.includes('溶解氧') || h.includes('温度'));
            }
          }
        }

        if (isHydro) {
          const result = parseHydrologicalExcel(buffer);
          if (result.samples.length > 0) {
            setHydroSamples(result.samples);
            setHydroParameters(result.parameters);
            setHydroSheetNames(result.sheetNames);
            setHydroSelectedSheet(result.selectedSheet);
            setHydroFileBuffer(buffer);
          }
        } else {
          const coords = parseStationCoordinates(buffer);
          if (coords.length > 0) {
            const coordsWithFile = coords.map(c => ({ ...c, fileName: file.name }));
            newCoords = [...newCoords, ...coordsWithFile];
          }
        }
      } catch (err) {
        console.error("Error parsing station coordinates file:", err);
      }
    }

    if (newFiles.length > 0) {
      setFiles(prev => [...prev, ...newFiles]);
      if (newCoords.length > 0) {
        setStationCoords(prev => {
          const merged = [...prev];
          newCoords.forEach(c => {
            const idx = merged.findIndex(m =>
              normalizeStationName(m.labelId) === normalizeStationName(c.labelId) &&
              normalizeStationName(m.station) === normalizeStationName(c.station) &&
              m.depth === c.depth
            );
            if (idx !== -1) {
              merged[idx] = c;
            } else {
              merged.push(c);
            }
          });
          return merged;
        });
      }
    }
  };

  const handleHydroSheetChange = (sheetName: string) => {
    if (hydroFileBuffer) {
      const result = parseHydrologicalExcel(hydroFileBuffer, sheetName);
      if (result.samples.length > 0) {
        setHydroSamples(result.samples);
        setHydroParameters(result.parameters);
        setHydroSelectedSheet(result.selectedSheet);
      }
    }
  };

  const clearAllData = () => {
    setFiles([]);
    setRawInjections([]);
    setStationCoords([]);
    setEnabledStds({});
    setCustomDilutions({});
    setExcludedInjections({});
    setRejectedSamples({});
    setCustomSampleNames({});
    setDisabledCurves({});
    setCustomStdUsedCs({});
    setDswMin(41);
    setDswMax(45);
    setSswMin(70);
    setSswMax(80);
    setCurveOffsets({});
    setCurrentStep(1);
    setHydroSamples([]);
    setHydroParameters([]);
    setHydroSheetNames([]);
    setHydroSelectedSheet('');
    setHydroFileBuffer(null);
    setForceZeroIntercept(false);

    // Clean up localStorage to prevent lingering data
    const keys = [
      'ocean_currentStep', 'ocean_visSubTab', 'ocean_files', 'ocean_rawInjections',
      'ocean_stationCoords', 'ocean_stdStockC', 'ocean_stdDilutionFactor', 'ocean_stdUsedC',
      'ocean_dilutionFactors', 'ocean_enabledStds', 'ocean_customDilutions',
      'ocean_excludedInjections', 'ocean_rejectedSamples', 'ocean_customSampleNames', 'ocean_selectedStation',
      'ocean_docMin', 'ocean_docMax', 'ocean_contourStep', 'ocean_idwPower',
      'ocean_sampleSortOrder', 'ocean_selectedCurveId', 'ocean_emptyInjectionThreshold',
      'ocean_anisotropyFactor', 'ocean_contourXAxis', 'ocean_minDepthFilter',
      'ocean_maxDepthFilter', 'ocean_minXFilter', 'ocean_maxXFilter', 'ocean_showBackgroundMap',
      'ocean_chart_styles', 'ocean_visSettingsTab',
      'ocean_dswMin', 'ocean_dswMax', 'ocean_sswMin', 'ocean_sswMax', 'ocean_curveOffsets', 'ocean_disabledCurves', 'ocean_customStdUsedCs',
      'ocean_hydroSamples', 'ocean_hydroParameters', 'ocean_hydroSheetNames', 'ocean_hydroSelectedSheet',
      'ocean_enableBlankCorrection', 'ocean_forceZeroIntercept'
    ];
    keys.forEach(k => localStorage.removeItem(k));
  };

  const removeFile = (fileName: string) => {
    setFiles(prev => prev.filter(f => f.name !== fileName));
    setRawInjections(prev => prev.filter(inj => inj.fileName !== fileName));
    setStationCoords(prev => prev.filter(c => (c as any).fileName !== fileName));

    // Clean up manual exclusions and rejections for sample groups belonging to this file
    setExcludedInjections(prev => {
      const copy = { ...prev };
      Object.keys(copy).forEach(key => {
        if (key.startsWith(`${fileName}::`)) {
          delete copy[key];
        }
      });
      return copy;
    });
    setRejectedSamples(prev => {
      const copy = { ...prev };
      Object.keys(copy).forEach(key => {
        if (key.startsWith(`${fileName}::`)) {
          delete copy[key];
        }
      });
      return copy;
    });
    setCustomSampleNames(prev => {
      const copy = { ...prev };
      Object.keys(copy).forEach(key => {
        if (key.startsWith(`${fileName}::`)) {
          delete copy[key];
        }
      });
      return copy;
    });

    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv')) {
      setHydroSamples([]);
      setHydroParameters([]);
      setHydroSheetNames([]);
      setHydroSelectedSheet('');
      setHydroFileBuffer(null);
    }
  };

  // Group raw injections into Sample Groups
  const sampleGroups = useMemo(() => {
    if (rawInjections.length === 0) return [];

    const groups: {
      sampleName: string;
      sampleId: string;
      fileName: string;
      injections: number[];
      rawInjIndices: number[];
    }[] = [];

    let currentGroup: {
      sampleName: string;
      sampleId: string;
      fileName: string;
      injections: number[];
      rawInjIndices: number[];
    } | null = null;

    // Group injections by splitting when we encounter injNo === 1
    rawInjections.forEach((inj, globalIdx) => {
      if (inj.injNo === 1) {
        if (currentGroup) {
          groups.push(currentGroup);
        }
        currentGroup = {
          sampleName: inj.sampleName,
          sampleId: inj.sampleId,
          fileName: inj.fileName,
          injections: [inj.area],
          rawInjIndices: [globalIdx]
        };
      } else {
        if (currentGroup) {
          currentGroup.injections.push(inj.area);
          currentGroup.rawInjIndices.push(globalIdx);
        }
      }
    });
    if (currentGroup) {
      groups.push(currentGroup);
    }

    // Finalize groups: calculate average, standard deviation, classifications
    return groups.map((g, idx) => {
      const id = `${g.fileName}::${g.sampleName}::${g.sampleId}::${idx}`;
      let displayName = customSampleNames[id] !== undefined ? customSampleNames[id] : g.sampleName;
      if (customSampleNames[id] === undefined) {
        if (displayName.includes('374.1')) {
          displayName = displayName.replace(/374\.1uM-0625/i, '360uM-0625').replace(/374\.1uM/i, '360uM-0625').replace(/374\.1/i, '360');
        } else if (displayName.includes('340.1')) {
          displayName = displayName.replace(/std\(340\.1uM\)/i, 'std(340.1uM-0627)').replace(/std\(340\.1uM-[^\)]*\)/i, 'std(340.1uM-0627)');
        }
      }

      const isStd = displayName.toLowerCase().includes('std');
      const isBlank = (
        displayName.toLowerCase().includes('blank') ||
        displayName.toLowerCase().includes('mq') ||
        g.sampleId.toLowerCase().includes('blank') ||
        g.sampleId.toLowerCase().includes('mq')
      );
      const isSeawater = displayName.toLowerCase() === 'dsw' || displayName.toLowerCase() === 'ssw' || displayName.toLowerCase().startsWith('sw');

      // Try matching via Excel sample info (Label ID matching sampleName)
      const standardizeLabel = (name: string) => {
        let clean = name.replace(/[-_\s]/g, '').toLowerCase();
        if (clean.startsWith('s') && !clean.startsWith('st') && /^[a-z]\d+/.test(clean)) {
          clean = 'st' + clean.slice(1);
        }
        return clean;
      };

      const cleanDisplay = standardizeLabel(displayName);
      let excelMatch = stationCoords.find(c => {
        const cleanLabel = standardizeLabel(c.labelId);
        return cleanLabel === cleanDisplay;
      });

      // Fuzzy/Partial matching fallback: check if one contains the other (for non-standard names)
      if (!excelMatch && cleanDisplay) {
        excelMatch = stationCoords.find(c => {
          const cleanLabel = standardizeLabel(c.labelId);
          if (!cleanLabel) return false;
          return cleanDisplay.includes(cleanLabel) || cleanLabel.includes(cleanDisplay);
        });
      }

      let station: string | null = null;
      let depth: number | null = null;

      if (excelMatch) {
        station = excelMatch.station;
        depth = excelMatch.depth;
      } else {
        // Fallback to pattern parsing from sampleName
        const stDepthMatch = displayName.match(/S(?:T)?[-_]?(\d+)[-_]?(\d+)/i);
        if (stDepthMatch) {
          station = `ST-${stDepthMatch[1]}`;
          depth = parseInt(stDepthMatch[2], 10);
        } else {
          const parts = displayName.split('-');
          const stPart = parts.find((p: string) => p.toUpperCase().startsWith('ST') || (p.toUpperCase().startsWith('S') && /^[a-zA-Z]\d+/.test(p)));
          if (stPart) {
            station = stPart.toUpperCase();
          }
          if (parts.length >= 4) {
            const possibleDepth = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(possibleDepth) && possibleDepth > 0) {
              depth = possibleDepth;
            }
          }
        }
      }

      // Standardize parsed station name to match Excel coordinate sheet exactly, preventing duplicates like ST27 vs ST-27
      if (station && !excelMatch) {
        const normSt = normalizeStationName(station);
        const match = stationCoords.find(c => normalizeStationName(c.station) === normSt)
          || (hydroSamples && hydroSamples.find(h => normalizeStationName(h.station) === normSt));
        if (match) {
          station = match.station;
        }
      }

      // Check if user has manual exclusions for injections
      const manualExclusions = excludedInjections[id];

      let finalSelected: boolean[];
      let finalMean: number;
      let finalSd: number;
      let finalRsd: number;

      if (manualExclusions) {
        // Compute mean and SD based on manual exclusions
        const activeVals = g.injections.filter((_, i) => !manualExclusions[i]);
        finalSelected = g.injections.map((_, i) => !manualExclusions[i]);
        finalMean = calculateMean(activeVals);
        finalSd = calculateStdev(activeVals);
        finalRsd = finalMean > 0 ? (finalSd / finalMean) * 100 : 0;
      } else if (isBlank || g.injections.every(a => a < 1.0)) {
        // For MQ Blank or low-signal samples, 0-area peak values are valid blank readings. Run selectBestSubset across all injections
        const subsetResult = selectBestSubset(g.injections);
        finalSelected = subsetResult.selected;
        finalMean = subsetResult.avArea;
        finalSd = subsetResult.sdArea;
        finalRsd = subsetResult.rsd;
      } else {
        // Automatic empty injection exclusion (data cleaning) + 3-out-of-4 outlier exclusion
        const isEmpty = g.injections.map(area => area < emptyInjectionThreshold);
        const nonEmptyIndices = g.injections.map((_, i) => i).filter(i => !isEmpty[i]);
        const nonEmptyVals = nonEmptyIndices.map(i => g.injections[i]);

        if (nonEmptyVals.length <= 1 && g.injections.length >= 2) {
          // Fallback to selectBestSubset on all injections if empty threshold excluded too many
          const result = selectBestSubset(g.injections);
          finalSelected = result.selected;
          finalMean = result.avArea;
          finalSd = result.sdArea;
          finalRsd = result.rsd;
        } else if (nonEmptyVals.length === 0) {
          // Fallback if all are empty
          const result = selectBestSubset(g.injections);
          finalSelected = result.selected;
          finalMean = result.avArea;
          finalSd = result.sdArea;
          finalRsd = result.rsd;
        } else if (nonEmptyVals.length <= 3) {
          // If 1-3 injections are non-empty, use all non-empty ones
          finalSelected = g.injections.map((_, i) => !isEmpty[i]);
          finalMean = calculateMean(nonEmptyVals);
          finalSd = calculateStdev(nonEmptyVals);
          finalRsd = finalMean > 0 ? (finalSd / finalMean) * 100 : 0;
        } else {
          // If we have 4 or more non-empty injections, run selectBestSubset on the non-empty ones
          const subsetResult = selectBestSubset(nonEmptyVals);
          finalSelected = g.injections.map((_, i) => {
            if (isEmpty[i]) return false;
            const nonEmptyIdx = nonEmptyIndices.indexOf(i);
            return subsetResult.selected[nonEmptyIdx];
          });
          finalMean = subsetResult.avArea;
          finalSd = subsetResult.sdArea;
          finalRsd = subsetResult.rsd;
        }
      }

      // Final safeguard: Never allow a sample with >= 2 injections to have fewer than 2 selected injections for averaging
      if (finalSelected.filter(Boolean).length < 2 && g.injections.length >= 2) {
        const subsetResult = selectBestSubset(g.injections);
        finalSelected = subsetResult.selected;
        finalMean = subsetResult.avArea;
        finalSd = subsetResult.sdArea;
        finalRsd = subsetResult.rsd;
      }

      return {
        id,
        fileName: g.fileName,
        sampleName: displayName,
        sampleId: g.sampleId,
        injections: g.injections,
        rawInjIndices: g.rawInjIndices,
        selectedInjections: finalSelected,
        avArea: finalMean,
        sdArea: finalSd,
        rsd: finalRsd,
        isStd,
        isBlank,
        isSeawater,
        station,
        depth
      } as SampleGroup;
    });
  }, [rawInjections, excludedInjections, emptyInjectionThreshold, stationCoords, customSampleNames, hydroSamples]);

  // Calculate average area of MQ Blanks, excluding cleaning/flush bottles and high residual carryover outliers
  const mqBlankAverageArea = useMemo(() => {
    // 1. Filter valid MQ blanks that are not explicitly marked as cleaning/flush/wash
    const validBlanks = sampleGroups.filter(g => {
      if (!g.isBlank) return false;
      const lowerId = g.sampleId.toLowerCase();
      const lowerName = g.sampleName.toLowerCase();
      // Exclude explicit wash/flush/cleaning bottles
      if (lowerId.includes('clean') || lowerId.includes('flush') || lowerId.includes('wash') || lowerName.includes('clean') || lowerName.includes('flush') || lowerName.includes('wash')) {
        return false;
      }
      return true;
    });

    if (validBlanks.length === 0) return 0;

    // 2. Filter out extreme outliers (e.g. carryover wash points like 30.63 uM with area >> median)
    const areas = validBlanks.map(g => g.avArea).sort((a, b) => a - b);
    const median = areas.length % 2 === 0
      ? (areas[areas.length / 2 - 1] + areas[areas.length / 2]) / 2
      : areas[Math.floor(areas.length / 2)];

    // Outlier threshold: area > 3.0 * median AND area > 0.3 (to prevent excluding tiny normal noise)
    const filteredBlanks = validBlanks.filter(g => {
      if (median > 0 && g.avArea > Math.max(median * 3.0, 0.3)) {
        return false; // Exclude carryover outlier
      }
      return true;
    });

    const activeBlanks = filteredBlanks.length > 0 ? filteredBlanks : validBlanks;
    const totalArea = activeBlanks.reduce((sum, g) => sum + g.avArea, 0);
    return totalArea / activeBlanks.length;
  }, [sampleGroups]);

  // Per-file/per-batch MQ Blank average area map for independent batch deduction
  const fileMqBlankMap = useMemo(() => {
    const map: Record<string, number> = {};
    const fileGroups: Record<string, any[]> = {};
    sampleGroups.forEach(g => {
      if (!fileGroups[g.fileName]) fileGroups[g.fileName] = [];
      fileGroups[g.fileName].push(g);
    });

    Object.entries(fileGroups).forEach(([fileName, gList]) => {
      const validBlanks = gList.filter(g => {
        if (!g.isBlank) return false;
        const lowerId = g.sampleId.toLowerCase();
        const lowerName = g.sampleName.toLowerCase();
        if (lowerId.includes('clean') || lowerId.includes('flush') || lowerId.includes('wash') || lowerName.includes('clean') || lowerName.includes('flush') || lowerName.includes('wash')) return false;
        return true;
      });

      if (validBlanks.length > 0) {
        const areas = validBlanks.map(g => g.avArea).sort((a, b) => a - b);
        const median = areas.length % 2 === 0
          ? (areas[areas.length / 2 - 1] + areas[areas.length / 2]) / 2
          : areas[Math.floor(areas.length / 2)];

        const filteredBlanks = validBlanks.filter(g => !(median > 0 && g.avArea > Math.max(median * 3.0, 0.3)));
        const activeBlanks = filteredBlanks.length > 0 ? filteredBlanks : validBlanks;
        map[fileName] = activeBlanks.reduce((sum, b) => sum + b.avArea, 0) / activeBlanks.length;
      } else {
        map[fileName] = mqBlankAverageArea; // Fallback to global average if this file has no MQ
      }
    });
    return map;
  }, [sampleGroups, mqBlankAverageArea]);

  // Default station selection is now handled inside OriginPlotter component

  // Identify standard curve blocks and fit curves
  const calibrationCurves = useMemo(() => {
    const rawCurveBlocks: { fileName: string; standards: any[] }[] = [];
    let currentCurveStds: any[] = [];
    let currentCurveFile = '';
    let hadSamplesSinceLastStd = false;

    // Group standard samples into curves
    sampleGroups.forEach((group) => {
      if (group.isStd) {
        // Decide if we start a new curve
        const isDifferentFile = currentCurveFile && group.fileName !== currentCurveFile;
        const shouldStartNew = currentCurveStds.length === 0 || isDifferentFile || hadSamplesSinceLastStd;

        if (shouldStartNew) {
          currentCurveStds = [group];
          currentCurveFile = group.fileName;
          hadSamplesSinceLastStd = false;

          rawCurveBlocks.push({
            fileName: group.fileName,
            standards: currentCurveStds
          });
        } else {
          currentCurveStds.push(group);
          if (rawCurveBlocks.length > 0) {
            rawCurveBlocks[rawCurveBlocks.length - 1].standards = currentCurveStds;
          }
        }
      } else {
        // If it's a regular sample or seawater (not blank/MQ), we set the flag
        if (!group.isBlank && !group.isStd) {
          hadSamplesSinceLastStd = true;
        }
      }
    });

    // Filter out curves with fewer than 3 standard points (likely drift checks/single-point standards)
    const validCurveBlocks = rawCurveBlocks.filter(block => block.standards.length >= 3);

    // Fit each curve
    return validCurveBlocks.map((curveBlock, index) => {
      const curveId = `curve_${index}`;
      const name = `工作曲线 ${index + 1} (${curveBlock.fileName.split('.')[0]})`;
      const activePoints: { x: number; y: number }[] = [];

      // Per-batch independent MQ blank area
      const batchBlankArea = fileMqBlankMap[curveBlock.fileName] ?? mqBlankAverageArea;

      const detailedStandards = curveBlock.standards.map((std, stdIndex) => {
        const customC = customStdUsedCs[std.id];
        let matchedUsedC = customC !== undefined ? customC : stdUsedC;
        if (customC === undefined) {
          if (std.sampleName.includes('374.1') || std.sampleName.includes('360')) {
            matchedUsedC = 360.0;
          } else if (std.sampleName.includes('340.1')) {
            matchedUsedC = 340.1;
          } else {
            const cMatch = std.sampleName.match(/std\((\d+\.?\d*)uM/i);
            if (cMatch) {
              matchedUsedC = parseFloat(cMatch[1]);
            }
          }
        }

        const defaultDilution = dilutionFactors[stdIndex] || 3;
        const currentDilution = customDilutions[std.id] !== undefined ? customDilutions[std.id] : defaultDilution;
        const theoreticalC = matchedUsedC / currentDilution;
        const isEnabled = enabledStds[std.id] !== undefined ? enabledStds[std.id] : (stdIndex < dilutionFactors.length);

        const areaToFit = std.avArea - (enableBlankCorrection ? batchBlankArea : 0);
        if (isEnabled) {
          activePoints.push({ x: theoreticalC, y: areaToFit });
        }

        const displayStdName = (Math.abs(matchedUsedC - 340.1) < 0.2 || std.sampleName.includes('340.1'))
          ? 'std(340.1uM-0627)'
          : (Math.abs(matchedUsedC - 360) < 1 || std.sampleName.includes('360') || std.sampleName.includes('374.1'))
            ? 'std(360uM-0625)'
            : std.sampleName;

        return {
          id: std.id,
          index: stdIndex,
          sampleName: displayStdName,
          avArea: std.avArea,
          correctedArea: areaToFit,
          dilution: currentDilution,
          theoreticalC,
          enabled: isEnabled,
          group: std,
          matchedUsedC
        };
      });

      const fit = fitCalibrationCurve(activePoints, forceZeroIntercept);

      return {
        id: curveId,
        index,
        name,
        fileName: curveBlock.fileName,
        standards: detailedStandards,
        slope: fit.slope,
        intercept: fit.intercept,
        rsq: fit.rsq
      };
    });
  }, [sampleGroups, stdUsedC, dilutionFactors, customDilutions, enabledStds, customStdUsedCs, enableBlankCorrection, mqBlankAverageArea, fileMqBlankMap, forceZeroIntercept]);

  // Active/selected calibration curve
  const activeCurve = useMemo(() => {
    return calibrationCurves.find(c => c.id === selectedCurveId) || calibrationCurves[0] || null;
  }, [calibrationCurves, selectedCurveId]);

  // Fallback to active curve for backward compatibility in Step 2 rendering
  const calibrationCurve = useMemo(() => {
    return activeCurve || { slope: 1, intercept: 0, rsq: 0 };
  }, [activeCurve]);

  // Active curve's standards for Step 2 list
  const standardsData = useMemo(() => {
    return activeCurve?.standards || [];
  }, [activeCurve]);

  // Effect to automatically select the first curve if none selected or selection is invalid
  useEffect(() => {
    if (calibrationCurves.length > 0) {
      if (!selectedCurveId || !calibrationCurves.some(c => c.id === selectedCurveId)) {
        setSelectedCurveId(calibrationCurves[0].id);
      }
    }
  }, [calibrationCurves, selectedCurveId]);

  // Map each sample to its corresponding calibration curve
  const sampleToCurveMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (calibrationCurves.length === 0) return map;

    const enabledCurves = calibrationCurves.filter(c => !disabledCurves[c.id]);
    const activeCurves = enabledCurves.length > 0 ? enabledCurves : calibrationCurves;

    let lastCurveId = activeCurves[0].id;

    sampleGroups.forEach((g) => {
      const matchingCurve = activeCurves.find(c => c.standards.some(s => s.id === g.id));
      if (matchingCurve) {
        lastCurveId = matchingCurve.id;
      }
      map[g.id] = lastCurveId;
    });

    return map;
  }, [sampleGroups, calibrationCurves, disabledCurves]);

  // Compute final concentrations for all samples using their respective curves
  const processedSamples = useMemo(() => {
    return sampleGroups.map(g => {
      // If a sample has too few valid injections (<= 1), it is likely a failed run (dry run)
      // and we default to rejecting it (unchecked) unless the user manually overrides it.
      const defaultRejected = g.injections.filter(area => area >= emptyInjectionThreshold).length <= 1;
      const isRejected = rejectedSamples[g.id] !== undefined ? rejectedSamples[g.id] : defaultRejected;
      const curveId = sampleToCurveMap[g.id];
      const curve = calibrationCurves.find(c => c.id === curveId) || calibrationCurves[0];

      const slope = curve?.slope || 1;
      const intercept = curve?.intercept || 0;
      const offset = curveOffsets[curveId] || 0;

      const batchBlankArea = fileMqBlankMap[g.fileName] ?? mqBlankAverageArea;
      const areaToUse = g.avArea - (enableBlankCorrection ? batchBlankArea : 0);
      const concentration = (areaToUse - intercept) / slope + offset;
      const error = g.sdArea / slope;

      // Match station coordinates
      const normStation = normalizeStationName(g.station);
      const coordMatch = stationCoords.find(c => normalizeStationName(c.station) === normStation)
        || (hydroSamples && hydroSamples.find(h => normalizeStationName(h.station) === normStation));

      return {
        ...g,
        concentration,
        error,
        isRejected,
        curveId,
        curveName: curve ? curve.name : '默认曲线',
        longitude: coordMatch?.longitude,
        latitude: coordMatch?.latitude,
        botDepth: (coordMatch as any)?.botDepth
      };
    });
  }, [sampleGroups, calibrationCurves, sampleToCurveMap, rejectedSamples, stationCoords, curveOffsets, enableBlankCorrection, mqBlankAverageArea, hydroSamples]);

  // Sort processed samples for list rendering & export
  const sortedProcessedSamples = useMemo(() => {
    const listWithIndex = processedSamples.map((s, idx) => ({ s, idx }));

    listWithIndex.sort((a, b) => {
      if (sampleSortOrder === 'category') {
        const getWeight = (item: typeof a.s) => {
          if (item.isBlank) return 1;
          if (item.isSeawater) return 2;
          if (item.isStd) return 4;
          return 3; // regular sample
        };
        const wa = getWeight(a.s);
        const wb = getWeight(b.s);
        if (wa !== wb) return wa - wb;
        return a.idx - b.idx; // stable sort
      }
      if (sampleSortOrder === 'name') {
        const cmp = a.s.sampleName.localeCompare(b.s.sampleName);
        if (cmp !== 0) return cmp;
        return a.idx - b.idx;
      }
      if (sampleSortOrder === 'concentration') {
        const cmp = b.s.concentration - a.s.concentration;
        if (cmp !== 0) return cmp;
        return a.idx - b.idx;
      }
      // 'import' order
      return a.idx - b.idx;
    });

    return listWithIndex.map(x => x.s);
  }, [processedSamples, sampleSortOrder]);

  // Nominal reference standards calculation
  const blanksAndSeawaters = useMemo(() => {
    const blanks = processedSamples.filter(s => s.isBlank);
    const seawaters = processedSamples.filter(s => s.isSeawater);

    const avgBlankArea = calculateMean(blanks.map(b => b.avArea));
    const avgBlankConc = calculateMean(blanks.map(b => b.concentration));

    const dsws = seawaters.filter(s => s.sampleName.toLowerCase() === 'dsw');
    const ssws = seawaters.filter(s => s.sampleName.toLowerCase() === 'ssw');

    const avgDswConc = calculateMean(dsws.map(d => d.concentration));
    const avgSswConc = calculateMean(ssws.map(s => s.concentration));

    return {
      avgBlankArea,
      avgBlankConc,
      avgDswConc,
      avgSswConc,
      dswCount: dsws.length,
      sswCount: ssws.length
    };
  }, [processedSamples]);

  // Get active stations list
  const stationsList = useMemo(() => {
    const stations = Array.from(new Set(processedSamples.map(g => g.station).filter(Boolean))) as string[];
    stations.sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10);
      const numB = parseInt(b.replace(/\D/g, ''), 10);
      if (isNaN(numA) || isNaN(numB)) {
        return a.localeCompare(b);
      }
      return numA - numB;
    });
    return stations;
  }, [processedSamples]);

  const [qcSelectedStation, setQcSelectedStation] = useState<string>('all');
  const [qcSelectedStatus, setQcSelectedStatus] = useState<'all' | 'qualified' | 'warning' | 'rejected'>('all');

  const qcStations = useMemo(() => {
    const list: string[] = [];
    const hasBlank = processedSamples.some(s => s.isBlank);
    const hasStd = processedSamples.some(s => s.isStd);
    const seawaters = Array.from(new Set(processedSamples.filter(s => s.isSeawater).map(s => s.sampleName.toUpperCase())));
    
    if (hasBlank) list.push("MQ/空白");
    seawaters.forEach(sw => list.push(sw));
    if (hasStd) list.push("STANDARD");
    
    return [...list, ...stationsList];
  }, [processedSamples, stationsList]);

  const filteredQcSamples = useMemo(() => {
    let list = sortedProcessedSamples;

    // 1. Filter by station
    if (qcSelectedStation !== 'all') {
      list = list.filter(s => {
        if (qcSelectedStation === 'MQ/空白') return s.isBlank;
        if (qcSelectedStation === 'STANDARD') return s.isStd;
        if (s.isSeawater && s.sampleName.toUpperCase() === qcSelectedStation) return true;
        return s.station === qcSelectedStation;
      });
    }

    // 2. Filter by status
    if (qcSelectedStatus !== 'all') {
      list = list.filter(s => {
        const isRsdHigh = s.rsd > 2.0;
        if (qcSelectedStatus === 'qualified') {
          return !s.isRejected && !isRsdHigh;
        }
        if (qcSelectedStatus === 'warning') {
          return !s.isRejected && isRsdHigh;
        }
        if (qcSelectedStatus === 'rejected') {
          return s.isRejected;
        }
        return true;
      });
    }

    return list;
  }, [sortedProcessedSamples, qcSelectedStation, qcSelectedStatus]);

  const itemsPerPage = 20;
  const paginatedQcSamples = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredQcSamples.slice(start, start + itemsPerPage);
  }, [filteredQcSamples, currentPage]);

  const totalPages = Math.ceil(filteredQcSamples.length / itemsPerPage) || 1;

  useEffect(() => {
    setCurrentPage(1);
  }, [qcSelectedStation, qcSelectedStatus]);

  // Note: dataBounds, uniqueStationCoords, and chart1dData memos moved to OriginPlotter component

  // Excel template export generator
  const exportToExcel = async () => {
    const activeCurves = calibrationCurves
      .filter(c => !disabledCurves[c.id])
      .map(c => ({ id: c.id, name: c.name, fileName: c.fileName, slope: c.slope, intercept: c.intercept, rsq: c.rsq }));

    const calculatedConcs = processedSamples.reduce((acc, s) => {
      acc[s.id] = s.concentration;
      return acc;
    }, {} as Record<string, number>);

    const targetCrmConc = (dswMin + dswMax) / 2;

    const fileMap: Record<string, SampleGroup[]> = {};
    processedSamples.forEach(g => {
      if (!fileMap[g.fileName]) {
        fileMap[g.fileName] = [];
      }
      fileMap[g.fileName].push(g);
    });

    const getFileSortPriority = (fileName: string): number => {
      const activeFileNames = activeCurves.map(c => c.fileName);
      const idx = activeFileNames.indexOf(fileName);
      return idx >= 0 ? idx : 999;
    };

    const sortedFileEntries = Object.entries(fileMap).sort(([fileA], [fileB]) => getFileSortPriority(fileA) - getFileSortPriority(fileB));
    const batchAnalysis: ColumnBatchExportData[] = [];

    sortedFileEntries.forEach(([fileName, sampleList], fileIdx) => {
      const fileColIdx = fileIdx + 1;
      const matchingCurves = activeCurves.filter(c => c.fileName === fileName);

      if (matchingCurves.length > 0) {
        const isMultiCurveInFile = matchingCurves.length > 1;

        matchingCurves.forEach(calib => {
          const curveSamples = isMultiCurveInFile
            ? sampleList.filter(s => (s as any).curveId === calib.id)
            : sampleList;
          const activeSampleList = curveSamples.length > 0 ? curveSamples : sampleList;

          const validBlanks = activeSampleList.filter(s => {
            if (!s.isBlank && !s.sampleName.toLowerCase().includes('blank') && !s.sampleName.toLowerCase().includes('mq')) return false;
            const lowerId = s.sampleId.toLowerCase();
            const lowerName = s.sampleName.toLowerCase();
            if (lowerId.includes('clean') || lowerId.includes('flush') || lowerId.includes('wash') || lowerName.includes('clean') || lowerName.includes('flush') || lowerName.includes('wash') || lowerName.includes('冲洗') || lowerName.includes('清洗')) return false;
            return true;
          });

          let blankArea = 0;
          let blankConcEquiv = 0;
          if (validBlanks.length > 0) {
            const areas = validBlanks.map(g => g.avArea).sort((a, b) => a - b);
            const medianArea = areas.length % 2 === 0
              ? (areas[areas.length / 2 - 1] + areas[areas.length / 2]) / 2
              : areas[Math.floor(areas.length / 2)];

            const filteredBlanks = validBlanks.filter(g => !(medianArea > 0 && g.avArea > Math.max(medianArea * 3.0, 0.3)));
            const activeBlanks = filteredBlanks.length > 0 ? filteredBlanks : validBlanks;
            blankArea = activeBlanks.reduce((sum, b) => sum + b.avArea, 0) / activeBlanks.length;
            blankConcEquiv = calib.slope > 0 ? blankArea / calib.slope : 0;
          }

          let dswCrms = activeSampleList.filter(s => {
            if ((s as any).isRejected) return false;
            const conc = calculatedConcs[s.id] ?? (calib.slope > 0 ? (s.avArea - calib.intercept) / calib.slope : 0);
            const corrected = correctCrmIdentity(s.sampleName, conc);
            return corrected.actualType === 'DSW';
          });

          if (dswCrms.length <= 1) {
            const fileDsws = sampleList.filter(s => {
              if ((s as any).isRejected) return false;
              const conc = calculatedConcs[s.id] ?? (calib.slope > 0 ? (s.avArea - calib.intercept) / calib.slope : 0);
              const corrected = correctCrmIdentity(s.sampleName, conc);
              return corrected.actualType === 'DSW';
            });
            if (fileDsws.length > dswCrms.length) {
              dswCrms = fileDsws;
            }
          }

          let crmAvgMeasured = 0;
          let crmRecovery = 0;

          if (dswCrms.length > 0) {
            const crmConcs = dswCrms.map(c => calculatedConcs[c.id] ?? 0);
            crmAvgMeasured = crmConcs.reduce((a, b) => a + b, 0) / dswCrms.length;
            crmRecovery = targetCrmConc > 0 ? (crmAvgMeasured / targetCrmConc) * 100 : 0;
          }

          const evaluatedSamples = activeSampleList.map(s => {
            const conc = calculatedConcs[s.id] ?? (calib.slope > 0 ? (s.avArea - calib.intercept) / calib.slope : 0);
            const evalRes = evaluateSampleQC(s.rsd, crmRecovery > 0 ? crmRecovery : undefined, calib.rsq);
            return {
              ...s,
              calculatedConc: conc,
              qcFlag: evalRes.flag
            };
          });

          batchAnalysis.push({
            curveId: calib.id,
            curveName: calib.name,
            fileName,
            fileColIdx,
            slope: calib.slope,
            intercept: calib.intercept,
            rsq: calib.rsq,
            blankArea,
            blankConcEquiv,
            crmExpected: targetCrmConc,
            crmMeasuredAvg: crmAvgMeasured,
            crmRecovery,
            samples: evaluatedSamples
          });
        });
      }
    });

    const summarySamples = processedSamples.map(s => {
      const evalRes = evaluateSampleQC(s.rsd, undefined, calibrationCurve.rsq);
      return {
        ...s,
        calculatedConc: s.concentration,
        qcFlag: evalRes.flag
      };
    });

    await exportMultiSheetQCExcel(summarySamples, batchAnalysis, stationCoords, hydroSamples);
  };

  const exportToODVCSV = () => {
    const activeCurves = calibrationCurves
      .filter(c => !disabledCurves[c.id])
      .map(c => ({ id: c.id, name: c.name, fileName: c.fileName, slope: c.slope, intercept: c.intercept, rsq: c.rsq }));

    const calculatedConcs = processedSamples.reduce((acc, s) => {
      acc[s.id] = s.concentration;
      return acc;
    }, {} as Record<string, number>);

    const targetCrmConc = (dswMin + dswMax) / 2;

    const fileMap: Record<string, SampleGroup[]> = {};
    processedSamples.forEach(g => {
      if (!fileMap[g.fileName]) {
        fileMap[g.fileName] = [];
      }
      fileMap[g.fileName].push(g);
    });

    const getFileSortPriority = (fileName: string): number => {
      const activeFileNames = activeCurves.map(c => c.fileName);
      const idx = activeFileNames.indexOf(fileName);
      return idx >= 0 ? idx : 999;
    };

    const sortedFileEntries = Object.entries(fileMap).sort(([fileA], [fileB]) => getFileSortPriority(fileA) - getFileSortPriority(fileB));
    const batchAnalysis: ColumnBatchExportData[] = [];

    sortedFileEntries.forEach(([fileName, sampleList], fileIdx) => {
      const fileColIdx = fileIdx + 1;
      const matchingCurves = activeCurves.filter(c => c.fileName === fileName);

      if (matchingCurves.length > 0) {
        const isMultiCurveInFile = matchingCurves.length > 1;

        matchingCurves.forEach(calib => {
          const curveSamples = isMultiCurveInFile
            ? sampleList.filter(s => (s as any).curveId === calib.id)
            : sampleList;
          const activeSampleList = curveSamples.length > 0 ? curveSamples : sampleList;

          const validBlanks = activeSampleList.filter(s => {
            if (!s.isBlank && !s.sampleName.toLowerCase().includes('blank') && !s.sampleName.toLowerCase().includes('mq')) return false;
            const lowerId = s.sampleId.toLowerCase();
            const lowerName = s.sampleName.toLowerCase();
            if (lowerId.includes('clean') || lowerId.includes('flush') || lowerId.includes('wash') || lowerName.includes('clean') || lowerName.includes('flush') || lowerName.includes('wash') || lowerName.includes('冲洗') || lowerName.includes('清洗')) return false;
            return true;
          });

          let blankArea = 0;
          let blankConcEquiv = 0;
          if (validBlanks.length > 0) {
            const areas = validBlanks.map(g => g.avArea).sort((a, b) => a - b);
            const medianArea = areas.length % 2 === 0
              ? (areas[areas.length / 2 - 1] + areas[areas.length / 2]) / 2
              : areas[Math.floor(areas.length / 2)];

            const filteredBlanks = validBlanks.filter(g => !(medianArea > 0 && g.avArea > Math.max(medianArea * 3.0, 0.3)));
            const activeBlanks = filteredBlanks.length > 0 ? filteredBlanks : validBlanks;
            blankArea = activeBlanks.reduce((sum, b) => sum + b.avArea, 0) / activeBlanks.length;
            blankConcEquiv = calib.slope > 0 ? blankArea / calib.slope : 0;
          }

          let dswCrms = activeSampleList.filter(s => {
            if ((s as any).isRejected) return false;
            const conc = calculatedConcs[s.id] ?? (calib.slope > 0 ? (s.avArea - calib.intercept) / calib.slope : 0);
            const corrected = correctCrmIdentity(s.sampleName, conc);
            return corrected.actualType === 'DSW';
          });

          if (dswCrms.length <= 1) {
            const fileDsws = sampleList.filter(s => {
              if ((s as any).isRejected) return false;
              const conc = calculatedConcs[s.id] ?? (calib.slope > 0 ? (s.avArea - calib.intercept) / calib.slope : 0);
              const corrected = correctCrmIdentity(s.sampleName, conc);
              return corrected.actualType === 'DSW';
            });
            if (fileDsws.length > dswCrms.length) {
              dswCrms = fileDsws;
            }
          }

          let crmAvgMeasured = 0;
          let crmRecovery = 0;

          if (dswCrms.length > 0) {
            const crmConcs = dswCrms.map(c => calculatedConcs[c.id] ?? 0);
            crmAvgMeasured = crmConcs.reduce((a, b) => a + b, 0) / dswCrms.length;
            crmRecovery = targetCrmConc > 0 ? (crmAvgMeasured / targetCrmConc) * 100 : 0;
          }

          const evaluatedSamples = activeSampleList.map(s => {
            const conc = calculatedConcs[s.id] ?? (calib.slope > 0 ? (s.avArea - calib.intercept) / calib.slope : 0);
            const evalRes = evaluateSampleQC(s.rsd, crmRecovery > 0 ? crmRecovery : undefined, calib.rsq);
            return {
              ...s,
              calculatedConc: conc,
              qcFlag: evalRes.flag
            };
          });

          batchAnalysis.push({
            curveId: calib.id,
            curveName: calib.name,
            fileName,
            fileColIdx,
            slope: calib.slope,
            intercept: calib.intercept,
            rsq: calib.rsq,
            blankArea,
            blankConcEquiv,
            crmExpected: targetCrmConc,
            crmMeasuredAvg: crmAvgMeasured,
            crmRecovery,
            samples: evaluatedSamples
          });
        });
      }
    });

    exportODVPlottingCSV(batchAnalysis, stationCoords, hydroSamples);
  };

  // Toggle single injection inclusion
  const handleToggleInjection = (groupId: string, injIndex: number) => {
    setExcludedInjections(prev => {
      const group = sampleGroups.find(g => g.id === groupId);
      if (!group) return prev;

      const current = prev[groupId] || group.injections.map(() => false);
      const updated = [...current];
      updated[injIndex] = !updated[injIndex];

      if (updated.filter(v => !v).length === 0) {
        return prev;
      }

      return {
        ...prev,
        [groupId]: updated
      };
    });
  };

  const handleUpdateInjectionAreaByIndex = (
    targetGlobalIndex: number,
    newArea: number
  ) => {
    setRawInjections(prev => prev.map((inj, idx) => {
      if (idx === targetGlobalIndex) {
        return { ...inj, area: newArea };
      }
      return inj;
    }));
  };

  // Toggle sample rejection
  const handleToggleRejection = (groupId: string) => {
    setRejectedSamples(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  // Note: All download, ref, and 2D rendering useEffect logic moved to OriginPlotter component

  // Stepper helper info
  const stepLabelMap = [
    "1. 导入数据",
    "2. 工作曲线拟合",
    "3. 数据质控 (QC)",
    "4. 剖面图表绘制",
    "5. 生成报表"
  ];

  return (
    <div className="wizard-container">

      {/* Wizard Header with Stepper Progress */}
      <div className="wizard-header">
        <div className="stepper">
          {/* Stepper background line progress */}
          <div
            className="stepper-progress"
            style={{ width: `calc(${((currentStep - 1) / (stepLabelMap.length - 1))} * (100% - 120px))` }}
          ></div>

          {stepLabelMap.map((label, idx) => {
            const stepNum = idx + 1;
            const isActive = currentStep === stepNum;
            const isCompleted = currentStep > stepNum;

            return (
              <div
                key={idx}
                className={`step-node ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
                onClick={() => {
                  // Only allow navigation to steps already unlocked
                  if (files.length > 0 || stepNum === 1) {
                    if (stepNum < 3 || calibrationCurve.slope > 0) {
                      setCurrentStep(stepNum);
                    }
                  }
                }}
              >
                <div className="step-circle">
                  {isCompleted ? <Check size={16} /> : stepNum}
                </div>
                <div className="step-label">{label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Step Panel */}
      <div className="wizard-content">

        {/* Step 1: Upload */}
        {currentStep === 1 && (
          <div>
            <div className="page-header">
              <div>
                <h1 className="page-title">数据文件导入</h1>
                <p className="page-subtitle">第一步：上传仪器导出的原始中文字符集 `.txt` 数据文件，以及带站位经纬度坐标的样品清单（`.xlsx`, `.xls`, `.csv`）</p>
              </div>
            </div>

            <div className="grid-2" style={{ gap: '20px', marginBottom: '24px' }}>
              {/* Dropzone 1: Raw Data TXT */}
              <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column' }}>
                <h3 className="font-semibold text-base text-slate-700" style={{ margin: '0 0 12px 0' }}>1. 仪器分析原始数据 (TXT)</h3>
                <div
                  className={`dropzone ${isDragActiveRaw ? 'drag-active' : ''}`}
                  onDragEnter={handleDragRaw}
                  onDragOver={handleDragRaw}
                  onDragLeave={handleDragRaw}
                  onDrop={handleDropRaw}
                  onClick={() => rawFileInputRef.current?.click()}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '160px' }}
                >
                  <input
                    type="file"
                    ref={rawFileInputRef}
                    style={{ display: 'none' }}
                    multiple
                    accept=".txt"
                    onChange={handleFileChangeRaw}
                  />
                  <Upload className="dropzone-icon" />
                  <div style={{ textAlign: 'center' }}>
                    <h4 className="font-semibold text-sm" style={{ margin: '0 0 4px' }}>拖拽原始文本到此处，或点击浏览</h4>
                    <p className="text-xs text-slate-400">仅限上传仪器导出的 `.txt` 原始数据文件</p>
                  </div>
                </div>
              </div>

              {/* Dropzone 2: Station Coordinates Excel/CSV */}
              <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column' }}>
                <h3 className="font-semibold text-base text-slate-700" style={{ margin: '0 0 12px 0' }}>2. 样品经纬度清单 (Excel/CSV)</h3>
                <div
                  className={`dropzone ${isDragActiveCoord ? 'drag-active' : ''}`}
                  onDragEnter={handleDragCoord}
                  onDragOver={handleDragCoord}
                  onDragLeave={handleDragCoord}
                  onDrop={handleDropCoord}
                  onClick={() => coordFileInputRef.current?.click()}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '160px' }}
                >
                  <input
                    type="file"
                    ref={coordFileInputRef}
                    style={{ display: 'none' }}
                    multiple
                    accept=".csv,.xlsx,.xls"
                    onChange={handleFileChangeCoord}
                  />
                  <Upload className="dropzone-icon text-emerald-500" />
                  <div style={{ textAlign: 'center' }}>
                    <h4 className="font-semibold text-sm" style={{ margin: '0 0 4px' }}>拖拽经纬度清单到此处，或点击浏览</h4>
                    <p className="text-xs text-slate-400">支持 `.xlsx`, `.xls`, `.csv` 样品站位清单文件</p>
                  </div>
                </div>
              </div>
            </div>

            {files.length > 0 && (
              <div className="card" style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h4 className="font-semibold text-sm" style={{ margin: 0 }}>已导入的文件 ({files.length})</h4>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '12px', color: '#ef4444', borderColor: '#fee2e2', display: 'flex', alignItems: 'center', gap: '4px' }}
                    onClick={clearAllData}
                  >
                    <Trash2 size={13} />
                    <span>清空数据</span>
                  </button>
                </div>
                <div className="file-list">
                  {files.map((file, i) => {
                    const isCoordinateFile = file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv');
                    const fileCoords = stationCoords.filter(c => (c as any).fileName === file.name);
                    const uniqueStsCount = isCoordinateFile ? new Set(fileCoords.map(c => c.station)).size : 0;
                    return (
                      <div className="file-item" key={i}>
                        <div className="file-info">
                          <FileText size={16} className={isCoordinateFile ? "text-emerald-500" : "text-sky-500"} />
                          <span>{file.name}</span>
                          <span className="text-xs text-slate-400">({(file.size / 1024).toFixed(1)} KB)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span className={`badge ${isCoordinateFile ? 'badge-success' : 'badge-info'}`}>
                            {hydroSamples.length > 0 && isCoordinateFile
                              ? `已解析 ${new Set(hydroSamples.map(s => s.station)).size} 个站位 (${hydroSamples.length} 行水文数据)`
                              : isCoordinateFile
                                ? `已解析 ${uniqueStsCount} 个站位 (${fileCoords.length} 行样品经纬度)`
                                : `已解析 ${rawInjections.filter(inj => inj.fileName === file.name).length} 行数据`
                            }
                          </span>
                          <button
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              padding: '4px',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.15s ease',
                            }}
                            onClick={() => removeFile(file.name)}
                            title="删除此文件"
                            onMouseEnter={(e) => {
                              e.currentTarget.style.color = 'var(--danger)';
                              e.currentTarget.style.backgroundColor = 'var(--danger-light)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.color = 'var(--text-muted)';
                              e.currentTarget.style.backgroundColor = 'transparent';
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {hydroSamples.length > 0 ? (
              <div className="grid-2">
                <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h3 className="card-title">
                    <Settings size={18} className="text-slate-500" />
                    <span>常规水文数据表切换</span>
                  </h3>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label" style={{ fontWeight: 'bold' }}>当前活动工作表 (Active Sheet)</label>
                    <select
                      className="input-field"
                      value={hydroSelectedSheet}
                      onChange={(e) => handleHydroSheetChange(e.target.value)}
                      style={{ width: '100%', fontWeight: hydroSelectedSheet === '__MERGE_ALL__' ? 'bold' : 'normal' }}
                    >
                      {hydroSheetNames.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                      {hydroSheetNames.length > 1 && (
                        <option value="__MERGE_ALL__">✨ 合并所有工作表 (Merge All Sheets)</option>
                      )}
                    </select>
                  </div>
                  <div style={{ marginTop: '8px' }}>
                    <span className="text-xs text-slate-500 font-semibold">基本统计：</span>
                    <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                      <div style={{ flex: 1, padding: '8px 12px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div className="text-xs text-slate-400">测站总数</div>
                        <div className="text-base font-bold text-slate-700">{new Set(hydroSamples.map(s => s.station)).size} 个</div>
                      </div>
                      <div style={{ flex: 1, padding: '8px 12px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div className="text-xs text-slate-400">数据记录数</div>
                        <div className="text-base font-bold text-slate-700">{hydroSamples.length} 行</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: '16px', padding: '24px', background: 'linear-gradient(135deg, #f0fdf4 0%, #e8f5e9 100%)', border: '1px solid #a7f3d0' }}>
                  <CheckCircle size={48} className="text-emerald-500" />
                  <div>
                    <h3 className="font-semibold text-lg text-emerald-800" style={{ margin: '0 0 4px' }}>
                      多参数水文绘图模式已激活
                    </h3>
                    <p className="text-xs text-emerald-700 mb-4" style={{ maxWidth: '320px', margin: '0 auto 12px' }}>
                      系统已成功从工作表 <strong>{hydroSelectedSheet === '__MERGE_ALL__' ? '合并所有工作表' : hydroSelectedSheet}</strong> 中解析出 {hydroParameters.length} 个水文参数。
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'center', maxHeight: '110px', overflowY: 'auto', padding: '4px' }}>
                      {hydroParameters.map((p, idx) => (
                        <span key={idx} className="badge badge-success" style={{ fontSize: '10px', padding: '3px 6px' }}>
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid-2">
                <div className="card">
                  <h3 className="card-title">
                    <Settings size={18} className="text-slate-500" />
                    <span>工作曲线参数配置</span>
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="grid-3" style={{ gap: '12px' }}>
                      <div className="input-group" style={{ marginBottom: 0 }}>
                        <label className="input-label">标准储备液浓度 (µmol C / L)</label>
                        <input
                          type="number"
                          className="input-field"
                          value={stdStockC}
                          onChange={e => handleStdStockCChange(parseFloat(e.target.value) || 0)}
                          step="any"
                        />
                      </div>
                      <div className="input-group" style={{ marginBottom: 0 }}>
                        <label className="input-label">配置稀释倍数 (转为使用浓度)</label>
                        <input
                          type="number"
                          className="input-field"
                          value={stdDilutionFactor}
                          onChange={e => handleStdDilutionFactorChange(parseFloat(e.target.value) || 0)}
                          step="any"
                        />
                      </div>
                      <div className="input-group" style={{ marginBottom: 0 }}>
                        <label className="input-label">使用浓度 (µmol C / L)</label>
                        <input
                          type="number"
                          className="input-field font-semibold text-sky-600 bg-sky-50/10"
                          value={stdUsedC}
                          onChange={e => handleStdUsedCChange(parseFloat(e.target.value) || 0)}
                          step="any"
                        />
                      </div>
                    </div>

                    <p className="text-xs text-slate-400" style={{ margin: 0 }}>
                      ※ <strong>计算说明：</strong><code>使用浓度 = 储备液浓度 / 配置稀释倍数</code>。系统会自动在上述三者间进行联动计算。
                    </p>

                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px', marginTop: '16px' }}>
                      <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        智能数据清洗与“扎空”异常过滤
                      </h4>
                      <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div className="input-group" style={{ marginBottom: 0, width: '220px' }}>
                          <label className="input-label" style={{ fontSize: '12px', fontWeight: 600 }}>扎空判定面积阈值 (Area)</label>
                          <input
                            type="number"
                            className="input-field"
                            value={emptyInjectionThreshold}
                            onChange={e => setEmptyInjectionThreshold(parseFloat(e.target.value) || 0)}
                            step="0.05"
                          />
                        </div>
                        <p className="text-xs text-slate-400" style={{ margin: 0, flex: 1, minWidth: '240px' }}>
                          ※ <strong>清洗规则：</strong>DOC 测定进样时，若发生空针、吸气泡（扎空）等异常现象，峰面积通常会接近 0（正常水样一般在 1.0 以上）。低于该阈值的进样数据会被<strong>自动排除</strong>，不参与均值计算，确保结果可靠。
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: '16px' }}>
                  <CheckCircle size={48} className={rawInjections.length > 0 ? "text-emerald-500" : "text-slate-300"} />
                  <div>
                    <h3 className="font-semibold text-lg" style={{ margin: '0 0 4px' }}>
                      {rawInjections.length > 0 ? "数据就绪" : "待上传数据"}
                    </h3>
                    <p className="text-sm text-slate-500" style={{ maxWidth: '300px', margin: '0 auto' }}>
                      {rawInjections.length > 0
                        ? `已成功加载了 ${processedSamples.length} 个独立样品的测量数据，点击下一步进行拟合曲线校验。`
                        : "请在上方上传仪器输出的 txt 数据。系统支持自动识别各种编码。"}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Calibration */}
        {currentStep === 2 && (
          <div>
            <div className="page-header">
              <div>
                <h1 className="page-title">标准工作曲线拟合</h1>
                <p className="page-subtitle">第二步：拟合线性回归工作曲线，勾选排除偏离严重的异常梯度点</p>
              </div>
            </div>

            {calibrationCurves.length > 0 && (
              <div className="card mb-4" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', flexDirection: 'row' }}>
                <span className="text-sm font-bold text-slate-700">检测到工作曲线，请选择并管理曲线：</span>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  {calibrationCurves.map(c => {
                    const isDisabled = disabledCurves[c.id];
                    return (
                      <div 
                        key={c.id} 
                        style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '6px', 
                          backgroundColor: isDisabled ? '#f1f5f9' : '#fff', 
                          padding: '4px 8px', 
                          borderRadius: '8px', 
                          border: `1px solid ${selectedCurveId === c.id ? 'var(--primary)' : '#cbd5e1'}`,
                          opacity: isDisabled ? 0.75 : 1,
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <button
                          onClick={() => setSelectedCurveId(c.id)}
                          className={`btn ${selectedCurveId === c.id ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ 
                            padding: '4px 10px', 
                            fontSize: '12px', 
                            fontWeight: '600',
                            border: 'none',
                            textDecoration: isDisabled ? 'line-through' : 'none',
                            backgroundColor: selectedCurveId === c.id ? (isDisabled ? '#64748b' : 'var(--primary)') : 'transparent',
                            color: selectedCurveId === c.id ? '#fff' : '#475569'
                          }}
                        >
                          {c.name} {isDisabled && '(已停用)'}
                        </button>
                        <button
                          onClick={() => {
                            setDisabledCurves(prev => ({
                              ...prev,
                              [c.id]: !prev[c.id]
                            }));
                          }}
                          className="btn"
                          style={{
                            padding: '3px 8px',
                            fontSize: '11px',
                            fontWeight: '600',
                            backgroundColor: isDisabled ? '#10b981' : '#ef4444',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                        >
                          {isDisabled ? '恢复' : '停用'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid-1-2">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div className="card" style={{ padding: '20px' }}>
                  <h3 className="card-title" style={{ fontSize: '16px' }}>拟合回归参数</h3>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '10px' }}>
                    <div>
                      <span className="text-xs text-slate-400 block font-semibold">拟合斜率 (Slope / m)</span>
                      <span className="text-3xl font-bold text-sky-600 font-display">
                        {calibrationCurve.slope ? calibrationCurve.slope.toFixed(6) : "N/A"}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-400 block font-semibold">拟合截距 (Intercept / b)</span>
                      <span className="text-xl font-bold text-slate-700">
                        {calibrationCurve.intercept ? calibrationCurve.intercept.toFixed(6) : "N/A"}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-400 block font-semibold">判定系数 (R-squared / R²)</span>
                      <span className="text-xl font-bold text-slate-700 flex items-center gap-2">
                        <span>{calibrationCurve.rsq ? calibrationCurve.rsq.toFixed(6) : "N/A"}</span>
                        {calibrationCurve.rsq >= 0.999 ? (
                          <span className="badge badge-success text-[10px]">优秀</span>
                        ) : calibrationCurve.rsq >= 0.99 ? (
                          <span className="badge badge-warning text-[10px]">合格</span>
                        ) : calibrationCurve.rsq > 0 ? (
                          <span className="badge badge-danger text-[10px]">差</span>
                        ) : null}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="card" style={{ padding: '20px' }}>
                  <h3 className="card-title" style={{ fontSize: '15px' }}>系统空白扣除 (MQ)</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                      <input
                        type="checkbox"
                        checked={enableBlankCorrection}
                        onChange={e => setEnableBlankCorrection(e.target.checked)}
                      />
                      <span>启用 MQ 空白扣除</span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                      <input
                        type="checkbox"
                        checked={forceZeroIntercept}
                        onChange={e => setForceZeroIntercept(e.target.checked)}
                      />
                      <span>强制工作曲线过原点 (截距为 0)</span>
                    </label>

                    <div style={{ fontSize: '11px', color: '#64748b', borderTop: '1px solid #e2e8f0', paddingTop: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span>检测到 MQ (Blank):</span>
                        <span className="font-bold text-slate-700">
                          {sampleGroups.filter(g => g.isBlank && g.sampleId.toLowerCase() === 'blank').length} 个
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span>系统空白平均面积:</span>
                        <span className="font-bold text-sky-600 font-mono">
                          {mqBlankAverageArea.toFixed(5)}
                        </span>
                      </div>

                      {sampleGroups.filter(g => g.isBlank).length > 0 && (
                        <div style={{ backgroundColor: '#f8fafc', padding: '6px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                          <span style={{ fontWeight: '600', display: 'block', marginBottom: '4px', fontSize: '10px' }}>MQ 详细信息列表：</span>
                          <div style={{ maxHeight: '100px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            {sampleGroups.filter(g => g.isBlank).map(g => {
                              const isCleaning = g.sampleId.toLowerCase() === 'cleaning';
                              return (
                                <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', opacity: isCleaning ? 0.5 : 1 }}>
                                  <span>{g.sampleName} ({g.sampleId}):</span>
                                  <span className="font-mono">{g.avArea.toFixed(4)} {isCleaning && '(已忽略)'}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="card">
                <h3 className="card-title">拟合回归曲线</h3>
                <div style={{ width: '100%', height: '300px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis
                        type="number"
                        dataKey="theoreticalC"
                        name="理论浓度"
                        unit=" µmol/L"
                        stroke="#94a3b8"
                        fontSize={12}
                      />
                      <YAxis
                        type="number"
                        dataKey="avArea"
                        name="平均面积"
                        stroke="#94a3b8"
                        fontSize={12}
                      />
                      <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                      <Legend />
                      <Scatter
                        name="有效标准点"
                        data={standardsData.filter(s => s.enabled)}
                        fill="#0284c7"
                      />
                      <Scatter
                        name="已排除标准点"
                        data={standardsData.filter(s => !s.enabled)}
                        fill="#ef4444"
                        shape="cross"
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="card">
              <h3 className="card-title">标准溶液测量列表</h3>
              <div className="table-container">
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th style={{ width: '60px' }}>启用</th>
                      <th>标准品名称</th>
                      <th>注射面积组</th>
                      <th>平均面积</th>
                      <th>面积SD</th>
                      <th>稀释倍数</th>
                      <th>计算理论浓度 (µmol/L)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standardsData.map((std) => (
                      <tr key={std.id} className={!std.enabled ? 'tr-danger opacity-60' : ''}>
                        <td>
                          <input
                            type="checkbox"
                            checked={std.enabled}
                            onChange={() => setEnabledStds(prev => ({
                              ...prev,
                              [std.id]: !std.enabled
                            }))}
                            style={{ cursor: 'pointer' }}
                          />
                        </td>
                        <td className="font-semibold">
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span>{std.sampleName}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#64748b', fontWeight: 'normal' }}>
                              <span>原液浓度:</span>
                              <input
                                type="number"
                                value={std.matchedUsedC}
                                onChange={e => {
                                  const val = parseFloat(e.target.value);
                                  if (!isNaN(val) && val >= 0) {
                                    setCustomStdUsedCs(prev => ({
                                      ...prev,
                                      [std.id]: val
                                    }));
                                  }
                                }}
                                className="input-field"
                                style={{ width: '65px', height: '22px', fontSize: '11px', padding: '2px 4px', margin: 0 }}
                                step="any"
                              />
                              <span>µmol/L</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            {std.group.injections.map((area: number, i: number) => {
                              return (
                                <div 
                                  key={i}
                                  style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '4px',
                                    padding: '2px 6px',
                                    borderRadius: '6px',
                                    backgroundColor: std.group.selectedInjections[i] ? 'var(--primary-light)' : '#f1f5f9',
                                    border: `1px solid ${std.group.selectedInjections[i] ? 'var(--primary)' : '#cbd5e1'}`,
                                    transition: 'all 0.15s ease'
                                  }}
                                >
                                  <span
                                    onClick={() => handleToggleInjection(std.id, i)}
                                    style={{ 
                                      cursor: 'pointer', 
                                      width: '8px', 
                                      height: '8px', 
                                      borderRadius: '50%', 
                                      backgroundColor: std.group.selectedInjections[i] ? 'var(--primary)' : '#94a3b8',
                                      display: 'inline-block' 
                                    }}
                                    title={std.group.selectedInjections[i] ? "点击排除本次注射" : "点击包含本次注射"}
                                  />
                                  <input
                                    type="number"
                                    step="any"
                                    value={area}
                                    onChange={(e) => {
                                      const val = parseFloat(e.target.value) || 0;
                                      const targetGlobalIdx = (std.group as any).rawInjIndices ? (std.group as any).rawInjIndices[i] : -1;
                                      if (targetGlobalIdx !== -1) {
                                        handleUpdateInjectionAreaByIndex(targetGlobalIdx, val);
                                      }
                                    }}
                                    style={{
                                      width: '62px',
                                      border: 'none',
                                      background: 'transparent',
                                      fontSize: '12px',
                                      fontWeight: '600',
                                      color: std.group.selectedInjections[i] ? 'var(--text-primary)' : 'var(--text-muted)',
                                      textDecoration: std.group.selectedInjections[i] ? 'none' : 'line-through',
                                      textAlign: 'center',
                                      outline: 'none',
                                      padding: 0
                                    }}
                                    title="直接输入修改数值"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </td>
                        <td>{std.avArea.toFixed(4)}</td>
                        <td>{std.group.sdArea.toFixed(4)}</td>
                        <td>
                          <input
                            type="number"
                            value={std.dilution}
                            onChange={e => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val) && val > 0) {
                                setCustomDilutions(prev => ({
                                  ...prev,
                                  [std.id]: val
                                }));
                              }
                            }}
                            className="input-field py-1 px-2 text-xs"
                            style={{ width: '70px' }}
                            step="any"
                          />
                        </td>
                        <td className="font-semibold">{std.theoreticalC.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Data Inspection */}
        {currentStep === 3 && (
          <div className="space-y-6">
            <QCDashboard
              files={files}
              groups={processedSamples}
              calibrationCurvesList={calibrationCurves
                .filter(c => !disabledCurves[c.id])
                .map(c => ({ id: c.id, name: c.name, fileName: c.fileName, slope: c.slope, intercept: c.intercept, rsq: c.rsq }))}
              calibrationMap={calibrationCurves
                .filter(c => !disabledCurves[c.id])
                .reduce((acc, c) => {
                  if (!acc[c.fileName] || c.rsq > (acc[c.fileName].rsq || 0)) {
                    acc[c.fileName] = { slope: c.slope, intercept: c.intercept, rsq: c.rsq };
                  }
                  return acc;
                }, {} as Record<string, { slope: number; intercept: number; rsq: number }>)}
              calculatedConcs={processedSamples.reduce((acc, s) => {
                acc[s.id] = s.concentration;
                return acc;
              }, {} as Record<string, number>)}
              dswTargetConc={(dswMin + dswMax) / 2}
              stationCoords={stationCoords}
              hydroSamples={hydroSamples}
            />

            <div className="page-header">
              <div>
                <h1 className="page-title">样品详细审核与微调</h1>
                <p className="page-subtitle">检查详细样品进样记录、变异系数 (RSD)，或手动排除离群峰面积</p>
              </div>
            </div>

            {/* DSW & SSW Reference Target Inputs */}
            <div className="card mb-6" style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Settings size={16} className="text-slate-500" />
                  <span className="text-sm font-bold text-slate-700">参标质控浓度设定：</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className="text-xs text-slate-500">深海参标 (DSW) 范围:</span>
                    <input
                      type="number"
                      className="input-field"
                      style={{ width: '70px', padding: '4px 8px', fontSize: '13px', margin: 0 }}
                      value={dswMin}
                      onChange={e => setDswMin(parseFloat(e.target.value) || 0)}
                      step="any"
                    />
                    <span className="text-xs text-slate-400">-</span>
                    <input
                      type="number"
                      className="input-field"
                      style={{ width: '70px', padding: '4px 8px', fontSize: '13px', margin: 0 }}
                      value={dswMax}
                      onChange={e => setDswMax(parseFloat(e.target.value) || 0)}
                      step="any"
                    />
                    <span className="text-xs text-slate-500">µmol/L</span>
                  </div>

                  <div style={{ width: '1px', height: '16px', backgroundColor: '#e2e8f0' }} />

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className="text-xs text-slate-500">表层参标 (SSW) 范围:</span>
                    <input
                      type="number"
                      className="input-field"
                      style={{ width: '70px', padding: '4px 8px', fontSize: '13px', margin: 0 }}
                      value={sswMin}
                      onChange={e => setSswMin(parseFloat(e.target.value) || 0)}
                      step="any"
                    />
                    <span className="text-xs text-slate-400">-</span>
                    <input
                      type="number"
                      className="input-field"
                      style={{ width: '70px', padding: '4px 8px', fontSize: '13px', margin: 0 }}
                      value={sswMax}
                      onChange={e => setSswMax(parseFloat(e.target.value) || 0)}
                      step="any"
                    />
                    <span className="text-xs text-slate-500">µmol/L</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid-3 mb-6">
              <div className="card" style={{ padding: '16px 20px', margin: '0' }}>
                <span className="text-xs text-slate-400 block font-semibold mb-1">Milli-Q 超纯水空白平均面积 (Av Blank)</span>
                <span className="text-2xl font-bold text-slate-800 font-display">
                  {blanksAndSeawaters.avgBlankArea ? blanksAndSeawaters.avgBlankArea.toFixed(4) : "N/A"}
                </span>
                <span className="text-xs text-slate-400 block mt-1">
                  相当于浓度: {blanksAndSeawaters.avgBlankConc ? blanksAndSeawaters.avgBlankConc.toFixed(2) : "0"} µmol/L
                </span>
              </div>
              <div className="card" style={{ padding: '16px 20px', margin: '0' }}>
                <span className="text-xs text-slate-400 block font-semibold mb-1 flex items-center gap-1">
                  <span>深海参标 (DSW) 平均浓度</span>
                  <span className="text-[10px] text-slate-400 font-normal">(设定值 {dswMin}-{dswMax} µmol/L)</span>
                </span>
                <span className={`text-2xl font-bold font-display ${blanksAndSeawaters.avgDswConc >= dswMin && blanksAndSeawaters.avgDswConc <= dswMax
                    ? "text-emerald-500"
                    : "text-amber-500"
                  }`}>
                  {blanksAndSeawaters.avgDswConc ? `${blanksAndSeawaters.avgDswConc.toFixed(2)} µmol/L` : "N/A"}
                </span>
                <span className="text-xs text-slate-400 block mt-1">
                  测量次数: {blanksAndSeawaters.dswCount} 次
                </span>
              </div>
              <div className="card" style={{ padding: '16px 20px', margin: '0' }}>
                <span className="text-xs text-slate-400 block font-semibold mb-1 flex items-center gap-1">
                  <span>表层参标 (SSW) 平均浓度</span>
                  <span className="text-[10px] text-slate-400 font-normal">(设定值 {sswMin}-{sswMax} µmol/L)</span>
                </span>
                <span className={`text-2xl font-bold font-display ${blanksAndSeawaters.avgSswConc >= sswMin && blanksAndSeawaters.avgSswConc <= sswMax
                    ? "text-emerald-500"
                    : "text-amber-500"
                  }`}>
                  {blanksAndSeawaters.avgSswConc ? `${blanksAndSeawaters.avgSswConc.toFixed(2)} µmol/L` : "N/A"}
                </span>
                <span className="text-xs text-slate-400 block mt-1">
                  测量次数: {blanksAndSeawaters.sswCount} 次
                </span>
              </div>
            </div>

            {/* Batch Calibration Curves & Reference QC Monitoring Table */}
            <div className="card mb-6">
              <h3 className="card-title">分批次工作曲线与参标质控监控表</h3>
              <div className="table-container">
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th>所属柱号</th>
                      <th>工作曲线批次</th>
                      <th>所属文件</th>
                      <th>斜率 (Slope)</th>
                      <th>截距 (Intercept)</th>
                      <th>回归系数 (R²)</th>
                      <th>MQ Blank (µmol/L)</th>
                      <th>DSW 参标均值 ({dswMin}-{dswMax} µmol/L)</th>
                      <th>SSW 参标均值 ({sswMin}-{sswMax} µmol/L)</th>
                      <th>浓度修正量 (µmol/L)</th>
                      <th>判定状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Get unique active files ordered by physical measurement date
                      const activeCurves = calibrationCurves
                        .filter(curve => !disabledCurves[curve.id])
                        .sort((a, b) => getFileSortPriority(a.fileName) - getFileSortPriority(b.fileName));

                      const uniqueFiles: string[] = [];
                      activeCurves.forEach(c => {
                        if (!uniqueFiles.includes(c.fileName)) {
                          uniqueFiles.push(c.fileName);
                        }
                      });

                      return activeCurves.map((curve) => {
                        const colIdx = uniqueFiles.indexOf(curve.fileName) + 1;
                        const curveSamples = processedSamples.filter(s => sampleToCurveMap[s.id] === curve.id && !s.isRejected);
                        const dsws = curveSamples.filter(s => s.sampleName.toLowerCase() === 'dsw');
                        const ssws = curveSamples.filter(s => s.sampleName.toLowerCase() === 'ssw');
                        
                        // Calculate valid MQ Blanks (strictly sampleId === 'Blank', excluding 'Cleaning' & carryover outliers)
                        const validMqs = curveSamples.filter(s => {
                          if (!s.isBlank) return false;
                          const lowerId = s.sampleId.toLowerCase();
                          const lowerName = s.sampleName.toLowerCase();
                          if (lowerId.includes('clean') || lowerId.includes('flush') || lowerId.includes('wash') || lowerName.includes('clean') || lowerName.includes('flush') || lowerName.includes('wash')) return false;
                          return true;
                        });

                        let mqConc = 0;
                        if (validMqs.length > 0) {
                          const areas = validMqs.map(g => g.avArea).sort((a, b) => a - b);
                          const medianArea = areas.length % 2 === 0
                            ? (areas[areas.length / 2 - 1] + areas[areas.length / 2]) / 2
                            : areas[Math.floor(areas.length / 2)];

                          // Exclude carryover outliers based on raw peak area (e.g. > 3 * medianArea AND area > 0.3)
                          const filteredMqs = validMqs.filter(g => !(medianArea > 0 && g.avArea > Math.max(medianArea * 3.0, 0.3)));
                          const activeMqs = filteredMqs.length > 0 ? filteredMqs : validMqs;
                          const avgRawArea = activeMqs.reduce((sum, b) => sum + b.avArea, 0) / activeMqs.length;
                          mqConc = curve.slope > 0 ? avgRawArea / curve.slope : 0;
                        }
                        
                        const avgDsw = calculateMean(dsws.map(d => d.concentration));
                        const avgSsw = calculateMean(ssws.map(s => s.concentration));
                        
                        const isDswOk = dsws.length === 0 || (avgDsw >= dswMin && avgDsw <= dswMax);
                        const isSswOk = ssws.length === 0 || (avgSsw >= sswMin && avgSsw <= sswMax);
                        // DSW is the primary gold standard for ocean DOC QC. If DSW is pass, batch is passed.
                        const status = isDswOk ? "合格" : "超标";
                        
                        return (
                          <tr key={curve.id}>
                            <td className="font-bold text-slate-800">
                              <span className="px-2 py-0.5 bg-slate-100 border border-slate-300 rounded text-xs">
                                第 {colIdx} 柱
                              </span>
                            </td>
                            <td className="font-semibold text-sky-700">{curve.name}</td>
                            <td className="text-xs text-slate-500">{curve.fileName}</td>
                          <td>{curve.slope.toFixed(6)}</td>
                          <td>{curve.intercept.toFixed(6)}</td>
                          <td>
                            <span className={curve.rsq >= 0.99 ? "text-emerald-600 font-semibold" : "text-rose-500 font-semibold"}>
                              {curve.rsq.toFixed(6)}
                            </span>
                          </td>
                          <td className="text-sky-700 font-mono font-medium">
                            {validMqs.length > 0 ? `${mqConc.toFixed(2)}` : "-"}
                          </td>
                          <td className={!isDswOk ? "text-amber-600 font-bold" : "text-slate-700 font-medium"}>
                            {dsws.length > 0 ? `${avgDsw.toFixed(2)}` : "-"}
                          </td>
                          <td className={!isSswOk ? "text-amber-600 font-bold" : "text-slate-700 font-medium"}>
                            {ssws.length > 0 ? `${avgSsw.toFixed(2)}` : "-"}
                          </td>
                          <td>
                            <input
                              type="number"
                              className="input-field"
                              style={{ width: '80px', padding: '4px 8px', fontSize: '13px', margin: 0, textAlign: 'center' }}
                              value={curveOffsets[curve.id] || 0}
                              onChange={e => {
                                const val = parseFloat(e.target.value) || 0;
                                setCurveOffsets(prev => ({ ...prev, [curve.id]: val }));
                              }}
                              step="any"
                              placeholder="0"
                            />
                          </td>
                          <td>
                            <span className={`badge ${disabledCurves[curve.id] ? 'badge-danger opacity-70' : status === '合格' ? 'badge-success' : 'badge-warning'}`}>
                              {disabledCurves[curve.id] ? '已停用' : status}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              <button
                                className="btn btn-secondary"
                                style={{ padding: '4px 8px', fontSize: '12px' }}
                                onClick={() => setActiveQcModalCurveId(curve.id)}
                              >
                                审核
                              </button>
                              <button
                                className="btn"
                                style={{
                                  padding: '4px 8px',
                                  fontSize: '12px',
                                  backgroundColor: disabledCurves[curve.id] ? '#10b981' : '#f43f5e',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: '6px',
                                  cursor: 'pointer'
                                }}
                                onClick={() => setDisabledCurves(prev => ({
                                  ...prev,
                                  [curve.id]: !prev[curve.id]
                                }))}
                              >
                                {disabledCurves[curve.id] ? '恢复' : '停用'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                  </tbody>
                </table>
              </div>
              {Object.keys(disabledCurves).filter(k => disabledCurves[k]).length > 0 && (
                <div style={{ marginTop: '12px', padding: '10px 14px', backgroundColor: '#fff1f2', borderRadius: '8px', border: '1px solid #fecdd3', fontSize: '12px', color: '#be123c', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>
                    ⚠️ 已停用 {Object.keys(disabledCurves).filter(k => disabledCurves[k]).length} 根工作曲线（已从上方列表中剔除，后方柱号已自动连续递补）。
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {calibrationCurves.filter(c => disabledCurves[c.id]).map(c => (
                      <button
                        key={c.id}
                        onClick={() => setDisabledCurves(prev => ({ ...prev, [c.id]: false }))}
                        className="btn"
                        style={{ padding: '2px 8px', fontSize: '11px', backgroundColor: '#fff', border: '1px solid #f43f5e', color: '#be123c', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        恢复 {c.fileName}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <h3 className="card-title" style={{ margin: 0 }}>样品浓度数据列表</h3>
                  <button
                    className="btn btn-secondary no-print"
                    style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    onClick={() => window.print()}
                    title="打开浏览器打印预览对话框"
                  >
                    <Printer size={14} />
                    <span>打印报表 / 预览</span>
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="text-sm font-semibold text-slate-500">站位筛选：</span>
                    <select
                      value={qcSelectedStation}
                      onChange={(e) => setQcSelectedStation(e.target.value)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '14px',
                        color: '#334155',
                        outline: 'none',
                        cursor: 'pointer',
                        backgroundColor: '#fff',
                        fontWeight: '500',
                        boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
                      }}
                    >
                      <option value="all">全部站位 ({processedSamples.length})</option>
                      {qcStations.map(st => {
                        const count = processedSamples.filter(s => {
                          if (st === 'MQ/空白') return s.isBlank;
                          if (st === 'STANDARD') return s.isStd;
                          if (st === 'DSW' || st === 'SSW') return s.isSeawater && s.sampleName.toUpperCase() === st;
                          return s.station === st;
                        }).length;
                        return (
                          <option key={st} value={st}>
                            {st} ({count} 个样品)
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="text-sm font-semibold text-slate-500">状态筛选：</span>
                    <select
                      value={qcSelectedStatus}
                      onChange={(e) => setQcSelectedStatus(e.target.value as any)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '14px',
                        color: '#334155',
                        outline: 'none',
                        cursor: 'pointer',
                        backgroundColor: '#fff',
                        fontWeight: '500',
                        boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
                      }}
                    >
                      <option value="all">全部状态</option>
                      <option value="qualified">仅看合格</option>
                      <option value="warning">仅看RSD超标</option>
                      <option value="rejected">仅看已废弃</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="text-sm font-semibold text-slate-500">数据排序：</span>
                    <select
                      value={sampleSortOrder}
                      onChange={(e) => setSampleSortOrder(e.target.value as any)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '14px',
                        color: '#334155',
                        outline: 'none',
                        cursor: 'pointer',
                        backgroundColor: '#fff',
                        fontWeight: '500',
                        boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
                      }}
                    >
                      <option value="category">按样品类别 (MQ/空白 ➔ 参标 ➔ 样品)</option>
                      <option value="import">按导入顺序</option>
                      <option value="name">按样品名称</option>
                      <option value="concentration">按浓度从高到低</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="table-container">
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th style={{ width: '50px' }}>使用</th>
                      <th>样品名称</th>
                      <th>站位</th>
                      <th>深度 (m)</th>
                      <th>DOC 浓度 (µmol/L)</th>
                      <th>误差 (µmol/L)</th>
                      <th>使用工作曲线</th>
                      <th>平均面积</th>
                      <th>面积SD</th>
                      <th>面积RSD (%)</th>
                      <th>每次注射面积 (包含/排除) 与计算浓度 (µmol/L)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedQcSamples.map((s) => {
                      const isRsdHigh = s.rsd > 2.0;
                      let trClass = "";
                      if (s.isRejected) trClass = "tr-danger opacity-50";
                      else if (isRsdHigh) trClass = "tr-warning";

                      const curve = calibrationCurves.find(c => c.id === s.curveId) || calibrationCurves[0];
                      const slope = curve?.slope || 1;
                      const intercept = curve?.intercept || 0;

                      return (
                        <tr key={s.id} className={trClass}>
                          <td>
                            <input
                              type="checkbox"
                              checked={!s.isRejected}
                              onChange={() => handleToggleRejection(s.id)}
                              style={{ cursor: 'pointer' }}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={s.sampleName}
                              onChange={e => {
                                const newName = e.target.value;
                                setCustomSampleNames((prev: Record<string, string>) => ({ ...prev, [s.id]: newName }));
                              }}
                              className="input-field py-1 px-2 text-xs"
                              style={{
                                border: '1px solid #e2e8f0',
                                background: '#fff',
                                fontWeight: 'bold',
                                width: '130px',
                                borderRadius: '4px',
                                padding: '2px 6px'
                              }}
                            />
                          </td>
                          <td>{s.station || "-"}</td>
                          <td>{s.depth !== null ? `${s.depth} m` : "-"}</td>
                          <td className="font-semibold text-sky-700">{s.concentration.toFixed(2)}</td>
                          <td className="text-xs text-slate-500">± {s.error.toFixed(2)}</td>
                          <td style={{ fontSize: '12px', color: '#64748b', fontWeight: '500' }}>{s.curveName}</td>
                          <td>{s.avArea.toFixed(4)}</td>
                          <td>{s.sdArea.toFixed(4)}</td>
                          <td>
                            <span className={isRsdHigh ? "text-amber-600 font-bold" : ""}>
                              {s.rsd.toFixed(2)}%
                            </span>
                            {isRsdHigh && !s.isRejected && (
                              <span title="RSD 超过 2%"><AlertTriangle size={12} className="text-amber-500 inline ml-1" /></span>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              {s.injections.map((area, i) => {
                                const offset = curveOffsets[s.curveId] || 0;
                                const injConc = (area - intercept) / slope + offset;
                                return (
                                  <div 
                                    key={i}
                                    style={{ 
                                      display: 'flex', 
                                      alignItems: 'center', 
                                      gap: '4px',
                                      padding: '4px 6px',
                                      borderRadius: '6px',
                                      backgroundColor: s.selectedInjections[i] ? 'var(--primary-light)' : '#f1f5f9',
                                      border: `1px solid ${s.selectedInjections[i] ? 'var(--primary)' : '#cbd5e1'}`,
                                      transition: 'all 0.15s ease'
                                    }}
                                  >
                                    <span
                                      onClick={() => handleToggleInjection(s.id, i)}
                                      style={{ 
                                        cursor: 'pointer', 
                                        width: '8px', 
                                        height: '8px', 
                                        borderRadius: '50%', 
                                        backgroundColor: s.selectedInjections[i] ? 'var(--primary)' : '#94a3b8',
                                        display: 'inline-block',
                                        flexShrink: 0
                                      }}
                                      title={s.selectedInjections[i] ? "点击排除本次注射" : "点击包含本次注射"}
                                    />
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                      <input
                                        type="number"
                                        step="any"
                                        value={area}
                                        onChange={(e) => {
                                          const val = parseFloat(e.target.value) || 0;
                                           const targetGlobalIdx = (s as any).rawInjIndices ? (s as any).rawInjIndices[i] : -1;
                                           if (targetGlobalIdx !== -1) {
                                             handleUpdateInjectionAreaByIndex(targetGlobalIdx, val);
                                           }
                                        }}
                                        style={{
                                          width: '62px',
                                          border: 'none',
                                          background: 'transparent',
                                          fontSize: '12px',
                                          fontWeight: '600',
                                          color: s.selectedInjections[i] ? 'var(--text-primary)' : 'var(--text-muted)',
                                          textDecoration: s.selectedInjections[i] ? 'none' : 'line-through',
                                          textAlign: 'center',
                                          outline: 'none',
                                          padding: 0
                                        }}
                                        title="直接输入修改数值"
                                      />
                                      <span style={{ 
                                        fontSize: '10px', 
                                        color: s.selectedInjections[i] ? '#0369a1' : '#94a3b8',
                                        fontWeight: '500',
                                        marginTop: '1px'
                                      }}>
                                        {injConc.toFixed(2)}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '20px' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '13px' }}
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  >
                    上一页
                  </button>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                    第 {currentPage} 页 / 共 {totalPages} 页 (共 {filteredQcSamples.length} 个样品)
                  </span>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '13px' }}
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  >
                    下一页
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Batch QC Modal popup dialog */}
        {activeQcModalCurveId && (() => {
          const curve = calibrationCurves.find(c => c.id === activeQcModalCurveId);
          if (!curve) return null;

          const curveSamples = processedSamples.filter(s => sampleToCurveMap[s.id] === curve.id);
          const dsws = curveSamples.filter(s => !s.isRejected && s.sampleName.toLowerCase() === 'dsw');
          const ssws = curveSamples.filter(s => !s.isRejected && s.sampleName.toLowerCase() === 'ssw');
          
          const avgDsw = calculateMean(dsws.map(d => d.concentration));
          const avgSsw = calculateMean(ssws.map(s => s.concentration));
          
          const currentCurveIndex = calibrationCurves.findIndex(c => c.id === activeQcModalCurveId);
          const hasPrevCurve = currentCurveIndex > 0;
          const hasNextCurve = currentCurveIndex < calibrationCurves.length - 1;

          const isDswOk = dsws.length === 0 || (avgDsw >= dswMin && avgDsw <= dswMax);
          const isSswOk = ssws.length === 0 || (avgSsw >= sswMin && avgSsw <= sswMax);

          return (
            <div 
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(15, 23, 42, 0.6)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
                padding: '20px'
              }}
            >
              <div 
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '12px',
                  width: '100%',
                  maxWidth: '1200px',
                  maxHeight: '90vh',
                  overflowY: 'auto',
                  boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
                  display: 'flex',
                  flexDirection: 'column'
                }}
              >
                {/* Modal Header */}
                <div 
                  style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid #f1f5f9',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    backgroundColor: '#f8fafc',
                    borderTopLeftRadius: '12px',
                    borderTopRightRadius: '12px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                        {curve.name} - 批次数据质控审核
                      </h3>
                      <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                        文件：{curve.fileName}
                      </p>
                    </div>

                    {/* Navigation Buttons */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600, margin: 0 }}
                        disabled={!hasPrevCurve}
                        onClick={() => {
                          if (hasPrevCurve) {
                            setActiveQcModalCurveId(calibrationCurves[currentCurveIndex - 1].id);
                          }
                        }}
                        title="切换到上一条工作曲线"
                      >
                        <ChevronLeft size={14} />
                        <span>上一条</span>
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600, margin: 0 }}
                        disabled={!hasNextCurve}
                        onClick={() => {
                          if (hasNextCurve) {
                            setActiveQcModalCurveId(calibrationCurves[currentCurveIndex + 1].id);
                          }
                        }}
                        title="切换到下一条工作曲线"
                      >
                        <span>下一条</span>
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                  <button 
                    onClick={() => setActiveQcModalCurveId(null)}
                    style={{
                      border: 'none',
                      background: 'none',
                      fontSize: '24px',
                      cursor: 'pointer',
                      color: '#64748b',
                      padding: '4px'
                    }}
                  >
                    &times;
                  </button>
                </div>

                {/* Modal Stats Bar */}
                <div 
                  style={{
                    padding: '16px 24px',
                    borderBottom: '1px solid #f1f5f9',
                    backgroundColor: '#fff',
                    display: 'flex',
                    gap: '24px',
                    flexWrap: 'wrap'
                  }}
                >
                  <div style={{ fontSize: '13px', color: '#334155' }}>
                    斜率 (Slope): <strong style={{ color: 'var(--primary)', fontFamily: 'monospace' }}>{curve.slope.toFixed(6)}</strong>
                  </div>
                  <div style={{ fontSize: '13px', color: '#334155' }}>
                    截距 (Intercept): <strong style={{ color: 'var(--primary)', fontFamily: 'monospace' }}>{curve.intercept.toFixed(6)}</strong>
                  </div>
                  <div style={{ fontSize: '13px', color: '#334155' }}>
                    回归系数 (R²): <strong style={{ color: curve.rsq >= 0.99 ? 'var(--success)' : 'var(--danger)', fontFamily: 'monospace' }}>{curve.rsq.toFixed(6)}</strong>
                  </div>
                  <div style={{ fontSize: '13px', color: '#334155' }}>
                    DSW 参标: <strong style={{ color: isDswOk ? 'var(--success)' : 'var(--warning)' }}>{dsws.length > 0 ? `${avgDsw.toFixed(2)} µmol/L` : '-'}</strong> ({dswMin}-{dswMax})
                  </div>
                  <div style={{ fontSize: '13px', color: '#334155' }}>
                    SSW 参标: <strong style={{ color: isSswOk ? 'var(--success)' : 'var(--warning)' }}>{ssws.length > 0 ? `${avgSsw.toFixed(2)} µmol/L` : '-'}</strong> ({sswMin}-{sswMax})
                  </div>
                </div>

                {/* Modal Body Table */}
                <div style={{ padding: '24px', overflowX: 'auto' }}>
                  <table className="custom-table">
                    <thead>
                      <tr>
                        <th style={{ width: '50px' }}>使用</th>
                        <th>样品名称</th>
                        <th>站位</th>
                        <th>深度 (m)</th>
                        <th>DOC 浓度 (µmol/L)</th>
                        <th>误差 (µmol/L)</th>
                        <th>平均面积</th>
                        <th>面积SD</th>
                        <th>面积RSD (%)</th>
                        <th>每次注射面积 (包含/排除) 与计算浓度 (µmol/L)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {curveSamples.map((s) => {
                        const isRsdHigh = s.rsd > 2.0;
                        let trClass = "";
                        if (s.isRejected) trClass = "tr-danger opacity-50";
                        else if (isRsdHigh) trClass = "tr-warning";

                        return (
                          <tr key={s.id} className={trClass}>
                            <td>
                              <input
                                type="checkbox"
                                checked={!s.isRejected}
                                onChange={() => handleToggleRejection(s.id)}
                                style={{ cursor: 'pointer' }}
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                value={s.sampleName}
                                onChange={e => {
                                  const newName = e.target.value;
                                  setCustomSampleNames((prev: Record<string, string>) => ({ ...prev, [s.id]: newName }));
                                }}
                                className="input-field py-1 px-2 text-xs"
                                style={{
                                  border: '1px solid #e2e8f0',
                                  background: '#fff',
                                  fontWeight: 'bold',
                                  width: '130px',
                                  borderRadius: '4px',
                                  padding: '2px 6px'
                                }}
                              />
                            </td>
                            <td>{s.station || "-"}</td>
                            <td>{s.depth !== null ? `${s.depth} m` : "-"}</td>
                            <td className="font-semibold text-sky-700">{s.concentration.toFixed(2)}</td>
                            <td className="text-xs text-slate-500">± {s.error.toFixed(2)}</td>
                            <td>{s.avArea.toFixed(4)}</td>
                            <td>{s.sdArea.toFixed(4)}</td>
                            <td>
                              <span className={isRsdHigh ? "text-amber-600 font-bold" : ""}>
                                {s.rsd.toFixed(2)}%
                              </span>
                              {isRsdHigh && !s.isRejected && (
                                <span title="RSD 超过 2%"><AlertTriangle size={12} className="text-amber-500 inline ml-1" /></span>
                              )}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                {s.injections.map((area, i) => {
                                  const offset = curveOffsets[curve.id] || 0;
                                  const injConc = (area - curve.intercept) / curve.slope + offset;
                                  return (
                                    <div 
                                      key={i}
                                      style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: '4px',
                                        padding: '4px 6px',
                                        borderRadius: '6px',
                                        backgroundColor: s.selectedInjections[i] ? 'var(--primary-light)' : '#f1f5f9',
                                        border: `1px solid ${s.selectedInjections[i] ? 'var(--primary)' : '#cbd5e1'}`,
                                        transition: 'all 0.15s ease'
                                      }}
                                    >
                                      <span
                                        onClick={() => handleToggleInjection(s.id, i)}
                                        style={{ 
                                          cursor: 'pointer', 
                                          width: '8px', 
                                          height: '8px', 
                                          borderRadius: '50%', 
                                          backgroundColor: s.selectedInjections[i] ? 'var(--primary)' : '#94a3b8',
                                          display: 'inline-block',
                                          flexShrink: 0
                                        }}
                                        title={s.selectedInjections[i] ? "点击排除本次注射" : "点击包含本次注射"}
                                      />
                                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                        <input
                                          type="number"
                                          step="any"
                                          value={area}
                                          onChange={(e) => {
                                            const val = parseFloat(e.target.value) || 0;
                                            const targetGlobalIdx = (s as any).rawInjIndices ? (s as any).rawInjIndices[i] : -1;
                                           if (targetGlobalIdx !== -1) {
                                             handleUpdateInjectionAreaByIndex(targetGlobalIdx, val);
                                           }
                                          }}
                                          style={{
                                            width: '62px',
                                            border: 'none',
                                            background: 'transparent',
                                            fontSize: '12px',
                                            fontWeight: '600',
                                            color: s.selectedInjections[i] ? 'var(--text-primary)' : 'var(--text-muted)',
                                            textDecoration: s.selectedInjections[i] ? 'none' : 'line-through',
                                            textAlign: 'center',
                                            outline: 'none',
                                            padding: 0
                                          }}
                                          title="直接输入修改数值"
                                        />
                                        <span style={{ 
                                          fontSize: '10px', 
                                          color: s.selectedInjections[i] ? '#0369a1' : '#94a3b8',
                                          fontWeight: '500',
                                          marginTop: '1px'
                                        }}>
                                          {injConc.toFixed(2)}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Modal Footer */}
                <div 
                  style={{
                    padding: '16px 24px',
                    borderTop: '1px solid #f1f5f9',
                    backgroundColor: '#f8fafc',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    borderBottomLeftRadius: '12px',
                    borderBottomRightRadius: '12px'
                  }}
                >
                  <button 
                    className="btn btn-primary"
                    onClick={() => setActiveQcModalCurveId(null)}
                  >
                    关闭
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Step 4: Visualizations */}
        {currentStep === 4 && (
          <div>
            <div className="page-header">
              <div>
                <h1 className="page-title">数据图表绘制</h1>
                <p className="page-subtitle">第四步：在 1D 剖面折线图与 2D 断面彩色等值线图之间进行切换，深度进行反转展现</p>
              </div>
            </div>
            <OriginPlotter
              processedSamples={processedSamples}
              stationCoords={stationCoords}
              hydroSamples={hydroSamples}
              hydroParameters={hydroParameters}
            />
          </div>
        )}

        {/* Step 5: Export */}
        {currentStep === 5 && (
          <div style={{ maxWidth: '600px', margin: '40px auto', textAlign: 'center' }}>
            <div className="card" style={{ padding: '40px 30px' }}>
              <CheckCircle size={64} className="text-emerald-500 mx-auto mb-6" style={{ margin: '0 auto 24px' }} />
              <h2 className="text-2xl font-bold mb-2">数据处理与质量审核已全部完成！</h2>
              <p className="text-sm text-slate-500 mb-8" style={{ marginBottom: '32px' }}>
                系统已生成符合规格的 Excel 数据报表，包含所有的样品测定均值、工作曲线系数、误差精度，以及被自动或手动排除的数据历史记录。
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '32px' }}>
                <div style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
                  <span className="text-sm text-slate-500 font-semibold">测定样品总数</span>
                  <span className="text-sm font-bold">{processedSamples.filter(s => !s.isStd).length} 个</span>
                </div>
                <div style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
                  <span className="text-sm text-slate-500 font-semibold">校准回归线性度 (R²)</span>
                  <span className="text-sm font-bold">{calibrationCurve.rsq ? calibrationCurve.rsq.toFixed(6) : "N/A"}</span>
                </div>
                <div style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
                  <span className="text-sm text-slate-500 font-semibold">深海参标 (DSW) 浓度</span>
                  <span className="text-sm font-bold text-sky-600">{blanksAndSeawaters.avgDswConc ? `${blanksAndSeawaters.avgDswConc.toFixed(2)} µmol/L` : "N/A"}</span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <button className="btn btn-primary w-full justify-center py-3 text-base" onClick={exportToExcel}>
                  <Download size={18} />
                  <span>一键下载 Excel 结构化处理报表 (.xlsx)</span>
                </button>
                <button
                  className="btn btn-secondary w-full justify-center py-3 text-base"
                  style={{ backgroundColor: '#0284c7', color: '#ffffff', borderColor: '#0284c7' }}
                  onClick={exportToODVCSV}
                >
                  <FileSpreadsheet size={18} />
                  <span>导出 ODV 绘图专用 CSV 文件 (.csv)</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Wizard Footer Navigation Controls */}
        <div className="wizard-footer">
          <button
            className="btn btn-secondary"
            onClick={() => {
              if (currentStep === 4 && hydroSamples.length > 0) {
                setCurrentStep(1);
              } else {
                setCurrentStep(prev => prev - 1);
              }
            }}
            disabled={currentStep === 1}
          >
            <ChevronLeft size={16} />
            <span>上一步</span>
          </button>

          <button
            className="btn btn-primary"
            onClick={() => {
              if (currentStep === 1 && hydroSamples.length > 0) {
                setCurrentStep(4);
              } else {
                setCurrentStep(prev => prev + 1);
              }
            }}
            disabled={
              (currentStep === 1 && files.length === 0 && hydroSamples.length === 0) ||
              (currentStep === 2 && !(calibrationCurve.slope > 0)) ||
              currentStep === 5 ||
              (currentStep === 4 && hydroSamples.length > 0)
            }
          >
            <span>下一步</span>
            <ChevronRight size={16} />
          </button>
        </div>

      </div>
    </div>
  );
}
