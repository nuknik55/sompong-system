"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updateCateringCustomer } from "../../actions";
import type { CateringCustomerDetail, CateringCustomerEventSummary } from "../../actions";
import { Field, thDate, locationLabel, fmtBaht, BookingStatusBadge } from "../../shared-utils";
import { customerFormDirty, customerPayload, formFromCustomer, type CustomerFormState } from "../../customer-form";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { StatTile } from "@/components/ui/stat-tile";

const DISCARD_MSG = "ทิ้งการแก้ไขที่ยังไม่ได้บันทึกหรือไม่?";
const RELOAD_MSG = "ทิ้งการแก้ไขที่ยังไม่ได้บันทึก แล้วโหลดข้อมูลล่าสุดของลูกค้ารายนี้หรือไม่?";
/** A save that brought no answer at all: the connection, the server, a deploy mid-session. (A sign-in the server no longer admits may redirect instead.) */
const RESULT_LOST =
  "ไม่ได้รับคำตอบจากระบบ — ข้อมูลที่แก้ไขยังอยู่ในหน้านี้ ลองกดบันทึกอีกครั้ง (ถ้าบันทึกไปแล้ว ระบบจะแจ้งว่าถูกแก้ไขจากที่อื่น ให้กด “โหลดข้อมูลล่าสุด”)";

/**
 * One customer: the details, and the booking history. Editing is where edits
 * used to be lost (queue item 51, Nik 2026-09-22):
 *   - an edit starts from the customer as the page shows it NOW, and its save
 *     carries the updated_at it started from, so a save over someone else's
 *     is refused, with nothing written (customer-form.ts, updateCateringCustomer);
 *   - leaving with an unsaved edit asks first — in-app links, closing or
 *     reloading the tab, and ออกจากระบบ (useLeaveGuard); the browser's Back
 *     button stays uncaught, as everywhere else;
 *   - the form is locked from the click until the save has landed, so nothing
 *     typed in between is dropped.
 */
