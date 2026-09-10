/**
 * Raw-export POS group -> category. ONE definition, two callers:
 *
 *   - scripts/seed-item-categories.mjs, the one-time seed, as its LM/Grab
 *     fallback (those sheets are a CHANNEL, and a Lineman dessert is still a
 *     dessert);
 *   - the classification screen, as a SUGGESTION for an item with no stored
 *     row — pre-selected, marked แนะนำ, not decided until a person confirms.
 *
 * Decision 1 (no suggestions on the screen) was made against a monthly
 * trickle of new items and reversed on 2026-09-10 against a 343-item queue:
 * hundreds of clicks for rows whose POS group already says the answer. The
 * property that survives: a suggestion is never written unless confirmed.
 *
 * All 11 groups in the export are handled explicitly. An unlisted group
 * returns null and the product is REPORTED rather than defaulted — building
 * this over the groups I happened to have looked at, with everything else
 * falling through to 'other', is what put a vegetable dish in the wrong
 * bucket the first time.
 *
 * ── GROUPS WITH NO DEFAULT, AND WHY THAT IS NOT DEAD CODE ─────────────────
 *
 * Other (฿81,110), ออเดอร์พนักงาน (฿30,300) and อื่นๆ (฿13,500) return null on
 * purpose: their products demonstrably span several categories, so any
 * single default is wrong for some of them.
 *
 *   Other            food 35 · drink 7 · other 6 · coffee 1
 *   ออเดอร์พนักงาน   food 24 · coffee 8 · drink 1
 *   อื่นๆ             food 14 · other 5
 *
 * ออเดอร์พนักงาน is the sharpest: Nik files staff meals by WHAT THE STAFF ATE,
 * so a staff coffee sits in his กาแฟ sheet. Defaulting the group to food
 * would pull staff coffee back into restaurant revenue — precisely what the
 * coffee exclusion exists to prevent.
 *
 * ── GROUPS THAT LOOK HETEROGENEOUS BUT ARE RESOLVED ───────────────────────
 *
 * เครื่องดื่ม, ร้านกาแฟ and กลุ่มของฝาก each span more than one category, but
 * every exception is NAMED — a subcategory rule here, or the seed's named
 * EXCEPTIONS. Resolved is not the same as heterogeneous, so they keep their
 * default.
 *
 * No import of the app's Category type: this is src/lib, and the literal
 * union below is checked against that type where the screen consumes it.
 */
export type PosGroupCategory = "food" | "dessert" | "drink" | "coffee" | "souvenir" | "other";

export function categoryFromPosGroup(group: string, subcategory: string): PosGroupCategory | null {
  switch (group) {
    // Single-category groups: a default is safe.
    case "อาหาร":
    case "ตรุษจีน":
    case "Comment Menu":
    case "อาหารเจ":
      return "food";

    // Legacy grouping, not a channel despite the name. All 17 that reached
    // the seed's fallback are dishes.
    case "Lineman":
      return "food";

    // Resolved by a subcategory rule rather than a guess.
    case "เครื่องดื่ม":
      return subcategory === "ของหวาน" ? "dessert" : "drink";

    // Resolved by named exceptions (ข้าวเหนียวมูน, the บ้าบิ่น pair) in the seed.
    case "ร้านกาแฟ":
      return "coffee";
    case "กลุ่มของฝาก":
      return "souvenir";

    // NO DEFAULT — see the comment above. Reported, never guessed.
    case "Other":
    case "ออเดอร์พนักงาน":
    case "อื่นๆ":
      return null;

    default:
      return null;
  }
}

/**
 * The suggestion for a product that appeared under one or more POS
 * group/subcategory pairs in the month (a dish sold in อาหาร and staff-ordered
 * in ออเดอร์พนักงาน carries both).
 *
 * Exactly one distinct resolved category across its pairs → that category.
 * A pair with no default does not veto a resolved one: it says nothing, so
 * it contributes nothing. Two different resolved categories → null; the
 * groups disagree and a person decides.
 */
export function suggestFromPosGroups(pairs: readonly { group: string; subcategory: string }[]): PosGroupCategory | null {
  const resolved = new Set<PosGroupCategory>();
  for (const p of pairs) {
    const c = categoryFromPosGroup(p.group, p.subcategory);
    if (c !== null) resolved.add(c);
  }
  return resolved.size === 1 ? [...resolved][0]! : null;
}
