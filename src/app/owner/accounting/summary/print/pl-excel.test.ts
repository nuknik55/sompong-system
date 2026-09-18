/**
 * Run with: npm test — the .xlsx the owner actually downloads.
 *
 * pl-workbook.test.ts checks the ROWS. This file checks the FILE: it calls
 * buildPlFile — the same function the button calls — and reads the bytes back,
 * because everything asked for here lives in the parts of the workbook that
 * the rows say nothing about.
 *
 *   - the filter and the frozen rows are XML the library either writes or
 *     does not (it has no freeze panes at all: the panes are patched into the
 *     file afterwards, and this is what proves they arrived);
 *   - the red mark on ฉบับเต็ม is a fill index in styles.xml, and the header
 *     band is another one. "The styling did not override the mark" is a claim
 *     about those indexes, so the test resolves them rather than trusting the
 *     style object it passed in;
 *   - a duplicated part is invisible from every reader that indexes by name,
 *     including SheetJS's own. Patching the panes by ADDING a part produced
 *     exactly that, so the zip is parsed here by hand.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import XLSX from "xlsx-js-style";
import {
  buildPlFile, buildPlWorkbook, columnWidths, freezeSheetXml, FULL_SHEET, MEETING_SHEET,
  type PlSummary, type SheetSpec,
} from "./pl-workbook.ts";

const OWNER_NAME = "เงินเดือนเจ้าของร้าน";
const OWNER_PAY = 60000;
const NOTICE = "ข้อมูลค่าใช้จ่ายของเดือนนี้ยังไม่ครบ";
const REVENUE = { food: 800000, drink: 200000 };
const COVERS = { bills: 2500, customers: 6000, cancelledBills: 3, cancelledAmount: 1200 };

const acc = (code: string, name: string, total: number, is_sensitive = false) => ({
  code, name, total, pct_of_revenue: (total / 1_000_000) * 100, is_sensitive,
});
function month(): PlSummary {
  const group = (code: string, name: string, target: number | null, accounts: ReturnType<typeof acc>[]) => {
    const total = accounts.reduce((s, a) => s + a.total, 0);
    return { group_code: code, group_name: name, target_pct: target, total, pct_of_revenue: (total / 1_000_000) * 100, accounts };
  };
  const groups = [
    // -25,000.50 is a credited delivery: a negative amount has to format and
    // fit like any other (queue item: the negative-account fix).
    group("G100", "ต้นทุนวัตถุดิบ (COGS)", 38, [acc("110", "ผักสด", 380500.25), acc("120", "ของสด", -25000.5)]),
    group("G700", "บริหาร (G&A)", null, [acc("710", "ค่าเช่า", 50000), acc("790", OWNER_NAME, OWNER_PAY, true)]),
  ];
  const nonOperating = [group("G950", "ภาษี", null, [acc("951", "ภาษีมูลค่าเพิ่ม", 12000)])];
  return {
    groups, nonOperating, totalRevenue: 1_000_000,
    operatingExpense: groups.reduce((s, g) => s + g.total, 0),
    capex: 0, tax: 12000, expenseDataIncomplete: true, monthInProgress: false,
  };
}

type Parts = Record<string, string>;
function build() {
  const { full, meeting } = buildPlWorkbook("สิงหาคม 2569", month(), REVENUE, COVERS, [NOTICE]);
  const { bytes, frozenSheets } = buildPlFile(XLSX, [full, meeting]);
  const back = XLSX.read(bytes, { type: "array", cellStyles: true, bookFiles: true });
  // bookFiles puts the zip parts on the workbook; the shipped types do not
  // declare them, so the shape is asserted here rather than assumed.
  const raw = (back as unknown as { files?: Record<string, { content?: Uint8Array }> }).files ?? {};
  const parts: Parts = {};
  for (const [name, part] of Object.entries(raw)) {
    if (part?.content) parts[name] = new TextDecoder().decode(part.content);
  }
  return { full, meeting, bytes, frozenSheets, back, parts };
}
/** sheet1.xml is the first appended sheet (ฉบับเต็ม), sheet2.xml the second. */
const sheetPart = (i: number) => `xl/worksheets/sheet${i}.xml`;

