import type { QuestionKind } from "./questions.ts";

/** What the student sent back, by question shape. */
export type Response =
  | { kind: "single" | "multiple"; picked: number[] }
  | { kind: "ordering"; order: number[] }
  | { kind: "matching"; assigned: (number | null)[] };

export interface Gradable {
  kind: QuestionKind;
  options?: string[] | null;
  answer_indexes?: number[] | null;
  steps?: string[] | null;
  pairs?: { left: string; right: string }[] | null;
}

export interface Mark {
  /** 0 to 100. Partial credit on every shape except single. */
  score: number;
  correct: boolean;
  /** Per-element verdict, for the review screen to mark up. */
  detail: boolean[];
}

const pct = (n: number, of: number) =>
  of <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((n / of) * 100)));

/**
 * Marks one answer.
 *
 * Select TWO/THREE and the two performance-based shapes award partial credit,
 * which is how CompTIA marks its own PBQs — getting three of four steps in
 * the right order is not the same as knowing nothing. Guarding against the
 * obvious exploit matters though: on a Select TWO, ticking every option must
 * not score, so wrong ticks are subtracted from right ones.
 */
export function grade(q: Gradable, response: Response | null): Mark {
  if (!response) return { score: 0, correct: false, detail: [] };

  if (q.kind === "single" || q.kind === "multiple") {
    if (response.kind !== "single" && response.kind !== "multiple") {
      return { score: 0, correct: false, detail: [] };
    }
    const answers = new Set(q.answer_indexes ?? []);
    const picked = new Set(response.picked ?? []);
    const detail = (q.options ?? []).map((_, i) => picked.has(i) === answers.has(i));

    if (q.kind === "single") {
      const right = picked.size === 1 && answers.has([...picked][0]!);
      return { score: right ? 100 : 0, correct: right, detail };
    }

    let hits = 0;
    let misfires = 0;
    for (const i of picked) {
      if (answers.has(i)) hits += 1;
      else misfires += 1;
    }
    const score = pct(hits - misfires, answers.size);
    return { score, correct: score === 100, detail };
  }

  if (q.kind === "ordering") {
    if (response.kind !== "ordering") return { score: 0, correct: false, detail: [] };
    // steps are stored in the correct order, so step i belongs at position i.
    const order = response.order ?? [];
    const steps = q.steps ?? [];
    const detail = steps.map((_, position) => order[position] === position);
    const placed = detail.filter(Boolean).length;
    const score = pct(placed, steps.length);
    return { score, correct: score === 100, detail };
  }

  if (q.kind === "matching") {
    if (response.kind !== "matching") return { score: 0, correct: false, detail: [] };
    const pairs = q.pairs ?? [];
    const assigned = response.assigned ?? [];
    // pairs[i].right is the right-hand value belonging to pairs[i].left, so a
    // left-hand item is right when it was given its own index. Duplicate
    // right-hand text is allowed and still marks correct, because two items
    // can legitimately share an answer.
    const detail = pairs.map((p, i) => {
      const chose = assigned[i];
      return chose != null && pairs[chose]?.right === p.right;
    });
    const score = pct(detail.filter(Boolean).length, pairs.length);
    return { score, correct: score === 100, detail };
  }

  return { score: 0, correct: false, detail: [] };
}
