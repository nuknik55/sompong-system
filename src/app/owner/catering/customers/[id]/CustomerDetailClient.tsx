"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updateCateringCustomer } from "../../actions";
import type { CateringCustomer, CateringCustomerEventSummary } from "../../actions";
import { Field, thDate, locationLabel, fmtBaht, StatusBadge } from "../../shared-utils";

type CustomerFormState = {
  name: string;
  phone: string;
  line_id: string;
  company_name: string;
  address: string;
  contact_person: string;
  tax_id: string;
  note: string;
};

function formFromCustomer(c: CateringCustomer): CustomerFormState {
  return {
    name: c.name,
    phone: c.phone ?? "",
    line_id: c.line_id ?? "",
    company_name: c.company_name ?? "",
    address: c.address ?? "",
    contact_person: c.contact_person ?? "",
    tax_id: c.tax_id ?? "",
    note: c.note ?? "",
  };
}

export function CustomerDetailClient({
  customer,
  events,
}: {
  customer: CateringCustomer;
  events: CateringCustomerEventSummary[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<CustomerFormState>(() => formFromCustomer(customer));
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof CustomerFormState>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        await updateCateringCustomer(customer.id, {
          name: form.name,
          phone: form.phone || null,
          line_id: form.line_id || null,
          company_name: form.company_name || null,
          address: form.address || null,
          contact_person: form.contact_person || null,
          tax_id: form.tax_id || null,
          note: form.note || null,
        });
        setIsEditing(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  function cancelEdit() {
    setForm(formFromCustomer(customer));
    setIsEditing(false);
    setError(null);
  }

  const totalEvents = events.length;
  const totalQuoted = events.reduce((s, e) => s + (e.quoted_total ?? 0), 0);

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <Link href="/owner/catering/customers" className="text-sm text-neutral-500 hover:text-neutral-800">← กลับ</Link>
        {!isEditing && (
          <button onClick={() => setIsEditing(true)} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
            แก้ไข
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6">
          <div className="grid grid-cols-2 gap-3">
            <Field label="ชื่อ *">
              <input className="input-base" value={form.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="เบอร์โทร">
              <input className="input-base" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </Field>
            <Field label="LINE ID">
              <input className="input-base" value={form.line_id} onChange={(e) => set("line_id", e.target.value)} />
            </Field>
            <Field label="บริษัท">
              <input className="input-base" value={form.company_name} onChange={(e) => set("company_name", e.target.value)} />
            </Field>
            <Field label="เลขผู้เสียภาษี">
              <input className="input-base" value={form.tax_id} onChange={(e) => set("tax_id", e.target.value)} />
            </Field>
            <Field label="ที่อยู่" className="col-span-2">
              <input className="input-base" value={form.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
            <Field label="ผู้ติดต่อ (ถ้าต่างจากชื่อ)" className="col-span-2">
              <input className="input-base" value={form.contact_person} onChange={(e) => set("contact_person", e.target.value)} />
            </Field>
            <Field label="หมายเหตุ" className="col-span-2">
              <textarea className="input-base h-20 resize-none" value={form.note} onChange={(e) => set("note", e.target.value)} />
            </Field>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3">
            <button onClick={cancelEdit} className="rounded-lg px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100">
              ยกเลิก
            </button>
            <button
              onClick={handleSave}
              disabled={isPending || form.name.trim() === ""}
              className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {isPending ? "กำลังบันทึก…" : "บันทึก"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-6">
          <h2 className="font-kanit text-lg font-semibold text-neutral-900">{customer.name}</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-neutral-400">เบอร์โทร</p>
              <p className="text-neutral-700">{customer.phone ?? "–"}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-400">LINE ID</p>
              <p className="text-neutral-700">{customer.line_id ?? "–"}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-400">บริษัท</p>
              <p className="text-neutral-700">{customer.company_name ?? "–"}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-400">ผู้ติดต่อ</p>
              <p className="text-neutral-700">{customer.contact_person ?? "–"}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-400">เลขผู้เสียภาษี</p>
              <p className="text-neutral-700">{customer.tax_id ?? "–"}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-neutral-400">ที่อยู่</p>
              <p className="text-neutral-700">{customer.address ?? "–"}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-neutral-400">หมายเหตุ</p>
              <p className="whitespace-pre-wrap text-neutral-700">{customer.note ?? "–"}</p>
            </div>
          </div>
        </div>
      )}

      {/* Summary stats */}
      <div className="mt-5 grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs text-neutral-400">จำนวนงานทั้งหมด</p>
          <p className="text-lg font-semibold tabular-nums text-neutral-900">{totalEvents}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs text-neutral-400">ยอดใบเสนอราคารวม *</p>
          <p className="text-lg font-semibold tabular-nums text-neutral-900">฿{fmtBaht(totalQuoted)}</p>
        </div>
      </div>
      <p className="mt-1 text-xs text-neutral-400">
        * ยอดรวมจากยอด ณ วันที่ออกใบเสนอราคาล่าสุดของแต่ละงาน อาจไม่ตรงกับรายการค่าใช้จ่ายปัจจุบันหากมีการแก้ไขภายหลังออกใบเสนอราคา
      </p>

      {/* History */}
      <div className="mt-5 rounded-xl border border-neutral-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-neutral-700">ประวัติการจอง</h3>
        {events.length === 0 ? (
          <p className="py-3 text-center text-xs text-neutral-400">ยังไม่มีประวัติการจอง</p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {events.map((e) => (
              <Link key={e.id} href={`/owner/catering/${e.id}`} className="flex items-start justify-between gap-3 py-2.5 hover:bg-neutral-50">
                <div>
                  <div className="text-sm text-neutral-800">{thDate(e.event_date)} · {locationLabel(e)}</div>
                  <div className="mt-0.5"><StatusBadge status={e.status} /></div>
                </div>
                <div className="shrink-0 text-right text-xs text-neutral-600">
                  <div>{e.quote_number ?? "ยังไม่ออกใบเสนอราคา"}</div>
                  {e.quoted_total != null && <div className="tabular-nums">฿{fmtBaht(e.quoted_total)}</div>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .input-base { width: 100%; border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 10px; font-size: 0.875rem; outline: none; background: white; }
        .input-base:focus { border-color: #6b7280; box-shadow: 0 0 0 2px rgba(107,114,128,0.15); }
      `}</style>
    </>
  );
}
