"use client";

import { useLayoutEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  FIT_STEPS,
  MAX_COPIES,
  MAX_MANUAL_LINES,
  MAX_MANUAL_LINE_CHARS,
  manualLinesProblem,
  parseCopies,
  parseManualLines,
  type MenuCard,
} from "@/lib/menu-card";
import { saveMenuCardLines } from "./actions";

// The card's own look (Nik's CI, AGENTS.md): a dark green band with a gold
// rule under it, room for the logo that comes later, headings in Kanit, the
// text in Noto Sans Thai. Both faces are the app's own, loaded by next/font on
// every page (layout.tsx), so the card cannot fall back to whatever the
// printing machine has. Colours print exactly (print-color-adjust).
const CSS = `
.mc-root { --mc-scale: 1; --mc-green: var(--color-brand-green, #2F5A16); --mc-gold: var(--color-brand-gold, #DFAF19); }
.mc-cards { display: flex; flex-direction: column; align-items: safe center; gap: 24px; padding: 8px 0 24px; overflow-x: auto; }
.mc-sheet {
  width: 210mm; height: 297mm; flex: none; background: #fff; color: #262626;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.08);
  font-family: var(--font-body), "Noto Sans Thai", sans-serif;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.mc-band { flex: none; background: var(--mc-green); color: #fff; padding: 9mm 16mm 7mm; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 2mm; }
.mc-logo { width: 64mm; height: 24mm; display: flex; align-items: center; justify-content: center; }
.mc-title { font-family: var(--font-kanit), sans-serif; font-weight: 600; font-size: 27pt; line-height: 1.15; margin: 0; text-wrap: balance; }
.mc-host { font-family: var(--font-kanit), sans-serif; font-weight: 400; font-size: 15pt; line-height: 1.3; margin: 0; }
.mc-rule { flex: none; height: 2.5mm; background: var(--mc-gold); }
.mc-meta { flex: none; text-align: center; padding: 6mm 16mm 1mm; font-size: 12.5pt; line-height: 1.5; color: #333; }
.mc-meta p { margin: 0; }
.mc-body { flex: 1 1 auto; min-height: 0; overflow: hidden; padding: 5mm 16mm 2mm; }
.mc-content { font-size: calc(14pt * var(--mc-scale)); line-height: 1.55; text-align: center; }
.mc-root[data-cols="2"] .mc-content { column-count: 2; column-gap: 10mm; }
/* In two columns a long section continues in the next column; a heading never
   ends a column, and a dish never splits. */
.mc-block + .mc-block { margin-top: .6em; }
.mc-set { font-family: var(--font-kanit), sans-serif; font-weight: 600; color: var(--mc-green); font-size: 1.2em; margin: 0 0 .3em; break-after: avoid; }
.mc-section { margin: 0 0 .85em; }
.mc-label { font-family: var(--font-kanit), sans-serif; font-weight: 500; color: var(--mc-green); font-size: .9em; letter-spacing: .04em;
  margin: 0 0 .2em; display: flex; align-items: center; justify-content: center; gap: .6em; break-after: avoid; }
.mc-label::before, .mc-label::after { content: ""; width: 2.4em; height: 1px; background: var(--mc-gold); }
.mc-section ul { list-style: none; margin: 0; padding: 0; }
.mc-section li { margin: .08em 0; overflow-wrap: anywhere; break-inside: avoid; }
.mc-manual { border-top: 1px solid var(--mc-gold); padding-top: .55em; margin-left: auto; margin-right: auto; max-width: 70%; }
.mc-empty { color: #737373; margin: 2em 0; }
.mc-foot { flex: none; text-align: center; padding: 2mm 0 7mm; color: var(--mc-green);
  font-family: var(--font-montserrat), var(--font-kanit), sans-serif; font-style: italic; font-size: 10.5pt; letter-spacing: .08em; }
.mc-overflow { display: none; }
.mc-root[data-overflow="true"] .mc-overflow { display: block; }
@media screen {
  .mc-logo { border: 1px dashed rgba(255,255,255,.5); border-radius: 4px; }
  .mc-logo-hint { font-size: 11px; color: rgba(255,255,255,.75); }
}
@media print {
  @page { size: A4 portrait; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  main { padding: 0 !important; }
  .mc-logo-hint { display: none; }
  .mc-cards { display: block; padding: 0; overflow: visible; }
  /* A hair under 297mm: a sheet of exactly the page height can push a blank page after it. */
  .mc-sheet { box-shadow: none; height: 296.5mm; break-after: page; }
  .mc-sheet:last-child { break-after: auto; }
}
`;

