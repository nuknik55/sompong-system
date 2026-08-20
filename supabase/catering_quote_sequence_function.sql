-- ============================================================================
-- Catering module — atomic quote-number sequence RPC
-- ============================================================================
-- Run once in the Supabase SQL editor, after catering_quotation_migration.sql.
-- Safe to re-run (CREATE OR REPLACE).
--
-- Required by issueCateringQuote() in src/app/owner/catering/actions.ts. The
-- Supabase JS client has no way to send a raw
--   INSERT ... ON CONFLICT DO UPDATE SET x = x + 1 ... RETURNING
-- statement — which is exactly what catering_quote_sequences was designed
-- for in catering_quotation_migration.sql. This function IS that statement,
-- exposed so the app can call it via supabase.rpc().
-- ============================================================================

CREATE OR REPLACE FUNCTION public.next_catering_quote_seq(p_yymm TEXT)
RETURNS INTEGER
LANGUAGE sql
AS $$
  INSERT INTO public.catering_quote_sequences (yymm, last_seq)
  VALUES (p_yymm, 1)
  ON CONFLICT (yymm) DO UPDATE SET last_seq = catering_quote_sequences.last_seq + 1
  RETURNING last_seq;
$$;

-- No SECURITY DEFINER: the caller already has direct INSERT/UPDATE on
-- catering_quote_sequences via the catering_quote_sequences_all policy
-- (owner/admin/sales), so this function needs no elevated privilege —
-- unlike catering_staff_options, which deliberately runs as the view owner.
GRANT EXECUTE ON FUNCTION public.next_catering_quote_seq(TEXT) TO authenticated;

COMMENT ON FUNCTION public.next_catering_quote_seq(TEXT) IS
  'Atomically returns the next sequence number for a Buddhist YYMM, creating the counter row on first use. Called from issueCateringQuote() the first time a given event''s quote_number is assigned.';
