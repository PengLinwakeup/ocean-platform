export function calculateMean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function calculateStdev(arr: number[]): number {
  if (arr.length <= 1) return 0;
  const mean = calculateMean(arr);
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

/**
 * 3-out-of-4 outlier exclusion algorithm.
 * Selects the subset of 3 injections with the lowest standard deviation.
 * If there are fewer than 4 injections, selects all injections.
 */
export function selectBestSubset(injections: number[]): {
  selected: boolean[];
  avArea: number;
  sdArea: number;
  rsd: number;
} {
  const n = injections.length;
  
  // Default: select all
  const defaultSelected = injections.map(() => true);
  if (n <= 3) {
    const mean = calculateMean(injections);
    const sd = calculateStdev(injections);
    const rsd = mean > 0 ? (sd / mean) * 100 : 0;
    return { selected: defaultSelected, avArea: mean, sdArea: sd, rsd };
  }

  // If there are exactly 4 injections, test all 4 combinations of 3 injections
  if (n === 4) {
    const combinations = [
      { selected: [true, true, true, false], indices: [0, 1, 2] },
      { selected: [true, true, false, true], indices: [0, 1, 3] },
      { selected: [true, false, true, true], indices: [0, 2, 3] },
      { selected: [false, true, true, true], indices: [1, 2, 3] }
    ];

    let bestCombination = combinations[0];
    let minSd = Infinity;

    for (const combo of combinations) {
      const vals = combo.indices.map(i => injections[i]);
      const sd = calculateStdev(vals);
      if (sd < minSd) {
        minSd = sd;
        bestCombination = combo;
      }
    }

    const bestVals = bestCombination.indices.map(i => injections[i]);
    const mean = calculateMean(bestVals);
    const sd = calculateStdev(bestVals);
    const rsd = mean > 0 ? (sd / mean) * 100 : 0;

    return {
      selected: bestCombination.selected,
      avArea: mean,
      sdArea: sd,
      rsd
    };
  }

  // Fallback for more than 4: find subset of size 3 with minimum SD
  let minSd = Infinity;
  let bestIndices: number[] = [0, 1, 2];
  
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const vals = [injections[i], injections[j], injections[k]];
        const sd = calculateStdev(vals);
        if (sd < minSd) {
          minSd = sd;
          bestIndices = [i, j, k];
        }
      }
    }
  }

  const selected = injections.map((_, idx) => bestIndices.includes(idx));
  const bestVals = bestIndices.map(i => injections[i]);
  const mean = calculateMean(bestVals);
  const sd = calculateStdev(bestVals);
  const rsd = mean > 0 ? (sd / mean) * 100 : 0;

  return { selected, avArea: mean, sdArea: sd, rsd };
}

/**
 * Fits a linear regression curve: Y = Slope * X + Intercept
 * Y represents the peak area, X represents the theoretical concentration.
 */
export function fitCalibrationCurve(points: { x: number; y: number }[]): {
  slope: number;
  intercept: number;
  rsq: number;
} {
  const n = points.length;
  if (n <= 1) {
    return { slope: 1, intercept: 0, rsq: 0 };
  }

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  
  const meanX = calculateMean(xs);
  const meanY = calculateMean(ys);

  let num = 0;
  let den = 0;
  let sumSqY = 0;
  let sumSqX = 0;

  for (let i = 0; i < n; i++) {
    const diffX = xs[i] - meanX;
    const diffY = ys[i] - meanY;
    num += diffX * diffY;
    den += diffX * diffX;
    sumSqX += diffX * diffX;
    sumSqY += diffY * diffY;
  }

  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;

  // R-squared
  let rsq = 0;
  if (sumSqX > 0 && sumSqY > 0) {
    rsq = Math.pow(num, 2) / (sumSqX * sumSqY);
  }

  return { slope, intercept, rsq };
}

/**
 * 2D Inverse Distance Weighting (IDW) interpolation
 * @param dataPoints Array of known points: { x: number, y: number, z: number } (x = station index, y = depth, z = DOC concentration)
 * @param gridX Target X coordinate (station index, can be fractional)
 * @param gridY Target Y coordinate (depth)
 * @param power IDW power parameter (typically 2)
 */
export function interpolateIDW(
  dataPoints: { x: number; y: number; z: number }[],
  gridX: number,
  gridY: number,
  power: number = 2
): number {
  if (dataPoints.length === 0) return 0;
  
  let totalWeight = 0;
  let weightedSum = 0;
  
  for (const pt of dataPoints) {
    const d = Math.sqrt(Math.pow(gridX - pt.x, 2) + Math.pow(gridY - pt.y, 2));
    
    // If we are exactly at the data point, return its value
    if (d === 0) {
      return pt.z;
    }
    
    const weight = 1 / Math.pow(d, power);
    totalWeight += weight;
    weightedSum += pt.z * weight;
  }
  
  return totalWeight === 0 ? 0 : weightedSum / totalWeight;
}
