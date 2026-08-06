"use server";

import { revalidatePath } from "next/cache";
import { requireHR } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Department = {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
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
  employment_type: "full_time" | "part_time_fixed" | "part_time_oncall" | "probation";
  base_salary: number;
  position_allowance: number;
  social_security_monthly: number;
  hire_date: string | null;
  start_date: string | null;
  daily_wage: number | null;
  weekly_day_off: string | null;
  citizenship_type: "thai" | "foreign";
  is_active: boolean;
  sort_order: number;
  al_quota_override: number | null;
  probation_end_date: string | null;
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

export type PayrollPeriod = {
  id: string;
  period_year: number;
  period_month: number;
  period_half: "first" | "second";
  pay_date: string | null;
  is_closed: boolean;
};

export type EmployeePayrollHistoryRow = {
  period_id: string;
  period_year: number;
  period_month: number;
  period_half: "first" | "second";
  is_closed: boolean;
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
  gross_total: number;
  net_total: number;
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
    .select("id,name,is_active,sort_order")
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((d) => ({ ...d, sort_order: d.sort_order ?? 999 }));
}

export async function upsertDepartment(d: { id?: string; name: string }): Promise<void> {
  await requireHR();
  const supabase = await createClient();
  if (d.id) {
    await supabase.from("departments").update({ name: d.name }).eq("id", d.id);
  } else {
    await supabase.from("departments").insert({ name: d.name });
  }
  revalidatePath("/owner/hr");
}

export async function setDepartmentActive(id: string, is_active: boolean): Promise<void> {
  await requireHR();
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
      base_salary, position_allowance, social_security_monthly,
      hire_date, start_date, daily_wage,
      weekly_day_off, citizenship_type, is_active, sort_order,
      al_quota_override, probation_end_date,
      departments(name, sort_order)
    `)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((e: Record<string, unknown>) => {
    const dept = e.departments as { name: string; sort_order: number } | null;
    return {
      ...(e as Omit<Employee, "department_name">),
      sort_order: (e.sort_order as number) ?? 999,
      department_name: dept?.name ?? null,
      _dept_sort: dept?.sort_order ?? 999,
    };
  }).sort((a, b) => {
    const da = (a as { _dept_sort: number })._dept_sort;
    const db = (b as { _dept_sort: number })._dept_sort;
    if (da !== db) return da - db;
    return a.sort_order - b.sort_order;
  });
}

export async function getEmployee(id: string): Promise<Employee | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .select(`
      id, employee_code, full_name, nickname, phone,
      department_id, position, employment_type,
      base_salary, position_allowance, social_security_monthly,
      hire_date, start_date, daily_wage,
      weekly_day_off, citizenship_type, is_active,
      al_quota_override, probation_end_date,
      departments(name)
    `)
    .eq("id", id)
    .single();
  if (error) return null;
  return {
    ...(data as unknown as Omit<Employee, "department_name">),
    sort_order: (data as unknown as { sort_order?: number }).sort_order ?? 999,
    department_name: (data.departments as unknown as { name: string } | null)?.name ?? null,
    al_quota_override: (data as unknown as { al_quota_override?: number | null }).al_quota_override ?? null,
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
  position_allowance: number;
  social_security_monthly: number;
  hire_date: string;
  start_date?: string | null;
  daily_wage?: number | null;
  weekly_day_off: string;
  citizenship_type: string;
  is_active: boolean;
  al_quota_override?: number | null;
  probation_end_date?: string | null;
}): Promise<void> {
  await requireHR();
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
    position_allowance: e.position_allowance,
    social_security_monthly: e.social_security_monthly,
    hire_date: e.hire_date || null,
    start_date: e.start_date || null,
    daily_wage: e.daily_wage ?? null,
    weekly_day_off: e.weekly_day_off || null,
    citizenship_type: e.citizenship_type,
    is_active: e.is_active,
    al_quota_override: e.al_quota_override ?? null,
    probation_end_date: e.probation_end_date || null,
  };
  if (e.id) {
    await supabase.from("employees").update(payload).eq("id", e.id);
  } else {
    await supabase.from("employees").insert(payload);
  }
  revalidatePath("/owner/hr/employees");
}

export async function updateEmployeeSortOrders(
  updates: { id: string; sort_order: number }[]
): Promise<void> {
  await requireHR();
  const supabase = await createClient();
  for (const u of updates) {
    await supabase.from("employees").update({ sort_order: u.sort_order }).eq("id", u.id);
  }
  revalidatePath("/owner/hr");
}

export type ProbationAlert = {
  id: string;
  full_name: string;
  nickname: string | null;
  probation_end_date: string;
  days_remaining: number;
};

export async function getProbationAlerts(): Promise<ProbationAlert[]> {
  const supabase = await createClient();
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0]!;
  const alertDate = new Date(today);
  alertDate.setDate(alertDate.getDate() + 30);
  const alertDateStr = alertDate.toISOString().split("T")[0]!;

  const { data } = await supabase
    .from("employees")
    .select("id, full_name, nickname, probation_end_date")
    .eq("employment_type", "probation")
    .eq("is_active", true)
    .not("probation_end_date", "is", null)
    .lte("probation_end_date", alertDateStr)
    .order("probation_end_date");

  return (data ?? []).map((e) => {
    const end = new Date(e.probation_end_date + "T00:00:00");
    const now = new Date(todayStr + "T00:00:00");
    const diff = Math.round((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return { id: e.id, full_name: e.full_name, nickname: e.nickname, probation_end_date: e.probation_end_date, days_remaining: diff };
  });
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
  await requireHR();
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
    const lastDay = new Date(filters.year, filters.month, 0).getDate();
    q = q.gte("date_from", `${filters.year}-${m}-01`).lte("date_from", `${filters.year}-${m}-${lastDay}`);
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
  await requireHR();
  const supabase = await createClient();
  let oldDateFrom: string | null = null;
  let oldDateTo: string | null = null;
  if (data.id) {
    const { id, ...rest } = data;
    const { data: old } = await supabase
      .from("leave_requests")
      .select("date_from,date_to")
      .eq("id", id)
      .single();
    oldDateFrom = old?.date_from ?? null;
    oldDateTo = old?.date_to ?? null;
    await supabase.from("leave_requests").update(rest).eq("id", id);
  } else {
    await supabase.from("leave_requests").insert({ ...data, status: "approved" });
  }

  // Mirror every date in the leave range to attendance_daily (source of truth for payroll/quota/schedule).
  const dailyRows: object[] = [];
  const cur = new Date(data.date_from + "T00:00:00");
  const end = new Date(data.date_to + "T00:00:00");
  while (cur <= end) {
    dailyRows.push({
      employee_id: data.employee_id,
      work_date: cur.toISOString().slice(0, 10),
      status: "leave",
      leave_type_id: data.leave_type_id,
      leave_fraction: 1,
      late_minutes: 0,
      ot_hours: 0,
      note: null,
      source: "leave_request",
    });
    cur.setDate(cur.getDate() + 1);
  }
  await supabase.from("attendance_daily").upsert(dailyRows, { onConflict: "employee_id,work_date" });

  // On edit: delete attendance_daily rows for dates that dropped out of the new range.
  if (oldDateFrom && oldDateTo) {
    const newDates = new Set(dailyRows.map((r) => (r as { work_date: string }).work_date));
    const toDelete: string[] = [];
    const c2 = new Date(oldDateFrom + "T00:00:00");
    const e2 = new Date(oldDateTo + "T00:00:00");
    while (c2 <= e2) {
      const ds = c2.toISOString().slice(0, 10);
      if (!newDates.has(ds)) toDelete.push(ds);
      c2.setDate(c2.getDate() + 1);
    }
    if (toDelete.length > 0) {
      await supabase
        .from("attendance_daily")
        .delete()
        .eq("employee_id", data.employee_id)
        .eq("source", "leave_request")
        .in("work_date", toDelete);
    }
  }

  revalidatePath("/owner/hr/leave");
  revalidatePath("/owner/hr/schedule");
  revalidatePath("/owner/hr/attendance");
}

export async function updateLeaveStatus(id: string, status: "approved" | "rejected"): Promise<void> {
  await requireHR();
  const supabase = await createClient();
  await supabase.from("leave_requests").update({ status }).eq("id", id);
  revalidatePath("/owner/hr/leave");
  revalidatePath("/owner/hr/schedule");
  revalidatePath("/owner/hr/attendance");
}

export async function deleteLeaveRequest(id: string): Promise<void> {
  await requireHR();
  const supabase = await createClient();
  const { data: lr } = await supabase
    .from("leave_requests")
    .select("employee_id,date_from,date_to")
    .eq("id", id)
    .single();
  await supabase.from("leave_requests").delete().eq("id", id);
  if (lr) {
    const toDelete: string[] = [];
    const cur = new Date(lr.date_from + "T00:00:00");
    const end = new Date(lr.date_to + "T00:00:00");
    while (cur <= end) {
      toDelete.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
    if (toDelete.length > 0) {
      await supabase
        .from("attendance_daily")
        .delete()
        .eq("employee_id", lr.employee_id)
        .eq("source", "leave_request")
        .in("work_date", toDelete);
    }
  }
  revalidatePath("/owner/hr/leave");
  revalidatePath("/owner/hr/schedule");
  revalidatePath("/owner/hr/attendance");
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
  await requireHR();
  const supabase = await createClient();
  if (h.id) {
    await supabase.from("holidays").update(h).eq("id", h.id);
  } else {
    await supabase.from("holidays").insert({ ...h, is_active: true });
  }
  revalidatePath("/owner/hr/settings");
}

export async function deleteHoliday(id: string): Promise<void> {
  await requireHR();
  const supabase = await createClient();
  await supabase.from("holidays").delete().eq("id", id);
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
  await requireHR();
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
  await requireHR();
  const supabase = await createClient();
  await supabase.from("payroll_periods").update({ is_closed: true }).eq("id", id);
  revalidatePath("/owner/hr/payroll");
}

export async function reopenPayrollPeriod(id: string): Promise<void> {
  await requireHR();
  const supabase = await createClient();
  await supabase.from("payroll_periods").update({ is_closed: false }).eq("id", id);
  revalidatePath("/owner/hr/payroll");
}

export async function getEmployeePayrollHistory(employeeId: string): Promise<EmployeePayrollHistoryRow[]> {
  const supabase = await createClient();
  const [{ data: periods, error: periodsError }, { data: entries, error: entriesError }, { data: emp }, { data: attendance }, deductibleLeaveTypeIds] = await Promise.all([
    supabase
      .from("payroll_periods")
      .select("id,period_year,period_month,period_half,is_closed")
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false })
      .order("period_half", { ascending: false }),
    supabase.from("payroll_entries").select("*").eq("employee_id", employeeId),
    supabase.from("employees").select("base_salary,position_allowance,social_security_monthly").eq("id", employeeId).single(),
    supabase.from("attendance_daily").select("work_date,status,late_minutes,leave_type_id,leave_fraction").eq("employee_id", employeeId),
    getDeductibleLeaveTypeIds(supabase),
  ]);
  if (periodsError) throw periodsError;
  if (entriesError) throw entriesError;

  const entryMap = new Map((entries ?? []).map((e: Record<string, unknown>) => [e.payroll_period_id as string, e]));
  const monthlySalary = (emp?.base_salary as number) ?? 0;
  const defaultBase = monthlySalary / 2;
  const defaultPosition = ((emp?.position_allowance as number) ?? 0) / 2;
  const defaultSS = ((emp?.social_security_monthly as number) ?? 0) / 2;
  const attendanceRows = (attendance ?? []) as { work_date: string; status: string; late_minutes: number | null; leave_type_id: string | null; leave_fraction: number | null }[];

  return (periods ?? []).map((period: Record<string, unknown>) => {
    const entry = entryMap.get(period.id as string) as Record<string, unknown> | undefined;
    const base_salary = (entry?.base_salary as number) ?? defaultBase;
    const position_allowance = (entry?.position_allowance as number) ?? defaultPosition;
    const special_bonus = (entry?.special_bonus as number) ?? 0;
    const holiday_pay = (entry?.holiday_pay as number) ?? 0;
    const ot_pay = (entry?.ot_pay as number) ?? 0;
    const social_security_deduction = (entry?.social_security_deduction as number) ?? defaultSS;
    let defaultLeaveDeduction = 0;
    if (entry?.leave_deduction === undefined) {
      const { start, end } = periodDateRange(period.period_year as number, period.period_month as number, period.period_half as "first" | "second");
      const periodRows = attendanceRows.filter((row) => row.work_date >= start && row.work_date <= end);
      defaultLeaveDeduction = computeAttendanceDeduction(periodRows, monthlySalary, deductibleLeaveTypeIds);
    }
    const leave_deduction = (entry?.leave_deduction as number) ?? defaultLeaveDeduction;
    const advance_deduction = (entry?.advance_deduction as number) ?? 0;
    const adjustment = (entry?.adjustment as number) ?? 0;
    const other_amount = (entry?.other_amount as number) ?? 0;
    const meal_allowance = (entry?.meal_allowance as number) ?? 0;
    const tip_amount = (entry?.tip_amount as number) ?? 0;
    const gross = base_salary + position_allowance + special_bonus + holiday_pay + ot_pay + other_amount + meal_allowance + tip_amount;
    const net = gross - social_security_deduction - leave_deduction - advance_deduction - adjustment;
    return {
      period_id: period.id as string,
      period_year: period.period_year as number,
      period_month: period.period_month as number,
      period_half: period.period_half as "first" | "second",
      is_closed: period.is_closed as boolean,
      base_salary,
      position_allowance,
      special_bonus,
      holiday_pay,
      ot_pay,
      social_security_deduction,
      leave_deduction,
      advance_deduction,
      adjustment,
      other_amount,
      meal_allowance,
      tip_amount,
      gross_total: (entry?.gross_total as number) ?? gross,
      net_total: (entry?.net_total as number) ?? net,
    };
  });
}

// ─── Approved leaves expanded to per-day (for schedule overlay) ───────────────

export type LeaveDay = {
  employee_id: string;
  leave_date: string;
  leave_type_code: string;
  leave_type_name: string;
  leave_request_id: string;
};

export async function getApprovedLeavesForWeek(weekStart: string): Promise<LeaveDay[]> {
  const supabase = await createClient();
  const weekEnd = new Date(weekStart + "T00:00:00");
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  const { data } = await supabase
    .from("attendance_daily")
    .select("employee_id,work_date,leave_type_id,leave_types(code,name_th)")
    .eq("status", "leave")
    .gte("work_date", weekStart)
    .lte("work_date", weekEndStr);

  if (!data) return [];

  return (data as Record<string, unknown>[]).map((row) => {
    const lt = row.leave_types as { code: string; name_th: string } | null;
    return {
      employee_id: row.employee_id as string,
      leave_date: row.work_date as string,
      leave_type_code: lt?.code ?? "ลา",
      leave_type_name: lt?.name_th ?? "ลา",
      leave_request_id: "",
    };
  });
}

export async function getSwapDatesForWeek(weekStart: string): Promise<string[]> {
  const supabase = await createClient();
  const weekEnd = new Date(weekStart + "T00:00:00");
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);
  const { data } = await supabase
    .from("day_swap_requests")
    .select("employee_id,work_date,off_date");
  const result: string[] = [];
  for (const r of (data ?? []) as { employee_id: string; work_date: string | null; off_date: string | null }[]) {
    if (r.work_date && r.work_date >= weekStart && r.work_date <= weekEndStr)
      result.push(`${r.employee_id}_${r.work_date}`);
    if (r.off_date && r.off_date >= weekStart && r.off_date <= weekEndStr)
      result.push(`${r.employee_id}_${r.off_date}`);
  }
  return result;
}

export async function getApprovedLeavesForMonth(year: number, month: number): Promise<LeaveDay[]> {
  const supabase = await createClient();
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const { data, error } = await supabase
    .from("leave_requests")
    .select("id, employee_id, date_from, date_to, leave_types(code, name_th)")
    .eq("status", "approved")
    .lte("date_from", monthEnd)
    .gte("date_to", monthStart)
    .limit(5000);

  if (error) console.error("[getApprovedLeavesForMonth] error:", error);
  if (!data) return [];

  const result: LeaveDay[] = [];
  for (const req of data as Record<string, unknown>[]) {
    const lt = req.leave_types as { code: string; name_th: string } | null;
    const from = new Date((req.date_from as string) + "T00:00:00");
    const to = new Date((req.date_to as string) + "T00:00:00");
    const mStart = new Date(monthStart + "T00:00:00");
    const mEnd = new Date(monthEnd + "T00:00:00");
    const cur = new Date(Math.max(from.getTime(), mStart.getTime()));
    const end = new Date(Math.min(to.getTime(), mEnd.getTime()));
    while (cur <= end) {
      const y = cur.getFullYear();
      const m2 = String(cur.getMonth() + 1).padStart(2, "0");
      const d = String(cur.getDate()).padStart(2, "0");
      result.push({
        employee_id: req.employee_id as string,
        leave_date: `${y}-${m2}-${d}`,
        leave_type_code: lt?.code ?? "ลา",
        leave_type_name: lt?.name_th ?? "ลา",
        leave_request_id: req.id as string,
      });
      cur.setDate(cur.getDate() + 1);
    }
  }
  return result;
}

// ─── Schedule Notes (Weekly Roster) ───────────────────────────────────────────

export type NoteType = "compensatory" | "holiday_use" | "leave" | "sick" | "vacation" | "event" | "note";

export type ScheduleNote = {
  id: string;
  employee_id: string;
  note_date: string;
  note: string;
  note_type: NoteType;
};

export async function getScheduleWeek(weekStart: string): Promise<ScheduleNote[]> {
  const supabase = await createClient();
  const end = new Date(weekStart + "T00:00:00");
  end.setDate(end.getDate() + 6);
  const { data } = await supabase
    .from("schedule_notes")
    .select("id,employee_id,note_date,note,note_type")
    .gte("note_date", weekStart)
    .lte("note_date", end.toISOString().slice(0, 10));
  return data ?? [];
}

export async function upsertScheduleNote(
  employeeId: string,
  noteDate: string,
  note: string,
  noteType: NoteType,
): Promise<void> {
  await requireHR();
  const supabase = await createClient();
  // Always upsert — note text is optional, note_type alone is meaningful.
  // Use clearNote (DELETE) when the user explicitly wants to remove a cell.
  {
    await supabase
      .from("schedule_notes")
      .upsert(
        { employee_id: employeeId, note_date: noteDate, note: note.trim(), note_type: noteType },
        { onConflict: "employee_id,note_date" },
      );
  }
  revalidatePath("/owner/hr/schedule");
}

// ─── Payroll Entries ──────────────────────────────────────────────────────────

// A day off/absent day costs 1/30 of the monthly base salary.
function dailyRate(monthlySalary: number): number {
  return monthlySalary / 30;
}

// Absences and unpaid leave (PLW) cost a full day (a partial leave day, e.g.
// half-day leave, costs its leave_fraction of that); every other leave type
// (AL, SL, SLA, PLP, CDW, CDP, UOT) is paid and never auto-deducted.
function perDayDeduction(
  row: { status: string; leave_type_id: string | null; leave_fraction?: number | null },
  monthlySalary: number,
  deductibleLeaveTypeIds: Set<string>,
): number {
  const rate = dailyRate(monthlySalary);
  if (row.status === "absent") return rate;
  if (row.status === "leave" && row.leave_type_id && deductibleLeaveTypeIds.has(row.leave_type_id)) {
    return rate * (row.leave_fraction ?? 1);
  }
  return 0;
}

// Lateness is judged on the TOTAL minutes late across the whole half-month
// period, not per incident: the first 30 minutes (cumulative) are free,
// then every additional 30-minute block (rounded up) costs half a day.
function lateDeductionFromTotal(monthlySalary: number, totalLateMinutes: number): number {
  if (totalLateMinutes <= 30) return 0;
  const blocks = Math.ceil((totalLateMinutes - 30) / 30);
  return blocks * (dailyRate(monthlySalary) / 2);
}

function periodDateRange(year: number, month: number, half: "first" | "second"): { start: string; end: string } {
  const m = String(month).padStart(2, "0");
  if (half === "first") return { start: `${year}-${m}-01`, end: `${year}-${m}-15` };
  const lastDay = new Date(year, month, 0).getDate();
  return { start: `${year}-${m}-16`, end: `${year}-${m}-${String(lastDay).padStart(2, "0")}` };
}

function computeAttendanceDeduction(
  rows: { status: string; late_minutes: number | null; leave_type_id: string | null; leave_fraction?: number | null }[],
  monthlySalary: number,
  deductibleLeaveTypeIds: Set<string>,
): number {
  let total = 0;
  let lateMinutes = 0;
  for (const row of rows) {
    if (row.status === "late") lateMinutes += row.late_minutes ?? 0;
    else total += perDayDeduction(row, monthlySalary, deductibleLeaveTypeIds);
  }
  total += lateDeductionFromTotal(monthlySalary, lateMinutes);
  return Math.round(total * 100) / 100;
}

const DAY_OF_WEEK_TH: Record<string, number> = {
  อาทิตย์: 0, จันทร์: 1, อังคาร: 2, พุธ: 3, พฤหัสบดี: 4, ศุกร์: 5, เสาร์: 6,
};

// ค่าข้าวเริ่มต้น 800 บาท/งวด หักวันขาด 60 บาท/วัน บวกคืนวันที่มาทำงาน
// ในวันนักขัตฤกษ์หรือวันหยุดประจำสัปดาห์ของพนักงานคนนั้น 60 บาท/วัน
function computeMealAllowance(
  rows: { status: string; work_date: string }[],
  weeklyDayOff: string | null,
  holidayDates: Set<string>,
): number {
  const weeklyOffDow = DAY_OF_WEEK_TH[weeklyDayOff ?? ""] ?? -1;
  let absentDays = 0;
  let workedOnOffDays = 0;
  for (const row of rows) {
    if (row.status === "absent") absentDays++;
    if (row.status === "present" || row.status === "late") {
      const dow = new Date(row.work_date + "T00:00:00").getDay();
      if (holidayDates.has(row.work_date) || dow === weeklyOffDow) workedOnOffDays++;
    }
  }
  return 800 - absentDays * 60 + workedOnOffDays * 60;
}

// Only ลากิจ (รายวัน) / PLW deducts pay like an absence — every other leave
// type (AL, SL, SLA, PLP, CDW, CDP, UOT) is paid and never auto-deducted.
async function getDeductibleLeaveTypeIds(supabase: Awaited<ReturnType<typeof createClient>>): Promise<Set<string>> {
  const { data } = await supabase.from("leave_types").select("id,code").eq("code", "PLW");
  return new Set((data ?? []).map((t: { id: string }) => t.id));
}

export async function getPayrollEntries(periodId: string): Promise<PayrollEntry[]> {
  const supabase = await createClient();
  const [{ data: period }, { data: employees }, { data: entries }, deductibleLeaveTypeIds] = await Promise.all([
    supabase.from("payroll_periods").select("period_year,period_month,period_half").eq("id", periodId).single(),
    supabase
      .from("employees")
      .select("id,employee_code,full_name,department_id,base_salary,position_allowance,social_security_monthly,weekly_day_off,sort_order,departments(name,sort_order)")
      .eq("is_active", true),
    supabase.from("payroll_entries").select("*").eq("payroll_period_id", periodId),
    getDeductibleLeaveTypeIds(supabase),
  ]);

  const sortedEmployees = (employees ?? []).slice().sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
    const da = (a.departments as { sort_order: number } | null)?.sort_order ?? 999;
    const db = (b.departments as { sort_order: number } | null)?.sort_order ?? 999;
    if (da !== db) return da - db;
    return ((a.sort_order as number) ?? 999) - ((b.sort_order as number) ?? 999);
  });

  const entryMap = new Map((entries ?? []).map((e: Record<string, unknown>) => [e.employee_id as string, e]));

  const deductionMap = new Map<string, number>();
  const mealAllowanceMap = new Map<string, number>();
  if (period) {
    const { start, end } = periodDateRange(period.period_year, period.period_month, period.period_half);
    const [{ data: attendance }, holidays] = await Promise.all([
      supabase
        .from("attendance_daily")
        .select("employee_id,work_date,status,late_minutes,leave_type_id,leave_fraction")
        .gte("work_date", start)
        .lte("work_date", end),
      getHolidays(period.period_year),
    ]);
    const holidayDates = new Set(holidays.filter((h) => h.is_active).map((h) => h.holiday_date));
    const salaryMap = new Map(sortedEmployees.map((e: Record<string, unknown>) => [e.id as string, (e.base_salary as number) ?? 0]));
    const weeklyDayOffMap = new Map(sortedEmployees.map((e: Record<string, unknown>) => [e.id as string, (e.weekly_day_off as string | null) ?? null]));
    const rowsByEmployee = new Map<string, { work_date: string; status: string; late_minutes: number | null; leave_type_id: string | null; leave_fraction: number | null }[]>();
    for (const row of (attendance ?? []) as { employee_id: string; work_date: string; status: string; late_minutes: number | null; leave_type_id: string | null; leave_fraction: number | null }[]) {
      if (!rowsByEmployee.has(row.employee_id)) rowsByEmployee.set(row.employee_id, []);
      rowsByEmployee.get(row.employee_id)!.push(row);
    }
    for (const [employeeId, rows] of rowsByEmployee) {
      deductionMap.set(employeeId, computeAttendanceDeduction(rows, salaryMap.get(employeeId) ?? 0, deductibleLeaveTypeIds));
      mealAllowanceMap.set(employeeId, computeMealAllowance(rows, weeklyDayOffMap.get(employeeId) ?? null, holidayDates));
    }
  }

  return sortedEmployees.map((emp: Record<string, unknown>) => {
    const entry = entryMap.get(emp.id as string) as Record<string, unknown> | undefined;
    return {
      id: (entry?.id as string) ?? null,
      payroll_period_id: periodId,
      employee_id: emp.id as string,
      employee_name: emp.full_name as string,
      employee_code: emp.employee_code as string | null,
      department_name: (emp.departments as { name: string } | null)?.name ?? null,
      base_salary: (entry?.base_salary as number) ?? ((emp.base_salary as number) ?? 0) / 2,
      position_allowance: (entry?.position_allowance as number) ?? ((emp.position_allowance as number) ?? 0) / 2,
      special_bonus: (entry?.special_bonus as number) ?? 0,
      holiday_pay: (entry?.holiday_pay as number) ?? 0,
      ot_pay: (entry?.ot_pay as number) ?? 0,
      social_security_deduction: (entry?.social_security_deduction as number) ?? ((emp.social_security_monthly as number) ?? 0) / 2,
      leave_deduction: (entry?.leave_deduction as number) ?? (deductionMap.get(emp.id as string) ?? 0),
      advance_deduction: (entry?.advance_deduction as number) ?? 0,
      adjustment: (entry?.adjustment as number) ?? 0,
      other_amount: (entry?.other_amount as number) ?? 0,
      meal_allowance: (entry?.meal_allowance as number) ?? (mealAllowanceMap.get(emp.id as string) ?? 0),
      tip_amount: (entry?.tip_amount as number) ?? 0,
      gross_total: (entry?.gross_total as number) ?? null,
      net_total: (entry?.net_total as number) ?? null,
      note: (entry?.note as string) ?? null,
    };
  });
}

export async function upsertPayrollEntry(e: Omit<PayrollEntry, "employee_name" | "employee_code" | "department_name" | "gross_total" | "net_total"> & { id: string | null }): Promise<void> {
  await requireHR();
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

// ─── Attendance Daily ─────────────────────────────────────────────────────────

export type AttendanceDaily = {
  id: string;
  employee_id: string;
  work_date: string;
  status: "present" | "absent" | "late" | "leave" | "day_off";
  late_minutes: number;
  ot_hours: number;
  leave_type_id: string | null;
  leave_fraction: number;
  note: string | null;
  source: string;
};

export async function getAttendanceDailyMonth(
  year: number,
  month: number,
): Promise<AttendanceDaily[]> {
  const supabase = await createClient();
  const m = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  const { data, error } = await supabase
    .from("attendance_daily")
    .select("id,employee_id,work_date,status,late_minutes,ot_hours,leave_type_id,leave_fraction,note,source")
    .gte("work_date", `${year}-${m}-01`)
    .lte("work_date", `${year}-${m}-${String(lastDay).padStart(2, "0")}`)
    .order("work_date");
  if (error) throw error;
  return data ?? [];
}

export async function upsertAttendanceDaily(r: {
  employee_id: string;
  work_date: string;
  status: string;
  late_minutes: number;
  ot_hours: number;
  leave_type_id: string | null;
  leave_fraction: number;
  note: string | null;
}): Promise<void> {
  await requireHR();
  const supabase = await createClient();
  await supabase.from("attendance_daily").upsert(
    { ...r, source: "manual" },
    { onConflict: "employee_id,work_date" },
  );
  revalidatePath("/owner/hr/attendance");
}

export async function deleteAttendanceDailyRecord(
  employeeId: string,
  workDate: string,
): Promise<void> {
  await requireHR();
  const supabase = await createClient();
  await supabase
    .from("attendance_daily")
    .delete()
    .eq("employee_id", employeeId)
    .eq("work_date", workDate);
  revalidatePath("/owner/hr/attendance");
}

// ─── Attendance Punches (legacy / biometric input) ────────────────────────────

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
    .lte("work_date", `${year}-${m}-${new Date(year, month, 0).getDate()}`)
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
  await requireHR();
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
  await requireHR();
  const supabase = await createClient();
  await supabase.from("attendance_punches").delete().eq("id", id);
  revalidatePath("/owner/hr/attendance");
}

// ─── Leave Quotas ─────────────────────────────────────────────────────────────

export type LeaveQuotaRow = {
  employee_id: string;
  employee_name: string;
  employee_nickname: string | null;
  usage: {
    leave_type_id: string;
    leave_type_code: string;
    leave_type_name: string;
    annual_quota: number;
    used_days: number;
    // AL only: half-year breakdown
    h1_quota?: number;
    h2_quota?: number;
    h1_used?: number;
    h2_used?: number;
  }[];
};

function yearsOfServiceAt(hireDateStr: string | null, refDateStr: string): number {
  if (!hireDateStr) return 0;
  const hire = new Date(hireDateStr + "T00:00:00");
  const ref = new Date(refDateStr + "T00:00:00");
  let y = ref.getFullYear() - hire.getFullYear();
  const anniversary = new Date(ref.getFullYear(), hire.getMonth(), hire.getDate());
  if (ref < anniversary) y--;
  return Math.max(0, y);
}

function yearsOfService(hireDateStr: string | null, year: number): number {
  return yearsOfServiceAt(hireDateStr, `${year}-12-31`);
}

function alQuotaDays(years: number): number {
  if (years < 1) return 0;
  if (years < 3) return 4;
  if (years < 6) return 6;
  if (years < 10) return 8;
  return 10;
}

export async function getLeaveQuotas(year: number): Promise<LeaveQuotaRow[]> {
  const supabase = await createClient();
  const [{ data: emps }, { data: types }, { data: adLeave }] = await Promise.all([
    supabase.from("employees").select("id,full_name,nickname,hire_date,sort_order,al_quota_override,departments(sort_order)").eq("is_active", true),
    supabase.from("leave_types").select("id,code,name_th,annual_quota_days").eq("is_active", true).not("annual_quota_days", "is", null),
    supabase
      .from("attendance_daily")
      .select("employee_id,leave_type_id,leave_fraction,work_date")
      .eq("status", "leave")
      .gte("work_date", `${year}-01-01`)
      .lte("work_date", `${year}-12-31`)
      .limit(10000),
  ]);

  const usageMap = new Map<string, number>();
  const h1UsageMap = new Map<string, number>(); // Jan–Jun
  const h2UsageMap = new Map<string, number>(); // Jul–Dec
  for (const r of adLeave ?? []) {
    const k = `${r.employee_id}_${r.leave_type_id}`;
    usageMap.set(k, (usageMap.get(k) ?? 0) + (r.leave_fraction ?? 1));
    const isH1 = (r.work_date ?? "") <= `${year}-06-30`;
    const hMap = isH1 ? h1UsageMap : h2UsageMap;
    hMap.set(k, (hMap.get(k) ?? 0) + (r.leave_fraction ?? 1));
  }

  const sorted = (emps ?? []).slice().sort((a, b) => {
    const da = ((a as Record<string, unknown>).departments as { sort_order: number } | null)?.sort_order ?? 999;
    const db = ((b as Record<string, unknown>).departments as { sort_order: number } | null)?.sort_order ?? 999;
    if (da !== db) return da - db;
    return ((a as Record<string, unknown>).sort_order as number ?? 999) - ((b as Record<string, unknown>).sort_order as number ?? 999);
  });

  return sorted.map((emp: Record<string, unknown>) => {
    const alOverride = (emp.al_quota_override as number | null) ?? null;
    const yearsH1 = yearsOfServiceAt(emp.hire_date as string | null, `${year}-06-30`);
    const yearsH2 = yearsOfServiceAt(emp.hire_date as string | null, `${year}-12-31`);
    const usage = (types ?? []).map((lt: Record<string, unknown>) => {
      const code = lt.code as string;
      const isAL = code === "AL" || (lt.name_th as string).includes("พักร้อน");
      const k = `${emp.id}_${lt.id}`;
      if (isAL) {
        const h1q = alOverride !== null ? Math.floor(alOverride / 2) : alQuotaDays(yearsH1) / 2;
        const h2q = alOverride !== null ? (alOverride - Math.floor(alOverride / 2)) : alQuotaDays(yearsH2) / 2;
        return {
          leave_type_id: lt.id as string,
          leave_type_code: code,
          leave_type_name: lt.name_th as string,
          annual_quota: h1q + h2q,
          used_days: usageMap.get(k) ?? 0,
          h1_quota: h1q,
          h2_quota: h2q,
          h1_used: h1UsageMap.get(k) ?? 0,
          h2_used: h2UsageMap.get(k) ?? 0,
        };
      }
      return {
        leave_type_id: lt.id as string,
        leave_type_code: code,
        leave_type_name: lt.name_th as string,
        annual_quota: lt.annual_quota_days as number,
        used_days: usageMap.get(k) ?? 0,
      };
    });

    // SL and SLA (ลาป่วย / ลาป่วยมีใบแพทย์) share one 30-day sick leave pool —
    // merge SLA's usage into SL instead of tracking two separate quotas.
    const sl = usage.find((u) => u.leave_type_code === "SL");
    const sla = usage.find((u) => u.leave_type_code === "SLA");
    const mergedUsage = sl && sla
      ? usage.filter((u) => u.leave_type_code !== "SLA").map((u) =>
          u.leave_type_code === "SL" ? { ...u, used_days: u.used_days + sla.used_days } : u
        )
      : usage;

    return {
      employee_id: emp.id as string,
      employee_name: emp.full_name as string,
      employee_nickname: emp.nickname as string | null,
      usage: mergedUsage,
    };
  });
}

// ─── Day Swap Requests ────────────────────────────────────────────────────────

export type DaySwapRequest = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_nickname: string | null;
  work_date: string | null;
  off_date: string | null;
  swap_type: "work_first" | "off_first";
  compensation: "bank_day" | "extra_pay";
  note: string | null;
  created_at: string;
};

export type CompDayBalance = {
  employee_id: string;
  employee_name: string;
  employee_nickname: string | null;
  earned: number;        // work_first bank_day ที่ work_date ผ่านแล้ว
  used: number;          // work_first bank_day ที่ off_date ผ่านแล้ว
  pending_makeup: number; // off_first ที่ยังไม่ได้มาทดแทน
};

export async function getDaySwapRequests(year?: number): Promise<DaySwapRequest[]> {
  const supabase = await createClient();
  let q = supabase
    .from("day_swap_requests")
    .select(`id, employee_id, work_date, off_date, swap_type, compensation, note, created_at, employees(full_name, nickname)`)
    .order("created_at", { ascending: false });
  if (year) {
    q = q.or(`work_date.gte.${year}-01-01,off_date.gte.${year}-01-01`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    employee_id: r.employee_id as string,
    employee_name: (r.employees as { full_name: string } | null)?.full_name ?? "",
    employee_nickname: (r.employees as { nickname: string | null } | null)?.nickname ?? null,
    work_date: r.work_date as string | null,
    off_date: r.off_date as string | null,
    swap_type: r.swap_type as "work_first" | "off_first",
    compensation: r.compensation as "bank_day" | "extra_pay",
    note: r.note as string | null,
    created_at: r.created_at as string,
  }));
}

export async function getSwapDatesForMonth(year: number, month: number): Promise<string[]> {
  const supabase = await createClient();
  const m = String(month).padStart(2, "0");
  const start = `${year}-${m}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${m}-${String(lastDay).padStart(2, "0")}`;
  const { data } = await supabase
    .from("day_swap_requests")
    .select("employee_id,work_date,off_date");
  const result: string[] = [];
  for (const r of (data ?? []) as { employee_id: string; work_date: string | null; off_date: string | null }[]) {
    if (r.work_date && r.work_date >= start && r.work_date <= end) result.push(`${r.employee_id}_${r.work_date}`);
    if (r.off_date  && r.off_date  >= start && r.off_date  <= end) result.push(`${r.employee_id}_${r.off_date}`);
  }
  return result;
}

export async function getCompDayBalances(): Promise<CompDayBalance[]> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: employees }, { data: swaps }] = await Promise.all([
    supabase.from("employees").select("id,full_name,nickname").eq("is_active", true).order("full_name"),
    supabase.from("day_swap_requests").select("employee_id,work_date,off_date,swap_type,compensation"),
  ]);
  const empList = employees ?? [];
  const swapList = swaps ?? [];
  return empList.map((emp: Record<string, unknown>) => {
    const mySwaps = swapList.filter((s: Record<string, unknown>) => s.employee_id === emp.id);
    const earned = mySwaps.filter(
      (s: Record<string, unknown>) =>
        s.swap_type === "work_first" &&
        s.compensation === "bank_day" &&
        typeof s.work_date === "string" &&
        s.work_date <= today,
    ).length;
    const used = mySwaps.filter(
      (s: Record<string, unknown>) =>
        s.swap_type === "work_first" &&
        s.compensation === "bank_day" &&
        s.off_date !== null &&
        typeof s.off_date === "string" &&
        s.off_date <= today,
    ).length;
    const pending_makeup = mySwaps.filter(
      (s: Record<string, unknown>) =>
        s.swap_type === "off_first" &&
        (s.work_date === null || s.work_date === ""),
    ).length;
    return {
      employee_id: emp.id as string,
      employee_name: emp.full_name as string,
      employee_nickname: emp.nickname as string | null,
      earned,
      used,
      pending_makeup,
    };
  });
}

export async function upsertDaySwapRequest(r: {
  id?: string;
  employee_id: string;
  work_date: string | null;
  off_date: string | null;
  swap_type: "work_first" | "off_first";
  compensation: "bank_day" | "extra_pay";
  note: string | null;
}): Promise<void> {
  await requireHR();
  const supabase = await createClient();
  const payload = {
    employee_id: r.employee_id,
    work_date: r.work_date || null,
    off_date: r.off_date || null,
    swap_type: r.swap_type,
    compensation: r.compensation,
    note: r.note || null,
  };
  if (r.id) {
    await supabase.from("day_swap_requests").update(payload).eq("id", r.id);
  } else {
    await supabase.from("day_swap_requests").insert(payload);
  }
  revalidatePath("/owner/hr/dayswap");
  revalidatePath("/owner/hr/employees");
}

export async function deleteDaySwapRequest(id: string): Promise<void> {
  await requireHR();
  const supabase = await createClient();
  await supabase.from("day_swap_requests").delete().eq("id", id);
  revalidatePath("/owner/hr/dayswap");
  revalidatePath("/owner/hr/employees");
}

// ─── Attendance Year Summary ──────────────────────────────────────────────────

export type AttendanceYearSummary = {
  absentDays: number;
  lateDays: number;
  lateMinutesTotal: number;
  otDays: number;
  leaveDays: number;
};

export async function getAttendanceYearSummary(
  employeeId: string,
  year: number,
): Promise<AttendanceYearSummary> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("attendance_daily")
    .select("status,late_minutes,ot_hours")
    .eq("employee_id", employeeId)
    .gte("work_date", `${year}-01-01`)
    .lte("work_date", `${year}-12-31`);

  let absentDays = 0, lateDays = 0, lateMinutesTotal = 0, otDays = 0, leaveDays = 0;
  for (const r of data ?? []) {
    if (r.status === "absent") absentDays++;
    if (r.status === "leave") leaveDays++;
    if ((r.late_minutes ?? 0) > 0) { lateDays++; lateMinutesTotal += r.late_minutes; }
    if ((r.ot_hours ?? 0) > 0) otDays++;
  }
  return { absentDays, lateDays, lateMinutesTotal, otDays, leaveDays };
}
