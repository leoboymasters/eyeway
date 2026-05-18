import type { RoadImageGeminiAnalysis } from '@/types/geminiAnalysis';

export const GEMINI_CACHE_UPDATED_EVENT = 'eyeway-gemini-cache-updated';

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
