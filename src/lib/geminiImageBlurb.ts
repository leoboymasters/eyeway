import type { RoadImageGeminiAnalysis } from '@/types/geminiAnalysis';

const DEFAULT_MAX = 640;

/**
 * Caption for pothole `description` / UI — word-boundary trim (default ~half a screen of text).
 */
export function shortImageDescriptionFromAnalysis(
  a: Pick<RoadImageGeminiAnalysis, 'scene_summary'>,
  maxLen: number = DEFAULT_MAX,
): string {
  let t = a.scene_summary.trim().replace(/\s+/g, ' ');
  if (!t) return '';
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen);
  const sp = cut.lastIndexOf(' ');
  const head = sp > Math.floor(maxLen * 0.35) ? cut.slice(0, sp) : cut;
  return `${head.trimEnd()}…`;
}
