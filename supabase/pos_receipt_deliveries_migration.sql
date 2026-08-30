-- ============================================================================
-- Persist POS receipt deliveries + the import window setting
-- ============================================================================
-- Run once in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS / DROP
-- POLICY IF EXISTS throughout), and wrapped in an explicit transaction so a
-- failure part-way through cannot leave half the objects behind.
--
-- v2 CORRECTION: an earlier draft did
--   ALTER TABLE public.app_settings ADD COLUMN pos_window_days ...
-- on the premise that app_settings already existed holding q_factor_pct. It
-- does NOT exist in this database — supabase/migrations/0002_q_factor.sql is
-- present in the repo but was never applied. Verified directly:
--   select on public.app_settings -> PGRST205 "Could not find the table".
-- This version creates its own scoped singleton instead. The core costing
-- q-factor is a separate concern and is deliberately NOT addressed here.
--
-- WHY THIS TABLE EXISTS
-- The POS "ใบรับสินค้าตรง" export is a ROLLING WINDOW — the verified sample
-- covers 01 เมษายน – 11 กรกฎาคม 2569 only. Deliveries older than the window
-- are not re-downloadable, so anything the importer discards at parse time is
-- gone for good. parsePosReceiptDeliveries() already returns every delivery;
-- this is where they come to rest.
--
-- Measured against the archived exports before designing this:
--   9 usable DETAIL exports -> 41,433 rows -> 20,109 distinct
--                              (document_number, material_code) pairs
--   i.e. ~51% of rows across exports are re-imports of the same delivery
--   0 cases of a repeated key carrying different qty/cost/unit
--   0 material_codes ever seen under more than one name (15 months)
-- So the natural key below is sound and an upsert on it is lossless.
--
-- Ingesting the archive yields ~465 days of history (1/4/2568 -> 10/7/2569),
-- which is what makes the 90-day window meaningful rather than identical to
-- "all available".
-- ============================================================================

BEGIN;


-- ── 1. Deliveries ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pos_receipt_deliveries (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity of the POS material. Deliberately NOT a FK to ingredients: a
  -- delivery is a fact about a POS material, and the material -> ingredient
  -- mapping (name match + pos_price_aliases) is meant to stay editable.
  -- Freezing it here would let a later remapping silently mis-value history.
  material_code      TEXT NOT NULL,
  material_name      TEXT NOT NULL,

  document_number    TEXT NOT NULL,
  -- Stored as a real DATE (CE), converted from the report's Buddhist-era
  -- string at parse time, so window queries can use interval arithmetic.
  -- The parser's numeric dateKey (e.g. 25690711) stays an in-memory ordering
  -- detail and is not persisted.
  document_date      DATE NOT NULL,

  -- '' is a genuine vendor identity in this data (0.7% of rows, and the
  -- DOMINANT identity for มะม่วง), so this is NOT NULL DEFAULT '' rather than
  -- nullable — the vendor-grouping logic in the importer must never compare
  -- against NULL.
  vendor_name        TEXT NOT NULL DEFAULT '',

  unit_name          TEXT NOT NULL,

  -- numeric, not integer: 1,986 of 20,109 rows have a fractional qty.
  -- No positive-only CHECK on cost: total_cost_inc_vat = 0 genuinely occurs.
  -- (The parser already drops qty <= 0 rows before they reach here.)
  qty                NUMERIC NOT NULL,
  total_cost_inc_vat NUMERIC NOT NULL,
  total_cost_exc_vat NUMERIC NOT NULL,

  imported_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL for rows written by the one-off backfill script (service role has no
  -- auth.uid()). Acceptable: these are historical facts, not decisions.
  imported_by        UUID REFERENCES auth.users (id),
  source_file        TEXT,

  -- The idempotency key. Re-importing an overlapping export is a genuine
  -- no-op per delivery rather than depending on values coinciding.
  CONSTRAINT pos_receipt_deliveries_document_material_key
    UNIQUE (document_number, material_code)
);

-- Deliberately no unit_cost column: it is total/qty on whichever VAT basis is
-- configured, and whether VAT belongs in food cost is still an open business
-- question (see COST_BASIS in src/lib/pos-import.ts). Storing both totals
-- keeps either basis derivable; storing unit_cost would bake today's answer
-- into permanent history.

-- Serves the per-material window query: filter by code, order/filter by date.
CREATE INDEX IF NOT EXISTS idx_pos_receipt_deliveries_material_date
  ON public.pos_receipt_deliveries (material_code, document_date DESC);

-- Serves period queries across all materials (e.g. valuing a past period at
-- the prices actually in effect).
CREATE INDEX IF NOT EXISTS idx_pos_receipt_deliveries_date
  ON public.pos_receipt_deliveries (document_date);


