"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireProfile, isAdminOrAbove } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type CoaAccount = {
  code: string;
  name: string;
  group_code: string | null;
  group_name: string | null;
  target_pct: number | null;
  sort_order: number;
  is_sensitive: boolean;
};

export type ExpenseEntry = {
  id: string;
  entry_date: string;
  coa_code: string;
  coa_name: string;
  group_name: string | null;
  amount: number;
  note: string | null;
  bill_ref: string | null;
  payment_method: "cash" | "transfer";
  created_at: string;
  display_order: number | null;
  supplier_id: string | null;
  supplier_name: string | null;
  detail: string | null;
};

export type Supplier = {
  id: string;
  name: string;
  bank: string | null;
  account_number: string | null;
  description: string | null;
  credit: boolean;
  payment_mode: "transfer" | "cash";
  internal_account: string | null;
  sort_order: number;
  is_active: boolean;
};

export type WeeklySupplierRow = {
  supplier: Supplier;
  days: (number | null)[];
  total: number;
};

export type RevenueRow = {
  revenue_type: "food" | "drink" | "dessert" | "delivery" | "other";
  amount: number;
};

export type MonthlySummaryGroup = {
  group_code: string;
  group_name: string;
  target_pct: number | null;
  total: number;
  pct_of_revenue: number | null;
  accounts: {
    code: string;
    name: string;
    total: number;
    pct_of_revenue: number | null;
  }[];
};

// ── Suppliers ────────────────────────────────────────

export async function getSuppliers(): Promise<Supplier[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .select("id,name,bank,account_number,description,credit,payment_mode,internal_account,sort_order,is_active")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as Supplier[];
}

export async function getWeeklyTransferData(tuesdayDate: string): Promise<{
  rows: WeeklySupplierRow[];
  days: string[];
}> {
  await requireAdmin();
  const supabase = await createClient();

  const days: string[] = [];
  const start = new Date(tuesdayDate);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }

  const [suppliersRes, entriesRes] = await Promise.all([
    supabase.from("suppliers").select("*").eq("is_active", true).order("sort_order"),
    supabase
      .from("expense_entries")
      .select("supplier_id,entry_date,amount")
      .gte("entry_date", days[0]!)
      .lte("entry_date", days[6]!)
      .not("supplier_id", "is", null),
  ]);

  if (suppliersRes.error) throw new Error(suppliersRes.error.message);
  if (entriesRes.error) throw new Error(entriesRes.error.message);

  const allSuppliers = (suppliersRes.data ?? []) as Supplier[];
  const entries = entriesRes.data ?? [];

  const supplierDayMap = new Map<string, number[]>();
  for (const e of entries) {
    if (!e.supplier_id) continue;
    if (!supplierDayMap.has(e.supplier_id)) {
      supplierDayMap.set(e.supplier_id, [0, 0, 0, 0, 0, 0, 0]);
    }
    const idx = days.indexOf(e.entry_date);
    if (idx === -1) continue;
    supplierDayMap.get(e.supplier_id)![idx] += e.amount ?? 0;
  }

  const rows: WeeklySupplierRow[] = allSuppliers.map((s) => {
    const raw = supplierDayMap.get(s.id) ?? [0, 0, 0, 0, 0, 0, 0];
    const total = raw.reduce((sum, v) => sum + v, 0);
    return { supplier: s, days: raw.map((v) => (v === 0 ? null : v)), total };
  });

  return { rows, days };
}

// ── COA ─────────────────────────────────────────────