/** The zip, parsed from its central directory rather than through the library that wrote it. */
function zipEntries(bytes: Uint8Array): { names: string[]; problems: string[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  assert.ok(eocd >= 0, "no end-of-central-directory: not a zip");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const names: string[] = [];
  const problems: string[] = [];
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(p, true), 0x02014b50, "bad central directory header");
    const method = view.getUint16(p + 10, true), crc = view.getUint32(p + 16, true);
    const csize = view.getUint32(p + 20, true), usize = view.getUint32(p + 24, true);
    const nlen = view.getUint16(p + 28, true), elen = view.getUint16(p + 30, true), clen = view.getUint16(p + 32, true);
    const lho = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen));
    names.push(name);
    const dataAt = lho + 30 + view.getUint16(lho + 26, true) + view.getUint16(lho + 28, true);
    const stored = bytes.subarray(dataAt, dataAt + csize);
    try {
      const out = method === 8 ? zlib.inflateRawSync(stored) : stored;
      if (out.length !== usize) problems.push(`${name}: ${out.length} bytes, header says ${usize}`);
      else if ((zlib.crc32(out) >>> 0) !== crc) problems.push(`${name}: crc mismatch`);
    } catch (e) {
      problems.push(`${name}: will not inflate (${(e as Error).message})`);
    }
    p += 46 + nlen + elen + clen;
  }
  return { names, problems };
}

const section = (xml: string, tag: string) =>
  new RegExp(`<${tag}[ >][\\s\\S]*?</${tag}>`).exec(xml)?.[0] ?? "";
/** The font and fill Excel will paint a cell with, resolved through styles.xml. */
function styleOf(parts: Parts, sheet: number, ref: string) {
  const cell = new RegExp(`<c r="${ref}"([^>]*)>`).exec(parts[sheetPart(sheet)] ?? "");
  assert.ok(cell, `cell ${ref} is not in sheet${sheet}`);
  const styles = parts["xl/styles.xml"] ?? "";
  const index = Number(/s="(\d+)"/.exec(cell[1] ?? "")?.[1] ?? 0);
  const xf = (section(styles, "cellXfs").match(/<xf [^>]*?\/?>/g) ?? [])[index] ?? "";
  const font = (section(styles, "fonts").match(/<font>[\s\S]*?<\/font>/g) ?? [])[Number(/fontId="(\d+)"/.exec(xf)?.[1] ?? 0)] ?? "";
  const fill = (section(styles, "fills").match(/<fill>[\s\S]*?<\/fill>/g) ?? [])[Number(/fillId="(\d+)"/.exec(xf)?.[1] ?? 0)] ?? "";
  return { font, fill, bold: font.includes("<b/>"), red: fill.includes("FFFF9999") };
}
const cellsIn = (parts: Parts, sheet: number, row: number) =>
  [...(parts[sheetPart(sheet)] ?? "").matchAll(new RegExp(`<c r="([A-E]${row})"`, "g"))].map((m) => m[1]!);
const labelAt = (spec: SheetSpec, row: number) => String(spec.rows[row]?.[0] ?? "");

test("the package holds each part once, and every part survives its own CRC", () => {
  const { bytes, parts } = build();
  const { names, problems } = zipEntries(bytes);
  assert.deepEqual(problems, []);
  assert.deepEqual(
    names.filter((n, i) => names.indexOf(n) !== i),
    [],
    "a part appears twice: readers that index by name see one of them, Excel may see the other",
  );
  assert.ok(names.includes("[Content_Types].xml"), "no content types part");
  assert.ok(names.includes(sheetPart(1)) && names.includes(sheetPart(2)), "both sheets must be in the package");
  assert.ok(Object.keys(parts).length >= names.length - 1, "read back fewer parts than the zip holds");
});

test("both sheets freeze the title, the warning and the column header", () => {
  const { full, meeting, frozenSheets, parts } = build();
  assert.equal(frozenSheets, 2);
  // Four rows above the first amount: title, one warning, a blank, the header.
  assert.equal(full.freezeRows, 4);
  assert.equal(meeting.freezeRows, 4);
  for (const [i, spec] of [full, meeting].entries()) {
    const xml = parts[sheetPart(i + 1)] ?? "";
    assert.match(
      xml,
      new RegExp(`<sheetView[^>]*><pane ySplit="${spec.freezeRows}" topLeftCell="A${spec.freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`),
      `sheet ${spec.name} is not frozen, or its pane is not the first child of sheetView`,
    );
  }
});

