/**
 * Three stars on each way of studying, earned separately.
 *
 * Smart Study, flashcards and practice tests each have their own ladder,
 * because they are different skills and being good at one says little about
 * the others: recognising a card is not the same as answering cold, and
 * neither is the same as sitting a timed paper. One shared ladder would also
 * let a strong night on cards carry a feature you had not opened.
 *
 * A kit is one chapter, so the stars belong to the kit and never reset — the
 * work sits there until it is done. The requirements are deliberately not
 * pure volume, because a target you can reach by grinding wrong answers is
 * not a target: the upper stars ask for the work *and* for the accuracy that
 * shows the work landed.
 *
 * Nothing closes off at the top. Past the third star the counts keep running
 * and spaced repetition keeps handing cards back, so there is always more to
 * do rather than a finish line that ends the session.
 */

export interface KitProgress {
  /** Flashcards in the kit. */
  cards: number;
  /** Cards reviewed at least once. */
  cardsSeen: number;
  /** Cards currently in good standing: passed, and not failed since. */
  cardsPassed: number;
  /** Smart Study questions answered. */
  answered: number;
  /** Scores of recent answers, newest first. */
  recentScores: number[];
  /** Answers scoring 70+ on questions at difficulty 4 or 5. */
  hardCorrect: number;
  /** Practice tests finished. */
  tests: number;
  /** Best practice test, as a percentage. */
  bestTestPercent: number | null;
}

export type Feature = "study" | "cards" | "test";

export interface Requirement {
  label: string;
  have: number;
  need: number;
  unit: "count" | "percent";
  met: boolean;
}

export interface Tier {
  stars: number;
  name: string;
  requirements: Requirement[];
  met: boolean;
}

export interface Ladder {
  feature: Feature;
  name: string;
  href: string;
  stars: number;
  tiers: Tier[];
  /** The tier being worked towards, or null once all three are earned. */
  next: Tier | null;
  /** What is still missing from the next tier, in words. */
  remaining: string[];
  /** False when the kit has nothing for this feature to work on. */
  available: boolean;
  /** Why it is unavailable, when it is. */
  note?: string;
}

export interface KitMastery {
  ladders: Ladder[];
  /** Stars earned across every available ladder. */
  stars: number;
  /** Stars on offer: three per available ladder. */
  total: number;
}

/*
 * How many questions a star asks for, scaled to the size of the chapter.
 *
 * A fixed number would be trivial on a long chapter and punishing on a short
 * one. The range keeps it inside what a single sitting can absorb, since a
 * kit is a chapter and a chapter is usually one evening.
 */
export function questionTarget(cards: number): number {
  const scaled = cards > 0 ? Math.round(cards / 8) : 8;
  return Math.min(Math.max(scaled, 5), 12);
}

/** Accuracy over the most recent answers, or null if there are none. */
export function recentAccuracy(
  scores: number[],
  window: number,
): number | null {
  const recent = scores.slice(0, Math.max(window, 1));
  if (recent.length === 0) return null;
  return Math.round(recent.reduce((n, s) => n + s, 0) / recent.length);
}

const req = (
  label: string,
  have: number,
  need: number,
  unit: Requirement["unit"] = "count",
): Requirement => ({
  label,
  have: Math.min(have, need),
  need,
  unit,
  met: have >= need,
});

/** Marks each tier earned only once every tier below it is. */
function settle(tiers: Tier[]): number {
  let earned = 0;
  for (const tier of tiers) {
    tier.met =
      tier.requirements.every((r) => r.met) && earned === tier.stars - 1;
    if (tier.met) earned = tier.stars;
  }
  return earned;
}

function build(
  feature: Feature,
  name: string,
  href: string,
  tiers: Tier[],
  unavailable?: string,
): Ladder {
  if (unavailable) {
    return {
      feature,
      name,
      href,
      stars: 0,
      tiers,
      next: null,
      remaining: [],
      available: false,
      note: unavailable,
    };
  }

  const stars = settle(tiers);
  const next = tiers.find((t) => !t.met) ?? null;

  return {
    feature,
    name,
    href,
    stars,
    tiers,
    next,
    remaining: next ? describeGap(next) : [],
    available: true,
  };
}

