-- ================================================================
-- Migration 008: Inventory check / order / receive system
-- ================================================================

-- 1. New nullable columns on ingredients
ALTER TABLE public.ingredients
  ADD COLUMN IF NOT EXISTS par_level   numeric(12,4),
  ADD COLUMN IF NOT EXISTS safety_note text,
  ADD COLUMN IF NOT EXISTS name_mm     text;

-- 2. Add 'accounting' to role enum
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('owner', 'admin', 'editor', 'staff', 'accounting'));

-- 3. Helper: editor / admin / owner — used in RLS policies below
--    is_owner() already covers admin+owner (see migration 006).
--    is_editor_or_above() adds editor to that set.
CREATE OR REPLACE FUNCTION public.is_editor_or_above()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_role() IN ('editor', 'admin', 'owner');
$$;

-- 4. Stations master table
CREATE TABLE IF NOT EXISTS public.stations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL UNIQUE,
  sort_order int         NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.stations (name, sort_order) VALUES
  ('ครัวใหญ่',    1),
  ('สโตร์',      2),
  ('ร้านกาแฟ',   3)
ON CONFLICT (name) DO NOTHING;

-- 5. Order sessions header
--    Status flow:
--      submitted → approved  (editor+ approves)
--      submitted → returned  (editor+ ตีกลับ, staff resubmits)
--      returned  → submitted (creator resubmits)
--      approved  → sent      (anyone logs dispatch)
--      approved/sent → received (anyone logs receipt)
CREATE TABLE IF NOT EXISTS public.order_sessions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id   uuid        REFERENCES public.stations(id) ON DELETE SET NULL,
  status       text        NOT NULL DEFAULT 'submitted'
               CHECK (status IN ('submitted', 'returned', 'approved', 'sent', 'received')),
  note         text,
  created_by   uuid        NOT NULL REFERENCES public.profiles(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  approved_by  uuid        REFERENCES public.profiles(id),
  approved_at  timestamptz,
  sent_at      timestamptz,
  sent_by      uuid        REFERENCES public.profiles(id),
  received_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- 6. Order line items
--    remaining split into ครัว (kitchen) + ตู้แช่ (freezer) per spec
--    pack ordering: pack_count × qty_per_pack = qty_ordered
CREATE TABLE IF NOT EXISTS public.order_items (
  id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id             uuid          NOT NULL REFERENCES public.order_sessions(id) ON DELETE CASCADE,
  ingredient_id          uuid          REFERENCES public.ingredients(id) ON DELETE SET NULL,
  ingredient_name        text          NOT NULL,
  -- เหลือ (ครัว)
  remaining_kitchen_qty  numeric(12,4),
  remaining_kitchen_unit text,
  -- เหลือ (ตู้แช่)
  remaining_freezer_qty  numeric(12,4),
  remaining_freezer_unit text,
  -- สั่ง (pack-based หรือกรอกตรง)
  pack_count             numeric(12,4),
  qty_per_pack           numeric(12,4),
  qty_ordered            numeric(12,4) NOT NULL DEFAULT 0,
  order_unit             text,
  -- รับของ — only writable via receive_order_item() below
  qty_received           numeric(12,4),
  -- editor แก้ก่อนอนุมัติ (null = ไม่ได้แก้)
  editor_qty_ordered     numeric(12,4),
  note                   text,
  sort_order             int           NOT NULL DEFAULT 0,
  created_at             timestamptz   NOT NULL DEFAULT now()
);

-- ================================================================
-- 7. SECURITY DEFINER function: receive_order_item
--    Staff calls this RPC instead of a raw UPDATE on order_items.
--    Runs as DB owner (bypasses RLS) but enforces:
--      - caller must be authenticated
--      - session status must be approved or sent
--    Updates ONLY qty_received — no other column can be touched.
-- ================================================================
CREATE OR REPLACE FUNCTION public.receive_order_item(
  item_id uuid,
  qty     numeric  -- NULL = "ยังไม่มา"; 0 = "ไม่ได้รับเลย"
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้อง login ก่อนบันทึกรับของ';
  END IF;

  -- Session must be in a receivable state
  IF NOT EXISTS (
    SELECT 1
    FROM   public.order_items  oi
    JOIN   public.order_sessions os ON os.id = oi.session_id
    WHERE  oi.id = item_id
      AND  os.status IN ('approved', 'sent')
  ) THEN
    RAISE EXCEPTION
      'ไม่สามารถบันทึกรับของได้: ใบสั่งของยังไม่ผ่านการอนุมัติ หรือไม่พบรายการ id=%',
      item_id;
  END IF;

  -- Touch ONLY qty_received
  UPDATE public.order_items
  SET    qty_received = qty
  WHERE  id = item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบรายการ id=%', item_id;
  END IF;
END;
$$;

-- Grant execute to logged-in users only; revoke from anonymous
GRANT  EXECUTE ON FUNCTION public.receive_order_item(uuid, numeric) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.receive_order_item(uuid, numeric) FROM anon;

-- ================================================================
-- RLS
-- ================================================================

ALTER TABLE public.stations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items    ENABLE ROW LEVEL SECURITY;

-- ── stations ──────────────────────────────────────────────────────
-- Read: everyone authenticated
-- Write: admin/owner only (is_owner() = admin+owner per migration 006)
CREATE POLICY "stations_select" ON public.stations
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "stations_insert" ON public.stations
  FOR INSERT WITH CHECK (public.is_owner());
CREATE POLICY "stations_update" ON public.stations
  FOR UPDATE USING (public.is_owner());
CREATE POLICY "stations_delete" ON public.stations
  FOR DELETE USING (public.is_owner());

-- ── order_sessions ────────────────────────────────────────────────
-- SELECT: everyone authenticated
CREATE POLICY "order_sessions_select" ON public.order_sessions
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- INSERT: authenticated user must set themselves as creator
--         (prevents spoofing another user's ID as created_by)
CREATE POLICY "order_sessions_insert" ON public.order_sessions
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
  );

-- UPDATE — 3 permissive policies (PostgreSQL ORs them together)

-- P1: Editor / admin / owner can update any session
CREATE POLICY "order_sessions_update_editor" ON public.order_sessions
  FOR UPDATE
  USING  (public.is_editor_or_above())
  WITH CHECK (public.is_editor_or_above());

-- P2: Creator can resubmit their own returned session only.
--     USING: old status must be 'returned' and caller is the creator.
--     WITH CHECK: new status must be 'submitted' (can't jump to anything else).
CREATE POLICY "order_sessions_update_resubmit" ON public.order_sessions
  FOR UPDATE
  USING  (created_by = auth.uid() AND status = 'returned')
  WITH CHECK (created_by = auth.uid() AND status = 'submitted');

-- P3: Any authenticated can advance an already-approved/sent session
--     to 'sent' or 'received' only — covers "ส่งใบสั่งของ" and "รับของ".
--     USING locks old state; WITH CHECK locks new state.
--     Together they prevent staff from jumping submitted→received.
CREATE POLICY "order_sessions_update_receive" ON public.order_sessions
  FOR UPDATE
  USING  (auth.uid() IS NOT NULL AND status IN ('approved', 'sent'))
  WITH CHECK (auth.uid() IS NOT NULL AND status IN ('sent', 'received'));

-- DELETE: editor+ or creator of their own submitted session
--         (creator case covers error-rollback in createOrderSession action)
CREATE POLICY "order_sessions_delete" ON public.order_sessions
  FOR DELETE
  USING (
    public.is_editor_or_above()
    OR (created_by = auth.uid() AND status = 'submitted')
  );

-- ── order_items ───────────────────────────────────────────────────
-- SELECT: everyone authenticated
CREATE POLICY "order_items_select" ON public.order_items
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- INSERT: only allowed into sessions the caller owns (and that are
--         still in an editable state), or by editor+.
--         Blocks inserting items into already-approved/sent sessions.
CREATE POLICY "order_items_insert" ON public.order_items
  FOR INSERT WITH CHECK (
    public.is_editor_or_above()
    OR EXISTS (
      SELECT 1 FROM public.order_sessions s
      WHERE  s.id = session_id
        AND  s.created_by = auth.uid()
        AND  s.status IN ('submitted', 'returned')
    )
  );

-- UPDATE: editor+ can update any column (qty adjustments before approval).
--         Staff updating qty_received must go through receive_order_item()
--         RPC instead, which only touches that single column.
CREATE POLICY "order_items_update_editor" ON public.order_items
  FOR UPDATE
  USING  (public.is_editor_or_above())
  WITH CHECK (public.is_editor_or_above());

-- DELETE: editor+ or creator while session is still editable
CREATE POLICY "order_items_delete" ON public.order_items
  FOR DELETE
  USING (
    public.is_editor_or_above()
    OR EXISTS (
      SELECT 1 FROM public.order_sessions s
      WHERE  s.id = session_id
        AND  s.created_by = auth.uid()
        AND  s.status IN ('submitted', 'returned')
    )
  );
