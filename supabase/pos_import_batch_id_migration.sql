-- Add pos_receipt_deliveries.import_batch_id.
--
-- WHY. The POS export is about to be parsed in the browser and uploaded as
-- validated rows in chunks of 2,000, because Vercel rejects request bodies over
-- 4.5 MB before the function runs and a 5-month .xls is now 4.69 MB.
--
-- A chunked upload is NOT a transaction: chunk 7 failing leaves chunks 1-6 in
-- the table. That is acceptable here specifically because this table is an
-- append-only log of facts keyed on UNIQUE (document_number, material_code) —
-- a half-uploaded batch is a SUBSET of true deliveries, not corruption, and
-- re-running fills the gap as a no-op for what already landed. (The backfill
-- demonstrated exactly this: a second --apply run inserted 0 of 22,711.)
--
-- What was missing was a way to SEE a partial batch. Without this column a
-- half-finished upload is indistinguishable from history, so it cannot be
-- reported on or removed. With it:
--
--   SELECT import_batch_id, count(*), min(imported_at), max(imported_at)
--     FROM public.pos_receipt_deliveries
--    WHERE import_batch_id IS NOT NULL
--    GROUP BY 1 ORDER BY 2 DESC;
--
--   DELETE FROM public.pos_receipt_deliveries WHERE import_batch_id = '<uuid>';
--
-- NULL for the 22,711 rows the one-off backfill script wrote, and for anything
-- imported before this lands. Deliberately not backfilled with a synthetic id:
-- those rows did not come from a browser batch and pretending otherwise would
-- make the column lie.
--
-- STATUS 2026-09-01: APPLIED in production, but the code that used it was
-- REVERTED (a304262, reverted because the chunked ingest wrote nothing — see
-- below). The column is nullable and unused, so it is harmless where it is;
-- this file stays tracked because the column really does exist and an untracked
-- applied migration is the exact problem supabase/README.md documents.
--
-- WHY THE CODE WAS REVERTED. ingestPosDeliveries upserted with
-- ignoreDuplicates: true on UNIQUE (document_number, material_code) — ON
-- CONFLICT DO NOTHING. The backfill had already loaded every delivery from the
-- same export files, so every uploaded row conflicted, nothing was written, and
-- import_batch_id was never set on any row. buildPosImportPreview then found
-- zero rows for the batch and failed. Batch-scoped preview and
-- ignoreDuplicates are incompatible; whatever replaces this must not rely on
-- an insert happening for rows that already exist.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE public.pos_receipt_deliveries
  ADD COLUMN IF NOT EXISTS import_batch_id UUID;

-- Partial: the vast majority of rows are NULL and never queried by batch.
CREATE INDEX IF NOT EXISTS pos_receipt_deliveries_batch_idx
  ON public.pos_receipt_deliveries (import_batch_id)
  WHERE import_batch_id IS NOT NULL;

COMMIT;

-- ─── Verification (run separately after COMMIT) ────────────────────────────
-- Expect one row, is_nullable = YES:
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='pos_receipt_deliveries'
--      AND column_name='import_batch_id';
--
-- Expect 22711 (or higher) and 0 respectively — the backfill rows stay NULL:
--   SELECT count(*) FILTER (WHERE import_batch_id IS NULL)     AS pre_existing,
--          count(*) FILTER (WHERE import_batch_id IS NOT NULL) AS batched
--     FROM public.pos_receipt_deliveries;
