/**
 * How far through a kit you are, as three earned tiers.
 *
 * A kit is one chapter, so the tiers belong to the kit and never reset: the
 * work sits there until it is done. The point is to replace "two questions
 * felt like enough" with a requirement that does not move — and the
 * requirements are deliberately not pure volume, because a target you can
 * reach by grinding wrong answers is not a target. Each tier asks for the
 * work *and* for the accuracy that shows the work landed.
 *
 * Nothing here closes off at the top. Passing the last tier leaves the
 * counts running, and spaced repetition keeps handing cards back, so there
 * is always more to do rather than a finish line that ends the session.
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
  /**
   * Practice tests finished. The tiers judge the best score rather than the
   * count — one strong paper on a chapter is a fair signal, and asking for
   * several would be grind rather than evidence.
   */
  tests: number;
  /** Best practice test, as a percentage. */
  bestTestPercent: number | null;
}

export type Activity = "cards" | "questions" | "test";

export interface Requirement {
  activity: Activity;
  label: string;
  have: number;
  need: number;
  unit: "count" | "percent";
  met: boolean;
  /** Set when this tier asks nothing of this activity. */
  idle?: boolean;
}

export interface Tier {
  stars: number;
  name: string;
  blurb: string;
  requirements: Requirement[];
  met: boolean;
}

export interface Mastery {
  stars: number;
  tiers: Tier[];
  /** The tier being worked towards, or null once all three are earned. */
  next: Tier | null;
  /** What is still missing from the next tier, in words. */
  remaining: string[];
}

/*
 * How many questions a tier asks for, scaled to the size of the chapter.
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

const need = (
  activity: Activity,
  label: string,
  have: number,
  target: number,
  unit: Requirement["unit"] = "count",
): Requirement => ({
  activity,
  label,
  have: Math.min(have, target),
  need: target,
  unit,
  met: have >= target,
});

const idle = (activity: Activity, label: string): Requirement => ({
  activity,
  label,
  have: 0,
  need: 0,
  unit: "count",
  met: true,
  idle: true,
});

export function masteryOf(progress: KitProgress): Mastery {
  const {
    cards,
    cardsSeen,
    cardsPassed,
    answered,
    recentScores,
    hardCorrect,
    bestTestPercent,
  } = progress;

  const q = questionTarget(cards);
  const window = q;
  const accuracy = recentAccuracy(recentScores, window) ?? 0;
  const best = bestTestPercent ?? 0;

  /*
   * A kit with no flashcards is not stuck at nought stars. Smart Study works
   * without a deck, so an absent deck asks nothing rather than blocking every
   * tier forever.
   */
  const hasCards = cards > 0;
  const solidCards = Math.ceil(cards * 0.8);

  const tiers: Tier[] = [
    {
      stars: 1,
      name: "Covered",
      blurb: "You have been through the whole chapter once.",
      requirements: [
        hasCards
          ? need("cards", "Every card seen", cardsSeen, cards)
          : idle("cards", "No deck in this kit"),
        need("questions", "Questions answered", answered, q),
        idle("test", "Not needed yet"),
      ],
      met: false,
    },
    {
      stars: 2,
      name: "Solid",
      blurb: "You are getting it right, not just getting through it.",
      requirements: [
        hasCards
          ? need("cards", "Cards passed", cardsPassed, solidCards)
          : idle("cards", "No deck in this kit"),
        need("questions", "Questions answered", answered, q * 2),
        need("test", "Best test", best, 60, "percent"),
      ],
      met: false,
    },
    {
      stars: 3,
      name: "Exam ready",
      blurb: "You are getting it right when the questions get harder.",
      requirements: [
        hasCards
          ? need("cards", "Every card passed", cardsPassed, cards)
          : idle("cards", "No deck in this kit"),
        need("questions", "Questions answered", answered, q * 3),
        need("test", "Best test", best, 85, "percent"),
      ],
      met: false,
    },
  ];

  /*
   * Accuracy gates the upper two tiers, measured over recent answers rather
   * than all time. Judging a whole kit by a shaky start would mean an early
   * bad run locks the top tier away however well you are doing now, which
   * punishes exactly the improvement the tier is supposed to recognise.
   */
  tiers[1].requirements.splice(
    2,
    0,
    need("questions", "Recent accuracy", accuracy, 70, "percent"),
  );
  tiers[2].requirements.splice(
    2,
    0,
    need("questions", "Recent accuracy", accuracy, 85, "percent"),
    need("questions", "Right at difficulty 4+", hardCorrect, 3),
  );

  // A tier is earned only once every tier below it is.
  let earned = 0;
  for (const tier of tiers) {
    tier.met =
      tier.requirements.every((r) => r.met) && earned === tier.stars - 1;
    if (tier.met) earned = tier.stars;
  }

  const next = tiers.find((t) => !t.met) ?? null;

  return {
    stars: earned,
    tiers,
    next,
    remaining: next ? describeGap(next) : [],
  };
}

/** The outstanding requirements of a tier, phrased as things left to do. */
function describeGap(tier: Tier): string[] {
  return tier.requirements
    .filter((r) => !r.met && !r.idle)
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
        case "Best test":
          return r.have === 0
            ? `sit a practice test and score ${r.need}%`
            : `score ${r.need}% on a practice test (best so far ${r.have}%)`;
        default:
          return r.label.toLowerCase();
      }
    });
}
