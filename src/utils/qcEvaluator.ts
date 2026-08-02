export type QCFlagLevel = 1 | 2 | 3 | 4;

export interface QCFlagResult {
  flag: QCFlagLevel;
  label: string;
  color: string;
  reasons: string[];
}

export interface CurveQCInfo {
  curveId: string;
  fileName: string;
  slope: number;
  intercept: number;
  rsq: number;
  blankArea: number;
  blankConc: number; // Blank concentration equivalent
  crmCount: number;
  crmAvgMeasured: number; // Measured avg CRM conc (uM C)
  crmExpected: number;   // Expected CRM conc (uM C)
  crmRecovery: number;   // Recovery percentage (%)
  flagResult: QCFlagResult;
}

/**
 * Evaluate Quality Control Flag (Flag 1 to Flag 4) for a given sample or curve.
 * 
 * Criteria:
 * - Flag 1 (Pass / Excellent): CRM Recovery 98-102%, RSD < 1.5%, Curve R² >= 0.999
 * - Flag 2 (Good / Qualified): CRM Recovery 95-105%, RSD < 3.0%, Curve R² >= 0.995
 * - Flag 3 (Warning / Suspect): CRM Recovery 90-95% or 105-110%, RSD 3.0-5.0%, R² >= 0.990
 * - Flag 4 (Reject / Bad): Recovery < 90% or > 110%, RSD > 5.0%, or R² < 0.990
 */
export function evaluateSampleQC(
  rsd: number,
  crmRecovery?: number,
  rsq?: number
): QCFlagResult {
  const reasons: string[] = [];

  let flag: QCFlagLevel = 1;

  // Check RSD
  if (rsd > 5.0) {
    flag = 4;
    reasons.push(`平行样进样变异系数较高 (RSD = ${rsd.toFixed(2)}% > 5.0%)`);
  } else if (rsd > 3.0) {
    flag = Math.max(flag, 3) as QCFlagLevel;
    reasons.push(`平行样变异系数稍高 (RSD = ${rsd.toFixed(2)}%)`);
  } else if (rsd > 1.5) {
    flag = Math.max(flag, 2) as QCFlagLevel;
    reasons.push(`平行样变异系数良好 (RSD = ${rsd.toFixed(2)}%)`);
  } else {
    reasons.push(`平行样重现性极佳 (RSD = ${rsd.toFixed(2)}% <= 1.5%)`);
  }

  // Check CRM Recovery if available
  if (crmRecovery !== undefined && crmRecovery > 0) {
    const dev = Math.abs(crmRecovery - 100);
    if (dev > 10) {
      flag = 4;
      reasons.push(`深海参标回收率严重偏离 (Recovery = ${crmRecovery.toFixed(1)}%)`);
    } else if (dev > 5) {
      flag = Math.max(flag, 3) as QCFlagLevel;
      reasons.push(`深海参标轻微漂移 (Recovery = ${crmRecovery.toFixed(1)}%)`);
    } else if (dev > 2) {
      flag = Math.max(flag, 2) as QCFlagLevel;
      reasons.push(`深海参标回收率合格 (Recovery = ${crmRecovery.toFixed(1)}%)`);
    } else {
      reasons.push(`深海参标回收率优秀 (Recovery = ${crmRecovery.toFixed(1)}%)`);
    }
  }

  // Check R-squared if available
  if (rsq !== undefined && rsq > 0) {
    if (rsq < 0.990) {
      flag = 4;
      reasons.push(`工作曲线拟合较差 (R² = ${rsq.toFixed(4)} < 0.990)`);
    } else if (rsq < 0.995) {
      flag = Math.max(flag, 3) as QCFlagLevel;
      reasons.push(`工作曲线拟合一般 (R² = ${rsq.toFixed(4)})`);
    } else if (rsq < 0.999) {
      flag = Math.max(flag, 2) as QCFlagLevel;
      reasons.push(`工作曲线拟合良好 (R² = ${rsq.toFixed(4)})`);
    } else {
      reasons.push(`工作曲线拟合极佳 (R² = ${rsq.toFixed(4)})`);
    }
  }

  // Assign metadata styles
  switch (flag) {
    case 1:
      return {
        flag: 1,
        label: 'Flag 1 (优秀可用)',
        color: '#10b981', // Emerald green
        reasons
      };
    case 2:
      return {
        flag: 2,
        label: 'Flag 2 (良好合格)',
        color: '#3b82f6', // Blue
        reasons
      };
    case 3:
      return {
        flag: 3,
        label: 'Flag 3 (轻微漂移/需关注)',
        color: '#f59e0b', // Amber
        reasons
      };
    case 4:
    default:
      return {
        flag: 4,
        label: 'Flag 4 (严重异常/建议弃用)',
        color: '#ef4444', // Red
        reasons
      };
  }
}

export interface CRMIdentityResult {
  actualType: 'DSW' | 'SSW' | 'UNKNOWN';
  displayLabel: string;
  isSelfCorrected: boolean;
  correctionNote: string;
}

/**
 * Self-correct CRM identity based on raw peak area / estimated concentration.
 * If raw name says DSW but estimated concentration > 60 uM (typical SSW range ~70-80 uM),
 * auto-correct to SSW to prevent skewing DSW recovery calculation.
 */
export function correctCrmIdentity(
  rawName: string,
  estimatedConc: number
): CRMIdentityResult {
  const upper = rawName.toUpperCase();
  const isLabeledDsw = upper.includes('DSW');
  const isLabeledSsw = upper.includes('SSW');

  if (isLabeledDsw) {
    if (estimatedConc > 60) {
      return {
        actualType: 'SSW',
        displayLabel: '表层参标(SSW)',
        isSelfCorrected: true,
        correctionNote: `[原标 DSW, 浓度 ${estimatedConc.toFixed(1)}μM 偏高, 智能校正为 SSW]`
      };
    }
    return {
      actualType: 'DSW',
      displayLabel: '深海参标(DSW)',
      isSelfCorrected: false,
      correctionNote: ''
    };
  }

  if (isLabeledSsw) {
    if (estimatedConc > 0 && estimatedConc < 55) {
      return {
        actualType: 'DSW',
        displayLabel: '深海参标(DSW)',
        isSelfCorrected: true,
        correctionNote: `[原标 SSW, 浓度 ${estimatedConc.toFixed(1)}μM 偏低, 智能校正为 DSW]`
      };
    }
    return {
      actualType: 'SSW',
      displayLabel: '表层参标(SSW)',
      isSelfCorrected: false,
      correctionNote: ''
    };
  }

  return {
    actualType: 'UNKNOWN',
    displayLabel: upper.includes('CRM') || upper.includes('REF') ? '参标水' : '普通水样',
    isSelfCorrected: false,
    correctionNote: ''
  };
}

