/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPBOX_ACCESS_TOKEN: string;
  /** Dev / demo only: key is bundled into the client. Prefer VITE_GEMINI_PROXY_URL in production. */
  readonly VITE_GEMINI_API_KEY?: string;
  /** POST { imageDataUrl } → RoadImageGeminiAnalysis JSON. Keeps Gemini key server-side. */
  readonly VITE_GEMINI_PROXY_URL?: string;
  /** Override default `gemini-3.1-flash-lite` — see https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite */
  readonly VITE_GEMINI_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
