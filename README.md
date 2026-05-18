# Dashboard

Eyeway **Vite + React** map/table UI backed by Supabase. Port **8080** (see `vite.config.ts`).

## Local development

From this directory:

```bash
npm install   # or: bun install
# Optional: cp .env.example .env.local  then fill VITE_MAPBOX_ACCESS_TOKEN etc.
npm run dev   # or: bun run dev
```

Production build:

```bash
npm run build
```

Supabase migrations for the shared database live at the repo root in `supabase/migrations/`; generated client snippets live under `src/integrations/supabase/` (do not edit `types.ts` by hand if it is codegen output).
