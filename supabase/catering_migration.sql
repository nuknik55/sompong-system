-- ============================================================================
-- Catering module — /owner/catering/   + new 'sales' role
-- ============================================================================
-- Run once in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS /
-- DROP ... IF EXISTS throughout).
--
-- No legacy data is migrated: the 2569 booking spreadsheet stays an archive.
-- These tables are built for correct data entry going forward.
--
-- Access: owner + admin + sales. catering_customers is the first table in this
-- system holding external-person data, so no table here gets a blanket
-- authenticated-read policy.
--
-- The 'sales' role can read SALE prices only. It has no access to
-- menu_recipe_items / ingredients / prep recipes, so food cost and margin are
-- unreachable for it at the database level.
-- !! UI CONSTRAINT for the page work: any live food-cost, margin or profit
-- !! figure on the catering pages must render for owner/admin ONLY. A sales
-- !! user must never see cost or margin, including in a set-menu picker,
-- !! an event summary, or a quotation preview.
--
-- Costing: no cost columns live on the menu/set tables. Food cost is derived
-- live via the existing engine (src/lib/costing.ts -> computeMenuCost) from
-- menus -> menu_recipe_items -> ingredients, and is only written down once,
-- into catering_event_cost_snapshots, when an event is marked done.
--
-- !! AFTER RUNNING THIS, src/lib/auth.ts MUST BE PATCHED (see notes at the
-- !! bottom of this file). requireAdminOrEditor() currently blocks by a
-- !! NEGATIVE list, so a 'sales' user would pass it and gain write access to
-- !! ingredients / stations / SOP / inventory / menu / prep actions.
-- ============================================================================


-- ── 0. Role: add 'sales' ────────────────────────────────────────────────────
-- profiles.role is guarded by a CHECK constraint (not an enum). Latest
-- definition came from hr_role_patch.sql; this extends it with 'sales'.
-- Every existing RLS policy in this database uses a POSITIVE allowlist
-- (verified: no "role != / <> / NOT IN" anywhere), so adding a value here
-- cannot widen any existing policy.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('owner', 'admin', 'editor', 'staff', 'hr', 'sales'));


-- ── 1. Customers ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.catering_customers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  phone        TEXT,                       -- TEXT, never numeric: preserves leading 0
  line_id      TEXT,
  company_name TEXT,
  tax_id       TEXT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catering_customers_phone ON public.catering_customers(phone);
CREATE INDEX IF NOT EXISTS idx_catering_customers_name  ON public.catering_customers(name);


-- ── 2. Set menus (packages of existing menus) ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.catering_set_menus (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT,
  price_per_set NUMERIC NOT NULL,          -- sale price of the whole package
  serves_guests NUMERIC,                   -- how many guests one set feeds
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dishes in a package point at the EXISTING menus table — never duplicated,
-- so computeMenuCost() stays the single source of cost truth.
CREATE TABLE IF NOT EXISTS public.catering_set_menu_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_menu_id UUID NOT NULL REFERENCES public.catering_set_menus(id) ON DELETE CASCADE,
  menu_id     UUID NOT NULL REFERENCES public.menus(id) ON DELETE RESTRICT,
  quantity    NUMERIC NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  UNIQUE (set_menu_id, menu_id)
);

CREATE INDEX IF NOT EXISTS idx_catering_set_menu_items_set  ON public.catering_set_menu_items(set_menu_id);
CREATE INDEX IF NOT EXISTS idx_catering_set_menu_items_menu ON public.catering_set_menu_items(menu_id);


-- ── 3. Events / bookings ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.catering_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID REFERENCES public.catering_customers(id) ON DELETE SET NULL,

  event_date     DATE NOT NULL,
  start_time     TIME,
  end_time       TIME,                     -- for bookings quoted as a window

  venue          TEXT NOT NULL
                 CHECK (venue IN ('air_shared','room_v1','room_v2','room_v1_v2','offsite')),
  booking_type   TEXT NOT NULL
                 CHECK (booking_type IN ('table','room','catering')),
  food_format    TEXT
                 CHECK (food_format IN ('chinese_table','buffet','a_la_carte','set_menu')),

  table_count    NUMERIC,                  -- numeric only
  reserve_tables NUMERIC,                  -- standby tables held in addition
  table_label    TEXT,                     -- specific table id / "whole room"
  guest_count    NUMERIC,

  status         TEXT NOT NULL DEFAULT 'inquiry'
                 CHECK (status IN ('inquiry','awaiting_deposit','deposit_paid','confirmed','done','cancelled')),

  -- Sale price is LOCKED at quotation time: quoted_total is computed from the
  -- sum of catering_event_charges when the quotation is issued, then frozen.
  quoted_total    NUMERIC,
  quoted_at       TIMESTAMPTZ,

  deposit_amount  NUMERIC,
  deposit_paid_at DATE,

  detail_note    TEXT,                     -- sales/handover context
  kitchen_note   TEXT,                     -- passed to the kitchen

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catering_events_date     ON public.catering_events(event_date);
CREATE INDEX IF NOT EXISTS idx_catering_events_status   ON public.catering_events(status);
CREATE INDEX IF NOT EXISTS idx_catering_events_customer ON public.catering_events(customer_id);


