/**
 * OMPA & eOMPA solver for Ocean Platform
 * Implements the Lawson-Hanson Non-Negative Least Squares (NNLS) algorithm
 * and standard water mass mixing formulations.
 */

// Matrix utilities for small systems (typically <= 10x10)
export const Matrix = {
  transpose(A: number[][]): number[][] {
    const m = A.length;
    const n = A[0].length;
    const AT: number[][] = Array.from({ length: n }, () => new Array(m).fill(0));
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        AT[j][i] = A[i][j];
      }
    }
    return AT;
  },

  multiply(A: number[][], B: number[][]): number[][] {
    const m = A.length;
    const n = A[0].length;
    const p = B[0].length;
    const C: number[][] = Array.from({ length: m }, () => new Array(p).fill(0));
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < p; j++) {
        let sum = 0;
        for (let k = 0; k < n; k++) {
          sum += A[i][k] * B[k][j];
        }
        C[i][j] = sum;
      }
    }
    return C;
  },

  multiplyVec(A: number[][], x: number[]): number[] {
    const m = A.length;
    const n = A[0].length;
    const y = new Array(m).fill(0);
    for (let i = 0; i < m; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        sum += A[i][j] * x[j];
      }
      y[i] = sum;
    }
    return y;
  },

  // Solves Ax = b using Gaussian elimination with partial pivoting
  solve(A: number[][], b: number[]): number[] | null {
    const n = b.length;
    // Create augmented matrix
    const M: number[][] = [];
    for (let i = 0; i < n; i++) {
      M.push([...A[i], b[i]]);
    }

    for (let i = 0; i < n; i++) {
      // Find pivot
      let maxEl = Math.abs(M[i][i]);
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(M[k][i]) > maxEl) {
          maxEl = Math.abs(M[k][i]);
          maxRow = k;
        }
      }

      // Swap maximum row with current row
      if (maxRow !== i) {
        const temp = M[i];
        M[i] = M[maxRow];
        M[maxRow] = temp;
      }

      // Check if singular
      if (Math.abs(M[i][i]) < 1e-12) {
        return null; // Singular matrix
      }

      // Make all rows below this one 0 in current column
      for (let k = i + 1; k < n; k++) {
        const c = -M[k][i] / M[i][i];
        for (let j = i; j <= n; j++) {
          if (i === j) {
            M[k][j] = 0;
          } else {
            M[k][j] += c * M[i][j];
          }
        }
      }
    }

    // Solve equation Mx = b for an upper triangular matrix
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      x[i] = M[i][n] / M[i][i];
      for (let k = i - 1; k >= 0; k--) {
        M[k][n] -= M[k][i] * x[i];
      }
    }
    return x;
  }
};

/**
 * Solves Non-Negative Least Squares: min ||Ax - b||_2^2 s.t. x >= 0
 * Implementation of Lawson-Hanson active-set NNLS algorithm.
 */
