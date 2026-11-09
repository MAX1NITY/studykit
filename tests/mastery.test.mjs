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
// The floor is the point: nobody learns a chapter in five questions, so a
// short deck must still ask for a real pass through the material.
assert.equal(questionTarget(8), 15, "a short chapter still asks for fifteen");
assert.equal(questionTarget(20), 15, "and so does a twenty-card one");
assert.equal(questionTarget(96), 24, "96 cards -> 24");
assert.equal(questionTarget(200), 30, "a very long chapter caps at 30");
assert.equal(questionTarget(0), 15, "a kit with no deck still asks for some");
assert.ok(
  questionTarget(20) >= 15,
  "no chapter should ever ask for fewer than fifteen",
);

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
      answered: 72,
      recentScores: Array(24).fill(92),
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
    blank({ answered: 24, recentScores: Array(24).fill(40) }),
    KIT,
  );
  assert.equal(ladder(one, "study").stars, 1, "turning up earns the first");

  const two = masteryOf(
    blank({ answered: 48, recentScores: Array(24).fill(75) }),
    KIT,
  );
  assert.equal(ladder(two, "study").stars, 2);

  const three = masteryOf(
    blank({ answered: 72, recentScores: Array(24).fill(90), hardCorrect: 3 }),
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

  const five = masteryOf(
    blank({ answered: 5, recentScores: Array(5).fill(100), hardCorrect: 9 }),
    KIT,
  );
  assert.equal(
    ladder(five, "study").stars,
    0,
    "five perfect answers is not learning a chapter either",
  );
}

// --- AN EARLY BAD RUN MUST NOT LOCK THE TOP STAR AWAY ------------------
{
  const scores = [...Array(40).fill(92), ...Array(60).fill(25)];
  const m = masteryOf(
    blank({ answered: 100, recentScores: scores, hardCorrect: 4 }),
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
      answered: 45,
      recentScores: Array(15).fill(95),
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
assert.equal(recentAccuracy([90], 10), 90, "one answer is itself");
assert.equal(recentAccuracy(Array(20).fill(100), 15), 100);
assert.equal(recentAccuracy(Array(20).fill(0), 15), 0);

// It leans on the newest answers: the same scores in the opposite order
// must not give the same figure.
{
  const improving = [100, 100, 100, 0, 0, 0];
  const declining = [0, 0, 0, 100, 100, 100];
  assert.ok(
    recentAccuracy(improving, 5) > recentAccuracy(declining, 5),
    "getting better should read higher than getting worse",
  );
}

// --- EVERY ANSWER MUST MOVE THE FIGURE ---------------------------------
// This is the bug this replaced. A trailing mean only rose when the answer
// dropping out of the window was wrong, so after a strong start a correct
// answer changed nothing at all: replayed against a real session it read
// 73 → 73 → 67 → 67, standing still on both of the correct answers.
{
  // That real session, newest first.
  const history = [100, 0, 100, 0, 100, 0, 100, 0, 100, 100, 100, 100, 100, 100, 0, 100, 100, 100];
  const now = recentAccuracy(history, 15);

  assert.ok(
    recentAccuracy([100, ...history], 15) > now,
    "a correct answer must raise it",
  );
  assert.ok(
    recentAccuracy([0, ...history], 15) < now,
    "a wrong answer must lower it",
  );

  // And it must keep moving, not just on the first one. Close to full
  // marks the steps fall below a whole percent and the displayed integer
  // repeats, which is fine — the fault being guarded against is a figure
  // that cannot move at all through the middle of the range.
  let scores = history;
  let previous = now;
  for (let i = 0; i < 12; i += 1) {
    scores = [100, ...scores];
    const next = recentAccuracy(scores, 15);
    assert.ok(next >= previous, `a correct answer lowered it: ${previous} -> ${next}`);
    if (previous < 90) {
      assert.ok(
        next > previous,
        `answer ${i + 1} of a correct run did not move it: ${previous} -> ${next}`,
      );
    }
    previous = next;
  }
  assert.ok(previous > 90, `a long correct run should approach full marks, got ${previous}`);
}

// A bad run has to be recoverable, and recognisably so.
{
  const rough = Array(60).fill(25);
  const recovered = [...Array(30).fill(100), ...rough];
  const weighted = recentAccuracy(recovered, 24);
  const allTime = Math.round(recovered.reduce((a, b) => a + b, 0) / recovered.length);
  assert.ok(
    weighted > allTime + 40,
    `improvement should show strongly: weighted ${weighted} vs all-time ${allTime}`,
  );
}

console.log("Per-feature stars: all assertions passed");
