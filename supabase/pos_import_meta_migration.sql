-- Migration: add pos_import_meta table to track last POS sales import date range

CREATE TABLE IF NOT EXISTS public.pos_import_meta (
  id TEXT PRIMARY KEY DEFAULT 'last',
  date_from TEXT,
  date_to TEXT,
  imported_at TIMESTAMPTZ DEFAULT now()
);

-- Allow the service role / authenticated users to read and write
ALTER TABLE public.pos_import_meta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner can manage pos_import_meta"
  ON public.pos_import_meta
  FOR ALL
  USING (true)
  WITH CHECK (true);
