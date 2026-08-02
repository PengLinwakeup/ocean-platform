import { useState, useMemo } from 'react';
import {
  ShieldCheck, AlertCircle, CheckCircle2, FileSpreadsheet, AlertTriangle, Info
} from 'lucide-react';
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { SampleGroup, ExcelSampleInfo } from '../types';
import { evaluateSampleQC, correctCrmIdentity, QCFlagLevel } from '../utils/qcEvaluator';
import { exportMultiSheetQCExcel, exportODVPlottingCSV } from '../utils/excelExporter';

export interface CurveBatchExportData {
  curveId: string;
  curveName: string;
  fileName: string;
  slope: number;
  intercept: number;
  rsq: number;
  blankArea: number;
  blankConcEquiv: number;
  crmExpected: number;
  crmMeasuredAvg: number;
  crmRecovery: number;
  samples: (SampleGroup & { calculatedConc: number; qcFlag: QCFlagLevel })[];
}

interface QCDashboardProps {
  files: { name: string; size: number }[];
  groups: SampleGroup[];
  calibrationMap: Record<string, { slope: number; intercept: number; rsq: number }>;
  calibrationCurvesList?: { id: string; name: string; fileName: string; slope: number; intercept: number; rsq: number }[];
  calculatedConcs: Record<string, number>;
  dswTargetConc?: number;
  stationCoords?: ExcelSampleInfo[];
  hydroSamples?: any[];
}

