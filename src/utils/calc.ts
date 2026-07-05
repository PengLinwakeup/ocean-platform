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
export function fitCalibrationCurve(
  points: { x: number; y: number }[],
  forceZeroIntercept?: boolean
): {
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

  if (forceZeroIntercept) {
    let sumXY = 0;
    let sumXX = 0;
    let sumYY = 0;
    let meanY = 0;
    for (let i = 0; i < n; i++) {
      sumXY += xs[i] * ys[i];
      sumXX += xs[i] * xs[i];
      sumYY += ys[i] * ys[i];
      meanY += ys[i];
    }
    meanY /= n;

    const slope = sumXX === 0 ? 0 : sumXY / sumXX;
    const intercept = 0;

    // R-squared for regression through origin: 1 - SSE / SST
    let sse = 0;
    let sst = 0;
    for (let i = 0; i < n; i++) {
      const predY = slope * xs[i];
      sse += Math.pow(ys[i] - predY, 2);
      sst += Math.pow(ys[i] - meanY, 2);
    }
    const rsq = sst === 0 ? 0 : Math.max(0, 1 - sse / sst);

    return { slope, intercept, rsq };
  }
  
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
  
  const isPowerTwo = power === 2;
  const len = dataPoints.length;

  for (let i = 0; i < len; i++) {
    const pt = dataPoints[i];
    const dx = gridX - pt.x;
    const dy = gridY - pt.y;
    const dSq = dx * dx + dy * dy;
    
    // If we are exactly at the data point, return its value
    if (dSq === 0) {
      return pt.z;
    }
    
    const weight = isPowerTwo ? (1 / dSq) : (1 / Math.pow(dSq, power / 2));
    totalWeight += weight;
    weightedSum += pt.z * weight;
  }
  
  return totalWeight === 0 ? 0 : weightedSum / totalWeight;
}

/**
 * Calculates potential density anomaly (sigma-theta, approximation) in kg/m3.
 * Uses the UNESCO EOS-80 equation of state for seawater at 1 atm (0 dbar pressure).
 */
export function calculatePotentialDensityAnomaly(S: number, T: number): number {
  // S: salinity (psu), T: temperature (°C)
  // Pure water density
  const rhow = 999.842594 +
    6.793952e-2 * T -
    9.095290e-3 * Math.pow(T, 2) +
    1.001685e-4 * Math.pow(T, 3) -
    1.120083e-6 * Math.pow(T, 4) +
    6.536332e-9 * Math.pow(T, 5);

  const A = 0.824493 -
    4.0899e-3 * T +
    7.6438e-5 * Math.pow(T, 2) -
    8.2467e-7 * Math.pow(T, 3) +
    5.3875e-9 * Math.pow(T, 4);

  const B = -5.72466e-3 +
    1.0227e-4 * T -
    1.6546e-6 * Math.pow(T, 2);

  const C = 4.8314e-4;

  const density = rhow + A * S + B * Math.pow(S, 1.5) + C * Math.pow(S, 2);
  return density - 1000;
}

/**
 * Calculates oxygen saturation in umol/kg using Garcia & Gordon (1992) equation.
 */
export function calculateOxygenSaturation(S: number, T: number): number {
  // S: salinity (psu), T: temperature (°C)
  const Tk = T + 273.15;
  const Ts = Math.log((298.15 - T) / Tk);

  const A0 = 5.80871;
  const A1 = 3.20291;
  const A2 = 4.17887;
  const A3 = 5.10203;
  const A4 = -0.06606;
  const A5 = 2.44536;

  const B0 = -0.00701577;
  const B1 = -0.00770028;
  const B2 = -0.0113864;
  const B3 = -0.00951619;

  const C0 = -0.000000098;

  const lnO2Sat = A0 + A1 * Ts + A2 * Math.pow(Ts, 2) + A3 * Math.pow(Ts, 3) + A4 * Math.pow(Ts, 4) + A5 * Math.pow(Ts, 5) +
    S * (B0 + B1 * Ts + B2 * Math.pow(Ts, 2) + B3 * Math.pow(Ts, 3)) +
    C0 * Math.pow(S, 2);

  return Math.exp(lnO2Sat);
}

/**
 * Calculates Potential Temperature (theta) in °C from Salinity, Temperature, and Pressure.
 * Bryden (1973) polynomial fit.
 * S: Salinity (psu)
 * T: In-situ Temperature (°C)
 * P: Pressure (dbar, or depth in meters as approximation)
 */
export function calculatePotentialTemperature(S: number, T: number, P: number): number {
  const ds = S - 35.0;
  
  // Adiabatic lapse rate (deg C per dbar)
  const adiabaticLapseRate = (
    (3.5803e-5 +
      T * (1.01e-6 - T * (5.7e-9 - T * 1.5e-11))) +
    ds * (1.874e-6 - T * (4.2e-8 - T * 6.5e-10)) +
    P * (1.874e-8 + T * (6.9e-10 - T * 1.1e-11))
  );
  
  const k1 = P * adiabaticLapseRate;
  
  const t2 = T + 0.5 * k1;
  const p2 = 0.5 * P;
  const alr2 = (
    (3.5803e-5 +
      t2 * (1.01e-6 - t2 * (5.7e-9 - t2 * 1.5e-11))) +
    ds * (1.874e-6 - t2 * (4.2e-8 - t2 * 6.5e-10)) +
    p2 * (1.874e-8 + t2 * (6.9e-10 - t2 * 1.1e-11))
  );
  const k2 = P * alr2;
  
  const t3 = T + 0.5 * k2;
  const alr3 = (
    (3.5803e-5 +
      t3 * (1.01e-6 - t3 * (5.7e-9 - t3 * 1.5e-11))) +
    ds * (1.874e-6 - t3 * (4.2e-8 - t3 * 6.5e-10)) +
    p2 * (1.874e-8 + t3 * (6.9e-10 - t3 * 1.1e-11))
  );
  const k3 = P * alr3;
  
  const t4 = T + k3;
  const alr4 = (
    (3.5803e-5 +
      t4 * (1.01e-6 - t4 * (5.7e-9 - t4 * 1.5e-11))) +
    ds * (1.874e-6 - t4 * (4.2e-8 - t4 * 6.5e-10)) +
    P * (1.874e-8 + t4 * (6.9e-10 - t4 * 1.1e-11))
  );
  const k4 = P * alr4;
  
  return T - (k1 + 2 * k2 + 2 * k3 + k4) / 6;
}

/**
 * Calculates Apparent Oxygen Utilization (AOU) in umol/kg.
 * S: Salinity (psu)
 * T: In-situ Temperature (°C)
 * O2Obs: Observed Oxygen (umol/kg)
 * P: Pressure (dbar)
 */
export function calculateAOU(S: number, T: number, O2Obs: number, P?: number): number {
  const theta = P !== undefined ? calculatePotentialTemperature(S, T, P) : T;
  const sat = calculateOxygenSaturation(S, theta);
  const aou = sat - O2Obs;
  return aou;
}

