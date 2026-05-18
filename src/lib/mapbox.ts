/**
 * Mapbox GL runs tile work in a Web Worker. Loading the worker from Mapbox's CDN
 * (`workerUrl` → api.mapbox.com) fails on many hosts with:
 *   SecurityError: Failed to construct 'Worker': Script at 'https://api.mapbox.com/...'
 *   cannot be accessed from origin 'https://<your-app>.vercel.app'
 *
 * Bundling the CSP worker with Vite (`?worker`) serves it from your deployment origin,
 * which satisfies same-origin worker rules.
 *
 * Set VITE_MAPBOX_ACCESS_TOKEN in Vercel → Project → Settings → Environment Variables.
 */
import mapboxgl from "mapbox-gl";
import MapboxWorker from "mapbox-gl/dist/mapbox-gl-csp-worker?worker";

mapboxgl.workerClass = MapboxWorker as unknown as typeof mapboxgl.workerClass;

/** Turn off events.mapbox.com telemetry POSTs (avoids access_token in analytics URLs; ad blockers often block these). */
const cfg = mapboxgl as unknown as { config?: Record<string, unknown> };
if (cfg.config) {
  try {
    Object.defineProperty(cfg.config, "EVENTS_URL", {
      get: () => null,
      configurable: true,
    });
  } catch {
    /* ignore */
  }
}

export function getMapboxAccessToken(): string {
  return (import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ?? "").trim();
}

export { mapboxgl };
