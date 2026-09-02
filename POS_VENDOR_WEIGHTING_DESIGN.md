# Vendor dominance: count is the wrong measure

Design. Every option below was modelled against the live 90-day window
(244 materials, 4,489 deliveries) with **the shipped rule as the baseline**.

**Recommendation: pick the unit first, then the vendor by quantity within that
unit.** It changes 2 materials, fixes the reported problem, and avoids the
failure modes of the other three options.

---

## The problem

`priceFromDeliveries` picks the vendor with the most **deliveries**. That treats
a 3-kg top-up as equal evidence to a 57-kg bulk drop. For กะทิ, in the window:

| vendor | deliveries | qty | spend | avg ฿/โล |
|---|---:|---:|---:|---:|
| **ป้อม กะทิ** | 4 (14%) | **339 โล (87%)** | **฿23,771 (87%)** | 70.12 |
| พี่แจ๋ว | 12 (41%) | 23 โล (6%) | ฿1,840 (7%) | 80.00 |
| กะทิ ทรัพย์บุญชัย | 13 (45%) | 26 โล (7%) | ฿1,560 (6%) | 60.00 |

The rule picked **ทรัพย์บุญชัย — a vendor supplying 7% of the coconut milk** —
and priced the ingredient at ฿60. Nik: ป้อม is the main supplier and the others
top up when Pom runs short. The data agrees with Nik, and the rule did not.

The ⚠ flag fired, but on count-closeness (45% vs 41%). It warned on a wrong row
by coincidence, not by diagnosis.

## Options, and what the data did to them

### D — spend-weighted median, no vendor selection. **Disqualified.**

Disagrees with the shipped rule on **64 of 244** materials, and the largest is
fatal:

```
น้ำจิ้มไก่   12 ถุง ฿732 = ฿61   |   12 ถุง ฿732 = ฿61
             6 ถุง ฿3,606 = ฿601  |   12 ถุง ฿720 = ฿60
             shipped ฿61          →   weighted median ฿601
```

The ฿3,606 row is a mis-key, and it carries **more spend-weight than all three
correct rows combined**. Weighting by spend systematically amplifies mis-keyed
rows, because a mis-key is almost always upward. It is anti-robust — strictly
worse than what we have. It also bypasses the gap filter's protection, since the
weighting happens independently of clustering.

### C — vendor by quantity, as originally framed. **Structurally unsound.**

`qty` is not summable across units: 5 กล่อง + 3 โล is not 8 of anything.
**14 of 244 materials have more than one unit in the window**, so a naive
volume total is meaningless for those.

### B — vendor by spend share. **Works, but has a price bias.**

Changes 3 materials. Two are right (กะทิ, หมึกหอม). The third is not:

| | deliveries | qty | spend | avg ฿/โล |
|---|---:|---:|---:|---:|
| พี่แจ๋ว | 7 (47%) | 10.4 (49%) | ฿933 (**59%**) | 89.71 |
| ตลาดสี่มุมเมือง | 8 (53%) | 11.0 (**51%**) | ฿661 (41%) | 60.09 |

`มะม่วงดิบ` is a near coin-flip on volume — and spend picks พี่แจ๋ว **only
because พี่แจ๋ว charges 50% more**. At equal volume the dearer vendor always
wins on spend, which moves the price +30% on a material where neither vendor
actually dominates. Spend measures what we paid, not what we bought.

### E — unit first, then vendor by quantity within that unit. **Recommended.**

Fixing the ordering dissolves C's objection: once the unit is chosen, `qty` is
summable by construction, and there is never a need to add across units.

Changes exactly **2 of 244**:

| | shipped | option E | change | vendor: shipped → E |
|---|---:|---:|---:|---|
| **กะทิ** | 60.00 | **69.00** | +15% | ทรัพย์บุญชัย → **ป้อม กะทิ** |
| **หมึกหอม** | 350.00 | **330.00** | −6% | พี่แจ๋ว → **วิยะดา** |

- **กะทิ** — the reported problem, fixed. ป้อม at 87% of volume.
- **หมึกหอม** — a genuine 24-vs-24 **count tie**, currently resolved by
  recency, i.e. arbitrarily. วิยะดา supplies **80% of the volume**. Volume
  resolves it on evidence instead of on which delivery happened to be last.
- **มะม่วงดิบ untouched**, because volume is 49/51 and no vendor dominates —
  which is the correct answer for a coin-flip.

## What changes in the code

In `priceFromDeliveries`, step 1 only:

```
now:  dominant vendor (by count) → that vendor's dominant unit → pool
then: dominant unit (by count)   → vendor by qty within it     → pool
```

Steps 2 and 3 of the escalating fallback, the gap filter, the min-pool guard,
the redefinition detector and the denylist are all unchanged.

**Two follow-on adjustments, both improvements:**

- `vendorShare` becomes **share of volume in the chosen unit** rather than share
  of deliveries. That is the number a reviewer actually wants: "this vendor
  supplied 87% of the coconut milk", not "made 14% of the drop-offs".
- The ⚠ unsettled flag should compare **volume** shares, not counts. หมึกหอม is
  50/50 on count but 80/20 on volume, so it is currently flagged as ambiguous
  when it is not. Fewer false flags, and the ones that remain mean something.

## What this does not fix

`มะเขือพวง` still prices from 2 deliveries via the thin-data fallback, and the
window-dependence limit in `supabase/README.md` is untouched — a vendor
dominant over full history but not inside 90 days is still invisible to the
flag. Neither is made worse.

## A correction to my own first pass

My first model compared four options against a **re-implementation** of the
current rule rather than against `priceFromDeliveries` itself. That
re-implementation omitted the recency tiebreak, so it reported `มะเขือพวง` as a
count-vs-volume divergence — 70 → 130 — when the shipped rule already returns
130 and nothing there changes.

That is the same mistake as the row-cap cross-check: **a comparison whose
baseline is not the real thing tells you about your model, not the system.**
Every number above is measured against the shipped module.
