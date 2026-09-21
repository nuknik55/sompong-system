/**
 * Run with: npm test — typing into a number box, key by key, the way the
 * recipe quantity box and the ingredient manager's boxes are typed into.
 *
 * The boxes below are wired exactly as the components wire them: what the
 * box shows comes from recipeQtyText / decimalBoxText, and a keystroke goes
 * through recipeQtyInput / decimalBoxInput, keeping the text as the draft.
 * The last test is the harness's own control: a box that holds only the
 * number must come out as 15, or the harness is not re-rendering between
 * keys and every other test here would pass for nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decimalBoxInput,
  decimalBoxText,
  parseDecimalInput,
  recipeQtyInput,
  recipeQtyText,
  sanitizeDecimalInput,
} from "./decimal-input.ts";

/**
 * A controlled box, typed into the way React runs one. Before every key the
 * box holds exactly what the component last rendered — for a type="text"
 * input React writes the rendered string back whenever it differs, so a
 * "1." rendered as "1" really is replaced. The key then edits that text at
 * the end, where the caret sits while typing, and the component's onChange
 * receives the result.
 */
type Box<S> = { shows: (s: S) => string; onInput: (raw: string) => S };
function typeInto<S>(box: Box<S>, start: S, keys: string[]): { state: S; shows: string } {
  let s = start;
  for (const key of keys) {
    const before = box.shows(s);
    s = box.onInput(key === "Backspace" ? before.slice(0, -1) : before + key);
  }
  return { state: s, shows: box.shows(s) };
}
const keys = (typed: string) => typed.split("");

// recipe-editor.tsx: the draft is the text of the one box being typed in.
type RecipeQty = { quantity: number; draft: string | null };
const recipeBox: Box<RecipeQty> = {
  shows: (s) => recipeQtyText(s.draft, s.quantity),
  onInput: (raw) => {
    const { text, quantity } = recipeQtyInput(raw);
    return { quantity, draft: text };
  },
};
const emptyRow: RecipeQty = { quantity: 0, draft: null };
const savedRow = (quantity: number): RecipeQty => ({ quantity, draft: null });
const leave = <S extends { draft: string | null }>(s: S): S => ({ ...s, draft: null });

test("1.5, BACKSPACE, 5 GIVES 1.5 — typed into an empty recipe row", () => {
  const r = typeInto(recipeBox, emptyRow, ["1", ".", "5", "Backspace", "5"]);
  assert.equal(r.state.quantity, 1.5);
  assert.equal(r.shows, "1.5");
});

test("BACKSPACING THE 5 OF A SAVED 1.5 LEAVES \"1.\", AND 5 MAKES IT 1.5 AGAIN — Nik's report", () => {
  const half = typeInto(recipeBox, savedRow(1.5), ["Backspace"]);
  assert.equal(half.shows, "1.", "the point stays in the box");
  assert.equal(half.state.quantity, 1, "and the row is worth 1 meanwhile");
  const back = typeInto(recipeBox, half.state, ["5"]);
  assert.equal(back.state.quantity, 1.5);
  assert.equal(back.shows, "1.5");
});

test("EVERY HALF-TYPED FORM STAYS EXACTLY AS TYPED", () => {
  const cases: [string[], string, number][] = [
    [keys("1."), "1.", 1],
    [keys("0."), "0.", 0],
    [keys("1.50"), "1.50", 1.5],
    [keys("."), ".", 0],
    [["1", "Backspace"], "", 0],
  ];
  for (const [typed, shows, quantity] of cases) {
    const r = typeInto(recipeBox, emptyRow, typed);
    assert.equal(r.shows, shows, typed.join(" "));
    assert.equal(r.state.quantity, quantity, typed.join(" "));
  }
});

test("A SAVED QUANTITY CAN BE CLEARED TO AN EMPTY BOX", () => {
  const r = typeInto(recipeBox, savedRow(1.5), ["Backspace", "Backspace", "Backspace"]);
  assert.equal(r.shows, "");
  assert.equal(r.state.quantity, 0);
});

test("DECIMALS BELOW ONE, AND ZEROS AFTER THE POINT, ARRIVE INTACT", () => {
  for (const [typed, quantity] of [["0.5", 0.5], ["0.25", 0.25], ["1.05", 1.05], ["2.25", 2.25], [".5", 0.5], ["150", 150]] as const) {
    const r = typeInto(recipeBox, emptyRow, keys(typed));
    assert.equal(r.state.quantity, quantity, typed);
    assert.equal(r.shows, typed, typed);
  }
});