export async function getAllCoa(): Promise<CoaAccount[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("coa")
    .select("code,name,group_code,group_name,target_pct,sort_order,is_sensitive")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function addCoaGroup(data: {
  code: string;
  name: string;
  target_pct: number | null;
}): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("coa").select("sort_order").order("sort_order", { ascending: false }).limit(1).single();
  const nextSort = ((existing?.sort_order ?? 0) + 100);
  const { error } = await supabase.from("coa").insert({
    code: data.code,
    name: data.name,
    group_code: null,
    group_name: null,
    target_pct: data.target_pct,
    sort_order: nextSort,
    is_sensitive: false,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/owner/accounting/coa");
}

export async function addCoaAccount(data: {
  code: string;
  name: string;
  group_code: string;
  group_name: string;
}): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { data: siblings } = await supabase
    .from("coa").select("sort_order").eq("group_code", data.group_code).order("sort_order", { ascending: false }).limit(1).single();
  const nextSort = ((siblings?.sort_order ?? 0) + 1);
  const { error } = await supabase.from("coa").insert({
    code: data.code,
    name: data.name,
    group_code: data.group_code,
    group_name: data.group_name,
    target_pct: null,
    sort_order: nextSort,
    is_sensitive: false,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/owner/accounting/coa");
  revalidatePath("/owner/accounting/daily");
}

export async function updateCoaAccount(
  code: string,
  data: { name: string; target_pct: number | null }
): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("coa").update({ name: data.name, target_pct: data.target_pct }).eq("code", code);
  if (error) throw new Error(error.message);
  revalidatePath("/owner/accounting/coa");
  revalidatePath("/owner/accounting/daily");
  revalidatePath("/owner/accounting");
}

export async function reorderCoaAccount(code: string, groupCode: string, direction: "up" | "down"): Promise<{ error?: string }> {
  await requireAdmin();
  const supabase = await createClient();

  // Get all sibling accounts in this group ordered by sort_order
  const { data: siblings } = await supabase
    .from("coa").select("code,sort_order").eq("group_code", groupCode).order("sort_order");
  if (!siblings) return { error: "ไม่พบข้อมูล" };

  const idx = siblings.findIndex((s) => s.code === code);
  if (idx < 0) return { error: "ไม่พบหมวด" };
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) return {};

  // Swap sort_orders between the two items
  const current = siblings[idx];
  const swap = siblings[swapIdx];
  await supabase.from("coa").update({ sort_order: swap.sort_order }).eq("code", current.code);
  await supabase.from("coa").update({ sort_order: current.sort_order }).eq("code", swap.code);

  revalidatePath("/owner/accounting/coa");
  revalidatePath("/owner/accounting/daily");
  return {};
}

export async function deleteCoaAccount(code: string): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { count } = await supabase
    .from("expense_entries").select("id", { count: "exact", head: true }).eq("coa_code", code);
  if ((count ?? 0) > 0) throw new Error(`ไม่สามารถลบได้ มีรายการบันทึกอยู่ ${count} รายการ`);
  const { error } = await supabase.from("coa").delete().eq("code", code);
  if (error) throw new Error(error.message);
  revalidatePath("/owner/accounting/coa");
  revalidatePath("/owner/accounting/daily");
}

export async function getCoa(): Promise<CoaAccount[]> {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("coa")
    .select("code,name,group_code,group_name,target_pct,sort_order,is_sensitive")
    .order("sort_order");
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  // Hide sensitive accounts from admin (owner only)
  if (profile.role !== "owner") return rows.filter((r) => !r.is_sensitive);
  return rows;
}

// ── Expense Entries ──────────────────────────────────

export async function getEntriesByDate(date: string): Promise<ExpenseEntry[]> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("expense_entries")
    .select("id,entry_date,coa_code,amount,note,detail,bill_ref,payment_method,created_at,display_order,supplier_id,coa(name,group_name,is_sensitive),suppliers(name)")
    .eq("entry_date", date)
    .order("display_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((r) => profile.role === "owner" || !(r.coa as unknown as { is_sensitive: boolean }).is_sensitive)
    .map((r) => {
      const coa = r.coa as unknown as { name: string; group_name: string | null; is_sensitive: boolean } | null;
      const row = r as unknown as { bill_ref: string | null; display_order: number | null; supplier_id: string | null; detail: string | null; suppliers: { name: string } | null };
      return {
        id: r.id,
        entry_date: r.entry_date,
        coa_code: r.coa_code,
        coa_name: coa?.name ?? r.coa_code,
        group_name: coa?.group_name ?? null,
        amount: r.amount,
        note: r.note,
        bill_ref: row.bill_ref ?? null,
        payment_method: r.payment_method as "cash" | "transfer",
        created_at: r.created_at,
        display_order: row.display_order ?? null,
        supplier_id: row.supplier_id ?? null,
        supplier_name: row.suppliers?.name ?? null,
        detail: row.detail ?? null,
      };
    });
}