type Props = {
  eventId: string;
  card: MenuCard;
  initialCopies: number;
  tableCount: number | null;
  savedLines: string;
  locked: boolean;
};

export function MenuCardClient({ eventId, card, initialCopies, tableCount, savedLines, locked }: Props) {
  const [copiesText, setCopiesText] = useState(String(initialCopies));
  const [text, setText] = useState(savedLines);
  const [saved, setSaved] = useState(savedLines);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  const copies = parseCopies(copiesText);
  const manual = parseManualLines(text);
  const problem = manualLinesProblem(text);
  const dirty = manual.join("\n") !== parseManualLines(saved).join("\n");
  const manualKey = manual.join("\n");

  // Fit the menu to ONE page (FIT_STEPS): measure the first card and set the
  // type scale and the column count on the root, which every copy reads.
  // DOM attributes, not React state: they follow from the layout, and a
  // re-render must not reset them. Runs again once the fonts have loaded.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let live = true;
    const fit = () => {
      if (!live) return;
      const body = root.querySelector<HTMLElement>(".mc-body");
      const content = root.querySelector<HTMLElement>(".mc-content");
      if (!body || !content) return;
      for (const step of FIT_STEPS) {
        root.style.setProperty("--mc-scale", String(step.scale));
        root.dataset.cols = String(step.cols);
        if (content.offsetHeight <= body.clientHeight) {
          root.dataset.overflow = "false";
          return;
        }
      }
      root.dataset.overflow = "true";
    };
    fit();
    void document.fonts?.ready.then(fit);
    return () => { live = false; };
  }, [manualKey, card]);

  function save(after?: () => void) {
    if (problem) { setMessage({ error: true, text: problem }); return; }
    startTransition(async () => {
      try {
        const result = await saveMenuCardLines(eventId, text);
        if (result.error) { setMessage({ error: true, text: result.error }); return; }
        const stored = result.saved ?? "";
        setSaved(stored);
        setText(stored);
        setMessage({ error: false, text: "บันทึกรายการแล้ว" });
        after?.();
      } catch {
        setMessage({ error: true, text: "บันทึกไม่สำเร็จ กรุณาลองใหม่" });
      }
    });
  }

  function print() {
    if (copies == null) { setMessage({ error: true, text: `จำนวนที่พิมพ์ต้องเป็นเลข 1–${MAX_COPIES}` }); return; }
    if (rootRef.current?.dataset.overflow === "true") {
      setMessage({ error: true, text: "เมนูยาวเกินหนึ่งหน้า A4 แม้ย่อตัวอักษรและแบ่งสองคอลัมน์แล้ว — ลดรายการที่พิมพ์เพิ่มก่อนพิมพ์" });
      return;
    }
    // Unsaved lines are saved first, so a reprint prints the same card.
    if (dirty && !locked) { save(() => window.setTimeout(() => window.print(), 50)); return; }
    window.print();
  }

  const sheets = copies ?? 1;
  return (
    <div ref={rootRef} className="mc-root">
      <style>{CSS}</style>

      <div className="no-print mx-auto mb-2 max-w-3xl space-y-3">
        <Link href={`/owner/catering/${eventId}`} className="text-sm text-neutral-500 hover:text-neutral-800">← กลับไปหน้างาน</Link>
        <h1 className="font-heading text-xl font-semibold text-neutral-900">การ์ดเมนูบนโต๊ะ</h1>
        <p className="text-sm text-neutral-600">พิมพ์หนึ่งใบต่อโต๊ะ ทุกใบเหมือนกัน กระดาษ A4 แนวตั้ง พิมพ์สี</p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-neutral-700">
            จำนวนที่พิมพ์ (ใบ)
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_COPIES}
              value={copiesText}
              onChange={(e) => setCopiesText(e.target.value)}
              className="input-base ml-2 w-24"
            />
          </label>
          <span className="pb-2 text-xs text-neutral-500">
            {tableCount != null && tableCount > 0 ? `ตั้งต้นตามจำนวนโต๊ะของงาน (${tableCount} โต๊ะ) เพิ่มใบสำรองได้` : "งานนี้ไม่ได้ระบุจำนวนโต๊ะ"}
          </span>
        </div>

        <label className="block text-sm text-neutral-700">
          รายการที่พิมพ์เพิ่ม (บรรทัดละรายการ ไม่เกิน {MAX_MANUAL_LINES} บรรทัด บรรทัดละไม่เกิน {MAX_MANUAL_LINE_CHARS} ตัวอักษร)
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            readOnly={locked}
            rows={4}
            placeholder="เช่น เค้กวันเกิด (ลูกค้านำมาเอง)"
            className="input-base mt-1 block w-full"
          />
        </label>
        {locked && (
          <p className="text-xs text-neutral-600">ต้นทุนของงานนี้ถูกล็อกแล้ว จึงแก้รายการที่พิมพ์เพิ่มไม่ได้ (ปลดล็อกที่หน้าต้นทุนก่อน) — ยังพิมพ์การ์ดได้ตามปกติ</p>
        )}
        {problem && <p className="text-sm text-danger">{problem}</p>}

        <div className="flex flex-wrap items-center gap-2">
          {!locked && (
            <Button kind="secondary" onClick={() => save()} disabled={!dirty || pending || problem != null}>
              {pending ? "กำลังบันทึก…" : "บันทึกรายการ"}
            </Button>
          )}
          <Button kind="primary" onClick={print} disabled={pending || copies == null || problem != null}>
            {copies == null ? "พิมพ์" : `พิมพ์ ${copies} ใบ`}
          </Button>
          {dirty && !locked && <span className="text-xs text-neutral-600">ยังไม่ได้บันทึก — กดพิมพ์จะบันทึกให้ก่อน</span>}
        </div>
        {message && (
          <p role={message.error ? "alert" : "status"} className={message.error ? "text-sm text-danger" : "text-sm text-neutral-700"}>
            {message.text}
          </p>
        )}
        <p className="mc-overflow text-sm text-danger" role="alert">
          เมนูยาวเกินหนึ่งหน้า A4 แม้ย่อตัวอักษรและแบ่งสองคอลัมน์แล้ว — ลดรายการที่พิมพ์เพิ่มก่อนพิมพ์
        </p>
      </div>

      <div className="mc-cards">
        {Array.from({ length: sheets }, (_, i) => (
          <MenuCardSheet key={i} card={card} manual={manual} />
        ))}
      </div>
    </div>
  );
}

