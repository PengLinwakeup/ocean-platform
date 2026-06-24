import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Upload, FileText, LineChart, 
  Map, Download, Trash2, CheckCircle, AlertTriangle, 
  Settings, ChevronLeft, ChevronRight, Check
} from 'lucide-react';
import { parseRawTxt } from './utils/parser';
import { selectBestSubset, fitCalibrationCurve, interpolateIDW, calculateMean, calculateStdev } from './utils/calc';
import { parseStationCoordinates, normalizeStationName } from './utils/stationParser';
import { RawInjection, SampleGroup, ExcelSampleInfo } from './types';
import { 
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, 
  CartesianGrid, Tooltip, Legend, ErrorBar
} from 'recharts';
import * as xlsx from 'xlsx';
import { contours } from 'd3-contour';
import { scaleLinear } from 'd3-scale';

export default function App() {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [visSubTab, setVisSubTab] = useState<'profile1d' | 'contour2d'>('profile1d');
  
  // File management state
  const [files, setFiles] = useState<{ name: string; size: number }[]>([]);
  const [rawInjections, setRawInjections] = useState<RawInjection[]>([]);
  const [stationCoords, setStationCoords] = useState<ExcelSampleInfo[]>([]);
  
  // Standard curve parameters
  const [stdStockC, setStdStockC] = useState<number>(10000); // standard stock concentration (µmol C / L)
  const [stdDilutionFactor, setStdDilutionFactor] = useState<number>(25.2423); // standard dilution factor
  const [stdUsedC, setStdUsedC] = useState<number>(396.16); // used standard uM C
  const [dilutionFactors, setDilutionFactors] = useState<number[]>([15, 10, 6, 5, 4, 3]);

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

  const [enabledStds, setEnabledStds] = useState<Record<string, boolean>>({}); // standard group id -> enabled
  const [customDilutions, setCustomDilutions] = useState<Record<string, number>>({}); // standard group id -> dilution factor
  
  // Sample manual overrides
  const [excludedInjections, setExcludedInjections] = useState<Record<string, boolean[]>>({}); // group id -> boolean array of excluded injections
  const [rejectedSamples, setRejectedSamples] = useState<Record<string, boolean>>({}); // group id -> rejected boolean
  
  // Visualization options
  const [selectedStation, setSelectedStation] = useState<string>('');
  const [docMin, setDocMin] = useState<number>(40);
  const [docMax, setDocMax] = useState<number>(80);
  const [contourStep, setContourStep] = useState<number>(5);
  const [idwPower, setIdwPower] = useState<number>(2);
  const [sampleSortOrder, setSampleSortOrder] = useState<'import' | 'category' | 'name' | 'concentration'>('category');
  const [selectedCurveId, setSelectedCurveId] = useState<string>('');
  const [emptyInjectionThreshold, setEmptyInjectionThreshold] = useState<number>(0.1);

  // ODV-style and Background Map states
  const [contourXAxis, setContourXAxis] = useState<'station' | 'longitude' | 'latitude'>('station');
  const [minDepthFilter, setMinDepthFilter] = useState<number>(0);
  const [maxDepthFilter, setMaxDepthFilter] = useState<number>(6000);
  const [minXFilter, setMinXFilter] = useState<number>(-180);
  const [maxXFilter, setMaxXFilter] = useState<number>(180);
  const [showBackgroundMap, setShowBackgroundMap] = useState<boolean>(false);




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

  const processRawFiles = async (fileList: File[]) => {
    const newFiles: { name: string; size: number }[] = [];
    let accumulatedInjections: RawInjection[] = [...rawInjections];
    let detectedConc: number | null = null;

    for (const file of fileList) {
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
        const coords = parseStationCoordinates(buffer);
        if (coords.length > 0) {
          newCoords = [...newCoords, ...coords];
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

  const clearAllData = () => {
    setFiles([]);
    setRawInjections([]);
    setStationCoords([]);
    setEnabledStds({});
    setCustomDilutions({});
    setExcludedInjections({});
    setRejectedSamples({});
    setSelectedStation('');
    setCurrentStep(1);
  };

  // Group raw injections into Sample Groups
  const sampleGroups = useMemo(() => {
    if (rawInjections.length === 0) return [];
    
    const groups: {
      sampleName: string;
      sampleId: string;
      fileName: string;
      injections: number[];
    }[] = [];
    
    let currentGroup: {
      sampleName: string;
      sampleId: string;
      fileName: string;
      injections: number[];
    } | null = null;
    
    // Group injections by splitting when we encounter injNo === 1
    for (const inj of rawInjections) {
      if (inj.injNo === 1) {
        if (currentGroup) {
          groups.push(currentGroup);
        }
        currentGroup = {
          sampleName: inj.sampleName,
          sampleId: inj.sampleId,
          fileName: inj.fileName,
          injections: [inj.area]
        };
      } else {
        if (currentGroup) {
          currentGroup.injections.push(inj.area);
        }
      }
    }
    if (currentGroup) {
      groups.push(currentGroup);
    }

    // Finalize groups: calculate average, standard deviation, classifications
    return groups.map((g, idx) => {
      const id = `${g.fileName}::${g.sampleName}::${g.sampleId}::${idx}`;
      
      const isStd = g.sampleName.toLowerCase().includes('std');
      const isBlank = g.sampleName.toLowerCase().includes('blank') || g.sampleName.toLowerCase().includes('mq');
      const isSeawater = g.sampleName.toLowerCase() === 'dsw' || g.sampleName.toLowerCase() === 'ssw' || g.sampleName.toLowerCase().startsWith('sw');
      
      // Try matching via Excel sample info (Label ID matching sampleName)
      const normName = normalizeStationName(g.sampleName);
      const excelMatch = stationCoords.find(c => normalizeStationName(c.labelId) === normName);
      
      let station: string | null = null;
      let depth: number | null = null;
      
      if (excelMatch) {
        station = excelMatch.station;
        depth = excelMatch.depth;
      } else {
        // Fallback to pattern parsing from sampleName
        const stDepthMatch = g.sampleName.match(/ST(\d+)-(\d+)/i);
        if (stDepthMatch) {
          station = `ST${stDepthMatch[1]}`;
          depth = parseInt(stDepthMatch[2], 10);
        } else {
          const parts = g.sampleName.split('-');
          const stPart = parts.find(p => p.toUpperCase().startsWith('ST'));
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
      } else {
        // Automatic empty injection exclusion (data cleaning) + 3-out-of-4 outlier exclusion
        const isEmpty = g.injections.map(area => area < emptyInjectionThreshold);
        const nonEmptyIndices = g.injections.map((_, i) => i).filter(i => !isEmpty[i]);
        const nonEmptyVals = nonEmptyIndices.map(i => g.injections[i]);

        if (nonEmptyVals.length === 0) {
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

      return {
        id,
        fileName: g.fileName,
        sampleName: g.sampleName,
        sampleId: g.sampleId,
        injections: g.injections,
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
  }, [rawInjections, excludedInjections, emptyInjectionThreshold, stationCoords]);

  // Set default station
  useEffect(() => {
    if (!selectedStation) {
      const stations = Array.from(new Set(sampleGroups.map(g => g.station).filter(Boolean))) as string[];
      if (stations.length > 0) {
        stations.sort((a, b) => {
          const numA = parseInt(a.replace(/\D/g, ''), 10);
          const numB = parseInt(b.replace(/\D/g, ''), 10);
          return numA - numB;
        });
        setSelectedStation(stations[0]);
      }
    }
  }, [sampleGroups, selectedStation]);

  // Identify standard curve blocks and fit curves
  const calibrationCurves = useMemo(() => {
    const curves: {
      id: string;
      index: number;
      name: string;
      fileName: string;
      standards: any[];
      slope: number;
      intercept: number;
      rsq: number;
    }[] = [];
    
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
          
          const curveId = `curve_${curves.length}`;
          curves.push({
            id: curveId,
            index: curves.length,
            name: `工作曲线 ${curves.length + 1} (${group.fileName.split('.')[0]})`,
            fileName: group.fileName,
            standards: currentCurveStds,
            slope: 1,
            intercept: 0,
            rsq: 0
          });
        } else {
          currentCurveStds.push(group);
          curves[curves.length - 1].standards = currentCurveStds;
        }
      } else {
        // If it's a regular sample or seawater (not blank/MQ), we set the flag
        if (!group.isBlank && !group.isStd) {
          hadSamplesSinceLastStd = true;
        }
      }
    });
    
    // Fit each curve
    return curves.map(curve => {
      const activePoints: { x: number; y: number }[] = [];
      
      const detailedStandards = curve.standards.map((std, index) => {
        let matchedUsedC = stdUsedC;
        const cMatch = std.sampleName.match(/std\((\d+\.?\d*)uM/i);
        if (cMatch) {
          matchedUsedC = parseFloat(cMatch[1]);
        }
        
        const defaultDilution = dilutionFactors[index] || 3; 
        const currentDilution = customDilutions[std.id] !== undefined ? customDilutions[std.id] : defaultDilution;
        const theoreticalC = matchedUsedC / currentDilution;
        const isEnabled = enabledStds[std.id] !== undefined ? enabledStds[std.id] : (index < dilutionFactors.length);
        
        if (isEnabled) {
          activePoints.push({ x: theoreticalC, y: std.avArea });
        }
        
        return {
          id: std.id,
          index,
          sampleName: std.sampleName,
          avArea: std.avArea,
          dilution: currentDilution,
          theoreticalC,
          enabled: isEnabled,
          group: std
        };
      });
      
      const fit = fitCalibrationCurve(activePoints);
      
      return {
        ...curve,
        standards: detailedStandards,
        slope: fit.slope,
        intercept: fit.intercept,
        rsq: fit.rsq
      };
    });
  }, [sampleGroups, stdUsedC, dilutionFactors, customDilutions, enabledStds]);

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
    
    let lastCurveId = calibrationCurves[0].id;
    
    sampleGroups.forEach((g) => {
      const matchingCurve = calibrationCurves.find(c => c.standards.some(s => s.id === g.id));
      if (matchingCurve) {
        lastCurveId = matchingCurve.id;
      }
      map[g.id] = lastCurveId;
    });
    
    return map;
  }, [sampleGroups, calibrationCurves]);

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
      
      const concentration = (g.avArea - intercept) / slope;
      const error = g.sdArea / slope;
      
      // Match station coordinates
      const normStation = normalizeStationName(g.station);
      const coordMatch = stationCoords.find(c => normalizeStationName(c.station) === normStation);
      
      return {
        ...g,
        concentration,
        error,
        isRejected,
        curveId,
        curveName: curve ? curve.name : '默认曲线',
        longitude: coordMatch?.longitude,
        latitude: coordMatch?.latitude,
        botDepth: coordMatch?.botDepth
      };
    });
  }, [sampleGroups, calibrationCurves, sampleToCurveMap, rejectedSamples, stationCoords]);

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

  useEffect(() => {
    setMinDepthFilter(dataBounds.minDepth);
    setMaxDepthFilter(dataBounds.maxDepth);
  }, [dataBounds.minDepth, dataBounds.maxDepth]);

  useEffect(() => {
    if (contourXAxis === 'longitude') {
      setMinXFilter(dataBounds.minLon);
      setMaxXFilter(dataBounds.maxLon);
    } else if (contourXAxis === 'latitude') {
      setMinXFilter(dataBounds.minLat);
      setMaxXFilter(dataBounds.maxLat);
    } else {
      setMinXFilter(0);
      const count = stationsList.length;
      setMaxXFilter(count > 1 ? count - 1 : 1);
    }
  }, [contourXAxis, dataBounds.minLon, dataBounds.maxLon, dataBounds.minLat, dataBounds.maxLat, stationsList.length]);

  // Unique coordinate mapping for station scatter maps (1D and 2D)
  const uniqueStationCoords = useMemo(() => {
    const uniqueMap: Record<string, { station: string; longitude: number; latitude: number }> = {};
    stationCoords.forEach(c => {
      const key = normalizeStationName(c.station);
      if (key && !uniqueMap[key]) {
        uniqueMap[key] = { station: c.station, longitude: c.longitude, latitude: c.latitude };
      }
    });
    return Object.values(uniqueMap) as { station: string; longitude: number; latitude: number }[];
  }, [stationCoords]);

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

  // Excel template export generator
  const exportToExcel = () => {
    const wb = xlsx.utils.book_new();
    
    // 1. Final Data Sheet
    const finalDataRows: any[][] = [
      ["DOC 分析报告"],
      ["生成时间", new Date().toLocaleString()],
      [],
      ["检测到的工作曲线列表"],
      ["工作曲线名称", "所属文件", "斜率 (Slope)", "截距 (Intercept)", "判定系数 (R²)"]
    ];

    calibrationCurves.forEach(c => {
      finalDataRows.push([
        c.name,
        c.fileName,
        parseFloat(c.slope.toFixed(6)),
        parseFloat(c.intercept.toFixed(6)),
        parseFloat(c.rsq.toFixed(6))
      ]);
    });

    finalDataRows.push(
      [],
      ["样品分析结果"],
      ["样品名称", "站位", "深度 (m)", "使用工作曲线", "Area1", "Area2", "Area3", "Area4", "平均面积", "面积SD", "面积RSD (%)", "DOC 浓度 (µmol/L)", "误差 (µmol/L)", "状态"]
    );

    sortedProcessedSamples.forEach(s => {
      const row = [
        s.sampleName,
        s.station || "-",
        s.depth !== null ? s.depth : "-",
        s.curveName,
        s.injections[0] !== undefined ? s.injections[0] : "",
        s.injections[1] !== undefined ? s.injections[1] : "",
        s.injections[2] !== undefined ? s.injections[2] : "",
        s.injections[3] !== undefined ? s.injections[3] : "",
        parseFloat(s.avArea.toFixed(4)),
        parseFloat(s.sdArea.toFixed(4)),
        parseFloat(s.rsd.toFixed(2)),
        parseFloat(s.concentration.toFixed(2)),
        parseFloat(s.error.toFixed(2)),
        s.isRejected ? "已废弃" : s.rsd > 2 ? "RSD超标" : "合格"
      ];
      finalDataRows.push(row);
    });

    const wsFinal = xlsx.utils.aoa_to_sheet(finalDataRows);
    xlsx.utils.book_append_sheet(wb, wsFinal, "DOC_Final_Data");
    
    // 2. Raw Injections Sheet
    const rawInjectionsRows: (string | number)[][] = [
      ["文件名", "样品名称", "样品ID", "注射次数", "分析类型", "峰面积"]
    ];
    rawInjections.forEach(inj => {
      rawInjectionsRows.push([
        inj.fileName,
        inj.sampleName,
        inj.sampleId,
        inj.injNo,
        inj.type,
        inj.area
      ]);
    });
    const wsRaw = xlsx.utils.aoa_to_sheet(rawInjectionsRows);
    xlsx.utils.book_append_sheet(wb, wsRaw, "Raw_Injections");

    // Download file
    const fileBase = files.length > 0 ? files[0].name.split('.')[0] : 'doc_data';
    xlsx.writeFile(wb, `${fileBase}_processed.xlsx`);
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

  // Toggle sample rejection
  const handleToggleRejection = (groupId: string) => {
    setRejectedSamples(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  const chart1dContainerRef = useRef<HTMLDivElement>(null);

  const download1DPlot = () => {
    const container = chart1dContainerRef.current;
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;
    
    const scale = 3; // 3x high-definition scale
    const svgWidth = svg.clientWidth || svg.width.baseVal.value || 500;
    const svgHeight = svg.clientHeight || svg.height.baseVal.value || 400;
    
    const combinedCanvas = document.createElement('canvas');
    combinedCanvas.width = svgWidth * scale;
    combinedCanvas.height = svgHeight * scale;
    const ctx = combinedCanvas.getContext('2d');
    if (!ctx) return;
    
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, svgWidth, svgHeight);
    
    // Clone SVG and set explicit viewBox and dimensions
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
      
      const link = document.createElement('a');
      link.download = `${selectedStation || 'ST'}_1D_Profile.png`;
      link.href = combinedCanvas.toDataURL('image/png');
      link.click();
    };
    img.src = url;
  };

  const download2DPlot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const svg = canvas.nextElementSibling as SVGSVGElement | null;
    if (!svg) return;
    
    const scale = 3; // 3x high-definition scale
    const combinedCanvas = document.createElement('canvas');
    combinedCanvas.width = 620 * scale;
    combinedCanvas.height = 450 * scale;
    const ctx = combinedCanvas.getContext('2d');
    if (!ctx) return;
    
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 620, 450);
    ctx.drawImage(canvas, 50, 30, 500, 380);
    
    // Clone SVG and set explicit viewBox and dimensions
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('width', '620');
    clone.setAttribute('height', '450');
    if (!clone.getAttribute('viewBox')) {
      clone.setAttribute('viewBox', '0 0 620 450');
    }
    
    const svgString = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      
      const link = document.createElement('a');
      link.download = `${selectedStation || 'DOC'}_2D_Contour.png`;
      link.href = combinedCanvas.toDataURL('image/png');
      link.click();
    };
    img.src = url;
  };

  // 2D Contour Plot Calculations & Drawing
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [contourSvgPaths, setContourSvgPaths] = useState<{ path: string; value: number }[]>([]);
  const [interpolatedPoints, setInterpolatedPoints] = useState<{x: number, y: number, name: string}[]>([]);
  const [contourDataPoints, setContourDataPoints] = useState<{ cx: number; cy: number; conc: number }[]>([]);
  const [topStationTicks, setTopStationTicks] = useState<{ name: string; cx: number }[]>([]);
  const [bathyPath, setBathyPath] = useState<string>('');

  // Redraw contour plot on dependency changes
  useEffect(() => {
    if (currentStep !== 4 || visSubTab !== 'contour2d' || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Filter out standard/blank/QC samples and non-rejected samples
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

    // Get unique stations sorted alphabetically/numerically
    const uniqueStations = [...new Set(validSamples.map(s => s.station))].sort((a, b) => {
      const numA = parseInt(a!.replace(/\D/g, ''), 10);
      const numB = parseInt(b!.replace(/\D/g, ''), 10);
      if (isNaN(numA) || isNaN(numB)) {
        return a!.localeCompare(b!);
      }
      return numA - numB;
    });

    const getXValue = (s: typeof validSamples[0]) => {
      if (contourXAxis === 'longitude') return s.longitude || 0;
      if (contourXAxis === 'latitude') return s.latitude || 0;
      return uniqueStations.indexOf(s.station!);
    };

    // Apply active range filters
    const filteredSamples = validSamples.filter(s => {
      const xVal = getXValue(s);
      return (
        s.depth! >= minDepthFilter &&
        s.depth! <= maxDepthFilter &&
        xVal >= minXFilter &&
        xVal <= maxXFilter
      );
    });

    if (filteredSamples.length === 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setContourSvgPaths([]);
      setContourDataPoints([]);
      setInterpolatedPoints([]);
      return;
    }

    // Get min/max boundaries of the active section
    const minX = minXFilter;
    const maxX = maxXFilter;
    const minY = minDepthFilter;
    const maxY = maxDepthFilter;
    const xSpan = maxX - minX || 1;
    const ySpan = maxY - minY || 1;

    // Map samples to coordinate systems for interpolation (normalized to [0, 1])
    const dataPoints = filteredSamples.map(s => ({
      x: (getXValue(s) - minX) / xSpan,
      y: (s.depth! - minY) / ySpan,
      z: s.concentration
    }));

    // IDW Grid dimensions
    const gridWidth = 100;
    const gridHeight = 100;
    const gridValues = new Float32Array(gridWidth * gridHeight);

    // Compute grid values using Inverse Distance Weighting (IDW)
    for (let r = 0; r < gridHeight; r++) {
      const gridYNorm = r / (gridHeight - 1);
      for (let c = 0; c < gridWidth; c++) {
        const gridXNorm = c / (gridWidth - 1);
        gridValues[r * gridWidth + c] = interpolateIDW(dataPoints, gridXNorm, gridYNorm, idwPower);
      }
    }

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Render contour colormap on the 2D Canvas
    const imgData = ctx.createImageData(canvasWidth, canvasHeight);
    const colorScale = scaleLinear<string>()
      .domain([docMin, docMin + (docMax - docMin) * 0.25, docMin + (docMax - docMin) * 0.5, docMin + (docMax - docMin) * 0.75, docMax])
      .range(['#1e3a8a', '#0284c7', '#10b981', '#f59e0b', '#ef4444']) 
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
        
        // Bilinear interpolation for ultra-smooth rendering
        const val = v00 * (1 - tx) * (1 - ty) + 
                    v10 * tx * (1 - ty) + 
                    v01 * (1 - tx) * ty + 
                    v11 * tx * ty;
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
        
        const pixelIdx = (cy * canvasWidth + cx) * 4;
        imgData.data[pixelIdx] = rVal;
        imgData.data[pixelIdx + 1] = gVal;
        imgData.data[pixelIdx + 2] = bVal;
        imgData.data[pixelIdx + 3] = 230; 
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // SVG Contour lines generation
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

    // Calculate canvas coordinates of actual measurement points for the ODV dots overlay
    const sampleDots = filteredSamples.map(s => {
      const xVal = getXValue(s);
      const cx = ((xVal - minX) / xSpan) * canvasWidth;
      const cy = ((s.depth! - minY) / ySpan) * canvasHeight;
      return { cx, cy, conc: s.concentration };
    });
    setContourDataPoints(sampleDots);

    // Define X-Axis Ticks & Labels
    const ticksCount = 5;
    const labelsList = [];
    if (contourXAxis === 'station') {
      // Space station names across the section
      const step = Math.max(1, Math.floor(uniqueStations.length / ticksCount));
      for (let i = 0; i < uniqueStations.length; i += step) {
        labelsList.push({
          x: (i / (uniqueStations.length - 1 || 1)) * canvasWidth,
          y: 0,
          name: uniqueStations[i]!
        });
      }
    } else {
      // Space longitude or latitude coordinates across the section
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

    // Calculate bathymetry path
    const bathyPoints = uniqueStations.map(st => {
      const stSamples = validSamples.filter(s => s.station === st);
      // Try to find bottom depth from stationCoords, fallback to maximum sample depth
      const normSt = normalizeStationName(st);
      const stCoords = stationCoords.filter(c => normalizeStationName(c.station) === normSt);
      const botDepthVal = stCoords.find(c => c.botDepth !== undefined)?.botDepth 
        || Math.max(...stSamples.map(s => s.depth || 0), 100);

      let xVal = 0;
      if (contourXAxis === 'longitude') {
        xVal = stSamples[0]?.longitude || 0;
      } else if (contourXAxis === 'latitude') {
        xVal = stSamples[0]?.latitude || 0;
      } else {
        xVal = uniqueStations.indexOf(st);
      }
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

    // Calculate top station ticks
    const ticks = uniqueStations.map(st => {
      const stSamples = validSamples.filter(s => s.station === st);
      let xVal = 0;
      if (contourXAxis === 'longitude') {
        xVal = stSamples[0]?.longitude || 0;
      } else if (contourXAxis === 'latitude') {
        xVal = stSamples[0]?.latitude || 0;
      } else {
        xVal = uniqueStations.indexOf(st);
      }
      const cx = ((xVal - minX) / xSpan) * canvasWidth;
      return { name: st || '', cx };
    });
    setTopStationTicks(ticks);
  }, [currentStep, visSubTab, processedSamples, docMin, docMax, contourStep, idwPower, contourXAxis, minDepthFilter, maxDepthFilter, minXFilter, maxXFilter]);

  // Stepper helper info
  const stepLabelMap = [
    "1. 导入数据",
    "2. 工作曲线拟合",
    "3. 数据审核 & QC",
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
            style={{ width: `${((currentStep - 1) / (stepLabelMap.length - 1)) * 100 - 8}%` }}
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
                    const uniqueStsCount = isCoordinateFile ? new Set(stationCoords.map(c => c.station)).size : 0;
                    return (
                      <div className="file-item" key={i}>
                        <div className="file-info">
                          <FileText size={16} className={isCoordinateFile ? "text-emerald-500" : "text-sky-500"} />
                          <span>{file.name}</span>
                          <span className="text-xs text-slate-400">({(file.size / 1024).toFixed(1)} KB)</span>
                        </div>
                        <span className={`badge ${isCoordinateFile ? 'badge-success' : 'badge-info'}`}>
                          {isCoordinateFile 
                            ? `已解析 ${uniqueStsCount} 个站位 (${stationCoords.length} 行样品经纬度)` 
                            : `已解析 ${rawInjections.filter(inj => inj.fileName === file.name).length} 行数据`
                          }
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

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

                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                    <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      标准工作曲线 6个梯度稀释点 配置
                    </h4>
                    <div className="grid-3" style={{ gap: '12px' }}>
                      {dilutionFactors.map((factor, index) => {
                        const calculatedC = stdUsedC / factor;
                        return (
                          <div key={index} className="input-group" style={{ marginBottom: 0, padding: '10px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                              梯度点 {index + 1}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>稀释倍数:</span>
                              <input 
                                type="number" 
                                className="input-field"
                                style={{ padding: '4px 8px', fontSize: '13px', flex: 1, minWidth: 0 }}
                                value={factor} 
                                onChange={e => {
                                  const val = parseFloat(e.target.value) || 0;
                                  const newFactors = [...dilutionFactors];
                                  newFactors[index] = val;
                                  setDilutionFactors(newFactors);
                                }}
                                step="any"
                              />
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--primary)', marginTop: '6px', fontWeight: 600 }}>
                              理论浓度: {isNaN(calculatedC) || !isFinite(calculatedC) ? '0.00' : calculatedC.toFixed(2)} µmol/L
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

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
            
            {calibrationCurves.length > 1 && (
              <div className="card mb-4" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', flexDirection: 'row' }}>
                <span className="text-sm font-bold text-slate-700">检测到多条工作曲线，请选择要查看/配置的曲线：</span>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {calibrationCurves.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedCurveId(c.id)}
                      className={`btn ${selectedCurveId === c.id ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '6px 12px', fontSize: '13px', fontWeight: '600' }}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid-1-2">
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
                        <td className="font-semibold">{std.sampleName}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            {std.group.injections.map((area: number, i: number) => {
                              const isEmpty = area < emptyInjectionThreshold;
                              return (
                                <span 
                                  key={i} 
                                  className={`badge ${std.group.selectedInjections[i] ? 'badge-info' : isEmpty ? 'badge-danger' : 'cell-excluded badge-secondary'}`}
                                  onClick={() => handleToggleInjection(std.id, i)}
                                  style={{ cursor: 'pointer' }}
                                  title={isEmpty ? "检测到疑似扎空（已自动排除）" : "点击手动强制包含/排除本次注射"}
                                >
                                  {area.toFixed(4)}{isEmpty ? " (空)" : ""}
                                </span>
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
                                if (std.index !== undefined && std.index < dilutionFactors.length) {
                                  const newFactors = [...dilutionFactors];
                                  newFactors[std.index] = val;
                                  setDilutionFactors(newFactors);
                                }
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
          <div>
            <div className="page-header">
              <div>
                <h1 className="page-title">数据审核与质控 (QC)</h1>
                <p className="page-subtitle">第三步：检查样品测量精密度，验证 SSW/DSW 参标，手动剔除野点或异常注射值</p>
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
                  <span className="text-[10px] text-slate-400 font-normal">(历史值 41-45 µmol/L)</span>
                </span>
                <span className={`text-2xl font-bold font-display ${
                  blanksAndSeawaters.avgDswConc >= 41 && blanksAndSeawaters.avgDswConc <= 45
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
                  <span className="text-[10px] text-slate-400 font-normal">(历史值 70-80 µmol/L)</span>
                </span>
                <span className={`text-2xl font-bold font-display ${
                  blanksAndSeawaters.avgSswConc >= 70 && blanksAndSeawaters.avgSswConc <= 80
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

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                <h3 className="card-title" style={{ margin: 0 }}>样品浓度数据列表</h3>
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
              <div className="table-container">
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th style={{ width: '50px' }}>使用</th>
                      <th>样品名称</th>
                      <th>站位</th>
                      <th>深度 (m)</th>
                      <th>使用工作曲线</th>
                      <th>每次注射面积 (点击剔除)</th>
                      <th>平均面积</th>
                      <th>面积SD</th>
                      <th>面积RSD (%)</th>
                      <th>DOC 浓度 (µmol/L)</th>
                      <th>误差 (µmol/L)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProcessedSamples.map((s) => {
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
                          <td className="font-semibold">{s.sampleName}</td>
                          <td>{s.station || "-"}</td>
                          <td>{s.depth !== null ? `${s.depth} m` : "-"}</td>
                          <td style={{ fontSize: '12px', color: '#64748b', fontWeight: '500' }}>{s.curveName}</td>
                          <td>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              {s.injections.map((area, i) => {
                                const isEmpty = area < emptyInjectionThreshold;
                                return (
                                  <span 
                                    key={i} 
                                    className={`badge ${s.selectedInjections[i] ? 'badge-info' : isEmpty ? 'badge-danger' : 'cell-excluded badge-secondary'}`}
                                    onClick={() => handleToggleInjection(s.id, i)}
                                    style={{ cursor: 'pointer' }}
                                    title={isEmpty ? "检测到疑似扎空（已自动排除）" : "点击包含/排除单次测量"}
                                  >
                                    {area.toFixed(4)}{isEmpty ? " (空)" : ""}
                                  </span>
                                );
                              })}
                            </div>
                          </td>
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
                          <td className="font-semibold text-sky-700">{s.concentration.toFixed(2)}</td>
                          <td className="text-xs text-slate-500">± {s.error.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Visualizations */}
        {currentStep === 4 && (
          <div>
            <div className="page-header">
              <div>
                <h1 className="page-title">数据图表绘制</h1>
                <p className="page-subtitle">第四步：在 1D 剖面折线图与 2D 断面彩色等值线图之间进行切换，深度进行反转展现</p>
              </div>
            </div>

            {/* Sub-tab selection for 1D vs 2D */}
            <div className="tab-group">
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

            {/* Sub-tab: 1D Profile */}
            {visSubTab === 'profile1d' && (
              <div className="grid-1-2">
                <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <h3 className="card-title" style={{ margin: '0 0 4px 0' }}>站位地理分布图 (二维散点图)</h3>
                    <p className="text-xs text-slate-400">点击地图中的测站标记或使用下方下拉框切换右侧深度剖面图</p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div className="input-group" style={{ marginBottom: 0 }}>
                      <label className="input-label" style={{ fontSize: '12px' }}>选择目标站位</label>
                      <select 
                        className="input-field font-semibold text-sm"
                        value={selectedStation}
                        onChange={e => setSelectedStation(e.target.value)}
                      >
                        {stationsList.map(st => (
                          <option key={st} value={st}>{st}</option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input 
                        type="checkbox" 
                        id="showBackgroundMap1d"
                        checked={showBackgroundMap} 
                        onChange={e => setShowBackgroundMap(e.target.checked)} 
                        style={{ cursor: 'pointer' }}
                      />
                      <label htmlFor="showBackgroundMap1d" style={{ fontSize: '12px', color: 'var(--text-secondary)', cursor: 'pointer', margin: 0 }}>
                        显示背景地图
                      </label>
                    </div>
                  </div>

                  {stationCoords.length === 0 ? (
                    <div style={{ padding: '20px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border-color)', textAlign: 'center' }}>
                      <AlertTriangle size={24} className="text-amber-500 mx-auto mb-2" style={{ margin: '0 auto 8px' }} />
                      <p className="text-xs text-slate-500 font-semibold" style={{ margin: 0 }}>未检测到站位经纬度数据</p>
                      <p className="text-[11px] text-slate-400 mt-1" style={{ margin: '4px 0 0' }}>您可以在第一步导入样品经纬度清单（Excel/CSV）以激活此地图联动。</p>
                    </div>
                  ) : (
                    <div style={{ width: '100%', height: '220px', position: 'relative' }}>
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

                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h3 className="card-title" style={{ margin: 0 }}>{selectedStation} 站位 DOC 垂直剖面图 (Depth Profile)</h3>
                    <button 
                      className="btn btn-secondary" 
                      style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                      onClick={download1DPlot}
                    >
                      <Download size={14} />
                      <span>保存图片</span>
                    </button>
                  </div>
                  
                  <div ref={chart1dContainerRef} style={{ width: '100%', height: '400px' }}>
                    {chart1dData.length === 0 ? (
                      <div style={{ height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#94a3b8' }}>
                        该站位没有可绘制的深度数据点
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
                          <defs>
                            <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#0ea5e9" />
                              <stop offset="100%" stopColor="#2563eb" />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={true} horizontal={true} />
                          <XAxis 
                            type="number" 
                            dataKey="concentration" 
                            name="DOC 浓度" 
                            unit=" µmol/L" 
                            stroke="#475569" 
                            fontSize={11}
                            fontWeight="600"
                            domain={['dataMin - 5', 'dataMax + 5']}
                            orientation="top"
                            axisLine={{ stroke: '#cbd5e1' }}
                            tickLine={{ stroke: '#cbd5e1' }}
                          />
                          <YAxis 
                            type="number" 
                            dataKey="depth" 
                            name="深度" 
                            unit=" m" 
                            stroke="#475569" 
                            fontSize={11}
                            fontWeight="600"
                            reversed
                            domain={[0, 'dataMax + 100']}
                            axisLine={{ stroke: '#cbd5e1' }}
                            tickLine={{ stroke: '#cbd5e1' }}
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
                              if (name === "DOC 浓度") return [`${value} µmol/L`, "DOC 浓度"];
                              if (name === "深度") return [`${value} m`, "测量深度"];
                              return [value, name];
                            }}
                          />
                          <Scatter 
                            name="DOC 测定值" 
                            data={chart1dData} 
                            fill="url(#lineGrad)" 
                            line={{ stroke: '#2563eb', strokeWidth: 2 }}
                            shape={(props: any) => {
                              const { cx, cy } = props;
                              return (
                                <circle 
                                  cx={cx} 
                                  cy={cy} 
                                  r={5} 
                                  fill="#2563eb" 
                                  stroke="#ffffff" 
                                  strokeWidth={1.5}
                                  style={{ filter: 'drop-shadow(0px 2px 4px rgba(37, 99, 235, 0.3))' }}
                                />
                              );
                            }}
                          >
                            <ErrorBar 
                              dataKey="error" 
                              direction="x" 
                              stroke="#94a3b8" 
                              strokeWidth={1} 
                              width={4} 
                            />
                          </Scatter>
                        </ScatterChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Sub-tab: 2D Contour */}
            {visSubTab === 'contour2d' && (
              <div className="grid-1-2">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Top-Left Station scatter map on 2D tab */}
                  {stationCoords.length > 0 && (
                    <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <h4 className="font-semibold text-sm text-slate-700" style={{ margin: 0 }}>站位地理分布图 (二维散点图)</h4>
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
                    <h3 className="card-title">绘图渲染选项</h3>
                    
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
                      <label className="input-label">等值线步长 (µmol / L)</label>
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

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: '8px 0' }}>
                      <input 
                        type="checkbox" 
                        id="showBackgroundMap2d"
                        checked={showBackgroundMap} 
                        onChange={e => setShowBackgroundMap(e.target.checked)} 
                        style={{ cursor: 'pointer' }}
                      />
                      <label htmlFor="showBackgroundMap2d" style={{ fontSize: '12px', color: 'var(--text-secondary)', cursor: 'pointer', margin: 0 }}>
                        显示背景地图
                      </label>
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

                      <div className="grid-2" style={{ gap: '8px' }}>
                        <div className="input-group" style={{ marginBottom: 0 }}>
                          <label className="input-label" style={{ fontSize: '11px' }}>
                            {contourXAxis === 'station' ? '最小站位索引' : contourXAxis === 'longitude' ? '最小经度 (°)' : '最小纬度 (°)'}
                          </label>
                          <input 
                            type="number" 
                            className="input-field" 
                            style={{ padding: '6px' }}
                            value={minXFilter} 
                            onChange={e => setMinXFilter(parseFloat(e.target.value) || 0)}
                          />
                        </div>
                        <div className="input-group" style={{ marginBottom: 0 }}>
                          <label className="input-label" style={{ fontSize: '11px' }}>
                            {contourXAxis === 'station' ? '最大站位索引' : contourXAxis === 'longitude' ? '最大经度 (°)' : '最大纬度 (°)'}
                          </label>
                          <input 
                            type="number" 
                            className="input-field" 
                            style={{ padding: '6px' }}
                            value={maxXFilter} 
                            onChange={e => setMaxXFilter(parseFloat(e.target.value) || 0)}
                          />
                        </div>
                      </div>
                    </div>


                    <div style={{ marginTop: '24px' }}>
                      <div className="legend-bar"></div>
                      <div className="legend-labels">
                        <span>{docMin} µmol/L</span>
                        <span>{(docMin + (docMax - docMin)/2).toFixed(0)}</span>
                        <span>{docMax} µmol/L</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card" style={{ display: 'flex', flexDirection: 'column', minWidth: '660px', overflowX: 'auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', width: '100%' }}>
                    <h3 className="card-title" style={{ margin: 0 }}>DOC 空间断面等值线分布图</h3>
                    <button 
                      className="btn btn-secondary" 
                      style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                      onClick={download2DPlot}
                    >
                      <Download size={14} />
                      <span>保存图片</span>
                    </button>
                  </div>
                  
                  {/* ODV styled window container */}
                  <div style={{ position: 'relative', width: '620px', height: '450px', backgroundColor: '#ffffff', userSelect: 'none', marginTop: '10px' }}>
                    
                    {/* Main Canvas Plot (starting at left 50px, top 30px) */}
                    <canvas 
                      ref={canvasRef} 
                      width={500} 
                      height={380} 
                      style={{ position: 'absolute', top: '30px', left: '50px', width: '500px', height: '380px', zIndex: 1, border: '1px solid #000000' }}
                    />
                    
                    {/* SVG overlay (starts at 0, 0 and covers the labels area too) */}
                    <svg 
                      width={620} 
                      height={450} 
                      style={{ position: 'absolute', top: 0, left: 0, width: '620px', height: '450px', zIndex: 2, pointerEvents: 'none' }}
                    >
                      {/* Clipping path definition to keep contours within the black border */}
                      <defs>
                        <clipPath id="plot-area-clip">
                          <rect x={50} y={30} width={500} height={380} />
                        </clipPath>
                        <linearGradient id="bathyGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#1e293b" stopOpacity="0.85" />
                          <stop offset="100%" stopColor="#0b0f19" stopOpacity="0.95" />
                        </linearGradient>
                      </defs>

                      {/* Contour lines (clipped to canvas box) */}
                      <g clipPath="url(#plot-area-clip)">
                        {contourSvgPaths.map((p: { path: string; value: number }, i: number) => {
                          return (
                            <path 
                              key={i} 
                              d={p.path} 
                              transform="translate(50, 30)"
                              fill="none" 
                              stroke="rgba(255, 255, 255, 0.45)" 
                              strokeWidth="1.5" 
                            />
                          );
                        })}

                        {/* Bathymetry Sea Floor Silhouette Masking */}
                        {bathyPath && (
                          <path
                            d={bathyPath}
                            transform="translate(50, 30)"
                            fill="url(#bathyGrad)"
                            stroke="#0ea5e9"
                            strokeWidth="2.5"
                          />
                        )}

                        {/* Black dots overlay representing measurement depth/locations */}
                        {contourDataPoints.map((pt, i) => (
                          <circle 
                            key={i} 
                            cx={pt.cx + 50} 
                            cy={pt.cy + 30} 
                            r={4} 
                            fill="#000000" 
                            stroke="#ffffff" 
                            strokeWidth={0.75}
                          >
                            <title>浓度: {pt.conc.toFixed(2)} µmol/L</title>
                          </circle>
                        ))}
                      </g>

                      {/* ODV Border Outline */}
                      <rect x={50} y={30} width={500} height={380} fill="none" stroke="#000000" strokeWidth="1" />

                      {/* Left Y-Axis Ticks & Labels (Depth [m]) */}
                      <text x={15} y={220} fill="#1e293b" fontSize={11} fontWeight="bold" textAnchor="middle" transform="rotate(-90 15 220)">
                        Depth [m]
                      </text>
                      {[0.0, 0.25, 0.5, 0.75, 1.0].map((r, i) => {
                        const depthVal = (minDepthFilter + (maxDepthFilter - minDepthFilter) * r).toFixed(0);
                        const yPos = 30 + 380 * r;
                        return (
                          <g key={i}>
                            <line x1={45} y1={yPos} x2={50} y2={yPos} stroke="#000000" strokeWidth="1" />
                            <text x={40} y={yPos + 4} fill="#1e293b" fontSize={10} fontWeight="600" textAnchor="end">
                              {depthVal}
                            </text>
                          </g>
                        );
                      })}

                      {/* Bottom X-Axis Ticks & Labels (Longitude / Latitude / Station index) */}
                      <text x={300} y={442} fill="#1e293b" fontSize={11} fontWeight="bold" textAnchor="middle">
                        {contourXAxis === 'station' ? 'Station Index' : contourXAxis === 'longitude' ? 'Longitude [°E]' : 'Latitude [°N]'}
                      </text>
                      {interpolatedPoints.map((pt: { x: number; y: number; name: string }, i: number) => {
                        const xPos = pt.x + 50;
                        return (
                          <g key={i}>
                            <line x1={xPos} y1={410} x2={xPos} y2={415} stroke="#000000" strokeWidth="1" />
                            <text 
                              x={xPos} 
                              y={428} 
                              fill="#1e293b" 
                              fontSize={9} 
                              fontWeight="600" 
                              textAnchor="middle"
                            >
                              {pt.name}
                            </text>
                          </g>
                        );
                      })}

                      {/* Top Axis Ticks & Labels (Station Name Indicators) */}
                      {topStationTicks.map((tick, i) => {
                        const xPos = tick.cx + 50;
                        if (xPos < 50 || xPos > 550) return null;
                        return (
                          <g key={i}>
                            <line x1={xPos} y1={25} x2={xPos} y2={30} stroke="#000000" strokeWidth="1" />
                            <text 
                              x={xPos} 
                              y={18} 
                              fill="#0369a1" 
                              fontSize={9} 
                              fontWeight="bold" 
                              textAnchor="middle"
                            >
                              {tick.name}
                            </text>
                          </g>
                        );
                      })}

                      {/* Colorbar Tick Labels (drawn on the right side of color bar) */}
                      {[0.0, 0.25, 0.5, 0.75, 1.0].map((r, i) => {
                        const val = docMin + (docMax - docMin) * r;
                        const yPos = 410 - 380 * r; // align with gradient bottom-up
                        return (
                          <g key={i}>
                            <line x1={585} y1={yPos} x2={590} y2={yPos} stroke="#000000" strokeWidth="1" />
                            <text x={594} y={yPos + 4} fill="#1e293b" fontSize={9} fontWeight="600" textAnchor="start">
                              {val.toFixed(1)}
                            </text>
                          </g>
                        );
                      })}
                    </svg>

                    {/* Vertical Colorbar Gradient Panel */}
                    <div style={{
                      position: 'absolute',
                      left: '570px',
                      top: '30px',
                      width: '15px',
                      height: '380px',
                      background: 'linear-gradient(to top, #1e3a8a, #0284c7, #10b981, #f59e0b, #ef4444)',
                      border: '1px solid #000000',
                      zIndex: 3
                    }} />

                    {/* Colorbar Title */}
                    <div style={{
                      position: 'absolute',
                      left: '556px',
                      top: '10px',
                      fontSize: '9px',
                      fontWeight: 'bold',
                      color: '#1e293b',
                      zIndex: 3
                    }}>
                      DOC [µmol/L]
                    </div>

                    {/* ODV Mini Inset Map (bottom left) */}
                    {showBackgroundMap && (
                      <div style={{
                        position: 'absolute',
                        left: '60px',
                        top: '290px',
                        width: '110px',
                        height: '110px',
                        backgroundColor: '#ffffff',
                        border: '1.5px solid #000000',
                        boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
                        padding: '3px',
                        zIndex: 10
                      }}>
                        <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
                          <img 
                            src="/station_map.jpg" 
                            alt="station map inset" 
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div style={{ display: 'flex', gap: '20px', marginTop: '16px', fontSize: '12px', color: '#64748b', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <span>※ 横轴表示：{contourXAxis === 'station' ? '测站序号 (按升序)' : contourXAxis === 'longitude' ? '经度' : '纬度'}</span>
                    <span>※ 纵轴表示：海水深度 (米，0米在最顶端反向刻度)</span>
                    <span>● 黑色圆点：实际采样点位置</span>
                    <span>■ 灰色阴影：海底地形 (海床)</span>
                  </div>
                </div>
              </div>
            )}
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

              <button className="btn btn-primary w-full justify-center py-3 text-base" onClick={exportToExcel}>
                <Download size={18} />
                <span>一键下载 Excel 处理报表</span>
              </button>
            </div>
          </div>
        )}

        {/* Wizard Footer Navigation Controls */}
        <div className="wizard-footer">
          <button 
            className="btn btn-secondary"
            onClick={() => currentStep > 1 && setCurrentStep(prev => prev - 1)}
            disabled={currentStep === 1}
          >
            <ChevronLeft size={16} />
            <span>上一步</span>
          </button>
          
          <button 
            className="btn btn-primary"
            onClick={() => currentStep < 5 && setCurrentStep(prev => prev + 1)}
            disabled={
              (currentStep === 1 && files.length === 0) || 
              (currentStep === 2 && !(calibrationCurve.slope > 0)) ||
              currentStep === 5
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
