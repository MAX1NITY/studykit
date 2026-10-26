/**
 * SM-2 spaced repetition, the algorithm behind Anki and SuperMemo.
 *
 * Each review reports how well the card was recalled; the schedule stretches
 * for cards you know and collapses for cards you don't.
 */

export type Grade = "again" | "hard" | "good" | "easy";

/** SM-2 works on a 0-5 quality scale. These are the four buttons we show. */
const QUALITY: Record<Grade, number> = {
  again: 0,
  hard: 3,
  good: 4,
  easy: 5,
};

export const MIN_EASE = 1.3;

export interface CardSchedule {
  ease: number;
  interval_days: number;
  repetitions: number;
  lapses: number;
}

export interface NextSchedule extends CardSchedule {
  due_at: string;
  last_reviewed_at: string;
}

/** Applies one review to a card's schedule and returns the new one. */
export function review(
  card: CardSchedule,
  grade: Grade,
  now: Date = new Date(),
): NextSchedule {
  const q = QUALITY[grade];
  let { ease, interval_days: interval, repetitions, lapses } = card;

  // SM-2 ease update. A perfect answer nudges ease up, a poor one pulls it
  // down, and ease never falls below 1.3 or the card would never mature.
  ease = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (ease < MIN_EASE) ease = MIN_EASE;

  if (q < 3) {
    // Lapse: relearn from the start, due again in ten minutes.
    repetitions = 0;
    lapses += 1;
    interval = 0;
    return {
      ease,
      interval_days: 0,
      repetitions,
      lapses,
      due_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
      last_reviewed_at: now.toISOString(),
    };
  }

  if (repetitions === 0) {
    interval = 1;
  } else if (repetitions === 1) {
    interval = 6;
  } else {
    interval = interval * ease;
  }

  // "Hard" earns a shorter step than the ease alone would give.
  if (grade === "hard") interval = Math.max(1, interval * 0.6);

  repetitions += 1;
  interval = Math.round(interval * 100) / 100;

  return {
    ease: Math.round(ease * 1000) / 1000,
    interval_days: interval,
    repetitions,
    lapses,
    due_at: new Date(now.getTime() + interval * 86_400_000).toISOString(),
    last_reviewed_at: now.toISOString(),
  };
}

/** Human-readable preview of when each button would schedule the card. */
export function previewIntervals(card: CardSchedule): Record<Grade, string> {
  const out = {} as Record<Grade, string>;
  for (const grade of ["again", "hard", "good", "easy"] as Grade[]) {
    const next = review(card, grade);
    out[grade] = formatInterval(next.interval_days);
  }
  return out;
}

export function formatInterval(days: number): string {
  if (days <= 0) return "10m";
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