export function solveNNLS(A: number[][], b: number[]): number[] {
  const m = A.length;
  if (m === 0) return [];
  const n = A[0].length;
  if (n === 0) return [];

  // P: index set of passive variables (positive values)
  const P = new Set<number>();
  // Z: index set of active variables (clamped to zero)
  const Z = new Set<number>();
  for (let i = 0; i < n; i++) Z.add(i);

  let x = new Array(n).fill(0);
  const maxIterations = 3 * n;
  let iter = 0;

  while (iter < maxIterations) {
    iter++;
    // Compute dual vector w = A^T * (b - A*x)
    const Ax = Matrix.multiplyVec(A, x);
    const r: number[] = []; // Residual vector
    for (let i = 0; i < m; i++) r.push(b[i] - Ax[i]);

    const AT = Matrix.transpose(A);
    const w = Matrix.multiplyVec(AT, r);

    // Check termination criteria
    let wMax = -Infinity;
    let jMax = -1;
    for (const j of Z) {
      if (w[j] > wMax) {
        wMax = w[j];
        jMax = j;
      }
    }

    // If active set is empty or all dual variables corresponding to active constraints are non-positive
    if (Z.size === 0 || wMax <= 1e-9) {
      break;
    }

    // Move index jMax from Z to P
    Z.delete(jMax);
    P.add(jMax);

    let innerIter = 0;
    while (innerIter < 100) {
      innerIter++;
      // Solve unconstrained least squares problem for A_P * z = b
      // Form reduced matrix A_P of size m x |P|
      const pIndices = Array.from(P).sort((a, b) => a - b);
      const k = pIndices.length;
      if (k === 0) break;

      const AP: number[][] = [];
      for (let i = 0; i < m; i++) {
        const row: number[] = [];
        for (const p of pIndices) {
          row.push(A[i][p]);
        }
        AP.push(row);
      }

      // Solve normal equation (AP^T * AP) * zP = AP^T * b
      const APT = Matrix.transpose(AP);
      const APT_AP = Matrix.multiply(APT, AP);
      const APT_b = Matrix.multiplyVec(APT, b);

      const zP = Matrix.solve(APT_AP, APT_b);
      if (!zP) {
        // Singular system, revert latest index and break
        P.delete(jMax);
        Z.add(jMax);
        break;
      }

      // Check if all components of zP are positive
      let allPositive = true;
      for (let i = 0; i < k; i++) {
        if (zP[i] <= 1e-9) {
          allPositive = false;
          break;
        }
      }

      if (allPositive) {
        // Accept zP as new x
        x = new Array(n).fill(0);
        for (let i = 0; i < k; i++) {
          x[pIndices[i]] = zP[i];
        }
        break;
      }

      // Find alpha to interpolate between x and z
      let alpha = Infinity;
      let alphaIdx = -1;
      for (let i = 0; i < k; i++) {
        const j = pIndices[i];
        const zj = zP[i];
        if (zj <= 0) {
          const val = x[j] / (x[j] - zj);
          if (val < alpha) {
            alpha = val;
            alphaIdx = j;
          }
        }
      }

      if (alphaIdx === -1 || alpha === Infinity) {
        break;
      }

      // Update x
      for (let i = 0; i < k; i++) {
        const j = pIndices[i];
        x[j] = x[j] + alpha * (zP[i] - x[j]);
      }

      // Move all indices j in P with x[j] == 0 to Z
      for (const j of P) {
        if (Math.abs(x[j]) <= 1e-9) {
          x[j] = 0;
          P.delete(j);
          Z.add(j);
        }
      }
    }
  }

  return x;
}

export interface WaterMassEndmember {
  name: string;
  temperature: number;
  salinity: number;
  oxygen: number; // umol/kg
  phosphate: number; // umol/L
  nitrate: number; // umol/L
  silicate: number; // umol/L
  doc: number; // umol/L
}

export interface OMPAParameters {
  waterMasses: WaterMassEndmember[];
  weights: {
    temperature: number;
    salinity: number;
    oxygen: number;
    phosphate: number;
    nitrate: number;
    silicate: number;
    mass: number; // Weight of the sum of fractions = 1 constraint
  };
  redfieldRatios: {
    op: number;     // r_O/P (oxygen to phosphate, e.g., 170)
    np: number;     // r_N/P (nitrate to phosphate, e.g., 16)
    sip: number;    // r_Si/P (silicate to phosphate, e.g., 40)
  };
  minDepth: number; // Minimum depth to perform OMPA
}

export interface OMPAResult {
  fractions: Record<string, number>; // water mass name -> fraction
  deltaP: number; // Remineralized phosphate (umol/L)
  aou: number; // Apparent Oxygen Utilization (umol/kg)
  conservativeDoc: number; // umol/L
  deltaDoc: number; // umol/L (observed - conservative)
  residual: number; // sum of squared residuals
  success: boolean;
}

