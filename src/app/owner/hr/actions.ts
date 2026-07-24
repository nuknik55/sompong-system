"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Department = {
  id: string;
  name: string;
  is_active: boolean;
};

export type Employee = {
  id: string;
  employee_code: string | null;
  full_name: string;
  nickname: string | null;
  phone: string | null;
  department_id: string | null;
  department_name: string | null;
  position: string | null;
  employment_type: "monthly" | "daily" | "hourly" | "parttime" | "parttime_regular";
  base_salary: number;
  daily_rate: number;
  hourly_rate: number;
  position_allowance: number;
  hire_date: string | null;
  weekly_day_off: string | null;
  citizenship_type: "thai" | "foreign";
  is_active: boolean;
};

export type LeaveType = {
  id: string;
  code: string;
  name_th: string;
  annual_quota_days: number | null;
  is_paid: boolean;
  is_subject_to_day_multiplier: boolean;
  requires_medical_cert: boolean;
  is_active: boolean;
};

export type LeaveRequest = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_nickname: string | null;
  leave_type_id: string;
  leave_type_code: string;
  leave_type_name: string;
  date_from: string;
  date_to: string;
  total_days: number;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  submitted_at: string;
};

export type Holiday = {
  id: string;
  holiday_date: string;
  name: string;
  pay_type: "multiplier" | "substitute";
  pay_multiplier: number;
  is_active: boolean;
};

export type OtRule = {
  id: string;
  name: string;
  applies_to: "weekday" | "weekend" | "holiday";
  multiplier: number;
  is_active: boolean;
};

export type PayrollPeriod = {
  id: string;
  period_year: number;
  period_month: number;
  period_half: "first" | "second";
  pay_date: string | null;
  is_closed: boolean;
};

export type PayrollEntry = {
  id: string | null;
  payroll_period_id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string | null;
  department_name: string | null;
  base_salary: number;
  position_allowance: number;
  special_bonus: number;
  holiday_pay: number;
  ot_pay: number;
  social_security_deduction: number;
  leave_deduction: number;
  advance_deduction: number;
  adjustment: number;
  other_amount: number;
  meal_allowance: number;
  tip_amount: number;
  gross_total: number | null;
  net_total: number | null;
  note: string | null;
};

export type AttendancePunch = {
  id: string;
  employee_id: string;
  work_date: string;
  punch_type: "in" | "out";
  punch_time: string;
  note: string | null;
};

// ─── Departments ──────────────────────────────────────────────────────────────

export async function getDepartments(): Promise<Department[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("departments")
    .select("id,name,is_active")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function upsertDepartment(d: { id?: string; name: string }): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  if (d.id) {
    await supabase.from("departments").update({ name: d.name }).eq("id", d.id);
  } else {
    await supabase.from("departments").insert({ name: d.name });
  }
  revalidatePath("/owner/hr");
}

export async function setDepartmentActive(id: string, is_active: boolean): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("departments").update({ is_active }).eq("id", id);
  revalidatePath("/owner/hr");
}

// ─── Employees ────────────────────────────────────────────────────────────────

export async function getEmployees(): Promise<Employee[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .select(`
      id, employee_code, full_name, nickname, phone,
      department_id, position, employment_type,
      base_salary, daily_rate, hourly_rate, position_allowance,
      hire_date, weekly_day_off, citizenship_type, is_active,
      departments(name)
    `)
    .order("full_name");
  if (error) throw error;
  return (data ?? []).map((e: Record<string, unknown>) => ({
    ...(e as Omit<Employee, "department_name">),
    department_name: (e.departments as { name: string } | null)?.name ?? null,
  }));
}

export async function getEmployee(id: string): Promise<Employee | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .select(`
      id, employee_code, full_name, nickname, phone,
      department_id, position, employment_type,
      base_salary, daily_rate, hourly_rate, position_allowance,
      hire_date, weekly_day_off, citizenship_type, is_active,
      departments(name)
    `)
    .eq("id", id)
    .single();
  if (error) return null;
  return {
    ...(data as Omit<Employee, "department_name">),
    department_name: (data.departments as unknown as { name: string } | null)?.name ?? null,
  };
}

