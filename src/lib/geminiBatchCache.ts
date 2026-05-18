import type { RoadImageGeminiAnalysis } from '@/types/geminiAnalysis';

export const GEMINI_CACHE_UPDATED_EVENT = 'eyeway-gemini-cache-updated';

/** Validate a `gemini_analysis` JSON blob coming back from Supabase. */
export function coerceGeminiAnalysis(raw: unknown): RoadImageGeminiAnalysis | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const assessment = o.assessment;
  const review_filter = o.review_filter;
  if (assessment !== 'likely_pothole' && assessment !== 'unlikely_pothole' && assessment !== 'uncertain') {
    return null;
  }
  if (review_filter !== 'keep' && review_filter !== 'manual_review' && review_filter !== 'likely_false_positive') {
    return null;
  }
  const conf = Number(o.confidence_0_to_1);
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '');
  const strArr = (k: string) =>
    Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  return {
    assessment,
    confidence_0_to_1: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0,
    scene_summary: str('scene_summary'),
    road_surface: str('road_surface'),
    lighting_conditions: str('lighting_conditions'),
    visible_issues: strArr('visible_issues'),
    distinguishing_features: strArr('distinguishing_features'),
    caveats: strArr('caveats'),
    review_filter,
  };
}

/** Map / UI: does this analysis (DB or cache) say "not a pothole"? */
export function geminiAnalysisIsNotPothole(a: RoadImageGeminiAnalysis | null | undefined): boolean {
  if (!a) return false;
  return a.assessment === 'unlikely_pothole' || a.review_filter === 'likely_false_positive';
}

type Entry = { analyzedAt: string; rowStamp: string; analysis: RoadImageGeminiAnalysis };

const KEY = 'eyeway.geminiBatch.v1';

function readStore(): Record<string, Entry> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Record<string, Entry>;
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

function writeStore(s: Record<string, Entry>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* quota / private mode */
  }
}

/** Fingerprint so we re-run Gemini when the row (or images) change. */
export function geminiRowStamp(row: {
  updated_at?: string | null;
  image_url?: string | null;
  frame_image_url?: string | null;
}): string {
  if (row.updated_at) return row.updated_at;
  return `len:${(row.image_url || '').length}:${(row.frame_image_url || '').length}`;
}

export function isGeminiBatchCurrent(id: string, rowStamp: string): boolean {
  const e = readStore()[id];
  return !!e && e.rowStamp === rowStamp;
}

export function getGeminiBatchEntry(id: string): Entry | null {
  return readStore()[id] ?? null;
}

/** Map / UI: Gemini concluded this is not a road pothole (or likely false positive). */
export function isGeminiNotPotholeMark(id: string): boolean {
  const e = readStore()[id];
  if (!e) return false;
  const a = e.analysis;
  return a.assessment === 'unlikely_pothole' || a.review_filter === 'likely_false_positive';
}

export function setGeminiBatchEntry(id: string, rowStamp: string, analysis: RoadImageGeminiAnalysis): void {
  const s = readStore();
  s[id] = { analyzedAt: new Date().toISOString(), rowStamp, analysis };
  writeStore(s);
}

export function clearGeminiBatchCache(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* empty */
  }
  window.dispatchEvent(new CustomEvent(GEMINI_CACHE_UPDATED_EVENT));
}