test("the freeze is skipped rather than guessed when the library changes shape", () => {
  const anchor = '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  assert.match(freezeSheetXml(anchor, 4) ?? "", /<pane ySplit="4" topLeftCell="A5"/);
  assert.equal(freezeSheetXml('<sheetViews><sheetView workbookViewId="0" tabSelected="1"/></sheetViews>', 4), null);
  assert.equal(freezeSheetXml(anchor, 0), null);
});

test("each sheet filters its expense list, and no total is inside the filter", () => {
  const { full, meeting, parts, back } = build();
  for (const [i, spec] of [full, meeting].entries()) {
    assert.ok(spec.filter, `${spec.name} has no filter range`);
    const ref = `A${spec.filter!.headerRow + 1}:E${spec.filter!.lastRow + 1}`;
    assert.match(parts[sheetPart(i + 1)] ?? "", new RegExp(`<autoFilter ref="${ref}"/>`));
    assert.equal((back.Sheets[spec.name]!["!autofilter"] as { ref: string }).ref, ref);
    // What the range covers: the expense header, then expense lines only.
    assert.equal(labelAt(spec, spec.filter!.headerRow), "ค่าใช้จ่าย");
    assert.equal(labelAt(spec, spec.filter!.lastRow + 1), "รวมค่าใช้จ่ายดำเนินงาน");
    for (let r = spec.filter!.headerRow + 1; r <= spec.filter!.lastRow; r++) {
      assert.ok(!labelAt(spec, r).startsWith("รวม"), `row ${r} of ${spec.name} is a total inside the filter`);
    }
  }
  assert.equal(full.name, FULL_SHEET);
  assert.equal(meeting.name, MEETING_SHEET);
});

test("the header band is white on dark; the warning is coloured type, not a band", () => {
  const { full, parts } = build();
  for (const header of full.headerRows) {
    const cells = cellsIn(parts, 1, header + 1);
    assert.equal(cells.length, 5, `header row ${header} does not span A..E`);
    for (const ref of cells) {
      const { font, fill, bold } = styleOf(parts, 1, ref);
      assert.ok(bold, `${ref} is not bold`);
      assert.match(font, /<color rgb="FFFFFF"\/>/);
      assert.match(fill, /<fgColor rgb="FF1F2937"\/>/);
    }
  }
  const notice = styleOf(parts, 1, `A${full.noticeRows[0]! + 1}`);
  assert.ok(notice.bold);
  assert.match(notice.font, /<color rgb="92400E"\/>/);
  assert.match(notice.fill, /patternType="none"/);
});

test("the red mark survives the styling, on exactly the figures that carry the owner-only account", () => {
  const { full, parts } = build();
  assert.ok(full.markedRows.length >= 4, "fixture must mark the account, its group, the total and the profit");
  for (const row of full.markedRows) {
    for (const ref of cellsIn(parts, 1, row + 1)) {
      assert.ok(styleOf(parts, 1, ref).red, `${ref} (${labelAt(full, row)}) lost its red fill`);
    }
  }
  // The marked TOTAL rows are the ones styling could have overwritten: they
  // carry bold and a rule of their own. Both have to be true at once.
  for (const row of full.totalRows.filter((r) => full.markedRows.includes(r))) {
    const { bold, red } = styleOf(parts, 1, `A${row + 1}`);
    assert.ok(bold && red, `${labelAt(full, row)}: bold ${bold}, red ${red}`);
  }
  // Controls: an unmarked total is bold and NOT red, an ordinary account row
  // is neither, and the meeting sheet carries no red cell at all.
  const plainTotal = full.totalRows.find((r) => !full.markedRows.includes(r))!;
  assert.equal(labelAt(full, plainTotal), "รวมรายได้");
  assert.equal(styleOf(parts, 1, `A${plainTotal + 1}`).bold, true);
  assert.equal(styleOf(parts, 1, `A${plainTotal + 1}`).red, false);
  const rent = full.rows.findIndex((r) => String(r[0]).trim() === "ค่าเช่า");
  assert.equal(styleOf(parts, 1, `A${rent + 1}`).red, false);
  const meetingCells = [...(parts[sheetPart(2)] ?? "").matchAll(/<c r="([A-E]\d+)"/g)].map((m) => m[1]!);
  assert.deepEqual(meetingCells.filter((ref) => styleOf(parts, 2, ref).red), []);
});

