export interface RawInjection {
  fileName: string;
  sampleName: string;
  sampleId: string;
  injNo: number;
  type: string;
  area: number;
}

export interface SampleGroup {
  id: string; // unique key: fileName + '::' + sampleName + '::' + sampleId
  fileName: string;
  sampleName: string;
  sampleId: string;
  injections: number[]; // area values of all injections
  selectedInjections: boolean[]; // whether each injection is selected (size 4 or 3)
  avArea: number; // average area of selected injections
  sdArea: number; // standard deviation of selected injections
  rsd: number; // relative standard deviation (%)
  
  // Classification
  isStd: boolean;
  isBlank: boolean;
  isSeawater: boolean; // DSW or SSW or SW1/2/3
  
  // Parsed metadata
  station: string | null;
  depth: number | null;
}

export interface StdPoint {
  id: string;
  sampleName: string;
  theoreticalC: number; // theoretical concentration in umol C/L
  area: number; // average area
  enabled: boolean; // whether this standard point is used in regression
}

export interface CalibrationCurve {
  slope: number;
  intercept: number;
  rsq: number;
}