-- ── 4. Staff assigned to an event (many-to-many) ────────────────────────────

CREATE TABLE IF NOT EXISTS public.catering_event_staff (
  event_id    UUID NOT NULL REFERENCES public.catering_events(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  role        TEXT NOT NULL DEFAULT 'taker'
              CHECK (role IN ('taker','runner')),
  PRIMARY KEY (event_id, employee_id, role)
);

CREATE INDEX IF NOT EXISTS idx_catering_event_staff_emp ON public.catering_event_staff(employee_id);


-- ── 5. Menus ordered for an event ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.catering_event_menus (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES public.catering_events(id) ON DELETE CASCADE,
  set_menu_id UUID REFERENCES public.catering_set_menus(id) ON DELETE RESTRICT,
  menu_id     UUID REFERENCES public.menus(id) ON DELETE RESTRICT,
  quantity    NUMERIC NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  -- each line is either a package or a single dish, never both, never neither
  CONSTRAINT catering_event_menus_one_target
    CHECK ((set_menu_id IS NOT NULL) <> (menu_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_catering_event_menus_event ON public.catering_event_menus(event_id);


-- ── 6. Quotation charge lines ───────────────────────────────────────────────
-- Real quotations vary a lot per event: a line per VIP room, karaoke with an
-- operator, electricity when the customer brings their own band, a drink
-- package, a catering service charge, and several separate discount lines.
-- Fixed columns could not express that, so charges are line items.
--
-- amount is stored, not derived: the form auto-computes unit_price * quantity
-- but the user can override it, because real quotations round and negotiate
-- (e.g. a drink package listed at 100/head but charged at 60/head).
--
-- Discounts are stored NEGATIVE, so any total is a plain SUM(amount) with no
-- branching. The CHECK below enforces that convention at the database level.

CREATE TABLE IF NOT EXISTS public.catering_event_charges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES public.catering_events(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  charge_type TEXT NOT NULL
              CHECK (charge_type IN ('food','drink','venue','service','transport','equipment','other','discount')),
  unit_price  NUMERIC NOT NULL,
  quantity    NUMERIC NOT NULL DEFAULT 1,
  amount      NUMERIC NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  CONSTRAINT catering_event_charges_discount_sign
    CHECK ((charge_type =  'discount' AND amount <= 0)
        OR (charge_type <> 'discount' AND amount >= 0))
);

CREATE INDEX IF NOT EXISTS idx_catering_event_charges_event ON public.catering_event_charges(event_id);


-- ── 7. Cost snapshot (written only when the event is done) ──────────────────
-- Before 'done': no row here. The UI computes food cost live from
-- catering_event_menus via computeMenuCost(), so it tracks ingredient prices.
-- On 'done': one row is written and the numbers never move again.

CREATE TABLE IF NOT EXISTS public.catering_event_cost_snapshots (
  event_id         UUID PRIMARY KEY REFERENCES public.catering_events(id) ON DELETE CASCADE,
  snapshot_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  q_factor_pct     NUMERIC NOT NULL,       -- the q-factor actually applied
  ingredient_cost  NUMERIC NOT NULL,
  q_factor_amount  NUMERIC NOT NULL,
  total_food_cost  NUMERIC NOT NULL,
  revenue          NUMERIC NOT NULL,       -- copied from catering_events.quoted_total
  gross_profit     NUMERIC NOT NULL,
  food_cost_pct    NUMERIC,
  has_unknown_cost BOOLEAN NOT NULL DEFAULT FALSE,
  -- per-menu breakdown frozen as-of the snapshot, so the figure stays readable
  -- even if a dish is later renamed, re-costed, or deleted
  line_items       JSONB NOT NULL DEFAULT '[]'::jsonb
);


-- ── updated_at triggers (reuses the existing public.set_updated_at()) ───────

DROP TRIGGER IF EXISTS trg_catering_customers_updated_at ON public.catering_customers;
CREATE TRIGGER trg_catering_customers_updated_at BEFORE UPDATE ON public.catering_customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_catering_set_menus_updated_at ON public.catering_set_menus;
CREATE TRIGGER trg_catering_set_menus_updated_at BEFORE UPDATE ON public.catering_set_menus
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_catering_events_updated_at ON public.catering_events;
CREATE TRIGGER trg_catering_events_updated_at BEFORE UPDATE ON public.catering_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── Row Level Security ──────────────────────────────────────────────────────
-- owner + admin + sales, on every table. Deliberately no
-- "SELECT TO authenticated USING (true)" policy anywhere here:
-- catering_customers holds names and phone numbers of people outside the
-- company. 'sales' is granted here and NOWHERE ELSE in the database.

ALTER TABLE public.catering_customers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catering_set_menus            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catering_set_menu_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catering_events               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catering_event_staff          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catering_event_menus          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catering_event_charges        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catering_event_cost_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "catering_customers_rw" ON public.catering_customers;
CREATE POLICY "catering_customers_rw" ON public.catering_customers FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin','sales'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin','sales'));

DROP POLICY IF EXISTS "catering_set_menus_rw" ON public.catering_set_menus;
CREATE POLICY "catering_set_menus_rw" ON public.catering_set_menus FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin','sales'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin','sales'));

