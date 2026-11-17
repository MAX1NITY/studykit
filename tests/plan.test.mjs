/**
 * Deciding which questions to write next.
 *
 * The two properties that matter are both about interruption: a run that
 * stops must not re-read material it has already used, and must not leave the
 * pool piled up in one domain.
 */
import assert from "node:assert/strict";

const { planBatches, planRemaining, MIX } = await import("../lib/exam/plan.ts");
const { DOMAINS, EXAM, domainQuota } = await import("../lib/exam/core1.ts");

assert.equal(
  MIX.reduce((n, m) => n + m.share, 0).toFixed(2),
  "1.00",
  "the mix must account for the whole pool",
);

// ------------------------------------------------- from an empty pool
const quota = domainQuota(EXAM.questions);
const emptyPlan = planBatches([], 1, 6);
const planned = emptyPlan.reduce((n, p) => n + p.count, 0);

assert.ok(planned >= 90, `one paper's worth is at least 90 questions, planned ${planned}`);
assert.ok(
  emptyPlan.every((p) => p.count > 0 && p.count <= 6),
  "no batch exceeds the batch size",
);
assert.equal(planRemaining([], 1), planned, "remaining matches what is planned");

// Every domain and every kind is represented.
assert.equal(new Set(emptyPlan.map((p) => p.domain)).size, 5);
assert.deepEqual(
  [...new Set(emptyPlan.map((p) => p.kind))].sort(),
  ["matching", "multiple", "ordering", "single"],
);

// ------------------------------------- an interrupted run stays spread
// The first eight batches must touch every domain, not grind through one.
const firstEight = emptyPlan.slice(0, 8);
assert.equal(
  new Set(firstEight.map((p) => p.domain)).size,
  5,
  `the first eight batches should reach all five domains, reached ${new Set(firstEight.map((p) => p.domain)).size}`,
);

// ------------------------------------------ rotation comes from the pool
// With 12 single-answer questions already written for 3.0, the next batch of
// them must read slice 2, not slice 0.
const partial = [{ domain: "3.0", kind: "single", count: 12 }];
const resumed = planBatches(partial, 1, 6);
const next30 = resumed.find((p) => p.domain === "3.0" && p.kind === "single");
assert.equal(next30.rotation, 2, "rotation continues from what the pool holds");

// And the work already done is not planned again.
const singles30 = resumed
  .filter((p) => p.domain === "3.0" && p.kind === "single")
  .reduce((n, p) => n + p.count, 0);
const target30 = Math.max(1, Math.round(quota["3.0"] * 1 * 0.72));
assert.equal(
  singles30,
  Math.max(0, target30 - 12),
  "only the shortfall is planned, not the whole target",
);

// ---------------------------------------------- a full pool plans nothing
const full = [];
for (const d of DOMAINS) {
  for (const { kind, share } of MIX) {
    full.push({
      domain: d.id,
      kind,
      count: Math.max(1, Math.round(quota[d.id] * 3 * share)),
    });
  }
}
assert.deepEqual(planBatches(full, 3, 6), [], "nothing left to write");
assert.equal(planRemaining(full, 3), 0);

// A pool filled for one paper still has work for three.
assert.ok(planRemaining(full, 3) < planRemaining([], 3));
const onePaper = [];
for (const d of DOMAINS) {
  for (const { kind, share } of MIX) {
    onePaper.push({
      domain: d.id,
      kind,
      count: Math.max(1, Math.round(quota[d.id] * 1 * share)),
    });
  }
}
assert.deepEqual(planBatches(onePaper, 1, 6), [], "one paper's target is met");
assert.ok(planBatches(onePaper, 3, 6).length > 0, "three papers still wants more");

// Unknown rows in the pool must not throw the arithmetic off.
assert.doesNotThrow(() =>
  planBatches([{ domain: "9.9", kind: "nonsense", count: 500 }], 1, 6),
);

// Every planned batch terminates: the plan is finite for a big ask.
assert.ok(planBatches([], 3, 6).length < 500);

console.log("plan: ok");
