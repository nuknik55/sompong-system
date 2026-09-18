/** Run with: npm test — a history line's time is Bangkok's, whatever zone the process runs in. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bangkokDateTime } from "./log-time.ts";

test("a UTC evening is the next Bangkok morning", () => {
  // 2026-09-16 19:30 UTC is 2026-09-17 02:30 in Bangkok (UTC+7).
  assert.deepEqual(bangkokDateTime("2026-09-16T19:30:00.000Z"), { date: "2026-09-17", time: "02:30" });
});

test("Bangkok midnight prints as 00:00 on the right day, and the afternoon in 24-hour form", () => {
  assert.deepEqual(bangkokDateTime("2026-09-16T17:00:00.000Z"), { date: "2026-09-17", time: "00:00" });
  assert.deepEqual(bangkokDateTime("2026-09-17T07:05:00.000Z"), { date: "2026-09-17", time: "14:05" });
});

test("THE DEFECT: the answer does not depend on the process time zone", () => {
  const before = process.env.TZ;
  try {
    const seen = new Set<string>();
    for (const tz of ["UTC", "Asia/Bangkok", "America/Los_Angeles"]) {
      process.env.TZ = tz;
      const r = bangkokDateTime("2026-09-16T19:30:00.000Z");
      seen.add(`${r.date} ${r.time}`);
    }
    assert.deepEqual([...seen], ["2026-09-17 02:30"]);
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});
