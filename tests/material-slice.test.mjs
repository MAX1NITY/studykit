/**
 * Which part of the syllabus a batch of questions reads.
 *
 * This is the quiet one. Questions generated from the opening pages of a
 * chapter look exactly as good as questions generated from the whole of it,
 * so nothing complains if most of the material is never opened. The same
 * mistake in the flashcard path once left the last seventh of every upload
 * unread.
 */
import assert from "node:assert/strict";

const { materialSlice } = await import("../lib/exam/select.ts");

/** Sources totalling roughly `chars` characters. */
const sourcesOf = (chars) => [{ name: "ch", content: "x".repeat(chars) }];

// Domain 2.0 in the real syllabus: five chapters, about 64 slices.
const networking = sourcesOf(573_066);

// Filling one paper takes about four batches of single-answer questions.
const firstFour = [0, 1, 2, 3].map((rotation) =>
  materialSlice(networking, rotation),
);
assert.equal(new Set(firstFour).size, 4, "four batches must read four different slices");
assert.ok(
  Math.max(...firstFour) - Math.min(...firstFour) > 20,
  `four batches must span the material, got slices ${firstFour.join(", ")}`,
);

// Over a long run the whole document gets opened, not just the start.
const many = new Set(
  Array.from({ length: 64 }, (_, r) => materialSlice(networking, r)),
);
assert.ok(many.size >= 55, `64 batches should reach most of the 64 slices, reached ${many.size}`);
assert.ok(Math.max(...many) >= 58, "the end of the material must be reachable");
assert.ok(Math.min(...many) === 0, "the start of the material must be reachable");

// Material short enough to read whole has one slice and stays on it.
const small = sourcesOf(6_000);
for (const rotation of [0, 1, 5, 40]) {
  assert.equal(materialSlice(small, rotation), 0);
}

// Never off the end, whatever rotation it is given.
for (const chars of [9_000, 70_583, 200_173, 573_066]) {
  const sources = sourcesOf(chars);
  const parts = Math.max(1, Math.ceil(chars / 9_000));
  for (const rotation of [0, 1, 7, 63, 500, 9_999]) {
    const got = materialSlice(sources, rotation);
    assert.ok(
      got >= 0 && got < parts,
      `${chars} chars, rotation ${rotation}: slice ${got} outside 0..${parts - 1}`,
    );
  }
}

console.log("material slice: ok");
