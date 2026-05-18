import { GoogleGenerativeAI, GoogleGenerativeAIFetchError, SchemaType } from '@google/generative-ai';

import type { RoadImageGeminiAnalysis } from '@/types/geminiAnalysis';

/**
 * Default: Gemini 3.1 Flash-Lite (model code `gemini-3.1-flash-lite`).
 * @see https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite
 * Override with VITE_GEMINI_MODEL if needed.
 */
const MODEL_ID = import.meta.env.VITE_GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite';

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    assessment: {
      type: SchemaType.STRING,
      format: 'enum' as const,
      enum: ['likely_pothole', 'unlikely_pothole', 'uncertain'],
    },
    confidence_0_to_1: { type: SchemaType.NUMBER },
    scene_summary: { type: SchemaType.STRING },
    road_surface: { type: SchemaType.STRING },
    lighting_conditions: { type: SchemaType.STRING },
    visible_issues: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    distinguishing_features: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    caveats: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    review_filter: {
      type: SchemaType.STRING,
      format: 'enum' as const,
      enum: ['keep', 'manual_review', 'likely_false_positive'],
    },
  },
  required: [
    'assessment',
    'confidence_0_to_1',
    'scene_summary',
    'road_surface',
    'lighting_conditions',
    'visible_issues',
    'distinguishing_features',
    'caveats',
    'review_filter',
  ],
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function resolveToDataUrl(imageSrc: string): Promise<string> {
  const s = imageSrc.trim();
  if (s.startsWith('data:image/')) {
    parseDataUrl(s);
    return s;
  }
  if (s.startsWith('http://') || s.startsWith('https://')) {
    const res = await fetch(s);
    if (!res.ok) {
      throw new Error(`Could not load image for analysis (${res.status}).`);
    }
    const blob = await res.blob();
    const mimeType =
      blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
    const buf = await blob.arrayBuffer();
    return `data:${mimeType};base64,${arrayBufferToBase64(buf)}`;
  }
  throw new Error('Unsupported image URL for Gemini (use a data URL or http(s) image).');
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const m = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!m) {
    throw new Error('Image must be a base64 data URL (e.g. data:image/jpeg;base64,…).');
  }
  const mimeType = m[1];
  const base64 = m[2];
  if (!mimeType.startsWith('image/')) {
    throw new Error('Data URL must be an image.');
  }
  return { mimeType, base64 };
}

function coerceAnalysis(raw: unknown): RoadImageGeminiAnalysis {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid analysis response.');
  }
  const o = raw as Record<string, unknown>;
  const assessment = o.assessment;
  const review_filter = o.review_filter;
  if (
    assessment !== 'likely_pothole' &&
    assessment !== 'unlikely_pothole' &&
    assessment !== 'uncertain'
  ) {
    throw new Error('Missing or invalid assessment.');
  }
  if (
    review_filter !== 'keep' &&
    review_filter !== 'manual_review' &&
    review_filter !== 'likely_false_positive'
  ) {
    throw new Error('Missing or invalid review_filter.');
  }
  const conf = Number(o.confidence_0_to_1);
  if (!Number.isFinite(conf)) {
    throw new Error('Missing confidence_0_to_1.');
  }
  const str = (k: string) => (typeof o[k] === 'string' ? o[k] : '');
  const strArr = (k: string) =>
    Array.isArray(o[k]) ? o[k].filter((x): x is string => typeof x === 'string') : [];

  return {
    assessment,
    confidence_0_to_1: Math.min(1, Math.max(0, conf)),
    scene_summary: str('scene_summary'),
    road_surface: str('road_surface'),
    lighting_conditions: str('lighting_conditions'),
    visible_issues: strArr('visible_issues'),
    distinguishing_features: strArr('distinguishing_features'),
    caveats: strArr('caveats'),
    review_filter,
  };
}

/**
 * POST JSON `{ "imageDataUrl": string }` → same shape as RoadImageGeminiAnalysis.
 */
async function analyzeViaProxy(proxyUrl: string, imageDataUrl: string): Promise<RoadImageGeminiAnalysis> {
  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ imageDataUrl }),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Proxy returned non-JSON (${res.status}).`);
  }
  if (!res.ok) {
    const msg =
      body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Analyze request failed (${res.status}).`;
    throw new Error(msg);
  }
  return coerceAnalysis(body);
}