DROP POLICY IF EXISTS "catering_set_menu_items_rw" ON public.catering_set_menu_items;
CREATE POLICY "catering_set_menu_items_rw" ON public.catering_set_menu_items FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin','sales'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin','sales'));

DROP POLICY IF EXISTS "catering_events_rw" ON public.catering_events;
CREATE POLICY "catering_events_rw" ON public.catering_events FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin','sales'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin','sales'));

DROP POLICY IF EXISTS "catering_event_staff_rw" ON public.catering_event_staff;
CREATE POLICY "catering_event_staff_rw" ON public.catering_event_staff FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin','sales'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin','sales'));

DROP POLICY IF EXISTS "catering_event_menus_rw" ON public.catering_event_menus;
CREATE POLICY "catering_event_menus_rw" ON public.catering_event_menus FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin','sales'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin','sales'));

DROP POLICY IF EXISTS "catering_event_charges_rw" ON public.catering_event_charges;
CREATE POLICY "catering_event_charges_rw" ON public.catering_event_charges FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin','sales'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin','sales'));

DROP POLICY IF EXISTS "catering_cost_snapshots_rw" ON public.catering_event_cost_snapshots;
CREATE POLICY "catering_cost_snapshots_rw" ON public.catering_event_cost_snapshots FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin','sales'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin','sales'));


-- ── Sales: dish list only, never cost ───────────────────────────────────────
-- Building a quotation needs SALE prices (set menu price + charge lines), never
-- cost. Cost and margin are owner/admin information, so sales gets SELECT on
-- menus alone — NOT on menu_recipe_items / ingredients / prep_recipes /
-- prep_recipe_items, which is where ingredient prices and food cost come from.
--
-- NOTE: menus.selling_price is a sale price, so it is fine here. The dish-level
-- cost cannot be reconstructed from menus alone: it requires the recipe tables
-- above, which sales cannot read.

DROP POLICY IF EXISTS "sales_read_menus" ON public.menus;
CREATE POLICY "sales_read_menus" ON public.menus FOR SELECT TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'sales');

-- Cleanup: these were proposed in an earlier draft and are deliberately NOT
-- created. Dropping them is a no-op on a fresh database.
DROP POLICY IF EXISTS "sales_read_menu_recipe_items" ON public.menu_recipe_items;
DROP POLICY IF EXISTS "sales_read_ingredients"       ON public.ingredients;
DROP POLICY IF EXISTS "sales_read_prep_recipes"      ON public.prep_recipes;
DROP POLICY IF EXISTS "sales_read_prep_recipe_items" ON public.prep_recipe_items;


