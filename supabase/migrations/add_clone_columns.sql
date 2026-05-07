-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- Adds clone and storage-metadata columns to g2tree_trees

alter table public.g2tree_trees
  add column if not exists clone_status          text        not null default 'draft',
  add column if not exists clone_data            jsonb       not null default '{}'::jsonb,
  add column if not exists texture_samples       jsonb       not null default '{}'::jsonb,
  add column if not exists source_photo_summary  jsonb       not null default '[]'::jsonb,
  add column if not exists finished_at           timestamptz;

-- Optional: add index for filtering by clone_status
create index if not exists g2tree_trees_clone_status_idx
  on public.g2tree_trees (user_id, clone_status);
