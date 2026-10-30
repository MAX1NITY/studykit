/**
 * The tier rules.
 *
 * The whole point of these tiers is to replace "two questions felt like
 * enough" with a requirement that does not move. So the properties worth
 * protecting are the ones that would quietly make a tier meaningless:
 * reaching it by volume alone, reaching it out of order, or being locked out
 * of it permanently by an early bad run.
 */
import assert from "node:assert/strict";

const { masteryOf, questionTarget, recentAccuracy } = await import(
  "../lib/mastery.ts"
);

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

// --- targets scale with the chapter ---------------------------------------
assert.equal(questionTarget(96), 12, "a long chapter caps at 12");
assert.equal(questionTarget(8), 5, "a short chapter floors at 5");
assert.equal(questionTarget(40), 5, "40 cards -> 5");
assert.equal(questionTarget(80), 10, "80 cards -> 10");
assert.equal(questionTarget(0), 8, "a kit with no deck still asks for some");

// --- nothing done means nothing earned ------------------------------------
{
  const m = masteryOf(blank());
  assert.equal(m.stars, 0);
  assert.equal(m.next.stars, 1);
  assert.ok(m.remaining.length > 0, "it should say what is missing");
  assert.match(m.remaining.join("; "), /card/, `got: ${m.remaining.join("; ")}`);
}

// --- the first tier is reachable by doing the work ------------------------
{
  const m = masteryOf(blank({ cardsSeen: 96, answered: 12, recentScores: Array(12).fill(50) }));
  assert.equal(m.stars, 1, `expected one star, got ${m.stars}`);
  assert.equal(m.next.stars, 2);
}

// --- VOLUME ALONE MUST NOT EARN THE UPPER TIERS --------------------------
// Everything answered, every card touched, but answers are mostly wrong.
{
  const m = masteryOf(
    blank({
      cardsSeen: 96,
      cardsPassed: 96,
      answered: 500,
      recentScores: Array(60).fill(20),
      hardCorrect: 0,
      tests: 4,
      bestTestPercent: 30,
    }),
  );
  assert.equal(
    m.stars,
    1,
    "grinding wrong answers should stop at one star, not buy the rest",
  );
  const gap = m.remaining.join("; ");
  assert.match(gap, /accuracy/, `the gap should name accuracy: ${gap}`);
}

// --- a tier cannot be skipped --------------------------------------------
// Third-tier numbers but the first tier's cards were never seen.
{
  const m = masteryOf(
    blank({
      cardsSeen: 0,
      cardsPassed: 0,
      answered: 200,
      recentScores: Array(40).fill(95),
      hardCorrect: 20,
      tests: 3,
      bestTestPercent: 95,
    }),
  );
  assert.equal(m.stars, 0, "the deck is untouched, so no tier is earned");
  assert.equal(m.next.stars, 1);
}

// --- the full climb ------------------------------------------------------
{
  const solid = masteryOf(
    blank({
      cardsSeen: 96,
      cardsPassed: 77, // 80% of 96
      answered: 24,
      recentScores: Array(12).fill(75),
      tests: 1,
      bestTestPercent: 70,
    }),
  );
  assert.equal(solid.stars, 2, `expected two stars, got ${solid.stars}`);

  const ready = masteryOf(
    blank({
      cardsSeen: 96,
      cardsPassed: 96,
      answered: 36,
      recentScores: Array(12).fill(90),
      hardCorrect: 3,
      tests: 2,
      bestTestPercent: 88,
    }),
  );
  assert.equal(ready.stars, 3, `expected three stars, got ${ready.stars}`);
  assert.equal(ready.next, null, "nothing left to work towards");
  assert.deepEqual(ready.remaining, []);
}

// --- AN EARLY BAD RUN MUST NOT LOCK THE TOP TIER AWAY -------------------
// Fifty poor answers, then twelve good ones. Recent accuracy is what counts,
// so improving has to be enough.
{
  const scores = [...Array(12).fill(92), ...Array(50).fill(25)];
  const m = masteryOf(
    blank({
      cardsSeen: 96,
      cardsPassed: 96,
      answered: 62,
      recentScores: scores,
      hardCorrect: 4,
      tests: 2,
      bestTestPercent: 90,
    }),
  );
  assert.equal(
    m.stars,
    3,
    "recent accuracy should recognise improvement, not average it away",
  );
}

// --- a kit with no flashcards is not stuck ------------------------------
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
  );
  assert.equal(m.stars, 3, "no deck should ask nothing, not block everything");
  const cardRows = m.tiers.flatMap((t) =>
    t.requirements.filter((r) => r.activity === "cards"),
  );
  assert.ok(cardRows.every((r) => r.idle), "card rows should be marked idle");
}

// --- each tier keeps its three activities separate ---------------------
{
  const m = masteryOf(blank());
  for (const tier of m.tiers) {
    const kinds = new Set(tier.requirements.map((r) => r.activity));
    assert.ok(kinds.has("cards"), `tier ${tier.stars} has no card requirement`);
    assert.ok(kinds.has("questions"), `tier ${tier.stars} has no question requirement`);
    assert.ok(kinds.has("test"), `tier ${tier.stars} has no test requirement`);
  }
}

// --- bars never render past full --------------------------------------
{
  const m = masteryOf(
    blank({ cardsSeen: 500, cardsPassed: 500, answered: 999, recentScores: Array(30).fill(100), hardCorrect: 99, tests: 9, bestTestPercent: 100 }),
  );
  for (const tier of m.tiers) {
    for (const r of tier.requirements) {
      assert.ok(
        r.have <= r.need,
        `${tier.stars}* ${r.label}: have ${r.have} exceeds need ${r.need}`,
      );
    }
  }
  assert.equal(m.stars, 3);
}

// --- recentAccuracy -----------------------------------------------------
assert.equal(recentAccuracy([], 5), null, "no answers means no accuracy");
assert.equal(recentAccuracy([100, 0], 2), 50);
assert.equal(recentAccuracy([100, 100, 0, 0, 0], 2), 100, "it looks at the newest only");
assert.equal(recentAccuracy([90], 10), 90, "a short history is used as-is");

console.log("Kit tiers: all assertions passed");