function toFriendlyGeminiError(err: unknown): Error {
  if (err instanceof GoogleGenerativeAIFetchError) {
    const reasons =
      err.errorDetails?.map((d) => d.reason).filter((r): r is string => typeof r === 'string') ?? [];
    const serviceBlocked = reasons.some(
      (r) => r === 'API_KEY_SERVICE_BLOCKED' || r.includes('API_KEY_SERVICE_BLOCKED'),
    );
    if (err.status === 403 && serviceBlocked) {
      return new Error(
        'Gemini 403 API_KEY_SERVICE_BLOCKED: this key is not allowed to call generativelanguage.googleapis.com. ' +
          'Use a key from https://aistudio.google.com/app/apikey — or in Google Cloud Console enable "Generative Language API" for the key\'s project and set API key restrictions to include that API (not only Maps/other products).',
      );
    }
    const extra = reasons.length ? ` Reasons: ${reasons.join('; ')}.` : '';
    return new Error(`Gemini API HTTP ${err.status ?? '?'}: ${err.message}.${extra}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

async function analyzeViaGeminiApi(imageDataUrl: string): Promise<RoadImageGeminiAnalysis> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error(
      'Set VITE_GEMINI_PROXY_URL (recommended) or VITE_GEMINI_API_KEY in .env.local to enable Analyze.',
    );
  }
  const { mimeType, base64 } = parseDataUrl(imageDataUrl);

  const genAI = new GoogleGenerativeAI(apiKey.trim());
  const model = genAI.getGenerativeModel({
    model: MODEL_ID,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const prompt = `Respond in English.

You are reviewing a tight crop around a single suspected pothole / road-surface defect. Exactly ONE feature is under review — ignore everything else in the frame.

CLASSIFY whether that one feature is a real road defect or a false alarm.

VISUAL ONTOLOGY (use this to discriminate — do NOT mention measurements, centimeters, or sizes anywhere; the system already has measurement data):
- Pothole: cavity with missing material, ragged or undercut edges, interior shadow or visible depth, often exposed aggregate.
- Tar patch / sealed repair: dark filled blob or rectangle, smooth top, flush with the surface, NO depth.
- Sealed joint: linear dark band, straight, follows pavement panel edges.
- Manhole / drain rim: circular metal or concrete, often labeled, flush or slightly raised.
- Painted marking / arrow: high-contrast paint on intact surface, geometric, no texture loss.
- Wet patch: darker than surroundings, irregular, no rim, may reflect sky.
- Shadow: soft edges, follows the outline of a nearby object, no material or texture change underneath.
- Loose debris / leaf: sits on top of the surface, intact pavement underneath.

scene_summary (3 sentences, maintenance-facing): describe ONLY the one feature.
The first sentence MUST start with a noun naming the feature ("Cavity…", "Patch…", "Joint…", "Shadow…", "Manhole…", "Painted marking…", etc.). Do NOT start with "The…", "A…", "This…", "It…".
Cover the three most diagnostic cues: shape, edge character (sharp / ragged / soft / linear), and interior — exposed aggregate, shadow, water, fill material, or intact surface. Mention a depth cue (cast shadow, color drop-off) when visible.

FORBIDDEN in scene_summary:
- Any measurement language: centimeters, meters, inches, "~", "approximately X cm", "size of a", "diameter", "wide", "deep" in numeric terms.
- Describing the wider road / surrounding pavement / general condition.
- Camera or vehicle meta: "the image shows", "forward view", "dashcam", "we see", "this photograph", "looking ahead".
- Ellipses or trailing-off sentences.

GOOD vs BAD scene_summary examples:
- GOOD: "Cavity with ragged asphalt edges and missing material along the rim. Interior is dark with exposed aggregate and a defined cast shadow on the far edge. The drop-off in tone indicates real depth rather than a surface mark."
- BAD: "The road surface consists of aging concrete panels with longitudinal cracking and surface degradation."  (whole-road description)
- BAD: "A round pothole around 25 cm across with a depth of roughly 4 cm."  (measurements — forbidden)
- BAD: "The image shows a forward view of a road where we see a depression."  (camera meta)

confidence_0_to_1: probability that this feature is a real road defect requiring maintenance. Calibration — 0.85+ obvious defect, 0.5–0.7 plausible, <0.3 likely false alarm.

CONSISTENCY (required — these MUST agree):
- assessment=likely_pothole    ⇒ review_filter=keep
- assessment=unlikely_pothole  ⇒ review_filter=likely_false_positive
- assessment=uncertain         ⇒ review_filter=manual_review

QUALITY FAIL-FAST: if the feature is occluded by the vehicle hood, motion-blurred, off-road (sky, sidewalk, grass, vehicle body), or unresolvable, set assessment=uncertain, review_filter=manual_review, and explain the limitation in caveats.

distinguishing_features: short bullet-style entries that name the evidence supporting your assessment (works for both pothole and false-positive verdicts).
visible_issues: surface problems actually visible in frame.
road_surface / lighting_conditions: broader context — may describe the surrounding scene.`;

  try {
    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType, data: base64 } },
    ]);
    const text = result.response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Gemini returned unreadable JSON.');
    }
    return coerceAnalysis(parsed);
  } catch (err) {
    throw toFriendlyGeminiError(err);
  }
}

/**
 * Gemini vision analyze for dashboard pothole detail.
 * Accepts a base64 data URL or a fetchable http(s) image URL.
 * Prefer VITE_GEMINI_PROXY_URL in production so the API key stays server-side.
 */
export async function analyzeRoadImage(imageSrc: string): Promise<RoadImageGeminiAnalysis> {
  const dataUrl = await resolveToDataUrl(imageSrc);
  const proxy = import.meta.env.VITE_GEMINI_PROXY_URL?.trim();
  if (proxy) {
    return analyzeViaProxy(proxy, dataUrl);
  }
  return analyzeViaGeminiApi(dataUrl);
}
