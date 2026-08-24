export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireSales, isAdminOrAbove } from "@/lib/auth";
import { getCateringPipelineEvents } from "../actions";
import type { CateringEvent } from "../actions";
import { CateringSubNav } from "@/components/catering-sub-nav";
import { thDate, locationLabel, fmtBaht, STATUS_LABEL, StatusBadge } from "../shared";

// Order mirrors the pipeline's natural progression, not the DB enum's
// declaration order (which happens to match already, but this is the
// intentional source of truth for display order).
const PIPELINE_STATUSES = ["inquiry", "awaiting_deposit", "deposit_paid", "confirmed"] as const;
type PipelineStatus = (typeof PIPELINE_STATUSES)[number];
const STALE_DAYS = 14;
const UPCOMING_DAYS = 7;

function isPipelineStatus(v: string | undefined): v is PipelineStatus {
  return !!v && (PIPELINE_STATUSES as readonly string[]).includes(v);
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

/** event_date is a plain DATE string ("YYYY-MM-DD") — compare as local calendar days, not UTC instants. */
function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export default async function CateringStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ history?: string; status?: string }>;
}) {
  const profile = await requireSales();
  const sp = await searchParams;
  const includeHistory = sp.history === "1";
  const activeStatus: PipelineStatus | "all" = isPipelineStatus(sp.status) ? sp.status : "all";

  const events = await getCateringPipelineEvents(includeHistory);

  // Pulled out of "confirmed" entirely, not just cross-listed — so nothing
  // urgent is only visible by scrolling past everything else. This applies
  // regardless of which status pill is active, since urgency is orthogonal
  // to the status filter.
  const upcoming = events.filter((e) => e.status === "confirmed" && daysUntil(e.event_date) >= 0 && daysUntil(e.event_date) <= UPCOMING_DAYS);
  const upcomingIds = new Set(upcoming.map((e) => e.id));

  const pipelineEvents = events.filter((e) => isPipelineStatus(e.status) && !upcomingIds.has(e.id));
  const countByStatus = Object.fromEntries(
    PIPELINE_STATUSES.map((s) => [s, pipelineEvents.filter((e) => e.status === s).length]),
  ) as Record<PipelineStatus, number>;

  const visibleEvents = activeStatus === "all" ? pipelineEvents : pipelineEvents.filter((e) => e.status === activeStatus);

  const history = includeHistory ? events.filter((e) => e.status === "done" || e.status === "cancelled") : [];

  function tabHref(status: PipelineStatus | "all") {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (includeHistory) params.set("history", "1");
    const qs = params.toString();
    return `/owner/catering/status${qs ? `?${qs}` : ""}`;
  }

  function historyHref(next: boolean) {
    const params = new URLSearchParams();
    if (activeStatus !== "all") params.set("status", activeStatus);
    if (next) params.set("history", "1");
    const qs = params.toString();
    return `/owner/catering/status${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <CateringSubNav isAdmin={isAdminOrAbove(profile.role)} />

      <div>
        <h1 className="font-kanit text-lg font-semibold text-neutral-900">ภาพรวมสถานะการจอง</h1>
        <p className="mt-0.5 text-xs text-neutral-400">
          เฉพาะงานจัดเลี้ยง (ไม่รวมจองโต๊ะ/จองห้องธรรมดา) — ยอดใบเสนอราคาที่แสดงคือยอด ณ วันที่ออกล่าสุด
          อาจไม่ตรงกับรายการค่าใช้จ่ายปัจจุบันหากมีการแก้ไขภายหลังออกใบเสนอราคา
        </p>
      </div>

      {upcoming.length > 0 && (
        <PipelineSection title={`ใกล้ถึงวันงาน (ภายใน ${UPCOMING_DAYS} วัน)`} events={upcoming} highlight />
      )}

      {/* Pill-tab status filter */}
      <div className="flex flex-wrap gap-2">
        <PillTab href={tabHref("all")} active={activeStatus === "all"} label={`ทั้งหมด (${pipelineEvents.length})`} />
        {PIPELINE_STATUSES.map((s) => (
          <PillTab key={s} href={tabHref(s)} active={activeStatus === s} label={`${STATUS_LABEL[s]} (${countByStatus[s]})`} />
        ))}
      </div>

      <PipelineList events={visibleEvents} showStatus={activeStatus === "all"} />

      <div className="pt-1 text-xs">
        {includeHistory ? (
          <Link href={historyHref(false)} className="text-neutral-400 hover:text-neutral-700">ซ่อนประวัติ (เสร็จสิ้น/ยกเลิก)</Link>
        ) : (
          <Link href={historyHref(true)} className="text-neutral-400 hover:text-neutral-700">ดูประวัติ (เสร็จสิ้น/ยกเลิก) →</Link>
        )}
      </div>

      {includeHistory && (
        <PipelineSection title="ประวัติ (เสร็จสิ้น/ยกเลิก)" events={history} muted showStatus />
      )}
    </div>
  );
}

function PillTab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
      }`}
    >
      {label}
    </Link>
  );
}