-- ── 2. Import settings ──────────────────────────────────────────────────────
-- A scoped singleton for this import system only. Deliberately NOT a
-- general-purpose settings table: the core costing q-factor is a separate
-- concern (and currently has no table at all — see the v2 note at the top),
-- and bundling it here would couple two unrelated systems in the same
-- migration.

CREATE TABLE IF NOT EXISTS public.pos_import_settings (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  -- How many days of delivery history the importer considers when computing
  -- a material's price candidates.
  window_days INTEGER NOT NULL DEFAULT 90,
  CONSTRAINT pos_import_settings_singleton CHECK (id = 1)
);

-- Seed the singleton so readers never have to handle "no row yet".
INSERT INTO public.pos_import_settings (id, window_days)
VALUES (1, 90)
ON CONFLICT (id) DO NOTHING;


-- ── 3. Row Level Security ───────────────────────────────────────────────────
-- pos_receipt_deliveries holds purchase costs, so it carries exactly the
-- sensitivity of public.ingredients and gets exactly its policy shape (see
-- costing_tables_rls_migration.sql):
--   read : owner, admin, editor, staff   -- sales excluded
--   write: owner, admin
--
-- If ingredients_select is ever tightened, this MUST be tightened in the same
-- change — they are the same data.
--
-- Note the write policy is broader than the import actions' own
-- requireOwner() gate. That is intentional: it lets an admin run the one-off
-- backfill without the DB refusing, while the server action remains the
-- tighter gate on the normal import flow.
--
-- pos_import_settings gets the same shape for consistency, though it holds no
-- cost data itself.

ALTER TABLE public.pos_receipt_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pos_receipt_deliveries_select" ON public.pos_receipt_deliveries;
CREATE POLICY "pos_receipt_deliveries_select" ON public.pos_receipt_deliveries FOR SELECT TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin', 'editor', 'staff'));

DROP POLICY IF EXISTS "pos_receipt_deliveries_write" ON public.pos_receipt_deliveries;
CREATE POLICY "pos_receipt_deliveries_write" ON public.pos_receipt_deliveries FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin'));

ALTER TABLE public.pos_import_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pos_import_settings_select" ON public.pos_import_settings;
CREATE POLICY "pos_import_settings_select" ON public.pos_import_settings FOR SELECT TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin', 'editor', 'staff'));

DROP POLICY IF EXISTS "pos_import_settings_write" ON public.pos_import_settings;
CREATE POLICY "pos_import_settings_write" ON public.pos_import_settings FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin'));


-- ── 4. Documentation ────────────────────────────────────────────────────────

COMMENT ON TABLE public.pos_receipt_deliveries IS
  'Every receipt line from the POS "ใบรับสินค้าตรง" export, accumulated across imports. The export itself is a rolling ~3.5-month window, so this table is the only durable record of deliveries that have aged out of it. Written by the POS import (preview stage) and by the one-off backfill over archived exports. Read by the importer to build each material''s price history: same-unit deliveries from the dominant vendor within pos_import_settings.window_days.';

COMMENT ON COLUMN public.pos_receipt_deliveries.material_code IS
  'POS material identifier. Stable: never observed under more than one material_name across the archived exports spanning 15 months. Not a FK to ingredients — see the table definition for why.';

COMMENT ON COLUMN public.pos_receipt_deliveries.vendor_name IS
  'Empty string, never NULL: blank is a real vendor identity in this data and is the dominant identity for some materials. The importer''s dominant-vendor grouping depends on being able to group by it.';

COMMENT ON COLUMN public.pos_receipt_deliveries.document_date IS
  'CE date, converted from the report''s Buddhist-era text (2569 -> 2026) at parse time so the import window can use interval arithmetic.';

COMMENT ON CONSTRAINT pos_receipt_deliveries_document_material_key ON public.pos_receipt_deliveries IS
  'Idempotency key. Verified unique within a single export and consistent across the archived exports (0 conflicting values for a repeated key), so ON CONFLICT DO NOTHING loses nothing.';

COMMENT ON TABLE public.pos_import_settings IS
  'Singleton (id = 1) holding settings for the POS price import only. Deliberately scoped rather than general-purpose — the core costing q-factor is an unrelated concern with no table of its own today.';

COMMENT ON COLUMN public.pos_import_settings.window_days IS
  'How many days of delivery history the POS importer considers when computing a material''s price candidates. Default 90.';


COMMIT;


-- ── Verification (run separately, after the COMMIT above) ───────────────────
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'pos_receipt_deliveries'
--  ORDER BY ordinal_position;
--
-- SELECT policyname, cmd, qual, with_check
--   FROM pg_policies
--  WHERE tablename IN ('pos_receipt_deliveries', 'pos_import_settings')
--  ORDER BY tablename, policyname;
--
-- SELECT * FROM public.pos_import_settings;   -- expect exactly (1, 90)
