/** Run with: npm test — the event-details sheet's rules (Nik, 2026-09-24). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockProblem, blocksForVenue, captionProblem, freeItemLines, freeMarkProblem, isLibraryImagePath, libraryImagePath,
  parseVenueTags, printedCaption, randomName, sheetNoteLines, sheetNotesProblem, unmarkedZeroLines, venueTagsProblem,
} from "./event-sheet.ts";

test("library uploads are named as the bucket accepts, in the library folder only", () => {
  const rand = randomName(() => 0.5);
  assert.match(rand, /^[0-9a-z]{8}$/);
  for (const ext of ["jpg", "png", "webp"] as const) assert.ok(isLibraryImagePath(libraryImagePath(ext, 1790000000000, rand)), ext);
  for (const bad of ["lib/1790000000000-abcd.gif", "lib/1790000000000-ABCD.jpg", "lib/x/1790000000000-abcd.jpg", "/lib/1790000000000-abcd.jpg",
    "lib/../1790000000000-abcd.jpg", "evt/0f8b3c2a-1d4e-4f5a-9b6c-7d8e9f0a1b2c/1790000000000-abcd.jpg", "lib/1790000000000-abcd.jpg\n"]) {
    assert.ok(!isLibraryImagePath(bad), bad);
  }
});

test("job notes print numbered: blank lines dropped, a typed number not doubled", () => {
  assert.deepEqual(sheetNoteLines("1. ลูกค้ามาจัดดอกไม้ 10:00\n\n  2) เปิดแอร์ก่อน 1 ชม.\nที่จอดรถ 10 คัน"), [
    "ลูกค้ามาจัดดอกไม้ 10:00", "เปิดแอร์ก่อน 1 ชม.", "ที่จอดรถ 10 คัน",
  ]);
  assert.deepEqual(sheetNoteLines(null), []);
  // A time or a decimal at the start is the note's own words, not a number.
  assert.deepEqual(sheetNoteLines("15.30 น. ทีมงานเข้าพื้นที่\n3.5 ชม. ก่อนงาน\n1.ไม่เว้นวรรค"), [
    "15.30 น. ทีมงานเข้าพื้นที่", "3.5 ชม. ก่อนงาน", "1.ไม่เว้นวรรค",
  ]);
  assert.equal(sheetNotesProblem("x".repeat(4000)), null);
  assert.ok(sheetNotesProblem("x".repeat(4001)));
  assert.ok(sheetNotesProblem(12));
});

test("venue tags: typed freely, each once; the booking's venue first, ignoring case and spaces", () => {
  assert.deepEqual(parseVenueTags("ห้อง V1, ห้อง  v1\nแอร์รวม,,"), ["ห้อง V1", "แอร์รวม"]);
  assert.equal(venueTagsProblem(Array.from({ length: 21 }, (_, i) => `t${i}`)) !== null, true);
  assert.equal(venueTagsProblem(["ห้อง V1"]), null);
  const blocks = [
    { id: "a", venue_tags: ["แอร์รวม"] },
    { id: "b", venue_tags: ["ห้องv1", "นอกสถานที่"] },
    { id: "c", venue_tags: [] },
  ];
  const { matching, others } = blocksForVenue(blocks, ["ห้อง V1", "ภายในร้าน"]);
  assert.deepEqual(matching.map((b) => b.id), ["b"]);
  assert.deepEqual(others.map((b) => b.id), ["a", "c"]);
});

test("a terms text has a title and a body within the database's limits", () => {
  assert.equal(blockProblem({ title: "การจัดโต๊ะ", body: "โต๊ะจีน 10 ที่" }), null);
  assert.ok(blockProblem({ title: "การจัดโต๊ะ", body: "  " }));
  assert.ok(blockProblem({ title: " ", body: "x" }));
  assert.ok(blockProblem({ title: "x".repeat(201), body: "x" }));
  assert.ok(blockProblem({ title: "x", body: "x".repeat(4001) }));
});

test("a library image's caption: this booking's when typed, else the library's; 300 characters at most", () => {
  assert.equal(printedCaption("ผังงานนี้", "ผังมาตรฐาน"), "ผังงานนี้");
  assert.equal(printedCaption("  ", "ผังมาตรฐาน"), "ผังมาตรฐาน");
  assert.equal(printedCaption(null, null), null);
  assert.equal(captionProblem(null), null);
  assert.equal(captionProblem("x".repeat(300)), null);
  assert.ok(captionProblem("x".repeat(301)));
  assert.ok(captionProblem(3));
});

test("THE FREE MARK: a ฿0 charge, or any dish (the mark prices it ฿0); never a set or the discount; a ฿0 line alone is only warned about", () => {
  assert.equal(freeMarkProblem({ kind: "manual", label: "น้ำแข็ง", amount: 0, free: true }), null);
  assert.equal(freeMarkProblem({ kind: "dish", label: "ขนมจีบ", amount: 0, free: true }), null);
  assert.equal(freeMarkProblem({ kind: "dish", label: "ขนมจีบ", amount: 120, free: true }), null);
  assert.ok(freeMarkProblem({ kind: "rate", label: "เวที", amount: 500, free: true }));
  // ฿5,000 × 0 is a ฿0 total and still not free: the unit price must be ฿0 too.
  assert.ok(freeMarkProblem({ kind: "rate", label: "ห้อง V1", amount: 0, unitPrice: 5000, free: true }));
  assert.ok(freeMarkProblem({ kind: "set", label: "ชุด A", amount: 0, free: true }));
  assert.ok(freeMarkProblem({ kind: "discount", label: "ส่วนลด", amount: 0, free: true }));
  assert.deepEqual(unmarkedZeroLines([
    { kind: "manual", label: "น้ำแข็ง", amount: 0, free: false },
    { kind: "manual", label: "เค้ก", amount: 0, free: true },
    { kind: "discount", label: "ส่วนลด", amount: 0, free: false },
    { kind: "set", label: "ชุด A", amount: 0, free: false },
    { kind: "rate", label: "ค่าห้อง", amount: 3000, free: false },
  ]), ["น้ำแข็ง"]);
});

test("รายการแถมฟรี: a fractional count prints to three decimals, never a stray point", () => {
  assert.deepEqual(freeItemLines([{ label: "น้ำแข็ง", quantity: 1.0004 }, { label: "ผลไม้", quantity: 2.5 }], []), ["น้ำแข็ง", "ผลไม้ × 2.5"]);
});

test("รายการแถมฟรี: the marked lines, then the sets' free sections", () => {
  assert.deepEqual(freeItemLines([{ label: "น้ำแข็ง", quantity: 2 }, { label: "เค้ก 2 ปอนด์", quantity: 1 }], [{ name: "ผลไม้รวม" }]), [
    "น้ำแข็ง × 2", "เค้ก 2 ปอนด์", "ผลไม้รวม",
  ]);
});
