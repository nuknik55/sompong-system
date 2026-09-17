/** Run with: npm test — who sees the "full figures are in the owner's account" line (queue item 32). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { OWNER_ONLY_NOTE, showsOwnerOnlyNote } from "./owner-only-note.ts";

test("the owner never sees the note", () => {
  assert.equal(showsOwnerOnlyNote("owner"), false);
});

test("every other role sees it, and so does an unknown or missing role", () => {
  for (const role of ["admin", "editor", "staff", "hr", "sales", "Owner", "OWNER", "", null, undefined, "superuser"]) {
    assert.equal(showsOwnerOnlyNote(role), true, String(role));
  }
});

test("the note is Nik's wording and carries no number", () => {
  assert.equal(OWNER_ONLY_NOTE, "ตัวเลขฉบับเต็มดูได้ที่บัญชีเจ้าของร้าน");
  assert.doesNotMatch(OWNER_ONLY_NOTE, /[0-9๐-๙]/);
});
