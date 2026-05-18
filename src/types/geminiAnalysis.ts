/** Parsed Gemini vision output for road / pothole images (dashboard analyze flow). */

export type GeminiPotholeAssessment = 'likely_pothole' | 'unlikely_pothole' | 'uncertain';

/** Human workflow hint — not persisted unless you add DB columns later. */
export type GeminiReviewFilter = 'keep' | 'manual_review' | 'likely_false_positive';

export interface RoadImageGeminiAnalysis {
  assessment: GeminiPotholeAssessment;
  /** Model self-reported certainty 0–1; informational only. */
  confidence_0_to_1: number;
  /** Road- and defect-focused summary (no dashcam / "the image shows" filler). */
  scene_summary: string;
  road_surface: string;
  lighting_conditions: string;
  /** Issues or objects relevant to road maintenance (cracks, patch, water, shadow, etc.). */
  visible_issues: string[];
  /** Salient visual details that support the assessment. */
  distinguishing_features: string[];
  /** Ambiguity, occlusion, or quality limits. */
  caveats: string[];
  review_filter: GeminiReviewFilter;
}