export async function getRecentEntries(yearMonth: string): Promise<ExpenseEntry[]> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("expense_entries")
    .select("id,entry_date,coa_code,amount,note,bill_ref,payment_method,created_at,display_order,coa(name,group_name,is_sensitive)")
    .gte("entry_date", `${yearMonth}-01`)
    .lte("entry_date", `${yearMonth}-31`)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((r) => profile.role === "owner" || !(r.coa as unknown as { is_sensitive: boolean }).is_sensitive)
    .map((r) => {
      const coa = r.coa as unknown as { name: string; group_name: string | null; is_sensitive: boolean } | null;
      return {
        id: r.id,
        entry_date: r.entry_date,
        coa_code: r.coa_code,
        coa_name: coa?.name ?? r.coa_code,
        group_name: coa?.group_name ?? null,
        amount: r.amount,
        note: r.note,
        bill_ref: (r as unknown as { bill_ref: string | null }).bill_ref ?? null,
        payment_method: r.payment_method as "cash" | "transfer",
        created_at: r.created_at,
        display_order: (r as unknown as { display_order: number | null }).display_order ?? null,
        supplier_id: null,
        supplier_name: null,
        detail: null,
      };
    });
}

export async function addExpenseEntry(data: {
  entry_date: string;
  coa_code: string;
  amount: number;
  note?: string;
  payment_method: "cash" | "transfer";
}): Promise<void> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  // Prevent non-owners from adding sensitive account entries
  if (profile.role !== "owner") {
    const { data: coa } = await supabase.from("coa").select("is_sensitive").eq("code", data.coa_code).single();
    if (coa?.is_sensitive) throw new Error("ไม่มีสิทธิ์บันทึกรายการนี้");
  }

  const { error } = await supabase.from("expense_entries").insert({
    entry_date: data.entry_date,
    coa_code: data.coa_code,
    amount: data.amount,
    note: data.note || null,
    payment_method: data.payment_method,
    created_by: profile.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/owner/accounting");
}

export async function updateExpenseEntry(
  id: string,
  data: {
    coa_code: string;
    amount: number;
    note: string | null;
    bill_ref: string | null;
    payment_method: "cash" | "transfer";
    supplier_id?: string | null;
    detail?: string | null;
  }
): Promise<void> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  if (profile.role !== "owner") {
    const { data: coa } = await supabase.from("coa").select("is_sensitive").eq("code", data.coa_code).single();
    if (coa?.is_sensitive) throw new Error("ไม่มีสิทธิ์แก้ไขรายการนี้");
  }

  const { error } = await supabase
    .from("expense_entries")
    .update({
      coa_code: data.coa_code,
      amount: data.amount,
      note: data.note,
      bill_ref: data.bill_ref,
      payment_method: data.payment_method,
      supplier_id: data.supplier_id ?? null,
      detail: data.detail ?? null,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/owner/accounting");
  revalidatePath("/owner/accounting/daily");
}

export async function deleteExpenseEntry(id: string): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("expense_entries").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/owner/accounting");
}

export async function getEntriesByIds(ids: string[]): Promise<ExpenseEntry[]> {
  const profile = await requireAdmin();
  if (!ids.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expense_entries")
    .select("id,entry_date,coa_code,amount,note,bill_ref,payment_method,created_at,display_order,coa(name,group_name,is_sensitive)")
    .in("id", ids)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((r) => profile.role === "owner" || !(r.coa as unknown as { is_sensitive: boolean }).is_sensitive)
    .map((r) => {
      const coa = r.coa as unknown as { name: string; group_name: string | null; is_sensitive: boolean } | null;
      return {
        id: r.id,
        entry_date: r.entry_date,
        coa_code: r.coa_code,
        coa_name: coa?.name ?? r.coa_code,
        group_name: coa?.group_name ?? null,
        amount: r.amount,
        note: r.note,
        bill_ref: (r as unknown as { bill_ref: string | null }).bill_ref ?? null,
        payment_method: r.payment_method as "cash" | "transfer",
        created_at: r.created_at,
        display_order: (r as unknown as { display_order: number | null }).display_order ?? null,
        supplier_id: null,
        supplier_name: null,
        detail: null,
      };
    });
}

export async function bulkInsertEntries(
  entries: {
    entry_date: string;
    coa_code: string;
    amount: number;
    note?: string;
    bill_ref?: string;
    payment_method: "cash" | "transfer";
    display_order?: number;
    supplier_id?: string;
    detail?: string;
  }[]
): Promise<number> {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const rows = entries.map((e) => ({
    entry_date: e.entry_date,
    coa_code: e.coa_code,
    amount: e.amount,
    note: e.note || null,
    bill_ref: e.bill_ref || null,
    payment_method: e.payment_method,
    created_by: profile.id,
    supplier_id: e.supplier_id || null,
    detail: e.detail || null,
    ...(e.display_order != null ? { display_order: e.display_order } : {}),
  }));
  const { error } = await supabase.from("expense_entries").insert(rows);
  if (error) throw new Error(error.message);
  revalidatePath("/owner/accounting");
  return rows.length;
}

export async function updateEntriesDisplayOrder(
  updates: { id: string; display_order: number }[]
): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  await Promise.all(
    updates.map(({ id, display_order }) =>
      supabase.from("expense_entries").update({ display_order }).eq("id", id)
    )
  );
}

// ── Monthly Revenue ──────────────────────────────────

export async function getMonthlyRevenue(yearMonth: string): Promise<RevenueRow[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("monthly_revenue")
    .select("revenue_type,amount")
    .eq("year_month", yearMonth);
  if (error) throw new Error(error.message);
  return (data ?? []) as RevenueRow[];
}

export async function setMonthlyRevenue(
  yearMonth: string,
  type: "food" | "drink" | "dessert" | "delivery" | "other",
  amount: number
): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("monthly_revenue")
    .upsert({ year_month: yearMonth, revenue_type: type, amount }, { onConflict: "year_month,revenue_type" });
  if (error) throw new Error(error.message);
  revalidatePath("/owner/accounting");
}