export async function upsertEmployee(e: {
  id?: string;
  employee_code: string;
  full_name: string;
  nickname: string;
  phone: string;
  department_id: string | null;
  position: string;
  employment_type: string;
  base_salary: number;
  daily_rate: number;
  hourly_rate: number;
  position_allowance: number;
  hire_date: string;
  weekly_day_off: string;
  citizenship_type: string;
  is_active: boolean;
}): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const payload = {
    employee_code: e.employee_code || null,
    full_name: e.full_name,
    nickname: e.nickname || null,
    phone: e.phone || null,
    department_id: e.department_id || null,
    position: e.position || null,
    employment_type: e.employment_type,
    base_salary: e.base_salary,
    daily_rate: e.daily_rate,
    hourly_rate: e.hourly_rate,
    position_allowance: e.position_allowance,
    hire_date: e.hire_date || null,
    weekly_day_off: e.weekly_day_off || null,
    citizenship_type: e.citizenship_type,
    is_active: e.is_active,
  };
  if (e.id) {
    await supabase.from("employees").update(payload).eq("id", e.id);
  } else {
    await supabase.from("employees").insert(payload);
  }
  revalidatePath("/owner/hr/employees");
}

// ─── Leave Types ──────────────────────────────────────────────────────────────

export async function getLeaveTypes(): Promise<LeaveType[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leave_types")
    .select("id,code,name_th,annual_quota_days,is_paid,is_subject_to_day_multiplier,requires_medical_cert,is_active")
    .order("code");
  if (error) throw error;
  return data ?? [];
}

export async function upsertLeaveType(lt: {
  id?: string;
  code: string;
  name_th: string;
  annual_quota_days: number | null;
  is_paid: boolean;
  is_subject_to_day_multiplier: boolean;
  requires_medical_cert: boolean;
  is_active: boolean;
}): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  if (lt.id) {
    await supabase.from("leave_types").update(lt).eq("id", lt.id);
  } else {
    await supabase.from("leave_types").insert(lt);
  }
  revalidatePath("/owner/hr/settings");
}

// ─── Leave Requests ───────────────────────────────────────────────────────────

export async function getLeaveRequests(filters?: {
  year?: number;
  month?: number;
  employeeId?: string;
  status?: string;
}): Promise<LeaveRequest[]> {
  const supabase = await createClient();
  let q = supabase
    .from("leave_requests")
    .select(`
      id, employee_id, leave_type_id, date_from, date_to,
      total_days, reason, status, submitted_at,
      employees(full_name, nickname),
      leave_types(code, name_th)
    `)
    .order("date_from", { ascending: false });

  if (filters?.employeeId) q = q.eq("employee_id", filters.employeeId);
  if (filters?.status && filters.status !== "all") q = q.eq("status", filters.status);
  if (filters?.year && filters?.month) {
    const m = String(filters.month).padStart(2, "0");
    q = q.gte("date_from", `${filters.year}-${m}-01`).lte("date_from", `${filters.year}-${m}-31`);
  } else if (filters?.year) {
    q = q.gte("date_from", `${filters.year}-01-01`).lte("date_from", `${filters.year}-12-31`);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    employee_id: r.employee_id as string,
    employee_name: (r.employees as { full_name: string; nickname: string | null } | null)?.full_name ?? "",
    employee_nickname: (r.employees as { full_name: string; nickname: string | null } | null)?.nickname ?? null,
    leave_type_id: r.leave_type_id as string,
    leave_type_code: (r.leave_types as { code: string; name_th: string } | null)?.code ?? "",
    leave_type_name: (r.leave_types as { code: string; name_th: string } | null)?.name_th ?? "",
    date_from: r.date_from as string,
    date_to: r.date_to as string,
    total_days: r.total_days as number,
    reason: r.reason as string | null,
    status: r.status as "pending" | "approved" | "rejected",
    submitted_at: r.submitted_at as string,
  }));
}