function MenuCardSheet({ card, manual }: { card: MenuCard; manual: string[] }) {
  const empty = card.blocks.length === 0 && card.extras.length === 0 && manual.length === 0;
  return (
    <section className="mc-sheet" aria-label="การ์ดเมนู">
      <header className="mc-band">
        {/* Room for the logo, which comes later (Nik, 2026-09-24). */}
        <div className="mc-logo" aria-hidden="true"><span className="mc-logo-hint">พื้นที่โลโก้</span></div>
        <h2 className="mc-title">{card.title}</h2>
        {card.host && <p className="mc-host">{card.host}</p>}
      </header>
      <div className="mc-rule" />
      <div className="mc-meta">
        <p>{card.date}</p>
        {card.venue && <p>{card.venue}</p>}
      </div>
      <div className="mc-body">
        <div className="mc-content">
          {card.blocks.map((b) => (
            <div key={b.key} className="mc-block">
              {b.heading && <h3 className="mc-set">{b.heading}</h3>}
              {b.sections.map((s) => (
                <div key={s.key} className="mc-section">
                  <h4 className="mc-label">{s.label}</h4>
                  <ul>{s.items.map((item, i) => <li key={i}>{item}</li>)}</ul>
                </div>
              ))}
            </div>
          ))}
          {card.extras.length > 0 && (
            <div className="mc-section">
              <h4 className="mc-label">รายการอาหารเพิ่มเติม</h4>
              <ul>{card.extras.map((item, i) => <li key={i}>{item}</li>)}</ul>
            </div>
          )}
          {manual.length > 0 && (
            <div className="mc-section mc-manual">
              <ul>{manual.map((item, i) => <li key={i}>{item}</li>)}</ul>
            </div>
          )}
          {empty && <p className="mc-empty">ยังไม่มีรายการอาหารในงานนี้</p>}
        </div>
      </div>
      <footer className="mc-foot">Always Delicious</footer>
    </section>
  );
}