// Default standard values for Indian Ocean water masses (modified/adjusted for deep/intermediate waters)
export const DEFAULT_INDIAN_OCEAN_WATER_MASSES: WaterMassEndmember[] = [
  {
    name: "SAMW", // Subantarctic Mode Water
    temperature: 10.0,
    salinity: 34.65,
    oxygen: 245.0,
    phosphate: 1.2,
    nitrate: 18.0,
    silicate: 8.0,
    doc: 52.0
  },
  {
    name: "AAIW", // Antarctic Intermediate Water
    temperature: 4.5,
    salinity: 34.4,
    oxygen: 210.0,
    phosphate: 1.8,
    nitrate: 26.0,
    silicate: 25.0,
    doc: 46.0
  },
  {
    name: "NADW", // North Atlantic Deep Water (saline, nutrient poor, well oxygenated)
    temperature: 2.5,
    salinity: 34.85,
    oxygen: 230.0,
    phosphate: 1.3,
    nitrate: 21.0,
    silicate: 28.0,
    doc: 44.0
  },
  {
    name: "IDW", // Indian Deep Water (older, nutrient rich, lower oxygen)
    temperature: 1.5,
    salinity: 34.72,
    oxygen: 120.0,
    phosphate: 2.6,
    nitrate: 37.0,
    silicate: 110.0,
    doc: 38.0
  },
  {
    name: "CDW", // Circumpolar Deep Water
    temperature: 1.2,
    salinity: 34.70,
    oxygen: 165.0,
    phosphate: 2.2,
    nitrate: 32.0,
    silicate: 85.0,
    doc: 40.0
  }
];

export const DEFAULT_OMPA_PARAMETERS: OMPAParameters = {
  waterMasses: DEFAULT_INDIAN_OCEAN_WATER_MASSES,
  weights: {
    temperature: 15.0,
    salinity: 25.0,
    oxygen: 8.0,
    phosphate: 10.0,
    nitrate: 8.0,
    silicate: 6.0,
    mass: 100.0 // mass conservation gets a high weight
  },
  redfieldRatios: {
    op: 170.0, // r_O/P
    np: 16.0,  // r_N/P
    sip: 50.0  // r_Si/P
  },
  minDepth: 200
};

/**
 * Runs the eOMPA model on a single sample.
 */
