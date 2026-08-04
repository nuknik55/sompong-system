-- Phase 1: start_date (วันเข้างานวันแรก) + daily_wage (ค่าแรงรายวัน)
-- start_date แยกจาก hire_date ชัดเจน: hire_date ยังใช้คำนวณโควตา AL เหมือนเดิม

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS daily_wage  numeric;

COMMENT ON COLUMN public.employees.start_date IS
  'วันแรกที่เริ่มงาน — ข้อมูลอ้างอิงเท่านั้น ไม่ใช้คำนวณใด ๆ';
COMMENT ON COLUMN public.employees.hire_date IS
  'วันบรรจุเป็นพนักงานประจำ — ใช้คำนวณอายุงานและโควตา AL (getLeaveQuotas)';
COMMENT ON COLUMN public.employees.daily_wage IS
  'ค่าแรงรายวัน (พาร์ทไทม์) — base_salary ยังคงหมายถึงเงินเดือนรายเดือนเสมอ';
