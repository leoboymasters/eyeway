export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type Status = 'reported' | 'inspected' | 'scheduled' | 'in-progress' | 'completed';

/** Cloud fusion outputs (Cloud Run → Supabase). */
export interface PotholeFusion {
  fusionOk: boolean | null;
  surfaceAreaM2: number | null;
  /** True when surfaceAreaM2 was filled as width×length (segmentation area missing in DB). */
  surfaceAreaIsEstimate?: boolean;
  widthM: number | null;
  lengthM: number | null;
  yoloConfidence: number | null;
  source: string | null;
  trackId: number | null;
}

export interface Pothole {
  id: string;
  location: {
    lat: number;
    lng: number;
    /** Human-readable line, e.g. road segment id */
    address?: string;
    roadId?: string;
  };
  severity: Severity;
  status: Status;
  detectionAccuracy: number;
  reportDate: string;
  scheduledRepairDate?: string;
  completionDate?: string;
  images: string[];
  /** Optional YOLO bbox crop when both full frame and crop are stored (legacy: sometimes full frame here). */
  frameImageUrl?: string;
  /** Detection box on the full street-view frame ([x1,y1,x2,y2] pixels or normalized). */
  bboxXyxy?: [number, number, number, number] | null;
  /** Frame size at inference (pairs with bbox_xyxy). */
  frameWidth?: number | null;
  frameHeight?: number | null;
  description?: string;
  reportedBy?: string;
  /** Cloud Run DA3 + fusion. */
  fusion?: PotholeFusion;
  model_url?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'maintenance' | 'inspector' | 'reporter';
  avatar?: string;
}

export interface MapViewState {
  latitude: number;
  longitude: number;
  zoom: number;
}