export function masteryOf(progress: KitProgress, kitId: string): KitMastery {
  const {
    cards,
    cardsSeen,
    cardsPassed,
    answered,
    recentScores,
    hardCorrect,
    tests,
    bestTestPercent,
  } = progress;

  const q = questionTarget(cards);
  const accuracy = recentAccuracy(recentScores, q) ?? 0;
  const best = bestTestPercent ?? 0;

  /*
   * Smart Study.
   *
   * The first star is just turning up: answer the questions. The second and
   * third ask for accuracy too, and the third for answers right at the top of
   * the difficulty range — which the difficulty picker only serves once you
   * are sustaining 80%, so it cannot be ground out on easy questions.
   */
  const study = build("study", "Smart Study", `/kits/${kitId}/study`, [
    {
      stars: 1,
      name: "Answered",
      requirements: [req("Questions answered", answered, q)],
      met: false,
    },
    {
      stars: 2,
      name: "Getting them right",
      requirements: [
        req("Questions answered", answered, q * 2),
        req("Recent accuracy", accuracy, 70, "percent"),
      ],
      met: false,
    },
    {
      stars: 3,
      name: "Right when it is hard",
      requirements: [
        req("Questions answered", answered, q * 3),
        req("Recent accuracy", accuracy, 85, "percent"),
        req("Right at difficulty 4+", hardCorrect, 3),
      ],
      met: false,
    },
  ]);

  /*
   * Flashcards.
   *
   * A lapse resets repetitions to 0, so "passed" means passed and not failed
   * since — which is why the third star is reachable in a sitting without
   * waiting days for intervals to mature, but still means nothing is
   * currently broken.
   */
  const deck = build(
    "cards",
    "Flashcards",
    `/kits/${kitId}/cards`,
    [
      {
        stars: 1,
        name: "Seen",
        requirements: [req("Every card seen", cardsSeen, Math.max(cards, 1))],
        met: false,
      },
      {
        stars: 2,
        name: "Mostly sticking",
        requirements: [
          req("Cards passed", cardsPassed, Math.max(Math.ceil(cards * 0.8), 1)),
        ],
        met: false,
      },
      {
        stars: 3,
        name: "All of it sticking",
        requirements: [
          req("Every card passed", cardsPassed, Math.max(cards, 1)),
        ],
        met: false,
      },
    ],
    cards === 0 ? "This kit has no deck yet." : undefined,
  );

  /*
   * Practice tests.
   *
   * Judged on the best paper rather than the count: one strong paper on a
   * chapter is fair evidence, and asking for several would be grind.
   */
  const paper = build("test", "Practice test", `/kits/${kitId}/test`, [
    {
      stars: 1,
      name: "Sat one",
      requirements: [req("Tests finished", tests, 1)],
      met: false,
    },
    {
      stars: 2,
      name: "Passing",
      requirements: [req("Best test", best, 70, "percent")],
      met: false,
    },
    {
      stars: 3,
      name: "Comfortably",
      requirements: [req("Best test", best, 85, "percent")],
      met: false,
    },
  ]);

  const ladders = [study, deck, paper];
  const available = ladders.filter((l) => l.available);

  return {
    ladders,
    stars: available.reduce((n, l) => n + l.stars, 0),
    total: available.length * 3,
  };
}

/** The outstanding requirements of a tier, phrased as things left to do. */
function describeGap(tier: Tier): string[] {
  return tier.requirements
    .filter((r) => !r.met)
    .map((r) => {
      const short = r.need - r.have;
      switch (r.label) {
        case "Every card seen":
          return `see ${short} more card${short === 1 ? "" : "s"}`;
        case "Cards passed":
        case "Every card passed":
          return `pass ${short} more card${short === 1 ? "" : "s"}`;
        case "Questions answered":
          return `answer ${short} more question${short === 1 ? "" : "s"}`;
        case "Recent accuracy":
          return `lift your recent accuracy to ${r.need}% (now ${r.have}%)`;
        case "Right at difficulty 4+":
          return `get ${short} more right at difficulty 4 or 5`;
        case "Tests finished":
          return `sit a practice test`;
        case "Best test":
          return r.have === 0
            ? `sit a practice test and score ${r.need}%`
            : `score ${r.need}% on a practice test (best so far ${r.have}%)`;
        default:
          return r.label.toLowerCase();
      }
    });
}
