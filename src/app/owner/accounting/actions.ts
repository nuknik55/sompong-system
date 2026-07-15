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
  payment_method: "cash" | "transfer";
  created_at: string;
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

// ── COA ─────────────────────────────────────────────

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

export async function getRecentEntries(yearMonth: string): Promise<ExpenseEntry[]> {
  await requireAdmin();
  const supabase = await createClient();
  const profile = await requireAdmin();

  const { data, error } = await supabase
    .from("expense_entries")
    .select("id,entry_date,coa_code,amount,note,payment_method,created_at,coa(name,group_name,is_sensitive)")
    .eq("to_char(entry_date,'YYYY-MM')" as never, yearMonth)
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
        payment_method: r.payment_method as "cash" | "transfer",
        created_at: r.created_at,
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

export async function deleteExpenseEntry(id: string): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("expense_entries").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/owner/accounting");
}

export async function bulkInsertEntries(
  entries: {
    entry_date: string;
    coa_code: string;
    amount: number;
    note?: string;
    payment_method: "cash" | "transfer";
  }[]
): Promise<number> {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const rows = entries.map((e) => ({ ...e, note: e.note || null, created_by: profile.id }));
  const { error } = await supabase.from("expense_entries").insert(rows);
  if (error) throw new Error(error.message);
  revalidatePath("/owner/accounting");
  return rows.length;
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
