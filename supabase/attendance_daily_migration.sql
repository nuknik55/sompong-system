-- Attendance Daily Summary Table
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.attendance_daily (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id     UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_date       DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'present'
                    CHECK (status IN ('present','absent','late','leave','day_off')),
  late_minutes    INTEGER NOT NULL DEFAULT 0,
  ot_hours        DECIMAL(4,2) NOT NULL DEFAULT 0,
  leave_type_id   UUID REFERENCES public.leave_types(id),
  note            TEXT,
  source          TEXT NOT NULL DEFAULT 'manual',
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id, work_date)
);

ALTER TABLE public.attendance_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hr_admin_read" ON public.attendance_daily FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr','admin'))
);
CREATE POLICY "hr_insert" ON public.attendance_daily FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr'))
);
CREATE POLICY "hr_update" ON public.attendance_daily FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr'))
);
CREATE POLICY "hr_delete" ON public.attendance_daily FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr'))
);
