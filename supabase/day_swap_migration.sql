CREATE TABLE IF NOT EXISTS public.day_swap_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID        NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_date    DATE        NOT NULL,
  off_date     DATE,
  swap_type    TEXT        NOT NULL CHECK (swap_type IN ('work_first', 'off_first')),
  compensation TEXT        NOT NULL DEFAULT 'bank_day'
                           CHECK (compensation IN ('bank_day', 'extra_pay')),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.day_swap_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner can manage day_swap_requests"
  ON public.day_swap_requests FOR ALL
  USING (true) WITH CHECK (true);