test("LEAVING THE BOX SHOWS THE NUMBER THAT WILL BE SAVED", () => {
  for (const [typed, shows] of [["1.", "1"], ["1.50", "1.5"], [".", ""], ["0.", ""], ["007", "7"]] as const) {
    const r = typeInto(recipeBox, emptyRow, keys(typed));
    assert.equal(recipeBox.shows(leave(r.state)), shows, typed);
  }
});

test("A SECOND POINT, LETTERS, SPACES AND COMMAS ARE DROPPED", () => {
  assert.equal(sanitizeDecimalInput("1.2.3"), "1.23");
  assert.equal(sanitizeDecimalInput("a1 b.5"), "1.5");
  assert.equal(sanitizeDecimalInput("1,000.5"), "1000.5");
  assert.equal(sanitizeDecimalInput("..."), ".");
  assert.equal(sanitizeDecimalInput(""), "");
  // A second point typed after a whole number is simply not taken.
  assert.equal(typeInto(recipeBox, emptyRow, keys("1.5.")).shows, "1.5");
});

test("THE TEXT IS READ AS A NUMBER ONLY WHEN IT MEANS ONE", () => {
  assert.equal(parseDecimalInput(""), null);
  assert.equal(parseDecimalInput("."), null);
  assert.equal(parseDecimalInput("1."), 1);
  assert.equal(parseDecimalInput(".5"), 0.5);
  assert.equal(parseDecimalInput("1.50"), 1.5);
  assert.equal(parseDecimalInput("007"), 7);
});

// ingredient-manager.tsx NumberInput: a value that may be empty (null).
type NumberBox = { value: number | null; draft: string | null };
const numberBox: Box<NumberBox> = {
  shows: (s) => decimalBoxText(s.draft, s.value),
  onInput: (raw) => {
    const { text, value } = decimalBoxInput(raw);
    return { value, draft: text };
  },
};

test("INGREDIENT BOXES: 1.5, BACKSPACE, 5 GIVES 1.5; A CLEARED BOX IS EMPTY, NOT 0", () => {
  const r = typeInto(numberBox, { value: null, draft: null }, ["1", ".", "5", "Backspace", "5"]);
  assert.equal(r.state.value, 1.5);
  assert.equal(r.shows, "1.5");
  const cleared = typeInto(numberBox, { value: 45, draft: null }, ["Backspace", "Backspace"]);
  assert.equal(cleared.state.value, null);
  assert.equal(cleared.shows, "");
  const point = typeInto(numberBox, { value: null, draft: null }, ["."]);
  assert.equal(point.state.value, null, "a lone point is no price yet — it used to be NaN");
  assert.equal(point.shows, ".");
  assert.equal(typeInto(numberBox, point.state, ["5"]).state.value, 0.5);
});

test("INGREDIENT PACK SIZE: A BOX CLEARED TO RETYPE STAYS EMPTY WHILE TYPING, THOUGH THE FORM FALLS BACK TO 1", () => {
  // The call site stores `v ?? 1` for receive_qty. The box must not jump to 1
  // under the person's fingers; it shows 1 once they leave it.
  const packBox: Box<NumberBox> = {
    shows: numberBox.shows,
    onInput: (raw) => {
      const { text, value } = decimalBoxInput(raw);
      return { value: value ?? 1, draft: text };
    },
  };
  const r = typeInto(packBox, { value: 12, draft: null }, ["Backspace", "Backspace"]);
  assert.equal(r.shows, "");
  assert.equal(r.state.value, 1);
  assert.equal(packBox.shows(leave(r.state)), "1");
  assert.equal(typeInto(packBox, r.state, keys("2.5")).state.value, 2.5);
});

test("CONTROL: A BOX THAT HOLDS ONLY THE NUMBER TURNS 1.5 INTO 15 IN THIS HARNESS", () => {
  // The shape this module exists to prevent. If this stops giving 15, the
  // harness no longer re-renders between keys, and the tests above prove
  // nothing.
  const numberOnly: Box<number> = {
    shows: (n) => (n === 0 ? "" : String(n)),
    onInput: (raw) => Number(sanitizeDecimalInput(raw)) || 0,
  };
  assert.equal(typeInto(numberOnly, 0, ["1", ".", "5"]).state, 15);
  assert.equal(typeInto(numberOnly, 1.5, ["Backspace", "5"]).state, 15);
  assert.equal(typeInto(numberOnly, 0, keys("0.5")).state, 5);
});
