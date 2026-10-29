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

// ---------------------------------------------------------------------------
// Every button must mean something different.
//
// Plain SM-2 pinned the first two intervals to 1 and 6 days whatever you
// pressed, so Hard, Good and Easy all scheduled a new card for tomorrow.
// Four buttons offering two outcomes is a decision with no consequence, and
// the student spends attention on it anyway.
// ---------------------------------------------------------------------------
{
  const distinct = (card, label) => {
    const days = ["again", "hard", "good", "easy"].map(
      (g) => review(card, g).interval_days,
    );
    const unique = new Set(days);
    assert.equal(
      unique.size,
      4,
      `${label}: expected four different intervals, got ${JSON.stringify(days)}`,
    );
    // And they must be in ascending order of confidence.
    const sorted = [...days].sort((a, b) => a - b);
    assert.deepEqual(
      days,
      sorted,
      `${label}: intervals should grow Again < Hard < Good < Easy, got ${JSON.stringify(days)}`,
    );
  };

  distinct({ ease: 2.5, interval_days: 0, repetitions: 0, lapses: 0 }, "new card");
  distinct({ ease: 2.5, interval_days: 1, repetitions: 1, lapses: 0 }, "second review");
  distinct({ ease: 2.36, interval_days: 6, repetitions: 2, lapses: 1 }, "third review");
  distinct({ ease: 2.5, interval_days: 30, repetitions: 5, lapses: 0 }, "mature card");
}

// A failed card must not come back instantly, or a student can grind one
// card's ease to the floor in seconds without ever seeing another.
{
  const lapsed = review(
    { ease: 2.5, interval_days: 10, repetitions: 3, lapses: 0 },
    "again",
  );
  assert.equal(lapsed.interval_days, 0);
  assert.ok(
    Date.parse(lapsed.due_at) - Date.now() > 60_000,
    "a lapsed card should wait minutes, not be due immediately",
  );
}

// Ease is written straight to the database, so it must not carry float dirt.
{
  for (const grade of ["again", "hard", "good", "easy"]) {
    const { ease } = review(
      { ease: 2.5, interval_days: 6, repetitions: 2, lapses: 0 },
      grade,
    );
    assert.equal(
      ease,
      Math.round(ease * 1000) / 1000,
      `${grade} returned an unrounded ease: ${ease}`,
    );
  }
}

// Hard is a reduced step, not a punishment on top of a punishment: the card
// was recalled, so it should not land sooner than it did last time.
{
  const card = { ease: 2.5, interval_days: 10, repetitions: 4, lapses: 0 };
  assert.ok(
    review(card, "hard").interval_days >= card.interval_days,
    "Hard should not shorten the interval of a card that was recalled",
  );
}

console.log("SM-2 grade separation: all assertions passed");
