/**
 * The star rules.
 *
 * Each way of studying earns its own three stars. The properties worth
 * protecting are the ones that would quietly make a star meaningless:
 * earning one by volume alone, earning one out of order, being locked out of
 * one permanently by an early bad run, or one feature's work bleeding into
 * another's ladder.
 */
import assert from "node:assert/strict";

const { masteryOf, questionTarget, recentAccuracy } = await import(
  "../lib/mastery.ts"
);

const KIT = "kit-1";

/** A kit with nothing done to it. */
const blank = (over = {}) => ({
  cards: 96,
  cardsSeen: 0,
  cardsPassed: 0,
  answered: 0,
  recentScores: [],
  hardCorrect: 0,
  tests: 0,
  bestTestPercent: null,
  ...over,
});

const ladder = (m, feature) => m.ladders.find((l) => l.feature === feature);

// --- targets scale with the chapter ---------------------------------------
assert.equal(questionTarget(96), 12, "a long chapter caps at 12");
assert.equal(questionTarget(8), 5, "a short chapter floors at 5");
assert.equal(questionTarget(80), 10, "80 cards -> 10");
assert.equal(questionTarget(0), 8, "a kit with no deck still asks for some");

// --- three separate ladders ----------------------------------------------
{
  const m = masteryOf(blank(), KIT);
  assert.deepEqual(
    m.ladders.map((l) => l.feature),
    ["study", "cards", "test"],
  );
  assert.equal(m.stars, 0);
  assert.equal(m.total, 9, "three stars on each of three ladders");
  for (const l of m.ladders) {
    assert.equal(l.tiers.length, 3, `${l.feature} should have three tiers`);
    assert.ok(l.href.includes(KIT), `${l.feature} should link to the kit`);
  }
}

// --- EACH LADDER IS EARNED ON ITS OWN WORK -------------------------------
// A perfect night on flashcards must not move Smart Study or the test.
{
  const m = masteryOf(
    blank({ cardsSeen: 96, cardsPassed: 96 }),
    KIT,
  );
  assert.equal(ladder(m, "cards").stars, 3, "the deck is done");
  assert.equal(ladder(m, "study").stars, 0, "Smart Study was never opened");
  assert.equal(ladder(m, "test").stars, 0, "no test was sat");
  assert.equal(m.stars, 3, "three of nine");
}

// And the reverse: Smart Study mastered leaves the deck untouched.
{
  const m = masteryOf(
    blank({
      answered: 36,
      recentScores: Array(12).fill(92),
      hardCorrect: 4,
    }),
    KIT,
  );
  assert.equal(ladder(m, "study").stars, 3);
  assert.equal(ladder(m, "cards").stars, 0);
  assert.equal(ladder(m, "test").stars, 0);
}

// --- Smart Study: the climb ----------------------------------------------
{
  const one = masteryOf(
    blank({ answered: 12, recentScores: Array(12).fill(40) }),
    KIT,
  );
  assert.equal(ladder(one, "study").stars, 1, "turning up earns the first");

  const two = masteryOf(
    blank({ answered: 24, recentScores: Array(12).fill(75) }),
    KIT,
  );
  assert.equal(ladder(two, "study").stars, 2);

  const three = masteryOf(
    blank({ answered: 36, recentScores: Array(12).fill(90), hardCorrect: 3 }),
    KIT,
  );
  assert.equal(ladder(three, "study").stars, 3);
  assert.equal(ladder(three, "study").next, null);
  assert.deepEqual(ladder(three, "study").remaining, []);
}

// --- VOLUME ALONE MUST NOT EARN THE UPPER STARS -------------------------
{
  const m = masteryOf(
    blank({ answered: 500, recentScores: Array(60).fill(20), hardCorrect: 0 }),
    KIT,
  );
  const study = ladder(m, "study");
  assert.equal(
    study.stars,
    1,
    "grinding wrong answers should stop at one star",
  );
  assert.match(
    study.remaining.join("; "),
    /accuracy/,
    `the gap should name accuracy: ${study.remaining.join("; ")}`,
  );
}

// --- accuracy without the work must not earn them either ---------------
{
  const m = masteryOf(
    blank({ answered: 4, recentScores: [100, 100, 100, 100], hardCorrect: 9 }),
    KIT,
  );
  assert.equal(ladder(m, "study").stars, 0, "four answers is not a chapter");
}

// --- AN EARLY BAD RUN MUST NOT LOCK THE TOP STAR AWAY ------------------
{
  const scores = [...Array(12).fill(92), ...Array(50).fill(25)];
  const m = masteryOf(
    blank({ answered: 62, recentScores: scores, hardCorrect: 4 }),
    KIT,
  );
  assert.equal(
    ladder(m, "study").stars,
    3,
    "recent accuracy should recognise improvement, not average it away",
  );
}

// --- a star cannot be skipped -------------------------------------------
{
  // Third-star test score, but no test has been finished.
  const m = masteryOf(blank({ tests: 0, bestTestPercent: 95 }), KIT);
  assert.equal(
    ladder(m, "test").stars,
    0,
    "the first star is finishing one, so nothing above it can be earned",
  );
}

// --- practice test: the climb -------------------------------------------
{
  assert.equal(ladder(masteryOf(blank({ tests: 1, bestTestPercent: 40 }), KIT), "test").stars, 1);
  assert.equal(ladder(masteryOf(blank({ tests: 1, bestTestPercent: 72 }), KIT), "test").stars, 2);
  assert.equal(ladder(masteryOf(blank({ tests: 2, bestTestPercent: 88 }), KIT), "test").stars, 3);
}

// --- a kit with no flashcards is not stuck -----------------------------
{
  const m = masteryOf(
    blank({
      cards: 0,
      answered: 24,
      recentScores: Array(8).fill(95),
      hardCorrect: 5,
      tests: 2,
      bestTestPercent: 95,
    }),
    KIT,
  );
  const deck = ladder(m, "cards");
  assert.equal(deck.available, false, "an absent deck has no ladder to climb");
  assert.ok(deck.note, "and it should say why");
  assert.equal(m.total, 6, "so only six stars are on offer");
  assert.equal(m.stars, 6, "and the other two ladders are fully earned");
}

// --- bars never render past full ---------------------------------------
{
  const m = masteryOf(
    blank({
      cardsSeen: 500,
      cardsPassed: 500,
      answered: 999,
      recentScores: Array(30).fill(100),
      hardCorrect: 99,
      tests: 9,
      bestTestPercent: 100,
    }),
    KIT,
  );
  for (const l of m.ladders) {
    for (const tier of l.tiers) {
      for (const r of tier.requirements) {
        assert.ok(
          r.have <= r.need,
          `${l.feature} ${tier.stars}* ${r.label}: ${r.have} exceeds ${r.need}`,
        );
      }
    }
  }
  assert.equal(m.stars, 9, "everything earned");
}

// --- recentAccuracy ----------------------------------------------------
assert.equal(recentAccuracy([], 5), null, "no answers means no accuracy");
assert.equal(recentAccuracy([100, 0], 2), 50);
assert.equal(recentAccuracy([100, 100, 0, 0, 0], 2), 100, "newest only");
assert.equal(recentAccuracy([90], 10), 90, "a short history is used as-is");

console.log("Per-feature stars: all assertions passed");
