-- ================================================================
-- Migration 009: Station order templates (station_ingredients)
-- ================================================================

CREATE TABLE IF NOT EXISTS public.station_ingredients (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id    uuid          NOT NULL REFERENCES public.stations(id) ON DELETE CASCADE,
  ingredient_id uuid          NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  -- free-text group label per template (independent from ingredient.category)
  custom_group  text,
  -- overrides ingredient's default unit for orders at this station
  custom_unit   text,
  -- pre-fills the "สั่ง" placeholder on the order form
  default_qty   numeric(12,4),
  -- manual drag ordering, independent of category
  sort_order    int           NOT NULL DEFAULT 0,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (station_id, ingredient_id)
);

ALTER TABLE public.station_ingredients ENABLE ROW LEVEL SECURITY;

-- READ: all authenticated users (staff need this to load the order form)
CREATE POLICY "station_ingredients_select" ON public.station_ingredients
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- WRITE: editor / admin / owner only
CREATE POLICY "station_ingredients_insert" ON public.station_ingredients
  FOR INSERT WITH CHECK (public.is_editor_or_above());

CREATE POLICY "station_ingredients_update" ON public.station_ingredients
  FOR UPDATE
  USING  (public.is_editor_or_above())
  WITH CHECK (public.is_editor_or_above());

CREATE POLICY "station_ingredients_delete" ON public.station_ingredients
  FOR DELETE USING (public.is_editor_or_above());
