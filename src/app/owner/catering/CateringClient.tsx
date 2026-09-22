"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { deleteCateringEvent } from "./actions";
import type { CateringEvent, StaffOption } from "./actions";
import {
  MONTHS_TH, BOOKING_TYPE_LABEL, FOOD_FORMAT_LABEL,
  thDate, timeRange, staffLabel, locationLabel,
  BookingStatusBadge,
} from "./shared-utils";
import { Button, buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { AccentTag } from "@/components/ui/badge";

export function CateringClient({
  initialEvents,
  staffOptions,
  year,
  month,
  view,
}: {
  initialEvents: CateringEvent[];
  staffOptions: StaffOption[];
  year: number;
  month: number;
  view: "month" | "year";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState<CateringEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const staffById = new Map(staffOptions.map((s) => [s.id, s]));

  function goMonth(delta: number) {
    let y = year, m = month + delta;
    if (m > 12) { y++; m = 1; }
    if (m < 1)  { y--; m = 12; }
    router.push(`/owner/catering?year=${y}&month=${m}`);
  }

  function goYear(delta: number) {
    router.push(`/owner/catering?year=${year + delta}&view=year`);
  }

  function switchView(next: "month" | "year") {
    if (next === view) return;
    router.push(next === "year" ? `/owner/catering?year=${year}&view=year` : `/owner/catering?year=${year}&month=${month}`);
  }

  // Reused verbatim so both view modes render identical row markup — only
  // the grouping/nav around this loop differs (see the table body below).
  type RowItem =
    | { kind: "header"; label: string; count: number }
    | { kind: "event"; event: CateringEvent; zebra: number };

  const rows: RowItem[] = (() => {
    if (view !== "year") return initialEvents.map((e, i) => ({ kind: "event" as const, event: e, zebra: i }));
    const byMonth = new Map<number, CateringEvent[]>();
    for (const e of initialEvents) {
      const m = parseInt(e.event_date.slice(5, 7), 10);
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m)!.push(e);
    }
    const out: RowItem[] = [];
    for (const [m, evs] of [...byMonth.entries()].sort(([a], [b]) => a - b)) {
      out.push({ kind: "header", label: `${MONTHS_TH[m - 1]} ${year + 543}`, count: evs.length });
      evs.forEach((e, i) => out.push({ kind: "event", event: e, zebra: i }));
    }
    return out;
  })();

  function handleDelete() {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    startTransition(async () => {
      try {
        const result = await deleteCateringEvent(id);
        setConfirmDelete(null);
        if (result.error) { setError(result.error); return; }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
      }
    });
  }

  return (
    <>
      {/* The shared page header (components/ui/page.tsx): the title LEFT,
          the page's one main action RIGHT. The one screen, not a modal:
          /owner/catering/new (BookingScreen.tsx). */}
      <PageHeader
        title="จองงานจัดเลี้ยง"
        actions={
          <Link href="/owner/catering/new" className={buttonClass("primary")}>
            + บันทึกการจอง
          </Link>
        }
      />

      {/* The period: เดือน / ปี, then back and forward through it; kept with
          the table it drives. */}
      <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="ช่วงเวลา"
          value={view}
          options={[{ value: "month", label: "เดือน" }, { value: "year", label: "ปี" }]}
          onChange={switchView}
        />
        <div className="flex items-center gap-2">
          <Button kind="secondary" size="sm" aria-label={view === "year" ? "ปีก่อนหน้า" : "เดือนก่อนหน้า"} onClick={() => (view === "year" ? goYear(-1) : goMonth(-1))}>←</Button>
          <span className="min-w-[150px] text-center font-heading text-sm font-medium text-neutral-900">
            {view === "year" ? year + 543 : `${MONTHS_TH[month - 1]} ${year + 543}`}
          </span>
          <Button kind="secondary" size="sm" aria-label={view === "year" ? "ปีถัดไป" : "เดือนถัดไป"} onClick={() => (view === "year" ? goYear(1) : goMonth(1))}>→</Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-300 bg-neutral-100 text-left text-xs font-semibold text-neutral-700">
              <th className="px-3 py-2 whitespace-nowrap">วันที่</th>
              <th className="px-3 py-2 whitespace-nowrap">เวลา</th>
              <th className="px-3 py-2">ลูกค้า</th>
              <th className="px-3 py-2">สถานที่</th>
              <th className="px-3 py-2">ประเภท</th>
              <th className="px-3 py-2">อาหาร</th>
              <th className="px-3 py-2 text-center">โต๊ะ</th>
              <th className="px-3 py-2 text-center">แขก</th>
              <th className="px-3 py-2">สถานะ</th>
              <th className="px-3 py-2">ผู้รับผิดชอบงาน</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {initialEvents.length === 0 && (
              <tr>
                <td colSpan={11} className="py-10 text-center text-neutral-500">
                  {view === "year" ? "ไม่มีการจองในปีนี้" : "ไม่มีการจองในเดือนนี้"}
                </td>
              </tr>
            )}
            {rows.map((r, i) =>
              r.kind === "header" ? (
                // Month-group separator in ปี view — same bg/text treatment
                // as the table's own <thead>, so it reads as a real section
                // break while scrolling, not just a thin divider line.
                <tr key={`h-${i}`}>
                  <td colSpan={11} className="border-b border-neutral-700 bg-neutral-800 px-3 py-2 text-sm font-semibold text-neutral-100">
                    {r.label} <span className="font-normal text-neutral-300">({r.count})</span>
                  </td>
                </tr>
              ) : (
                <tr key={r.event.id} className={`border-b border-neutral-100 last:border-0 ${r.zebra % 2 === 0 ? "bg-white" : "bg-neutral-50"}`}>
                  <td className="px-3 py-2 whitespace-nowrap text-neutral-700">{thDate(r.event.event_date)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-neutral-600 tabular-nums">{timeRange(r.event.start_time, r.event.end_time)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-neutral-900">{r.event.customer_name ?? "–"}</div>
                    {r.event.customer_phone && <div className="text-xs text-neutral-500 tabular-nums">{r.event.customer_phone}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {/* An accent, not a role: off-site is told apart, not judged
                        (gold is the waiting role now, so it cannot be this). */}
                    {r.event.location_type === "offsite" ? (
                      <AccentTag accent="teal">{locationLabel(r.event)}</AccentTag>
                    ) : (
                      <span className="text-neutral-600">{locationLabel(r.event)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-600">{BOOKING_TYPE_LABEL[r.event.booking_type] ?? r.event.booking_type}</td>
                  <td className="px-3 py-2 text-xs text-neutral-600">{r.event.food_format ? FOOD_FORMAT_LABEL[r.event.food_format] ?? r.event.food_format : "–"}</td>
                  <td className="px-3 py-2 text-center text-xs tabular-nums text-neutral-600">
                    {r.event.table_count ?? (r.event.table_label ? "" : "–")}
                    {r.event.reserve_tables ? <span className="text-neutral-500"> +{r.event.reserve_tables}</span> : null}
                    {r.event.table_label && <div className="text-[10px] text-neutral-500">{r.event.table_label}</div>}
                  </td>
                  <td className="px-3 py-2 text-center text-xs tabular-nums text-neutral-600">{r.event.guest_count ?? "–"}</td>
                  <td className="px-3 py-2"><BookingStatusBadge status={r.event.status} /></td>
                  <td className="px-3 py-2 text-xs text-neutral-600">
                    {r.event.staff_ids.length === 0
                      ? "–"
                      : r.event.staff_ids.map((id) => {
                          const s = staffById.get(id);
                          return s ? staffLabel(s) : "?";
                        }).join(", ")}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-4">
                      <Link href={`/owner/catering/${r.event.id}`} className={buttonClass("link", { size: "sm" })}>ดู</Link>
                      <Button kind="link" size="sm" danger onClick={() => setConfirmDelete(r.event)}>ลบ</Button>
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-2 font-heading text-base font-semibold text-neutral-900">ลบการจอง?</h3>
            <p className="mb-4 text-sm text-neutral-600">
              {confirmDelete.customer_name ?? "ไม่ระบุลูกค้า"} · {thDate(confirmDelete.event_date)}
              <br />
              ข้อมูลจะถูกลบถาวร ไม่สามารถกู้คืนได้
            </p>
            <div className="flex justify-end gap-2">
              <Button kind="secondary" onClick={() => setConfirmDelete(null)}>
                ยกเลิก
              </Button>
              <Button kind="primary" danger onClick={handleDelete} disabled={isPending}>
                {isPending ? "กำลังลบ…" : "ลบถาวร"}
              </Button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