test("amounts carry separators and two decimals; counts and percentages keep their own formats", () => {
  const { full, back } = build();
  const ws = back.Sheets[FULL_SHEET]!;
  const rent = full.rows.findIndex((r) => String(r[0]).trim() === "ค่าเช่า");
  const credit = full.rows.findIndex((r) => String(r[0]).trim() === "ของสด");
  assert.equal(ws[`C${rent + 1}`].z, "#,##0.00");
  assert.equal(ws[`C${credit + 1}`].z, "#,##0.00");
  assert.equal(ws[`C${credit + 1}`].v, -25000.5);
  assert.equal(ws[`D${rent + 1}`].z, "0.0");
  for (const r of full.countRows) assert.equal(ws[`C${r + 1}`].z, "#,##0", `row ${r} is a count`);
  // % เป้า in column E is untouched, as it has always been: no format of
  // its own, which the reader reports as General.
  const cogs = full.rows.findIndex((r) => String(r[0]).trim() === "ต้นทุนวัตถุดิบ (COGS)");
  assert.equal(ws[`E${cogs + 1}`].v, 38);
  assert.equal(ws[`E${cogs + 1}`].z, "General");
});

test("every column is wide enough for the widest thing in it, so no number shows as ####", () => {
  const { full, meeting, back } = build();
  for (const spec of [full, meeting]) {
    const ws = back.Sheets[spec.name]!;
    const widths = (ws["!cols"] as { wch: number }[]).map((c) => c.wch);
    assert.deepEqual(widths, columnWidths(spec));
    for (let r = 0; r < spec.rows.length; r++) {
      for (const c of [2, 3, 4]) {
        const v = spec.rows[r]?.[c];
        if (typeof v !== "number") continue;
        const shown = c === 2
          ? v.toLocaleString("en-US", { minimumFractionDigits: spec.countRows.includes(r) ? 0 : 2, maximumFractionDigits: spec.countRows.includes(r) ? 0 : 2 })
          : v.toFixed(1);
        assert.ok(shown.length <= widths[c]!, `${spec.name} column ${c}: "${shown}" needs ${shown.length}, column is ${widths[c]}`);
      }
    }
  }
});

test("the meeting sheet says nothing about what was taken out — not in a cell, not in a name", () => {
  const { full, meeting, parts } = build();
  const hidden = ["ไม่แสดง", "ตัด", "ซ่อน", "เจ้าของร้าน", "790", String(OWNER_PAY)];
  const meetingXml = parts[sheetPart(2)] ?? "";
  for (const word of hidden) assert.ok(!meetingXml.includes(word), `สำหรับประชุม contains "${word}"`);
  assert.ok(parts[sheetPart(1)]!.includes(OWNER_NAME), "the leak-finder must be able to find it: ฉบับเต็ม has the account");
  // The same warning on both sheets, and no extra one: a notice is about the
  // month, and a sheet that carried one more would be saying something.
  assert.equal(meeting.noticeRows.length, full.noticeRows.length);
  assert.ok(meetingXml.includes(NOTICE));
  if (parts["xl/sharedStrings.xml"]) {
    for (const word of hidden) assert.ok(!parts["xl/sharedStrings.xml"]!.includes(word), `shared strings contain "${word}"`);
  }
  // The filter is the one thing here that writes a DEFINED NAME. Excel's own
  // _xlnm._FilterDatabase, one per sheet, holding a range and nothing else.
  const workbook = parts["xl/workbook.xml"] ?? "";
  const names = [...workbook.matchAll(/<definedName name="([^"]+)"([^>]*)>([^<]*)</g)];
  assert.ok(names.length > 0, "the filter should have written a defined name");
  for (const [, name, attrs, value] of names) {
    assert.equal(name, "_xlnm._FilterDatabase", `unexpected defined name ${name}`);
    assert.match(value!, /^&apos;[^&]+&apos;![A-E]\d+:[A-E]\d+$/, `defined name ${name} is not a plain range: ${value}`);
    if (attrs!.includes('localSheetId="1"')) assert.ok(value!.includes(MEETING_SHEET), "the meeting sheet's name must be its own");
  }
  for (const word of hidden) assert.ok(!workbook.includes(word), `workbook.xml contains "${word}"`);
});
