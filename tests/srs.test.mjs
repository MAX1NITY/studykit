// Checks the SM-2 implementation behaves the way the algorithm specifies.
import assert from "node:assert/strict";

// Node strips the types from lib/srs.ts directly; no build step needed.
const { review, previewIntervals, formatInterval } = await import(
  "../lib/srs.ts"
);

const fresh = { ease: 2.5, interval_days: 0, repetitions: 0, lapses: 0 };
const now = new Date("2026-01-01T00:00:00Z");
const DAY = 86_400_000;

function daysUntil(iso) {
  return (new Date(iso).getTime() - now.getTime()) / DAY;
}

// --- first "good" review schedules one day out ------------------------------
let card = review(fresh, "good", now);
assert.equal(card.repetitions, 1);
assert.equal(card.interval_days, 1);
assert.equal(daysUntil(card.due_at), 1);

// --- second "good" review schedules six days out (SM-2 constant) ------------
card = review(card, "good", now);
assert.equal(card.repetitions, 2);
assert.equal(card.interval_days, 6);

// --- third onwards multiplies by ease ---------------------------------------
const third = review(card, "good", now);
assert.equal(third.repetitions, 3);
assert.ok(
  Math.abs(third.interval_days - 6 * card.ease) < 0.02,
  `expected ~${6 * card.ease}, got ${third.interval_days}`,
);

// --- "easy" raises ease, "hard" lowers it ----------------------------------
assert.ok(review(fresh, "easy", now).ease > 2.5, "easy should raise ease");
assert.ok(review(fresh, "hard", now).ease < 2.5, "hard should lower ease");

// --- ease never drops below the 1.3 floor ----------------------------------
let beaten = fresh;
for (let i = 0; i < 20; i += 1) beaten = review(beaten, "hard", now);
assert.ok(beaten.ease >= 1.3 - 1e-9, `ease floor broken: ${beaten.ease}`);

// --- "again" resets the streak, counts a lapse, returns in 10 minutes ------
const lapsed = review(third, "again", now);
assert.equal(lapsed.repetitions, 0);
assert.equal(lapsed.lapses, 1);
assert.equal(lapsed.interval_days, 0);
assert.equal(new Date(lapsed.due_at).getTime() - now.getTime(), 10 * 60_000);

// --- "hard" gives a shorter step than "good" at the same point -------------
const mature = { ease: 2.5, interval_days: 10, repetitions: 5, lapses: 0 };
assert.ok(
  review(mature, "hard", now).interval_days <
    review(mature, "good", now).interval_days,
  "hard must schedule sooner than good",
);

// --- "easy" gives a longer step than "good" -------------------------------
assert.ok(
  review(mature, "easy", now).interval_days >
    review(mature, "good", now).interval_days,
  "easy must schedule later than good",
);

// --- previews cover all four buttons and read as human intervals ----------
const preview = previewIntervals(mature);
assert.deepEqual(Object.keys(preview).sort(), ["again", "easy", "good", "hard"]);
assert.equal(preview.again, "10m");

assert.equal(formatInterval(0), "10m");
assert.equal(formatInterval(1), "1d");
assert.equal(formatInterval(45), "2mo");
assert.equal(formatInterval(400), "1.1y");

console.log("SM-2: all assertions passed");
