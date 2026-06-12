export interface MaterialProperties {
  width: number; // in mm
  thickness: number; // in mm
  length: number; // in mm
  mass: number; // in kg
}

export interface CustomMarkers {
  markerA: string;
  markerB: string;
  markerC: string;
  markerD: string;
}

export type AudioSourceType = 'mic' | 'file';

export interface CalculatedData {
  density: number | null;
  liveEUser: number | null;
  liveEPhys: number | null;
  maxEUser: number | null;
  maxEPhys: number | null;
}

export interface TrimSelection {
  startPercent: number; // 0 to 1
  endPercent: number; // 0 to 1
}

export interface RecordedAudio {
  id: string;
  pcmData: Float32Array;
  sampleRate: number;
  duration: number; // in seconds
  blobUrl: string;
}
