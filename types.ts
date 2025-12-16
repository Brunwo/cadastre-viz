export interface ParsedParcel {
  id: string; // Unique ID for React keys
  rawText: string;
  communeName: string;
  inseeCode?: string;
  section: string;
  numero: string;
  status: 'pending' | 'loading' | 'success' | 'error';
  geoJson?: any; // GeoJSON geometry
  errorMessage?: string;
}

export interface InseeResponse {
  nom: string;
  code: string;
  codesPostaux: string[];
}

export enum ParseStatus {
  IDLE,
  PARSING_TEXT,
  FETCHING_INSEE,
  FETCHING_GEOMETRY,
  COMPLETED
}