export async function upsertLeaveRequest(data: {
  id?: string;
  employee_id: string;
  leave_type_id: string;
  date_from: string;
  date_to: string;
  total_days: number;
  reason: string;
}): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  if (data.id) {
    const { id, ...rest } = data;
    await supabase.from("leave_requests").update(rest).eq("id", id);
  } else {
    await supabase.from("leave_requests").insert({ ...data, status: "approved" });
  }
  revalidatePath("/owner/hr/leave");
}

export async function updateLeaveStatus(id: string, status: "approved" | "rejected"): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("leave_requests").update({ status }).eq("id", id);
  revalidatePath("/owner/hr/leave");
}

export async function deleteLeaveRequest(id: string): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("leave_requests").delete().eq("id", id);
  revalidatePath("/owner/hr/leave");
}

// ─── Holidays ─────────────────────────────────────────────────────────────────

export async function getHolidays(year: number): Promise<Holiday[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("holidays")
    .select("id,holiday_date,name,pay_type,pay_multiplier,is_active")
    .gte("holiday_date", `${year}-01-01`)
    .lte("holiday_date", `${year}-12-31`)
    .order("holiday_date");
  if (error) throw error;
  return data ?? [];
}

export async function upsertHoliday(h: {
  id?: string;
  holiday_date: string;
  name: string;
  pay_type: "multiplier" | "substitute";
  pay_multiplier: number;
}): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  if (h.id) {
    await supabase.from("holidays").update(h).eq("id", h.id);
  } else {
    await supabase.from("holidays").insert({ ...h, is_active: true });
  }
  revalidatePath("/owner/hr/settings");
}

export async function deleteHoliday(id: string): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("holidays").delete().eq("id", id);
  revalidatePath("/owner/hr/settings");
}

// ─── OT Rules ─────────────────────────────────────────────────────────────────

export async function getOtRules(): Promise<OtRule[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ot_rules")
    .select("id,name,applies_to,multiplier,is_active")
    .order("applies_to");
  if (error) throw error;
  return data ?? [];
}

export async function upsertOtRule(r: {
  id?: string;
  name: string;
  applies_to: "weekday" | "weekend" | "holiday";
  multiplier: number;
  is_active: boolean;
}): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  if (r.id) {
    await supabase.from("ot_rules").update(r).eq("id", r.id);
  } else {
    await supabase.from("ot_rules").insert(r);
  }
  revalidatePath("/owner/hr/settings");
}

// ─── Payroll Periods ──────────────────────────────────────────────────────────

export async function getPayrollPeriods(): Promise<PayrollPeriod[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payroll_periods")
    .select("id,period_year,period_month,period_half,pay_date,is_closed")
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false })
    .order("period_half");
  if (error) throw error;
  return data ?? [];
}

export async function createPayrollPeriod(p: {
  period_year: number;
  period_month: number;
  period_half: "first" | "second";
  pay_date: string;
}): Promise<string> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payroll_periods")
    .insert({ ...p, is_closed: false })
    .select("id")
    .single();
  if (error) throw error;
  revalidatePath("/owner/hr/payroll");
  return data.id;
}

export async function closePayrollPeriod(id: string): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("payroll_periods").update({ is_closed: true }).eq("id", id);
  revalidatePath("/owner/hr/payroll");
}

// ─── Payroll Entries ──────────────────────────────────────────────────────────