export function CustomerDetailClient({
  customer,
  events,
}: {
  customer: CateringCustomerDetail;
  events: CateringCustomerEventSummary[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // The open edit: the form, what it started from, and the customer's
  // updated_at at that moment — the token its save sends.
  const [edit, setEdit] = useState<{ form: CustomerFormState; start: CustomerFormState; token: string } | null>(null);
  const [error, setError] = useState<{ text: string; conflict: boolean } | null>(null);
  const dirty = edit !== null && customerFormDirty(edit.form, edit.start);
  useLeaveGuard(dirty);

  function set<K extends keyof CustomerFormState>(k: K, v: string) {
    setEdit((e) => (e ? { ...e, form: { ...e.form, [k]: v } } : e));
  }

  /** From the customer as the page shows it now, never as it showed it when the page opened. */
  function startEdit() {
    const start = formFromCustomer(customer);
    setEdit({ form: start, start, token: customer.updated_at });
    setError(null);
  }

  function cancelEdit() {
    if (dirty && window.confirm(DISCARD_MSG) === false) return;
    setEdit(null);
    setError(null);
  }

  function handleSave() {
    if (!edit) return;
    const sending = edit;
    setError(null);
    // The refresh after a save runs inside this transition, so the form stays
    // locked, and แก้ไข disabled, until the saved customer is on the page.
    startTransition(async () => {
      const res = await updateCateringCustomer(customer.id, customerPayload(sending.form), sending.token).catch(() => null);
      if (!res) { setError({ text: RESULT_LOST, conflict: false }); return; }
      if (!res.ok) { setError({ text: res.error, conflict: res.conflict === true }); return; }
      setEdit(null);
      router.refresh();
    });
  }

  /** After a refusal: drop the draft (asking first) and fetch the latest; the next edit starts from it. */
  function reloadLatest() {
    if (dirty && window.confirm(RELOAD_MSG) === false) return;
    setEdit(null);
    setError(null);
    startTransition(() => { router.refresh(); });
  }

  const totalEvents = events.length;
  const totalQuoted = events.reduce((s, e) => s + (e.quoted_total ?? 0), 0);
  const form = edit?.form;

  return (
    <>
      {/* The shared page header. The back link is a plain <a>, which the
          leave guard above catches like every other link on the page. */}
      <PageHeader
        back={{ href: "/owner/catering/customers", label: "กลับ" }}
        title={customer.name}
        actions={!edit ? (
          <Button kind="secondary" onClick={startEdit} disabled={isPending}>
            {isPending ? "กำลังโหลด…" : "แก้ไข"}
          </Button>
        ) : undefined}
      />

      <div className="space-y-5">
      {edit && form ? (
        <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6">
          {/* ONE lock for the whole form while a save is in flight. */}
          <fieldset disabled={isPending} className="m-0 min-w-0 border-0 p-0">
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
          </fieldset>
          {error && (
            <p className="text-sm text-danger">
              {error.text}
              {error.conflict && (
                <button type="button" onClick={reloadLatest} disabled={isPending} className="ml-2 font-medium underline hover:text-danger-hover disabled:opacity-50">
                  โหลดข้อมูลล่าสุด
                </button>
              )}
            </p>
          )}
          {dirty && <p className="text-right text-xs text-amber-800">มีการแก้ไขที่ยังไม่ได้บันทึก</p>}
          <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3">
            <Button kind="secondary" onClick={cancelEdit} disabled={isPending}>
              ยกเลิก
            </Button>
            <Button kind="primary" onClick={handleSave} disabled={isPending || form.name.trim() === ""}>
              {isPending ? "กำลังบันทึก…" : "บันทึก"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-white p-6">
          {/* The name is the page's title now (PageHeader above). */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-neutral-500">เบอร์โทร</p>
              <p className="text-neutral-700">{customer.phone ?? "–"}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-500">LINE ID</p>
              <p className="text-neutral-700">{customer.line_id ?? "–"}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-500">บริษัท</p>
              <p className="text-neutral-700">{customer.company_name ?? "–"}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-500">ผู้ติดต่อ</p>
              <p className="text-neutral-700">{customer.contact_person ?? "–"}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-500">เลขผู้เสียภาษี</p>
              <p className="text-neutral-700">{customer.tax_id ?? "–"}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-neutral-500">ที่อยู่</p>
              <p className="text-neutral-700">{customer.address ?? "–"}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-neutral-500">หมายเหตุ</p>
              <p className="whitespace-pre-wrap text-neutral-700">{customer.note ?? "–"}</p>
            </div>
          </div>
        </div>
      )}

      {/* Summary: coloured tiles (components/ui/stat-tile.tsx). */}
      <div className="space-y-1.5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatTile accent="navy" label="จำนวนงานทั้งหมด" value={totalEvents} />
          <StatTile accent="green" label="ยอดใบเสนอราคารวม *" value={`฿${fmtBaht(totalQuoted)}`} />
        </div>
        <p className="text-xs text-neutral-500">
          * ยอดรวมจากยอด ณ วันที่ออกใบเสนอราคาล่าสุดของแต่ละงาน อาจไม่ตรงกับรายการค่าใช้จ่ายปัจจุบันหากมีการแก้ไขภายหลังออกใบเสนอราคา
        </p>
      </div>

      {/* History */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 font-heading text-sm font-semibold text-neutral-800">ประวัติการจอง</h2>
        {events.length === 0 ? (
          <p className="py-3 text-center text-xs text-neutral-500">ยังไม่มีประวัติการจอง</p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {events.map((e) => (
              <Link key={e.id} href={`/owner/catering/${e.id}`} className="flex items-start justify-between gap-3 py-2.5 hover:bg-neutral-50">
                <div>
                  <div className="text-sm text-neutral-800">{thDate(e.event_date)} · {locationLabel(e)}</div>
                  <div className="mt-0.5"><BookingStatusBadge status={e.status} /></div>
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
      </div>
    </>
  );
}
