-- Deduplicate pothole inserts when the edge retries after timeout or replays offline queue.
-- Apply in Supabase SQL editor or via `supabase db push` if you use the CLI.

alter table public.potholes
  add column if not exists fusion_idempotency_key text;

create unique index if not exists potholes_fusion_idempotency_key_uidx
  on public.potholes (fusion_idempotency_key);

comment on column public.potholes.fusion_idempotency_key is
  'Client-supplied UUID per fusion request; PostgREST upsert on_conflict=fusion_idempotency_key';