// ── Monthly Summary ──────────────────────────────────

export async function getMonthlySummary(yearMonth: string): Promise<{
  groups: MonthlySummaryGroup[];
  totalRevenue: number;
  totalExpense: number;
}> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const [entriesRes, coaRes, revenueRes] = await Promise.all([
    supabase
      .from("expense_entries")
      .select("coa_code,amount")
      .filter("entry_date", "gte", `${yearMonth}-01`)
      .filter("entry_date", "lte", `${yearMonth}-31`),
    supabase.from("coa").select("*").order("sort_order"),
    supabase.from("monthly_revenue").select("revenue_type,amount").eq("year_month", yearMonth),
  ]);

  if (entriesRes.error) throw new Error(entriesRes.error.message);
  if (coaRes.error) throw new Error(coaRes.error.message);

  const allCoa = (coaRes.data ?? []) as CoaAccount[];
  const entries = entriesRes.data ?? [];
  const revenueRows = revenueRes.data ?? [];

  const totalRevenue = revenueRows.reduce((s, r) => s + (r.amount ?? 0), 0);

  // Filter sensitive for non-owners
  const visibleCoa =
    profile.role === "owner" ? allCoa : allCoa.filter((c) => !c.is_sensitive);

  // Sum entries by coa_code
  const totals = new Map<string, number>();
  for (const e of entries) {
    // Skip sensitive entries for non-owners
    const coa = visibleCoa.find((c) => c.code === e.coa_code);
    if (!coa) continue;
    totals.set(e.coa_code, (totals.get(e.coa_code) ?? 0) + (e.amount ?? 0));
  }

  // Build groups (only rows with group_code = null and code starts with G)
  const groupHeaders = visibleCoa.filter((c) => c.group_code === null && c.code.startsWith("G"));
  const groups: MonthlySummaryGroup[] = groupHeaders.map((g) => {
    const accounts = visibleCoa
      .filter((c) => c.group_code === g.code)
      .map((c) => ({
        code: c.code,
        name: c.name,
        total: totals.get(c.code) ?? 0,
        pct_of_revenue: totalRevenue > 0 ? ((totals.get(c.code) ?? 0) / totalRevenue) * 100 : null,
      }))
      .filter((a) => a.total > 0);
    const groupTotal = accounts.reduce((s, a) => s + a.total, 0);
    return {
      group_code: g.code,
      group_name: g.name,
      target_pct: g.target_pct,
      total: groupTotal,
      pct_of_revenue: totalRevenue > 0 ? (groupTotal / totalRevenue) * 100 : null,
      accounts,
    };
  });

  const totalExpense = groups.reduce((s, g) => s + g.total, 0);
  return { groups, totalRevenue, totalExpense };
}