export async function getPayrollEntries(periodId: string): Promise<PayrollEntry[]> {
  const supabase = await createClient();
  const [{ data: employees }, { data: entries }] = await Promise.all([
    supabase
      .from("employees")
      .select("id,employee_code,full_name,department_id,base_salary,position_allowance,departments(name)")
      .eq("is_active", true)
      .order("full_name"),
    supabase.from("payroll_entries").select("*").eq("payroll_period_id", periodId),
  ]);

  const entryMap = new Map((entries ?? []).map((e: Record<string, unknown>) => [e.employee_id as string, e]));

  return (employees ?? []).map((emp: Record<string, unknown>) => {
    const entry = entryMap.get(emp.id as string) as Record<string, unknown> | undefined;
    return {
      id: (entry?.id as string) ?? null,
      payroll_period_id: periodId,
      employee_id: emp.id as string,
      employee_name: emp.full_name as string,
      employee_code: emp.employee_code as string | null,
      department_name: (emp.departments as { name: string } | null)?.name ?? null,
      base_salary: (entry?.base_salary as number) ?? (emp.base_salary as number) ?? 0,
      position_allowance: (entry?.position_allowance as number) ?? (emp.position_allowance as number) ?? 0,
      special_bonus: (entry?.special_bonus as number) ?? 0,
      holiday_pay: (entry?.holiday_pay as number) ?? 0,
      ot_pay: (entry?.ot_pay as number) ?? 0,
      social_security_deduction: (entry?.social_security_deduction as number) ?? 0,
      leave_deduction: (entry?.leave_deduction as number) ?? 0,
      advance_deduction: (entry?.advance_deduction as number) ?? 0,
      adjustment: (entry?.adjustment as number) ?? 0,
      other_amount: (entry?.other_amount as number) ?? 0,
      meal_allowance: (entry?.meal_allowance as number) ?? 0,
      tip_amount: (entry?.tip_amount as number) ?? 0,
      gross_total: (entry?.gross_total as number) ?? null,
      net_total: (entry?.net_total as number) ?? null,
      note: (entry?.note as string) ?? null,
    };
  });
}

export async function upsertPayrollEntry(e: Omit<PayrollEntry, "employee_name" | "employee_code" | "department_name" | "gross_total" | "net_total"> & { id: string | null }): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const gross =
    e.base_salary + e.position_allowance + e.special_bonus +
    e.holiday_pay + e.ot_pay + e.other_amount + e.meal_allowance + e.tip_amount;
  const net = gross - e.social_security_deduction - e.leave_deduction - e.advance_deduction - e.adjustment;
  const payload = {
    payroll_period_id: e.payroll_period_id,
    employee_id: e.employee_id,
    base_salary: e.base_salary,
    position_allowance: e.position_allowance,
    special_bonus: e.special_bonus,
    holiday_pay: e.holiday_pay,
    ot_pay: e.ot_pay,
    social_security_deduction: e.social_security_deduction,
    leave_deduction: e.leave_deduction,
    advance_deduction: e.advance_deduction,
    adjustment: e.adjustment,
    other_amount: e.other_amount,
    meal_allowance: e.meal_allowance,
    tip_amount: e.tip_amount,
    note: e.note,
    gross_total: gross,
    net_total: net,
  };
  if (e.id) {
    await supabase.from("payroll_entries").update(payload).eq("id", e.id);
  } else {
    await supabase.from("payroll_entries").insert(payload);
  }
  revalidatePath("/owner/hr/payroll");
}

// ─── Attendance ───────────────────────────────────────────────────────────────

export async function getAttendancePunches(
  employeeId: string,
  year: number,
  month: number,
): Promise<AttendancePunch[]> {
  const supabase = await createClient();
  const m = String(month).padStart(2, "0");
  const { data, error } = await supabase
    .from("attendance_punches")
    .select("id,employee_id,work_date,punch_type,punch_time,note")
    .eq("employee_id", employeeId)
    .gte("work_date", `${year}-${m}-01`)
    .lte("work_date", `${year}-${m}-31`)
    .order("work_date")
    .order("punch_time");
  if (error) throw error;
  return data ?? [];
}

export async function upsertAttendancePunch(p: {
  id?: string;
  employee_id: string;
  work_date: string;
  punch_type: "in" | "out";
  punch_time: string;
  note?: string;
}): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  if (p.id) {
    const { id, ...rest } = p;
    await supabase.from("attendance_punches").update({ ...rest, source: "manual" }).eq("id", id);
  } else {
    await supabase.from("attendance_punches").insert({ ...p, source: "manual" });
  }
  revalidatePath("/owner/hr/attendance");
}

export async function deleteAttendancePunch(id: string): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("attendance_punches").delete().eq("id", id);
  revalidatePath("/owner/hr/attendance");
}
