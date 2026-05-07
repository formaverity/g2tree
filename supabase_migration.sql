-- G2Tree schema migration: scan-state columns
-- Run this in your Supabase SQL editor (Dashboard → SQL Editor → New query)
-- All statements use IF NOT EXISTS so the script is safe to re-run.

-- ── New SI measurement columns ────────────────────────────────────────────────
ALTER TABLE g2tree_trees ADD COLUMN IF NOT EXISTS dbh_cm          NUMERIC;
ALTER TABLE g2tree_trees ADD COLUMN IF NOT EXISTS height_m        NUMERIC;
ALTER TABLE g2tree_trees ADD COLUMN IF NOT EXISTS crown_spread_m  NUMERIC;
ALTER TABLE g2tree_trees ADD COLUMN IF NOT EXISTS health_score    INTEGER;
ALTER TABLE g2tree_trees ADD COLUMN IF NOT EXISTS canopy_density  INTEGER;
ALTER TABLE g2tree_trees ADD COLUMN IF NOT EXISTS location_source TEXT;

-- ── Rich JSONB columns ────────────────────────────────────────────────────────
ALTER TABLE g2tree_trees ADD COLUMN IF NOT EXISTS ecological_benefits JSONB;
ALTER TABLE g2tree_trees ADD COLUMN IF NOT EXISTS procedural_params   JSONB;
ALTER TABLE g2tree_trees ADD COLUMN IF NOT EXISTS vision_analysis     JSONB;

-- ── Audit timestamps ──────────────────────────────────────────────────────────
ALTER TABLE g2tree_trees ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION g2tree_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS g2tree_trees_updated_at ON g2tree_trees;
CREATE TRIGGER g2tree_trees_updated_at
  BEFORE UPDATE ON g2tree_trees
  FOR EACH ROW EXECUTE FUNCTION g2tree_set_updated_at();

-- ── Optional: index for spatial queries ──────────────────────────────────────
-- CREATE INDEX IF NOT EXISTS g2tree_trees_location ON g2tree_trees (lat, lng)
-- WHERE lat IS NOT NULL AND lng IS NOT NULL;
