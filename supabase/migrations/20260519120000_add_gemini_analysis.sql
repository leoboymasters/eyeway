-- Persist Gemini vision analysis on the pothole row so all clients (and the
-- public dashboard) see the same "not a pothole" / scene context, instead of
-- only the localStorage cache that triggered Gemini originally.
ALTER TABLE public.potholes
  ADD COLUMN IF NOT EXISTS gemini_analysis JSONB;

COMMENT ON COLUMN public.potholes.gemini_analysis IS
  'Full RoadImageGeminiAnalysis JSON from the dashboard Gemini batch (assessment, confidence_0_to_1, scene_summary, review_filter, ...).';
