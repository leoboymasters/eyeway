-- processing_tasks: drop Kiri-specific column name; value is the external/async job id for any backend.
alter table public.processing_tasks
  rename column kiri_task_id to external_task_id;
