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

  const prompt = `You are reviewing a single image from a road-facing camera (possibly a cropped ROI around a detector box).
Classify whether the image plausibly shows a pothole or road surface damage vs a likely false alarm (shadows, patches, joints, leaves, wet glare, etc.).

scene_summary (maintenance-facing, not a "photo caption"):
Write 3–6 complete sentences that focus on the ROAD SURFACE and the ALLEGED DEFECT or what actually explains the detection.
Start with the pavement and the feature in frame (e.g. cavity, edge breakup, patch, crack, joint, water in a hollow, alligator cracking). Mention shape, approximate extent in the image, edge sharpness, interior shadow/texture, material contrast, and anything that supports or contradicts pothole vs false alarm.

FORBIDDEN in scene_summary: do not describe the camera, vehicle, dashcam, "forward view", "looking ahead", "the image shows", "we see a view from", "this photograph", or similar meta-framing. Jump straight to what is on the road.

If it is likely a false positive, still describe the road feature you think it is (e.g. sealed joint, wet stripe, tar patch) concretely—no vehicle perspective filler.
Do not trail off with an ellipsis or end mid-phrase.

Be conservative: use "uncertain" when quality or framing is ambiguous.
review_filter:
- keep: credible road defect / pothole evidence
- manual_review: mixed or unclear; human should look
- likely_false_positive: probably not a pothole (explain in caveats)

Return JSON matching the schema only.`;

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
