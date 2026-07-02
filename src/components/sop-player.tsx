"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Video, X, Printer } from "lucide-react";
import type { SopFullData } from "@/lib/sop-data";

// ── Video helpers ────────────────────────────────────────────────

function getYouTubeEmbedUrl(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}?autoplay=0` : null;
}

function isGoogleDrive(url: string): boolean {
  return url.includes("drive.google.com");
}

// ── Step types ───────────────────────────────────────────────────

type CardType =
  | { kind: "ingredients" }
  | { kind: "step"; section: "prep" | "cook" | "plating"; stepIndex: number; totalInSection: number; text: string; photoUrl: string | null }
  | { kind: "checklist" };

const SECTION_LABEL: Record<"prep" | "cook" | "plating", string> = {
  prep: "เตรียมวัตถุดิบ",
  cook: "ปรุง",
  plating: "จัดจาน",
};

const SECTION_COLOR: Record<"prep" | "cook" | "plating", string> = {
  prep: "bg-sky-100 text-sky-700",
  cook: "bg-amber-100 text-amber-700",
  plating: "bg-green-100 text-green-700",
};

// ── Print layout (hidden during normal view, shown when printing) ─

function PrintLayout({ sop }: { sop: SopFullData }) {
  return (
    <div className="hidden print:block font-sans text-black">
      {/* Header */}
      <div className="mb-4 border-b-2 border-brand-green pb-3">
        <h1 className="font-kanit text-2xl font-bold text-brand-green">{sop.menuName}</h1>
        {sop.menuCategory && (
          <span className="text-sm text-neutral-500">{sop.menuCategory}</span>
        )}
      </div>

      {/* Ingredients table */}
      <h2 className="font-kanit mb-2 text-lg font-semibold text-brand-green">วัตถุดิบ</h2>
      <table className="mb-6 w-full border-collapse text-sm">
        <thead>
          <tr className="bg-neutral-100">
            <th className="border border-neutral-300 px-2 py-1 text-left">วัตถุดิบ</th>
            <th className="border border-neutral-300 px-2 py-1 text-right">ปริมาณ</th>
            <th className="border border-neutral-300 px-2 py-1 text-left">หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>
          {sop.ingredients.map((ing) => (
            <tr key={ing.ingredientId}>
              <td className="border border-neutral-300 px-2 py-1">{ing.name}</td>
              <td className="border border-neutral-300 px-2 py-1 text-right tabular-nums">
                {ing.quantity} {ing.unit ?? ""}
              </td>
              <td className="border border-neutral-300 px-2 py-1 text-neutral-500">{ing.note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Steps sections */}
      {(["prep", "cook", "plating"] as const).map((section) => {
        const steps = sop[`${section}Steps`];
        if (steps.length === 0) return null;
        return (
          <div key={section} className="mb-6 break-inside-avoid">
            <h2 className="font-kanit mb-2 text-lg font-semibold text-brand-green">
              {section === "prep" ? "ขั้นตอนการเตรียมวัตถุดิบ" : section === "cook" ? "ขั้นตอนการปรุง" : "การจัดจาน"}
            </h2>
            <ol className="space-y-3">
              {steps.map((s, i) => (
                <li key={s.id} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-green text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm">{s.text}</p>
                    {s.photoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.photoUrl}
                        alt={`step ${i + 1}`}
                        className="mt-1 h-24 w-32 rounded object-cover"
                      />
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        );
      })}

      {/* Checklist */}
      {sop.checklist.length > 0 && (
        <div className="mb-6 break-inside-avoid">
          <h2 className="font-kanit mb-2 text-lg font-semibold text-brand-green">
            จุดตรวจสอบมาตรฐาน
          </h2>
          <ul className="space-y-1">
            {sop.checklist.map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 block h-4 w-4 shrink-0 rounded border border-neutral-400" />
                {item.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer */}
      <div className="mt-8 border-t border-neutral-300 pt-3 text-xs text-neutral-500">
        {sop.authorName && <span>ผู้จัดทำ: {sop.authorName} &nbsp;|&nbsp; </span>}
        <span>วันที่ปรับปรุง: {sop.updatedAt}</span>
      </div>
    </div>
  );
}

// ── Player ───────────────────────────────────────────────────────

export function SopPlayer({ sop }: { sop: SopFullData }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showVideo, setShowVideo] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  // Build the ordered step sequence
  const cards: CardType[] = [
    { kind: "ingredients" },
    ...sop.prepSteps.map((s, i) => ({
      kind: "step" as const,
      section: "prep" as const,
      stepIndex: i,
      totalInSection: sop.prepSteps.length,
      text: s.text,
      photoUrl: s.photoUrl,
    })),
    ...sop.cookSteps.map((s, i) => ({
      kind: "step" as const,
      section: "cook" as const,
      stepIndex: i,
      totalInSection: sop.cookSteps.length,
      text: s.text,
      photoUrl: s.photoUrl,
    })),
    ...sop.platingSteps.map((s, i) => ({
      kind: "step" as const,
      section: "plating" as const,
      stepIndex: i,
      totalInSection: sop.platingSteps.length,
      text: s.text,
      photoUrl: s.photoUrl,
    })),
    ...(sop.checklist.length > 0 ? [{ kind: "checklist" as const }] : []),
  ];

  const total = cards.length;
  const card = cards[currentIndex];
  const ytEmbedUrl = sop.demoVideoUrl ? getYouTubeEmbedUrl(sop.demoVideoUrl) : null;
  const isDrive = sop.demoVideoUrl ? isGoogleDrive(sop.demoVideoUrl) : false;
  const hasVideo = Boolean(sop.demoVideoUrl);

  function toggleChecked(id: string) {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <>
      {/* Print layout (hidden on screen) */}
      <PrintLayout sop={sop} />

      {/* Player (hidden when printing) */}
      <div className="print:hidden flex flex-col" style={{ minHeight: "calc(100vh - 72px)" }}>
        {/* ── Top bar ── */}
        <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2 no-print">
          <div className="min-w-0 flex-1">
            <p className="truncate font-kanit font-semibold text-neutral-800">{sop.menuName}</p>
            {sop.menuCategory && (
              <p className="text-xs text-neutral-400">{sop.menuCategory}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Progress text */}
            <span className="text-xs text-neutral-400">
              {currentIndex + 1} / {total}
            </span>
            {/* Video toggle */}
            {hasVideo && (
              <button
                type="button"
                onClick={() => setShowVideo((v) => !v)}
                className={`rounded-full p-1.5 ${
                  showVideo ? "bg-brand-gold/20 text-amber-700" : "text-neutral-500 hover:bg-neutral-100"
                }`}
                title="วิดีโอสาธิต"
              >
                <Video className="h-5 w-5" />
              </button>
            )}
            {/* Print */}
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-full p-1.5 text-neutral-500 hover:bg-neutral-100"
              title="พิมพ์"
            >
              <Printer className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* ── Progress bar ── */}
        <div className="h-1 bg-neutral-100 no-print">
          <div
            className="h-full bg-brand-green transition-all duration-300"
            style={{ width: `${((currentIndex + 1) / total) * 100}%` }}
          />
        </div>

        {/* ── Video panel ── */}
        {showVideo && sop.demoVideoUrl && (
          <div className="border-b border-neutral-200 bg-black p-2 no-print">
            {ytEmbedUrl ? (
              <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
                <iframe
                  src={ytEmbedUrl}
                  className="absolute inset-0 h-full w-full rounded"
                  allowFullScreen
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  title="demo video"
                />
              </div>
            ) : isDrive ? (
              <div className="flex items-center justify-between gap-3 rounded bg-neutral-800 px-3 py-3">
                <p className="text-sm text-white">วิดีโอ Google Drive</p>
                <a
                  href={sop.demoVideoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded bg-white px-3 py-1 text-sm font-medium text-neutral-900 hover:bg-neutral-100"
                >
                  เปิดวิดีโอ ↗
                </a>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setShowVideo(false)}
              className="mt-1 flex items-center gap-1 text-xs text-neutral-400 hover:text-white"
            >
              <X className="h-3 w-3" /> ปิดวิดีโอ
            </button>
          </div>
        )}

        {/* ── Card ── */}
        <div className="flex flex-1 flex-col items-center px-4 py-4">
          <div className="flex w-full max-w-2xl flex-1 flex-col">
          {card.kind === "ingredients" && (
            <div className="flex flex-1 flex-col">
              <div className="mb-3 inline-flex items-center gap-1.5">
                <span className="rounded bg-sky-100 px-2.5 py-0.5 text-sm font-medium text-sky-700">
                  เตรียมวัตถุดิบให้ครบก่อนเริ่ม
                </span>
              </div>
              <div className="flex-1 space-y-2 overflow-auto">
                {sop.ingredients.length === 0 ? (
                  <p className="text-neutral-400">ไม่มีข้อมูลวัตถุดิบในระบบ</p>
                ) : (
                  sop.ingredients.map((ing) => (
                    <div
                      key={ing.ingredientId}
                      className="flex items-start justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2"
                    >
                      <span className="font-medium text-neutral-800">{ing.name}</span>
                      <div className="text-right">
                        <p className="tabular-nums text-neutral-600">
                          {ing.quantity} {ing.unit ?? ""}
                        </p>
                        {ing.note && (
                          <p className="text-xs text-neutral-400">{ing.note}</p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {card.kind === "step" && (
            <div className="flex flex-1 flex-col">
              <div className="mb-3 flex items-center justify-between">
                <span className={`rounded px-2.5 py-0.5 text-sm font-medium ${SECTION_COLOR[card.section]}`}>
                  {SECTION_LABEL[card.section]}
                </span>
                <span className="text-xs text-neutral-400">
                  {card.stepIndex + 1} / {card.totalInSection}
                </span>
              </div>

              {card.photoUrl && (
                <div className="relative mb-4 w-full h-[45vh] md:h-[55vh] overflow-hidden rounded-xl bg-neutral-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={card.photoUrl}
                    alt="step photo"
                    className="absolute inset-0 h-full w-full object-contain object-center"
                  />
                </div>
              )}

              <p className="flex-1 text-xl leading-relaxed text-neutral-800">{card.text}</p>
            </div>
          )}

          {card.kind === "checklist" && (
            <div className="flex flex-1 flex-col">
              <div className="mb-3">
                <span className="rounded bg-purple-100 px-2.5 py-0.5 text-sm font-medium text-purple-700">
                  ตรวจสอบมาตรฐาน
                </span>
              </div>
              <div className="flex-1 space-y-3 overflow-auto">
                {sop.checklist.map((item) => {
                  const checked = checkedItems.has(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleChecked(item.id)}
                      className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-base transition-colors ${
                        checked
                          ? "border-green-200 bg-green-50 text-green-800"
                          : "border-neutral-200 bg-white text-neutral-800"
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-xs font-bold ${
                          checked ? "border-green-500 bg-green-500 text-white" : "border-neutral-300"
                        }`}
                      >
                        {checked ? "✓" : ""}
                      </span>
                      <span className={checked ? "line-through" : ""}>{item.text}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          </div>
        </div>

        {/* ── Nav buttons ── */}
        <div className="border-t border-neutral-200 bg-white px-4 py-3 no-print">
          <div className="mx-auto flex max-w-2xl items-center justify-between">
          <button
            type="button"
            disabled={currentIndex === 0}
            onClick={() => setCurrentIndex((i) => i - 1)}
            className="inline-flex items-center gap-2 rounded-xl border border-neutral-300 px-5 py-2.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-40"
          >
            <ChevronLeft className="h-5 w-5" />
            ก่อนหน้า
          </button>

          {/* Dot indicators (up to 12; collapse to bar for more) */}
          {total <= 12 ? (
            <div className="flex gap-1.5">
              {cards.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setCurrentIndex(i)}
                  className={`h-2 rounded-full transition-all ${
                    i === currentIndex
                      ? "w-6 bg-brand-green"
                      : i < currentIndex
                      ? "w-2 bg-brand-green/40"
                      : "w-2 bg-neutral-300"
                  }`}
                />
              ))}
            </div>
          ) : (
            <span className="text-xs text-neutral-500">
              {currentIndex + 1} / {total}
            </span>
          )}

          <button
            type="button"
            disabled={currentIndex === total - 1}
            onClick={() => setCurrentIndex((i) => i + 1)}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-green px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-40"
          >
            ถัดไป
            <ChevronRight className="h-5 w-5" />
          </button>
          </div>
        </div>
      </div>
    </>
  );
}
