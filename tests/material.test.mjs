/**
 * Long uploads are read a slice at a time. If slicing is wrong a student gets
 * cards for the opening fifth of their notes and no sign that the rest was
 * skipped, which is worse than having none because it looks complete.
 */
import assert from "node:assert/strict";

const { selectMaterial, partCount, BUDGETS } = await import("../lib/ai/material.ts");

const make = (chars, name = "Notes") => [
  { name, content: "x".repeat(chars) },
];

// --- partCount ------------------------------------------------------------
assert.equal(partCount(make(100), 1000), 1, "short material is one part");
assert.equal(partCount(make(1000), 1000), 1, "exactly one budget is one part");
assert.equal(partCount(make(1001), 1000), 2, "one over spills into a second");
assert.equal(partCount(make(116781), 20000), 6, "the real upload is six parts");
assert.equal(partCount([], 1000), 1, "no material still reports one part");

// --- selectMaterial: short input is returned whole -------------------------
const short = [{ name: "Notes", content: "the whole thing" }];
const whole = selectMaterial(short, 1000);
assert.ok(whole.includes("the whole thing"));
assert.ok(!whole.includes("part 1 of"), "no part banner when nothing was cut");

// --- each part returns different material ---------------------------------
const long = [{ name: "Long", content: Array.from({ length: 6000 }, (_, i) => `s${i}`).join(" ") }];
const budget = 5000;
const parts = partCount(long, budget);
assert.ok(parts > 1, "fixture should be long enough to split");

const slices = Array.from({ length: parts }, (_, i) =>
  selectMaterial(long, budget, i * budget),
);

for (let i = 1; i < slices.length; i += 1) {
  assert.notEqual(
    slices[i],
    slices[i - 1],
    `part ${i + 1} repeated part ${i} — repeated runs would write the same cards`,
  );
}

// --- the slice says which part it is, so the model knows it is partial ----
assert.match(slices[0], /part 1 of \d+/i);
assert.match(slices[1], /part 2 of \d+/i);

// --- a slice never exceeds its budget by much -----------------------------
for (const [i, slice] of slices.entries()) {
  assert.ok(
    slice.length <= budget + 200,
    `part ${i + 1} was ${slice.length} characters, over the ${budget} budget`,
  );
}

// --- offsets past the end wrap rather than returning nothing --------------
const wrapped = selectMaterial(long, budget, budget * 50);
assert.ok(wrapped.length > 100, "a large offset must still return material");

// --- together, the parts reach the end of the document --------------------
const tail = long[0].content.slice(-200);
const reachesEnd = slices.some((s) => s.includes(tail.slice(0, 50)));
assert.ok(reachesEnd, "the last part never reached the end of the material");

// --- the real budgets divide the real upload sensibly ---------------------
assert.ok(BUDGETS.question < BUDGETS.cards, "a single question needs less than a deck");
assert.ok(BUDGETS.guide >= BUDGETS.cards, "the guide may read more at once");

console.log("Material slicing: all assertions passed");