/** Header-less variant for the pill-filtered list — the active pill already conveys the filter, so a repeated title/count here would be redundant. */
function PipelineList({ events, showStatus }: { events: CateringEvent[]; showStatus?: boolean }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      {events.length === 0 ? (
        <p className="py-3 text-center text-xs text-neutral-400">ไม่มีรายการ</p>
      ) : (
        <div className="divide-y divide-neutral-100">
          {events.map((e) => <PipelineRow key={e.id} event={e} showStatus={showStatus} />)}
        </div>
      )}
    </section>
  );
}

/** Used for "ใกล้ถึงวันงาน" and "ประวัติ" — both stay independent of the pill filter, so they keep their own title/count header. */
function PipelineSection({
  title,
  events,
  highlight,
  muted,
  showStatus,
}: {
  title: string;
  events: CateringEvent[];
  highlight?: boolean;
  muted?: boolean;
  showStatus?: boolean;
}) {
  return (
    <section
      className={`rounded-xl border p-4 ${
        highlight ? "border-amber-300 bg-amber-50/50" : muted ? "border-neutral-200 bg-neutral-50/60" : "border-neutral-200 bg-white"
      }`}
    >
      <h2 className={`mb-2 text-sm font-semibold ${highlight ? "text-amber-800" : "text-neutral-700"}`}>
        {title} <span className="font-normal text-neutral-400">({events.length})</span>
      </h2>
      {events.length === 0 ? (
        <p className="py-3 text-center text-xs text-neutral-400">ไม่มีรายการ</p>
      ) : (
        <div className="divide-y divide-neutral-100">
          {events.map((e) => <PipelineRow key={e.id} event={e} showStatus={showStatus} />)}
        </div>
      )}
    </section>
  );
}

function PipelineRow({ event: e, showStatus }: { event: CateringEvent; showStatus?: boolean }) {
  const staleDays = daysSince(e.updated_at);
  const isStale = staleDays >= STALE_DAYS;

  return (
    <Link href={`/owner/catering/${e.id}`} className="flex items-start justify-between gap-3 py-2.5 hover:bg-neutral-50">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-neutral-900">{e.customer_name ?? "ไม่ระบุลูกค้า"}</div>
        <div className="text-xs text-neutral-500">{thDate(e.event_date)} · {locationLabel(e)}</div>
        {isStale && (
          <div className="mt-0.5 text-[11px] text-amber-600">ไม่มีความเคลื่อนไหว {staleDays} วัน</div>
        )}
      </div>
      <div className="shrink-0 space-y-1 text-right text-xs text-neutral-600">
        {showStatus && <div><StatusBadge status={e.status} /></div>}
        <div>{e.quote_number ?? "ยังไม่ออกใบเสนอราคา"}</div>
        {e.quoted_total != null && <div className="tabular-nums">฿{fmtBaht(e.quoted_total)}</div>}
        {e.deposit_amount != null && (
          <div className="tabular-nums text-neutral-400">
            มัดจำ ฿{fmtBaht(e.deposit_amount)}{e.deposit_paid_at ? ` (${thDate(e.deposit_paid_at)})` : ""}
          </div>
        )}
      </div>
    </Link>
  );
}