export function runSampleOMPA(
  sample: {
    temperature: number;
    salinity: number;
    oxygen: number;
    phosphate: number;
    nitrate: number;
    silicate: number;
    doc?: number;
  },
  params: OMPAParameters
): OMPAResult {
  const { waterMasses, weights, redfieldRatios } = params;
  const n = waterMasses.length; // Number of water masses

  // Build the system of equations.
  // Variables to solve for: x_0, x_1, ..., x_{n-1} (water mass fractions) AND deltaP (biogeochemical term)
  // Total variables: n + 1
  // Equations:
  // 1. Temp: sum(x_i * T_i) = T_obs
  // 2. Salinity: sum(x_i * S_i) = S_obs
  // 3. Phosphate: sum(x_i * P_i) + deltaP = P_obs
  // 4. Nitrate: sum(x_i * N_i) + r_N/P * deltaP = N_obs
  // 5. Oxygen: sum(x_i * O_i) - r_O/P * deltaP = O_obs
  // 6. Silicate: sum(x_i * Si_i) + r_Si/P * deltaP = Si_obs
  // 7. Mass Conservation: sum(x_i) = 1 (deltaP coefficient is 0)

  // We will construct matrix A (equations as rows, variables as columns)
  // Size of A: 7 rows, n + 1 columns
  const A: number[][] = [];
  const b: number[] = [];

  // Parameter values observed
  const obs = [
    sample.temperature,
    sample.salinity,
    sample.oxygen,
    sample.phosphate,
    sample.nitrate,
    sample.silicate,
    1.0 // Sum of fractions = 1
  ];

  // Parameter weights
  const w = [
    weights.temperature,
    weights.salinity,
    weights.oxygen,
    weights.phosphate,
    weights.nitrate,
    weights.silicate,
    weights.mass
  ];

  // For normalization, we scale equations by their weights.
  // Equation 0: Temp
  let rowTemp = waterMasses.map(wm => wm.temperature);
  rowTemp.push(0); // Coefficient for deltaP is 0
  A.push(rowTemp.map(val => val * w[0]));
  b.push(obs[0] * w[0]);

  // Equation 1: Salinity
  let rowSal = waterMasses.map(wm => wm.salinity);
  rowSal.push(0); // Coefficient for deltaP is 0
  A.push(rowSal.map(val => val * w[1]));
  b.push(obs[1] * w[1]);

  // Equation 2: Oxygen
  let rowO2 = waterMasses.map(wm => wm.oxygen);
  rowO2.push(-redfieldRatios.op); // Coefficient for deltaP is -r_O/P
  A.push(rowO2.map(val => val * w[2]));
  b.push(obs[2] * w[2]);

  // Equation 3: Phosphate
  let rowPhos = waterMasses.map(wm => wm.phosphate);
  rowPhos.push(1.0); // Coefficient for deltaP is 1
  A.push(rowPhos.map(val => val * w[3]));
  b.push(obs[3] * w[3]);

  // Equation 4: Nitrate
  let rowNit = waterMasses.map(wm => wm.nitrate);
  rowNit.push(redfieldRatios.np); // Coefficient for deltaP is r_N/P
  A.push(rowNit.map(val => val * w[4]));
  b.push(obs[4] * w[4]);

  // Equation 5: Silicate
  let rowSil = waterMasses.map(wm => wm.silicate);
  rowSil.push(redfieldRatios.sip); // Coefficient for deltaP is r_Si/P
  A.push(rowSil.map(val => val * w[5]));
  b.push(obs[5] * w[5]);

  // Equation 6: Mass conservation (sum(x_i) = 1)
  let rowMass = Array(n).fill(1.0);
  rowMass.push(0); // Coefficient for deltaP is 0
  A.push(rowMass.map(val => val * w[6]));
  b.push(obs[6] * w[6]);

  // Solve using NNLS
  const x = solveNNLS(A, b);

  if (x.length === 0) {
    return {
      fractions: {},
      deltaP: 0,
      aou: 0,
      conservativeDoc: 0,
      deltaDoc: 0,
      residual: 999,
      success: false
    };
  }

  // Parse fractions
  const fractions: Record<string, number> = {};
  let sumFractions = 0;
  for (let i = 0; i < n; i++) {
    fractions[waterMasses[i].name] = x[i];
    sumFractions += x[i];
  }

  // If fractions are all zero, sumFractions will be 0. Avoid division by zero
  const normFractions: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    normFractions[waterMasses[i].name] = sumFractions > 0 ? x[i] / sumFractions : 0;
  }

  const deltaP = x[n]; // The last solved variable is deltaP

  // Calculate conservative DOC
  let conservativeDoc = 0;
  for (let i = 0; i < n; i++) {
    conservativeDoc += normFractions[waterMasses[i].name] * waterMasses[i].doc;
  }

  // Delta DOC: observed - conservative
  const deltaDoc = sample.doc !== undefined ? sample.doc - conservativeDoc : 0;

  // Calculate residual sum of squares (RSS)
  const Ax = Matrix.multiplyVec(A, x);
  let residual = 0;
  for (let i = 0; i < A.length; i++) {
    residual += Math.pow(Ax[i] - b[i], 2);
  }

  // Approximate AOU from solved deltaP using Redfield ratio (delta AOU = r_O/P * deltaP)
  const aou = deltaP * redfieldRatios.op;

  return {
    fractions: normFractions,
    deltaP,
    aou,
    conservativeDoc,
    deltaDoc,
    residual,
    success: true
  };
}
