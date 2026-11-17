/**
 * Marking exam answers.
 *
 * The properties worth protecting are the ones that would quietly hand out
 * marks: ticking every option on a Select TWO, or a partial-credit shape
 * paying out for an answer that got nothing right.
 */
import assert from "node:assert/strict";

const { grade } = await import("../lib/exam/grade.ts");

// ------------------------------------------------------------ single
const single = {
  kind: "single",
  options: ["SaaS", "PaaS", "IaaS", "DaaS"],
  answer_indexes: [0],
};

assert.equal(grade(single, { kind: "single", picked: [0] }).score, 100);
assert.equal(grade(single, { kind: "single", picked: [2] }).score, 0);
assert.equal(grade(single, { kind: "single", picked: [] }).score, 0);
assert.equal(grade(single, null).score, 0);
assert.equal(grade(single, { kind: "single", picked: [0] }).correct, true);

// Ticking the right one plus another is not a right answer to a single.
assert.equal(grade(single, { kind: "single", picked: [0, 1] }).score, 0);

// ---------------------------------------------------------- multiple
const two = {
  kind: "multiple",
  options: ["a", "b", "c", "d", "e"],
  answer_indexes: [1, 3],
};

assert.equal(grade(two, { kind: "multiple", picked: [1, 3] }).score, 100);
assert.equal(grade(two, { kind: "multiple", picked: [3, 1] }).score, 100, "order must not matter");
assert.equal(grade(two, { kind: "multiple", picked: [1] }).score, 50, "half right, nothing wrong");
assert.equal(grade(two, { kind: "multiple", picked: [1, 0] }).score, 0, "one right, one wrong");
assert.equal(
  grade(two, { kind: "multiple", picked: [1, 3, 0] }).score,
  50,
  "both right plus a wrong one keeps half",
);
assert.equal(
  grade(two, { kind: "multiple", picked: [0, 1, 2, 3, 4] }).score,
  0,
  "ticking everything must score nothing",
);
assert.equal(grade(two, { kind: "multiple", picked: [] }).score, 0);
assert.equal(grade(two, { kind: "multiple", picked: [1] }).correct, false);

// A Select THREE: two of three with no misfires is two thirds.
const three = {
  kind: "multiple",
  options: ["a", "b", "c", "d", "e"],
  answer_indexes: [0, 2, 4],
};
assert.equal(grade(three, { kind: "multiple", picked: [0, 2] }).score, 67);
assert.equal(grade(three, { kind: "multiple", picked: [0, 2, 4] }).score, 100);

// ---------------------------------------------------------- ordering
const steps = { kind: "ordering", steps: ["one", "two", "three", "four"] };

assert.equal(grade(steps, { kind: "ordering", order: [0, 1, 2, 3] }).score, 100);
assert.equal(
  grade(steps, { kind: "ordering", order: [1, 0, 2, 3] }).score,
  50,
  "first two swapped leaves two in place",
);
assert.equal(
  grade(steps, { kind: "ordering", order: [3, 2, 1, 0] }).score,
  0,
  "fully reversed places nothing",
);
assert.deepEqual(
  grade(steps, { kind: "ordering", order: [0, 2, 1, 3] }).detail,
  [true, false, false, true],
);

// ---------------------------------------------------------- matching
const pairs = {
  kind: "matching",
  pairs: [
    { left: "RJ45", right: "Ethernet" },
    { left: "RJ11", right: "Telephone" },
    { left: "SC", right: "Fibre" },
    { left: "DB9", right: "Serial" },
  ],
};

assert.equal(grade(pairs, { kind: "matching", assigned: [0, 1, 2, 3] }).score, 100);
assert.equal(grade(pairs, { kind: "matching", assigned: [1, 0, 2, 3] }).score, 50);
assert.equal(grade(pairs, { kind: "matching", assigned: [null, null, null, null] }).score, 0);
assert.equal(
  grade(pairs, { kind: "matching", assigned: [0, 1, 2, null] }).score,
  75,
  "three placed, one left blank",
);

// Two left-hand items can share an answer, and both must still mark correct.
const shared = {
  kind: "matching",
  pairs: [
    { left: "SC", right: "Fibre" },
    { left: "LC", right: "Fibre" },
    { left: "RJ45", right: "Ethernet" },
  ],
};
assert.equal(
  grade(shared, { kind: "matching", assigned: [1, 0, 2] }).score,
  100,
  "swapping two items that share an answer is still right",
);

// ------------------------------------------------------ wrong shape
assert.equal(grade(single, { kind: "ordering", order: [0] }).score, 0);
assert.equal(grade(steps, { kind: "single", picked: [0] }).score, 0);

console.log("grade: ok");