-- ── Sales: staff picker via a name-only view ────────────────────────────────
-- Assigning staff to an event needs a name list. Granting SELECT on
-- public.employees would expose base_salary, daily_wage and
-- social_security_monthly, because RLS is row-level and cannot hide columns.
-- This view exposes only the columns the picker needs.
--
-- !! The view intentionally relies on the DEFAULT view behaviour
-- !! (security_invoker = false), so it reads employees with the view owner's
-- !! rights and bypasses the employees RLS policies — which is what lets sales
-- !! see names while having NO policy on employees itself. Access is instead
-- !! gated by the WHERE clause below.
-- !! Do NOT "fix" a Supabase linter warning by setting security_invoker = true
-- !! on this view: sales would silently start getting zero rows.

DROP POLICY IF EXISTS "sales_read_employees" ON public.employees;

DROP VIEW IF EXISTS public.catering_staff_options;
CREATE VIEW public.catering_staff_options AS
SELECT
  e.id,
  e.nickname,
  e.full_name,
  e.is_active,
  e.sort_order,
  d.name AS department_name
FROM public.employees e
LEFT JOIN public.departments d ON d.id = e.department_id
WHERE (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
      IN ('owner', 'admin', 'sales');

REVOKE ALL ON public.catering_staff_options FROM PUBLIC;
GRANT SELECT ON public.catering_staff_options TO authenticated;

COMMENT ON VIEW public.catering_staff_options IS
  'Name-only employee list for the catering staff picker. Exists so the sales role never receives salary columns: RLS is row-level and cannot hide base_salary / daily_wage / social_security_monthly. Relies on default (non-invoker) view semantics to bypass employees RLS; access is gated by the role test in its WHERE clause.';


-- ── Column documentation ────────────────────────────────────────────────────

COMMENT ON TABLE  public.catering_customers IS
  'External customers for catering bookings. First table in this system holding personal data of people outside the company — treat as PII.';
COMMENT ON COLUMN public.catering_customers.phone IS
  'Always TEXT. Storing phone numbers as numeric drops the leading zero.';

COMMENT ON COLUMN public.catering_events.quoted_total IS
  'Sale price locked at quotation time — the sum of catering_event_charges at the moment the quotation was issued. Never recomputed afterwards.';
COMMENT ON COLUMN public.catering_events.table_label IS
  'Specific table identifier or a non-numeric booking such as a whole room; table_count stays NULL in that case.';
COMMENT ON COLUMN public.catering_events.reserve_tables IS
  'Standby tables held in addition to table_count.';

COMMENT ON TABLE  public.catering_event_charges IS
  'Quotation line items. Charge lines vary per event (per-room fees, karaoke with operator, electricity for a customer-supplied band, drink packages, service charge, multiple discount lines), so they cannot be fixed columns.';
COMMENT ON COLUMN public.catering_event_charges.amount IS
  'Stored, not derived. The form pre-fills unit_price * quantity but allows an override, because quotations round and negotiate. Discount rows are negative so a total is a plain SUM(amount).';

COMMENT ON TABLE  public.catering_event_cost_snapshots IS
  'Written once, when an event is marked done. Before that the food cost is computed live through src/lib/costing.ts. One row per event.';
COMMENT ON COLUMN public.catering_event_cost_snapshots.line_items IS
  'Per-menu cost breakdown frozen at snapshot time so the figure remains auditable if a dish is later renamed, re-costed, or deleted.';


-- ============================================================================
-- REQUIRED FOLLOW-UP IN src/lib/auth.ts  (TypeScript — not applied by this file)
-- ============================================================================
-- 1) Add 'sales' to the Role union:
--        export type Role = "owner" | "admin" | "editor" | "staff" | "hr" | "sales";
--
-- 2) CLOSE THE HOLE — requireAdminOrEditor() blocks by a NEGATIVE list today:
--        if (profile.role === "staff" || profile.role === "hr") redirect("/staff");
--    A 'sales' user passes that and gains write access to ~30 actions across
--    /owner/ingredients, /owner/stations, /sop, /staff/inventory, /staff/menu
--    and /staff/prep. Change it to a positive allowlist (behaviour is identical
--    for all five existing roles):
--        if (!["owner", "admin", "editor"].includes(profile.role)) redirect("/staff");
--
-- 3) Add the catering guard, matching the existing naming style:
--        /** Catering access: owner, admin, or sales. */
--        export async function requireSales(): Promise<Profile> {
--          const profile = await requireProfile();
--          if (!["owner", "admin", "sales"].includes(profile.role)) redirect("/staff");
--          return profile;
--        }
--
-- The other four guards (requireOwner, requireAdmin, requireHR,
-- requireHROrAdmin) already use positive allowlists and correctly exclude
-- 'sales' from payroll, HR and accounting — no change needed there.
-- ============================================================================
