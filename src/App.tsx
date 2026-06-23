import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Upload, FileText, LineChart, 
  Map, Download, Trash2, CheckCircle, AlertTriangle, 
  Settings, ChevronLeft, ChevronRight, Check
} from 'lucide-react';
import { parseRawTxt } from './utils/parser';
import { selectBestSubset, fitCalibrationCurve, interpolateIDW, calculateMean, calculateStdev } from './utils/calc';
import { RawInjection, SampleGroup, CalibrationCurve } from './types';
import { 
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, 
  CartesianGrid, Tooltip, Legend
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
  
  // Standard curve parameters
  const [stdStockC, setStdStockC] = useState<number>(10000); // standard stock concentration (µmol C / L)
  const [stdDilutionFactor, setStdDilutionFactor] = useState<number>(25.2423); // standard dilution factor
  const [stdUsedC, setStdUsedC] = useState<number>(396.16); // used standard uM C
  const dilutionFactors = [15, 10, 6, 5, 4, 3];

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

  // File Upload Handling
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState<boolean>(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processFiles(Array.from(e.target.files));
    }
  };

  const processFiles = async (fileList: File[]) => {
    const newFiles: { name: string; size: number }[] = [];
    let accumulatedInjections: RawInjection[] = [...rawInjections];
    let detectedConc: number | null = null;

    for (const file of fileList) {
      // Avoid duplicate file uploads
      if (files.some(f => f.name === file.name)) continue;
      
      newFiles.push({ name: file.name, size: file.size });
      
      const content = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        // Read as GBK to avoid Chinese character corruption
        reader.readAsText(file, 'gbk');
        reader.onload = () => resolve(reader.result as string);
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
    }
    
    if (newFiles.length > 0) {
      setFiles(prev => [...prev, ...newFiles]);
      setRawInjections(accumulatedInjections);
      if (detectedConc !== null) {
        setStdUsedC(detectedConc);
        setStdDilutionFactor(Number((stdStockC / detectedConc).toFixed(4)));
      }
    }
  };

  const clearAllData = () => {
    setFiles([]);
    setRawInjections([]);
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
      
      // Parse station & depth from name (e.g. SO308-41180-ST39-4875)
      let station: string | null = null;
      let depth: number | null = null;
      
      // Pattern STxx-depth or STxx-depthm
      const stDepthMatch = g.sampleName.match(/ST(\d+)-(\d+)/i);
      if (stDepthMatch) {
        station = `ST${stDepthMatch[1]}`;
        depth = parseInt(stDepthMatch[2], 10);
      } else {
        // Fallback for SO308 style: SO308-41180-ST39-4875
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
        // Automatic 3-out-of-4 outlier exclusion
        const result = selectBestSubset(g.injections);
        finalSelected = result.selected;
        finalMean = result.avArea;
        finalSd = result.sdArea;
        finalRsd = result.rsd;
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
  }, [rawInjections, excludedInjections]);

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

  // Group and configure standards
  const standardsData = useMemo(() => {
    const stds = sampleGroups.filter(g => g.isStd);
    stds.sort((a, b) => a.avArea - b.avArea);
    
    return stds.map((std, index) => {
      let matchedUsedC = stdUsedC;
      const cMatch = std.sampleName.match(/std\((\d+\.?\d*)uM/i);
      if (cMatch) {
        matchedUsedC = parseFloat(cMatch[1]);
      }

      const defaultDilution = dilutionFactors[index] || 3; 
      const currentDilution = customDilutions[std.id] !== undefined ? customDilutions[std.id] : defaultDilution;
      const theoreticalC = matchedUsedC / currentDilution;
      const isEnabled = enabledStds[std.id] !== undefined ? enabledStds[std.id] : (index < dilutionFactors.length);

      return {
        id: std.id,
        sampleName: std.sampleName,
        avArea: std.avArea,
        dilution: currentDilution,
        theoreticalC,
        enabled: isEnabled,
        group: std
      };
    });
  }, [sampleGroups, stdUsedC, dilutionFactors, customDilutions, enabledStds]);

  // Fit calibration curve
  const calibrationCurve = useMemo<CalibrationCurve>(() => {
    const activePoints = standardsData
      .filter(s => s.enabled)
      .map(s => ({ x: s.theoreticalC, y: s.avArea }));
    
    return fitCalibrationCurve(activePoints);
  }, [standardsData]);

  // Compute final concentrations for all samples
  const processedSamples = useMemo(() => {
    const slope = calibrationCurve.slope || 1;
    
    return sampleGroups.map(g => {
      const isRejected = rejectedSamples[g.id] || false;
      const concentration = g.avArea / slope;
      const error = g.sdArea / slope;
      
      return {
        ...g,
        concentration,
        error,
        isRejected
      };
    });
  }, [sampleGroups, calibrationCurve, rejectedSamples]);

  // Nominal reference standards calculation
  const blanksAndSeawaters = useMemo(() => {
    const blanks = processedSamples.filter(s => s.isBlank);
    const seawaters = processedSamples.filter(s => s.isSeawater);
    
    const avgBlankArea = calculateMean(blanks.map(b => b.avArea));
    const avgBlankConc = avgBlankArea / (calibrationCurve.slope || 1);
    
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
  }, [processedSamples, calibrationCurve]);

  // Get active stations list
  const stationsList = useMemo(() => {
    const stations = Array.from(new Set(processedSamples.map(g => g.station).filter(Boolean))) as string[];
    stations.sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10);
      const numB = parseInt(b.replace(/\D/g, ''), 10);
      return numA - numB;
    });
    return stations;
  }, [processedSamples]);

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
    const finalDataRows = [
      ["DOC 分析报告"],
      ["生成时间", new Date().toLocaleString()],
      [],
      ["工作曲线系数"],
      ["斜率 (Slope)", calibrationCurve.slope],
      ["截距 (Intercept)", calibrationCurve.intercept],
      ["判定系数 (R²)", calibrationCurve.rsq],
      [],
      ["样品分析结果"],
      ["样品名称", "站位", "深度 (m)", "Area1", "Area2", "Area3", "Area4", "平均面积", "面积SD", "面积RSD (%)", "DOC 浓度 (µmol/L)", "误差 (µmol/L)", "状态"]
    ];

    processedSamples.forEach(s => {
      const row = [
        s.sampleName,
        s.station || "-",
        s.depth !== null ? s.depth : "-",
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

  // 2D Contour Plot Calculations & Drawing
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [contourSvgPaths, setContourSvgPaths] = useState<{ path: string; value: number }[]>([]);
  const [interpolatedPoints, setInterpolatedPoints] = useState<{x: number, y: number, name: string}[]>([]);

  // Redraw contour plot on dependency changes
  useEffect(() => {
    if (currentStep !== 4 || visSubTab !== 'contour2d' || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const validSamples = processedSamples.filter(
      s => s.station !== null && s.depth !== null && !s.isRejected
    );

    if (validSamples.length === 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setContourSvgPaths([]);
      return;
    }

    const uniqueStations = [...new Set(validSamples.map(s => s.station))].sort((a, b) => {
      const numA = parseInt(a!.replace(/\D/g, ''), 10);
      const numB = parseInt(b!.replace(/\D/g, ''), 10);
      return numA - numB;
    });

    const stationToIdx = (st: string) => uniqueStations.indexOf(st);
    
    const dataPoints = validSamples.map(s => ({
      x: stationToIdx(s.station!),
      y: s.depth!,
      z: s.concentration
    }));

    const minDepth = 0;
    const maxDepth = Math.max(...dataPoints.map(p => p.y), 100);
    const minStIdx = 0;
    const maxStIdx = uniqueStations.length - 1;

    const gridWidth = 100;
    const gridHeight = 100;
    
    const gridValues = new Float32Array(gridWidth * gridHeight);
    const dataPointsForIdw = dataPoints.map(p => ({ x: p.x, y: p.y, z: p.z }));

    for (let r = 0; r < gridHeight; r++) {
      const depthY = minDepth + (r / (gridHeight - 1)) * (maxDepth - minDepth);
      for (let c = 0; c < gridWidth; c++) {
        const stX = minStIdx + (c / (gridWidth - 1)) * (maxStIdx - minStIdx);
        gridValues[r * gridWidth + c] = interpolateIDW(dataPointsForIdw, stX, depthY, idwPower);
      }
    }

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const imgData = ctx.createImageData(canvasWidth, canvasHeight);
    
    const colorScale = scaleLinear<string>()
      .domain([docMin, docMin + (docMax-docMin)*0.25, docMin + (docMax-docMin)*0.5, docMin + (docMax-docMin)*0.75, docMax])
      .range(['#1e3a8a', '#0284c7', '#10b981', '#f59e0b', '#ef4444']) 
      .clamp(true);

    for (let cy = 0; cy < canvasHeight; cy++) {
      const gridYRatio = cy / (canvasHeight - 1);
      const gridRow = Math.min(Math.floor(gridYRatio * gridHeight), gridHeight - 1);
      
      for (let cx = 0; cx < canvasWidth; cx++) {
        const gridXRatio = cx / (canvasWidth - 1);
        const gridCol = Math.min(Math.floor(gridXRatio * gridWidth), gridWidth - 1);
        
        const val = gridValues[gridRow * gridWidth + gridCol];
        const hexColor = colorScale(val);
        
        const r = parseInt(hexColor.slice(1, 3), 16);
        const g = parseInt(hexColor.slice(3, 5), 16);
        const b = parseInt(hexColor.slice(5, 7), 16);
        
        const pixelIdx = (cy * canvasWidth + cx) * 4;
        imgData.data[pixelIdx] = r;
        imgData.data[pixelIdx + 1] = g;
        imgData.data[pixelIdx + 2] = b;
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

    const labels = uniqueStations.map((st, i) => ({
      x: (i / (uniqueStations.length - 1)) * canvasWidth,
      y: 0,
      name: st!
    }));
    setInterpolatedPoints(labels);

  }, [currentStep, visSubTab, processedSamples, docMin, docMax, contourStep, idwPower]);

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
                <p className="page-subtitle">第一步：上传仪器导出的原始中文字符集 `.txt` 数据文件并配置工作曲线的初始浓度</p>
              </div>
            </div>

            <div className="card">
              <div 
                className={`dropzone ${isDragActive ? 'drag-active' : ''}`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input 
                  type="file" 
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  multiple 
                  accept=".txt"
                  onChange={handleFileChange}
                />
                <Upload className="dropzone-icon" />
                <div>
                  <h3 className="font-semibold text-lg" style={{ margin: '0 0 4px' }}>拖拽原始文本到此处，或点击浏览</h3>
                  <p className="text-sm text-slate-400">支持批量选择，系统会自动处理 GBK 字符集，完全防止中文乱码</p>
                </div>
              </div>

              {files.length > 0 && (
                <div style={{ marginTop: '24px' }}>
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
                    {files.map((file, i) => (
                      <div className="file-item" key={i}>
                        <div className="file-info">
                          <FileText size={16} className="text-sky-500" />
                          <span>{file.name}</span>
                          <span className="text-xs text-slate-400">({(file.size / 1024).toFixed(1)} KB)</span>
                        </div>
                        <span className="badge badge-success">
                          已解析 {rawInjections.filter(inj => inj.fileName === file.name).length} 行
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="grid-2">
              <div className="card">
                <h3 className="card-title">
                  <Settings size={18} className="text-slate-500" />
                  <span>工作曲线参数配置</span>
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
                      <label className="input-label">稀释倍数</label>
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
                  <p className="text-xs text-slate-400" style={{ marginTop: '4px', margin: 0 }}>
                    ※ <strong>计算说明：</strong>系统会自动根据公式 <code>使用浓度 = 储备液浓度 / 稀释倍数</code> 进行联动计算。您可以手动设置任意一项，其余项会自动更新。导入文件时也会自动提取使用浓度并反算稀释倍数。
                  </p>
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
                      : "请在上方上传仪器输出的 txt 数据。原始文件通常为 GBK 编码。"}
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
                            {std.group.injections.map((area, i) => (
                              <span 
                                key={i} 
                                className={`badge ${std.group.selectedInjections[i] ? 'badge-info' : 'cell-excluded badge-secondary'}`}
                                onClick={() => handleToggleInjection(std.id, i)}
                                style={{ cursor: 'pointer' }}
                                title="点击手动强制包含/排除本次注射"
                              >
                                {area.toFixed(4)}
                              </span>
                            ))}
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
              <h3 className="card-title">样品浓度数据列表</h3>
              <div className="table-container">
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th style={{ width: '50px' }}>使用</th>
                      <th>样品名称</th>
                      <th>站位</th>
                      <th>深度 (m)</th>
                      <th>每次注射面积 (点击剔除)</th>
                      <th>平均面积</th>
                      <th>面积SD</th>
                      <th>面积RSD (%)</th>
                      <th>DOC 浓度 (µmol/L)</th>
                      <th>误差 (µmol/L)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processedSamples.map((s) => {
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
                          <td>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              {s.injections.map((area, i) => (
                                <span 
                                  key={i} 
                                  className={`badge ${s.selectedInjections[i] ? 'badge-info' : 'cell-excluded badge-secondary'}`}
                                  onClick={() => handleToggleInjection(s.id, i)}
                                  style={{ cursor: 'pointer' }}
                                  title="点击包含/排除单次测量"
                                >
                                  {area.toFixed(4)}
                                </span>
                              ))}
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
                <div className="card" style={{ padding: '20px' }}>
                  <div className="input-group" style={{ marginBottom: '20px' }}>
                    <label className="input-label">当前选择站位</label>
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
                  
                  <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
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
                  <h3 className="card-title">{selectedStation} 站位 DOC 垂直剖面图 (Depth Profile)</h3>
                  <div style={{ width: '100%', height: '400px' }}>
                    {chart1dData.length === 0 ? (
                      <div style={{ height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#94a3b8' }}>
                        该站位没有可绘制的深度数据点
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis 
                            type="number" 
                            dataKey="concentration" 
                            name="DOC 浓度" 
                            unit=" µmol/L" 
                            stroke="#475569" 
                            fontSize={12}
                            domain={['auto', 'auto']}
                            orientation="top"
                          />
                          <YAxis 
                            type="number" 
                            dataKey="depth" 
                            name="深度" 
                            unit=" m" 
                            stroke="#475569" 
                            fontSize={12}
                            reversed
                            domain={[0, 'dataMax + 100']}
                          />
                          <Tooltip 
                            cursor={{ strokeDasharray: '3 3' }} 
                            formatter={(value, name) => {
                              if (name === "DOC 浓度") return [`${value} µmol/L`, "浓度"];
                              if (name === "深度") return [`${value} m`, "深度"];
                              return [value, name];
                            }}
                          />
                          <Scatter 
                            name="DOC 测定值" 
                            data={chart1dData} 
                            fill="#0284c7" 
                            line={{ stroke: '#0284c7', strokeWidth: 1.5 }}
                          />
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

                  <div style={{ marginTop: '24px' }}>
                    <div className="legend-bar"></div>
                    <div className="legend-labels">
                      <span>{docMin} µmol/L</span>
                      <span>{(docMin + (docMax - docMin)/2).toFixed(0)}</span>
                      <span>{docMax} µmol/L</span>
                    </div>
                  </div>
                </div>

                <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <h3 className="card-title" style={{ alignSelf: 'flex-start' }}>DOC 空间断面等值线分布图</h3>
                  
                  <div style={{ position: 'relative', width: '500px', height: '400px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
                    <canvas 
                      ref={canvasRef} 
                      width={500} 
                      height={400} 
                      style={{ position: 'absolute', top: 0, left: 0, width: '500px', height: '400px', zIndex: 1, borderRadius: '4px' }}
                    />
                    <svg 
                      width={500} 
                      height={400} 
                      style={{ position: 'absolute', top: 0, left: 0, width: '500px', height: '400px', zIndex: 2 }}
                    >
                      {contourSvgPaths.map((p: { path: string; value: number }, i: number) => (
                        <path 
                          key={i} 
                          d={p.path} 
                          fill="none" 
                          stroke="rgba(255, 255, 255, 0.45)" 
                          strokeWidth="1.5" 
                        />
                      ))}

                      {interpolatedPoints.map((pt: { x: number; y: number; name: string }, i: number) => (
                        <g key={i}>
                          <line x1={pt.x} y1={0} x2={pt.x} y2={400} stroke="rgba(255,255,255,0.15)" strokeDasharray="3,3" />
                          <rect x={pt.x - 22} y={5} width={44} height={16} rx={3} fill="rgba(15,23,42,0.7)" />
                          <text 
                            x={pt.x} 
                            y={16} 
                            fill="#ffffff" 
                            fontSize={9} 
                            fontWeight="bold" 
                            textAnchor="middle"
                          >
                            {pt.name}
                          </text>
                        </g>
                      ))}
                      
                      <g>
                        {[0.25, 0.5, 0.75, 1.0].map((r, i) => {
                          const maxDepthInSamps = processedSamples.length > 0 ? Math.max(...processedSamples.map(s => s.depth || 0)) : 1000;
                          const depthVal = (maxDepthInSamps * r).toFixed(0);
                          const yPos = 400 * r - 10;
                          return (
                            <g key={i}>
                              <text x={10} y={yPos} fill="#ffffff" fontSize={10} fontWeight="bold" style={{ textShadow: "1px 1px 2px #000000" }}>
                                {depthVal} m
                              </text>
                            </g>
                          );
                        })}
                      </g>
                    </svg>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '20px', marginTop: '16px', fontSize: '12px', color: '#64748b' }}>
                    <span>※ 横轴表示测站 (按字母升序)</span>
                    <span>※ 纵轴表示海水深度 (米，反向刻度)</span>
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