export default function QCDashboard({
  groups,
  calibrationMap,
  calibrationCurvesList = [],
  calculatedConcs,
  dswTargetConc = 42.0, // Default Deep Sea Water CRM concentration in uM C
  stationCoords = [],
  hydroSamples = []
}: QCDashboardProps) {
  const [selectedFlagFilter, setSelectedFlagFilter] = useState<number | 'ALL'>('ALL');
  const [targetCrmConc, setTargetCrmConc] = useState<number>(dswTargetConc);

  // Helper for sorting files by physical measurement date & batch priority
  const getFileSortPriority = (fileName: string): number => {
    const fn = fileName.toLowerCase();
    if (fn.includes('indian ocean-51') || fn.includes('indian ocean 51')) return 10051;
    if (fn.includes('indian ocean-50') || fn.includes('indian ocean 50')) return 10050;
    if (fn.includes('indian ocean')) return 10099;

    const dateMatch = fn.match(/(\d{1,2})\.(\d{1,2})/);
    if (dateMatch) {
      const month = parseInt(dateMatch[1], 10);
      const day = parseInt(dateMatch[2], 10);
      const batchMatch = fn.match(/^(\d+)-/);
      const batchNo = batchMatch ? parseInt(batchMatch[1], 10) : 0;
      return 200000 + month * 10000 + day * 100 + batchNo;
    }
    return 900000;
  };

  // Group analysis by file and detailed calibration curves
  const batchAnalysis = useMemo(() => {
    const fileMap: Record<string, SampleGroup[]> = {};
    groups.forEach(g => {
      if (!fileMap[g.fileName]) {
        fileMap[g.fileName] = [];
      }
      fileMap[g.fileName].push(g);
    });

    const sortedFileEntries = Object.entries(fileMap).sort(([fileA], [fileB]) => getFileSortPriority(fileA) - getFileSortPriority(fileB));

    const result: (CurveBatchExportData & { fileColIdx: number; isMultiCurveInFile: boolean })[] = [];

    sortedFileEntries.forEach(([fileName, sampleList], fileIdx) => {
      const fileColIdx = fileIdx + 1;

      // Find curves belonging to this file
      const matchingCurves = calibrationCurvesList.filter(c => c.fileName === fileName);

      if (matchingCurves.length > 0) {
        const isMultiCurveInFile = matchingCurves.length > 1;

        matchingCurves.forEach(calib => {
          // Filter samples that strictly belong to THIS specific calibration curve (if multi-curve file)
          const curveSamples = isMultiCurveInFile
            ? sampleList.filter(s => (s as any).curveId === calib.id)
            : sampleList;
          const activeSampleList = curveSamples.length > 0 ? curveSamples : sampleList;

          // Find MQ Blanks for this curve segment (excluding cleaning/wash and extreme carryover outliers)
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

          // Find DSW CRMs for this curve segment
          let dswCrms = activeSampleList.filter(s => {
            if ((s as any).isRejected) return false;
            const conc = calculatedConcs[s.id] ?? (calib.slope > 0 ? (s.avArea - calib.intercept) / calib.slope : 0);
            const corrected = correctCrmIdentity(s.sampleName, conc);
            return corrected.actualType === 'DSW';
          });

          // Fallback: If 0 or 1 DSW CRM in this curve segment, fallback to search across the ENTIRE physical column (sampleList)
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

          result.push({
            curveId: calib.id,
            curveName: calib.name,
            fileName,
            fileColIdx,
            isMultiCurveInFile,
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
      } else {
        // Fallback if no curves list passed
        const calib = calibrationMap[fileName] || { slope: 1, intercept: 0, rsq: 0 };
        const blanks = sampleList.filter(s => s.isBlank || s.sampleName.toLowerCase().includes('blank') || s.sampleName.toLowerCase().includes('mq'));
        const blankArea = blanks.length > 0 ? blanks.reduce((sum, b) => sum + b.avArea, 0) / blanks.length : 0;
        const blankConcEquiv = calib.slope > 0 ? (blankArea - calib.intercept) / calib.slope : 0;

        const dswCrms = sampleList.filter(s => {
          if ((s as any).isRejected) return false;
          const conc = calculatedConcs[s.id] ?? (calib.slope > 0 ? (s.avArea - calib.intercept) / calib.slope : 0);
          const corrected = correctCrmIdentity(s.sampleName, conc);
          return corrected.actualType === 'DSW';
        });

        let crmAvgMeasured = 0;
        let crmRecovery = 0;

        if (dswCrms.length > 0) {
          const crmConcs = dswCrms.map(c => calculatedConcs[c.id] ?? 0);
          crmAvgMeasured = crmConcs.reduce((a, b) => a + b, 0) / dswCrms.length;
          crmRecovery = targetCrmConc > 0 ? (crmAvgMeasured / targetCrmConc) * 100 : 0;
        }

        const evaluatedSamples = sampleList.map(s => {
          const conc = calculatedConcs[s.id] ?? (calib.slope > 0 ? (s.avArea - calib.intercept) / calib.slope : 0);
          const evalRes = evaluateSampleQC(s.rsd, crmRecovery > 0 ? crmRecovery : undefined, calib.rsq);
          return {
            ...s,
            calculatedConc: conc,
            qcFlag: evalRes.flag
          };
        });

        result.push({
          curveId: fileName,
          curveName: fileName,
          fileName,
          fileColIdx,
          isMultiCurveInFile: false,
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
      }
    });

    return result;
  }, [groups, calibrationMap, calibrationCurvesList, calculatedConcs, targetCrmConc]);

  // Overall Samples with QC Flags
  const allEvaluatedSamples = useMemo(() => {
    return batchAnalysis.flatMap(b => b.samples);
  }, [batchAnalysis]);

  // CRM Tracking Data for Control Chart (X: Column Index, Y: CRM Conc)
  const crmChartData = useMemo(() => {
    return batchAnalysis.map((b, idx) => {
      const crmRec = b.crmRecovery ?? 0;
      const crmAvg = b.crmMeasuredAvg ?? 0;
      const evalRes = evaluateSampleQC(0, crmRec, b.rsq);
      return {
        columnIndex: idx + 1,
        columnName: `柱 ${idx + 1}`,
        fileName: b.fileName,
        crmConc: crmAvg > 0 ? Number(crmAvg.toFixed(2)) : null,
        crmRecovery: crmRec > 0 ? Number(crmRec.toFixed(1)) : null,
        blankConc: Number(b.blankConcEquiv.toFixed(2)),
        rsq: Number(b.rsq.toFixed(4)),
        flag: evalRes.flag,
        flagLabel: evalRes.label
      };
    });
  }, [batchAnalysis]);

  // Counts per Flag
  const flagCounts = useMemo(() => {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    allEvaluatedSamples.forEach(s => {
      if (s.qcFlag && s.qcFlag >= 1 && s.qcFlag <= 4) {
        counts[s.qcFlag as QCFlagLevel]++;
      }
    });
    return counts;
  }, [allEvaluatedSamples]);

  const [isExporting, setIsExporting] = useState(false);

  const handleExportExcel = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      await exportMultiSheetQCExcel(allEvaluatedSamples, batchAnalysis, stationCoords, hydroSamples);
    } catch (err) {
      console.error('Excel Export Error:', err);
      alert('导出 Excel 失败: ' + (err as Error).message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportCSV = () => {
    try {
      exportODVPlottingCSV(batchAnalysis, stationCoords, hydroSamples);
    } catch (err) {
      console.error('ODV CSV Export Error:', err);
      alert('导出 ODV CSV 失败: ' + (err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / QC Summary Cards */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-800/80 p-5 rounded-2xl border border-slate-700 backdrop-blur-md">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-400" />
            数据分析与质量控制 (DOC QC Dashboard)
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            针对每次进样/每根柱子的深海参标 (CRM)、Blank 值及平行样重现性自动进行 Flag 1~4 评级。
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleExportExcel}
            disabled={isExporting}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 disabled:opacity-50 text-white font-medium rounded-xl shadow-lg shadow-emerald-900/30 transition-all hover:scale-[1.02] text-sm"
          >
            <FileSpreadsheet className="w-4 h-4" />
            {isExporting ? '正在生成...' : '导出结构化 Excel'}
          </button>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-medium rounded-xl shadow-lg shadow-sky-900/30 transition-all hover:scale-[1.02] text-sm"
          >
            <FileSpreadsheet className="w-4 h-4" />
            导出 ODV 绘图 CSV
          </button>
        </div>
      </div>

      {/* Control Panel: CRM Target Setting & Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {/* Target CRM Setting Card */}
        <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700 flex flex-col justify-between">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">深海参标 (CRM) 理论值</span>
          <div className="flex items-center gap-2 mt-2">
            <input
              type="number"
              step="0.1"
              value={targetCrmConc}
              onChange={e => setTargetCrmConc(Number(e.target.value))}
              className="w-24 bg-slate-900 border border-slate-700 text-white font-bold px-3 py-1.5 rounded-lg focus:outline-none focus:border-emerald-500"
            />
            <span className="text-sm text-slate-300">μmol C/L</span>
          </div>
          <p className="text-xs text-slate-500 mt-2">默认深海参标理论值约 42.0 μM</p>
        </div>

        {/* Flag 1 Card */}
        <div
          onClick={() => setSelectedFlagFilter(selectedFlagFilter === 1 ? 'ALL' : 1)}
          className={`cursor-pointer p-4 rounded-xl border transition-all ${
            selectedFlagFilter === 1
              ? 'bg-emerald-950/60 border-emerald-500 ring-2 ring-emerald-500/50'
              : 'bg-slate-800/60 border-slate-700 hover:border-emerald-500/50'
          }`}
        >
          <div className="flex justify-between items-center text-emerald-400 text-xs font-bold uppercase">
            <span>Flag 1 (优秀可用)</span>
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-white mt-2">{flagCounts[1]}</div>
          <p className="text-xs text-slate-400 mt-1">Recovery 98-102%, RSD &lt; 1.5%</p>
        </div>

        {/* Flag 2 Card */}
        <div
          onClick={() => setSelectedFlagFilter(selectedFlagFilter === 2 ? 'ALL' : 2)}
          className={`cursor-pointer p-4 rounded-xl border transition-all ${
            selectedFlagFilter === 2
              ? 'bg-blue-950/60 border-blue-500 ring-2 ring-blue-500/50'
              : 'bg-slate-800/60 border-slate-700 hover:border-blue-500/50'
          }`}
        >
          <div className="flex justify-between items-center text-blue-400 text-xs font-bold uppercase">
            <span>Flag 2 (良好合格)</span>
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-white mt-2">{flagCounts[2]}</div>
          <p className="text-xs text-slate-400 mt-1">Recovery 95-105%, RSD &lt; 3.0%</p>
        </div>

        {/* Flag 3 Card */}
        <div
          onClick={() => setSelectedFlagFilter(selectedFlagFilter === 3 ? 'ALL' : 3)}
          className={`cursor-pointer p-4 rounded-xl border transition-all ${
            selectedFlagFilter === 3
              ? 'bg-amber-950/60 border-amber-500 ring-2 ring-amber-500/50'
              : 'bg-slate-800/60 border-slate-700 hover:border-amber-500/50'
          }`}
        >
          <div className="flex justify-between items-center text-amber-400 text-xs font-bold uppercase">
            <span>Flag 3 (轻微漂移)</span>
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-white mt-2">{flagCounts[3]}</div>
          <p className="text-xs text-slate-400 mt-1">Recovery 90-95% / 105-110%</p>
        </div>

        {/* Flag 4 Card */}
        <div
          onClick={() => setSelectedFlagFilter(selectedFlagFilter === 4 ? 'ALL' : 4)}
          className={`cursor-pointer p-4 rounded-xl border transition-all ${
            selectedFlagFilter === 4
              ? 'bg-rose-950/60 border-rose-500 ring-2 ring-rose-500/50'
              : 'bg-slate-800/60 border-slate-700 hover:border-rose-500/50'
          }`}
        >
          <div className="flex justify-between items-center text-rose-400 text-xs font-bold uppercase">
            <span>Flag 4 (严重偏离/弃用)</span>
            <AlertCircle className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-white mt-2">{flagCounts[4]}</div>
          <p className="text-xs text-slate-400 mt-1">Recovery &lt;90% / &gt;110%</p>
        </div>
      </div>

      {/* CRM Trend / Control Chart (横坐标：柱子，纵坐标：参标浓度) */}
      <div className="bg-slate-800/80 p-6 rounded-2xl border border-slate-700">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Info className="w-5 h-5 text-sky-400" />
              每根柱子深海参标 (CRM / Deep Standard) 稳定性控制图
            </h3>
            <p className="text-xs text-slate-400">
              横坐标为运行柱号/批次，纵坐标为测得的深海参标浓度。虚线为控制界限 (±5% 与 ±10%)。
            </p>
          </div>
        </div>

        <div className="h-72 w-full mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="columnIndex"
                name="柱号"
                unit="号"
                stroke="#94a3b8"
                tickCount={crmChartData.length}
                domain={[0, crmChartData.length + 1]}
              />
              <YAxis
                dataKey="crmConc"
                name="CRM 浓度"
                unit=" μM"
                stroke="#94a3b8"
                domain={[Math.floor(targetCrmConc * 0.8), Math.ceil(targetCrmConc * 1.2)]}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg text-xs space-y-1 shadow-xl">
                        <p className="font-bold text-white">{data.columnName} ({data.fileName})</p>
                        <p className="text-emerald-400">参标测定浓度: {data.crmConc} μmol C/L</p>
                        <p className="text-sky-400">参标回收率: {data.crmRecovery}%</p>
                        <p className="text-slate-300">MQ Blank 浓度当量: {data.blankConc} μM</p>
                        <p className="text-slate-400">工作曲线 R²: {data.rsq}</p>
                        <p className="font-semibold" style={{ color: data.flag === 1 ? '#10b981' : data.flag === 2 ? '#3b82f6' : data.flag === 3 ? '#f59e0b' : '#ef4444' }}>
                          质控结论: {data.flagLabel}
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              {/* Target & Control Lines */}
              <ReferenceLine y={targetCrmConc} stroke="#10b981" strokeWidth={2} label={{ value: `目标 100% (${targetCrmConc} μM)`, fill: '#10b981', position: 'right' }} />
              <ReferenceLine y={targetCrmConc * 1.05} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: '+5%', fill: '#f59e0b', position: 'right' }} />
              <ReferenceLine y={targetCrmConc * 0.95} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: '-5%', fill: '#f59e0b', position: 'right' }} />
              <ReferenceLine y={targetCrmConc * 1.10} stroke="#ef4444" strokeDasharray="2 2" label={{ value: '+10%', fill: '#ef4444', position: 'right' }} />
              <ReferenceLine y={targetCrmConc * 0.90} stroke="#ef4444" strokeDasharray="2 2" label={{ value: '-10%', fill: '#ef4444', position: 'right' }} />

              <Scatter name="深海参标" data={crmChartData} fill="#38bdf8" shape="circle" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Batch Overview Cards Table */}
      <div className="bg-slate-800/80 p-6 rounded-2xl border border-slate-700">
        <h3 className="text-lg font-bold text-white mb-4">每根柱子 (Batch) 工作曲线与质控参数总览表</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900/60 text-slate-400 uppercase font-semibold">
              <tr>
                <th className="p-3">柱号 / 文件名</th>
                <th className="p-3">拟合方程 (Slope / Intercept)</th>
                <th className="p-3">R²</th>
                <th className="p-3">MQ Blank (μM C)</th>
                <th className="p-3">参标实测浓度 (μM C)</th>
                <th className="p-3">参标回收率 (%)</th>
                <th className="p-3">柱子综合评级</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {batchAnalysis.map((b) => {
                const crmRec = b.crmRecovery ?? 0;
                const crmAvg = b.crmMeasuredAvg ?? 0;
                const evalRes = evaluateSampleQC(0, crmRec, b.rsq);
                return (
                  <tr key={b.curveId} className="hover:bg-slate-700/30 transition-colors">
                    <td className="p-3 font-medium text-white">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-slate-900 border border-slate-700 rounded text-sky-400 font-bold">
                          第 {b.fileColIdx} 柱
                        </span>
                        <span>{b.curveName}</span>
                      </div>
                      <span className="text-[11px] text-slate-400 block mt-0.5">{b.fileName}</span>
                    </td>
                    <td className="p-3 font-mono">
                      y = {b.slope.toFixed(6)}x {b.intercept >= 0 ? '+' : ''}{b.intercept.toFixed(2)}
                    </td>
                    <td className={`p-3 font-bold ${b.rsq >= 0.999 ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {b.rsq.toFixed(6)}
                    </td>
                    <td className="p-3 text-sky-400 font-mono">
                      {b.blankConcEquiv.toFixed(2)} μM
                    </td>
                    <td className="p-3 font-mono text-white">
                      {crmAvg > 0 ? `${crmAvg.toFixed(2)} μM` : '-'}
                    </td>
                    <td className="p-3">
                      {crmRec > 0 ? (
                        <span className={`px-2 py-0.5 rounded font-bold ${
                          crmRec >= 95 && crmRec <= 105 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                        }`}>
                          {crmRec.toFixed(1)}%
                        </span>
                      ) : '-'}
                    </td>
                    <td className="p-3 font-semibold" style={{ color: evalRes.color }}>
                      {evalRes.label}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
