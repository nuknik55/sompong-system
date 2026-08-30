-- ================================================================
-- Migration 012: Two-stage approval (reviewed + sent) + schema fixes
-- ================================================================

-- ----------------------------------------------------------------
-- 1. order_sessions — DROP old CHECK first (still knows 'approved',
--    does NOT know 'reviewed' yet — must drop before UPDATE)
-- ----------------------------------------------------------------
ALTER TABLE public.order_sessions
  DROP CONSTRAINT IF EXISTS order_sessions_status_check;

-- ----------------------------------------------------------------
-- 2. Migrate existing 'approved' sessions → 'reviewed'
--    (constraint is gone so UPDATE won't be rejected)
-- ----------------------------------------------------------------
UPDATE public.order_sessions
SET    status = 'reviewed', updated_at = now()
WHERE  status = 'approved';

-- ----------------------------------------------------------------
-- 3. order_sessions — ADD new CHECK with 'reviewed' in place of
--    'approved'
-- ----------------------------------------------------------------
ALTER TABLE public.order_sessions
  ADD CONSTRAINT order_sessions_status_check
  CHECK (status IN ('submitted', 'returned', 'reviewed', 'sent', 'received'));

-- ----------------------------------------------------------------
-- 4. order_sessions — add reviewer columns
-- ----------------------------------------------------------------
ALTER TABLE public.order_sessions
  ADD COLUMN IF NOT EXISTS reviewed_by  uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS reviewed_at  timestamptz;

-- ----------------------------------------------------------------
-- 5. order_items — add reviewer_qty_ordered
--    (separate from editor_qty_ordered which is the purchaser's
--     final adjustment at the 'sent' stage — do not repurpose)
-- ----------------------------------------------------------------
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS reviewer_qty_ordered numeric(12,4);

-- ----------------------------------------------------------------
-- 6. Fix: maintenance_reports has no status CHECK constraint.
--
--    BEFORE running: verify no rogue values exist:
--      SELECT DISTINCT status FROM maintenance_reports;
--    Expected: only 'new', 'in_progress', 'done'
--    If other values appear, normalize them first, e.g.:
--      UPDATE maintenance_reports SET status = 'new'
--        WHERE status NOT IN ('new', 'in_progress', 'done');
--    Then run this ADD CONSTRAINT.
-- ----------------------------------------------------------------
ALTER TABLE public.maintenance_reports
  ADD CONSTRAINT maintenance_reports_status_check
  CHECK (status IN ('new', 'in_progress', 'done'));

-- ----------------------------------------------------------------
-- 7. RLS — update order_sessions_update_receive
--
--    Old: any authenticated user could advance:
--      'approved' → 'sent'    (removed — 'approved' is gone)
--      'sent'     → 'received'
--
--    New: any authenticated user can ONLY do sent → received.
--    reviewed → sent is editor+ only, covered by the existing
--    order_sessions_update_editor policy (is_editor_or_above()).
-- ----------------------------------------------------------------
DROP POLICY IF EXISTS "order_sessions_update_receive" ON public.order_sessions;

CREATE POLICY "order_sessions_update_receive" ON public.order_sessions
  FOR UPDATE
  USING  (auth.uid() IS NOT NULL AND status = 'sent')
  WITH CHECK (auth.uid() IS NOT NULL AND status = 'received');

-- ----------------------------------------------------------------
-- 8. reviewed → returned (editor+ ตีกลับจากขั้นจัดซื้อ) is covered
--    by order_sessions_update_editor (no status restriction).
--    Documented here for clarity — no policy change needed.
-- ----------------------------------------------------------------
