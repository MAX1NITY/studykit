/**
 * Choosing and shaping Core 1 questions.
 *
 * Deliberately free of database and server-only imports: these are the rules
 * that decide what gets asked and whether two questions are the same one, and
 * rules like that are worth testing directly rather than through a route.
 */
import { DOMAINS, OBJECTIVE_IDS, domainQuota, EXAM } from "./core1.ts";
import { partCount, type SourceLike } from "../ai/material.ts";

/**
 * The CompTIA header a chapter of real course material carries, e.g.
 *
 *   THE FOLLOWING COMPTIA A+ 220-1201 EXAM OBJECTIVES ARE COVERED:
 *     4.0 Virtualization and Cloud Computing
 *     4.1 Explain virtualization concepts.
 *
 * Reading it costs nothing and is right by construction, so it is tried
 * before asking a model to classify anything. Only ids on the official list
 * are accepted, so a stray "1.9" in body text cannot invent an objective.
 */
export function declaredObjectives(content: string): {
  domain: string;
  objectives: string[];
} {
  const head = content.slice(0, 4_000);
  const ids = [...head.matchAll(/(?:^|[\s✓|*-])(\d\.\d)(?=[\s.):|]|$)/gm)].map(
    (m) => m[1],
  );

  const objectives: string[] = [];
  const domains: string[] = [];
  for (const id of ids) {
    if (id.endsWith(".0")) {
      if (DOMAINS.some((d) => d.id === id) && !domains.includes(id)) domains.push(id);
    } else if (OBJECTIVE_IDS.has(id) && !objectives.includes(id)) {
      objectives.push(id);
    }
  }

  // A chapter can touch two domains; the one it declares most objectives for
  // is the one it belongs to.
  const byDomain = new Map<string, number>();
  for (const o of objectives) {
    const d = `${o[0]}.0`;
    byDomain.set(d, (byDomain.get(d) ?? 0) + 1);
  }
  const leader = [...byDomain.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return { domain: leader ?? domains[0] ?? "", objectives };
}

const FILLER = new Set([
  "which", "that", "this", "these", "those", "what", "would", "should", "could",
  "best", "most", "first", "next", "technician", "company", "user", "following",
  "being", "have", "been", "with", "from", "they", "their", "there", "when",
  "after", "before", "about", "into", "also", "than", "then", "them",
]);

/**
 * A stable id for "this question, said this way".
 *
 * Generation runs over overlapping slices of the same chapter, so without
 * this the pool fills with the same question reworded. Normalising away case,
 * punctuation, word order and filler catches the restatements that differ
 * only in phrasing; it will not catch a genuinely different wording of the
 * same idea, which is what the recent-stems list in the prompt is for.
 *
 * Two independent 32-bit passes rather than a crypto hash, so this module
 * stays importable from anywhere. Sixty-four bits is far more than a pool of
 * a few thousand questions needs.
 */
export function fingerprint(stem: string): string {
  const normal = stem
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    // Numbers are kept whatever their length: "a 2TB drive" and "a 4TB
    // drive" are different questions, and dropping short tokens would have
    // called them the same one.
    .filter((w) => (/\d/.test(w) || w.length > 3) && !FILLER.has(w))
    .sort()
    .join(" ");

  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < normal.length; i += 1) {
    const c = normal.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b + c, 0x85ebca6b) >>> 0;
    b = ((b << 13) | (b >>> 19)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

export interface Pickable {
  id: string;
  domain: string;
  kind: string;
}

/**
 * Chooses the questions for one mock exam.
 *
 * Domain counts come straight from the published weights, so a sitting is
 * shaped like the real paper rather than like whatever happens to be in the
 * pool. Performance-based shapes are capped at five across the whole paper,
 * which is what CompTIA says to expect; the rest is single-answer with some
 * Select TWO.
 *
 * Ordinary questions are placed first and the performance-based ones are
 * added into the remaining room. Taking questions as they came would spend
 * the five-question budget on the first domain drawn and then refuse the
 * paper for want of single-answer questions in the last one, which is a
 * refusal the pool did not deserve.
 *
 * A pool genuinely too thin for a domain is reported in `shortfall` rather
 * than quietly producing an 80-question paper that looks complete.
 */
export function composeSitting<T extends Pickable>(
  pool: T[],
  total = EXAM.questions,
): { ids: string[]; shortfall: Record<string, number> } {
  const quota = domainQuota(total);
  const shortfall: Record<string, number> = {};
  const picked: T[] = [];

  const isPbq = (q: T) => q.kind === "ordering" || q.kind === "matching";

  const plain = new Map<string, T[]>();
  const pbq = new Map<string, T[]>();
  for (const q of pool) {
    const bucket = isPbq(q) ? pbq : plain;
    if (!bucket.has(q.domain)) bucket.set(q.domain, []);
    bucket.get(q.domain)!.push(q);
  }

  const PBQ_CAP = 5;
  // Spread the performance-based questions over the domains that have any,
  // rather than putting all five in whichever one is drawn first.
  const withPbq = shuffle(
    Object.keys(quota).filter((d) => (pbq.get(d) ?? []).length > 0),
  );
  const allowance = new Map<string, number>();
  for (let i = 0; i < PBQ_CAP && withPbq.length; i += 1) {
    const d = withPbq[i % withPbq.length];
    allowance.set(d, (allowance.get(d) ?? 0) + 1);
  }

  for (const [domainId, want] of Object.entries(quota)) {
    const ordinary = shuffle(plain.get(domainId) ?? []);
    const performance = shuffle(pbq.get(domainId) ?? []);

    const take: T[] = [];
    // Never let the performance-based shapes crowd out the paper: at most
    // its allowance, and never more than a third of a small domain's quota.
    const room = Math.min(
      allowance.get(domainId) ?? 0,
      performance.length,
      Math.max(1, Math.floor(want / 3)),
    );
    take.push(...performance.slice(0, room));
    take.push(...ordinary.slice(0, Math.max(0, want - take.length)));

    // Still short on ordinary questions: rather than refuse the paper, use
    // more of what there is.
    if (take.length < want) {
      take.push(...performance.slice(room, room + (want - take.length)));
    }

    if (take.length < want) shortfall[domainId] = want - take.length;
    picked.push(...take);
  }

  return { ids: shuffle(picked).map((q) => q.id), shortfall };
}

export function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Deterministic display order for a question's steps or matching options.
 *
 * An ordering question stores its steps in the correct order, so it must be
 * shuffled before it is shown — and shuffled the same way every time it
 * loads, or a reload would rearrange a half-answered question underneath the
 * student.
 */
export function displayOrder(seed: string, length: number): number[] {
  const order = Array.from({ length }, (_, i) => i);
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  }
  for (let i = order.length - 1; i > 0; i -= 1) {
    // >>> 0 matters: Math.imul is signed, and a negative h here indexes
    // order[-1], which drops a step out of the permutation.
    h = (Math.imul(h, 48271) + 11) >>> 0;
    const j = h % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// ------------------------------------------------- showing and reading back

/** A question as the student sees it: the answers are not in here. */
export interface Presented {
  id: string;
  kind: string;
  domain: string;
  objective: string;
  stem: string;
  /** single and multiple: the options, shuffled. */
  options?: string[];
  /** How many options to tick, for a Select TWO/THREE. */
  pick?: number;
  /** ordering: the steps, shuffled out of their correct order. */
  steps?: string[];
  /** matching: the fixed left-hand items and the shuffled values to assign. */
  lefts?: string[];
  rights?: string[];
}

export interface Answerable {
  id: string;
  kind: string;
  domain: string;
  objective: string;
  stem: string;
  options?: string[] | null;
  answer_indexes?: number[] | null;
  steps?: string[] | null;
  pairs?: { left: string; right: string }[] | null;
}

/**
 * Strips a question down to what the student may see.
 *
 * Everything is shuffled on the way out, deterministically from the question
 * id. That matters twice over: an ordering question is stored in its correct
 * order and would otherwise be answered by touching nothing, and the shuffle
 * has to survive a reload or a half-answered question would rearrange itself
 * under the student's hands.
 */
export function present(q: Answerable): Presented {
  const out: Presented = {
    id: q.id,
    kind: q.kind,
    domain: q.domain,
    objective: q.objective,
    stem: q.stem,
  };

  if (q.kind === "single" || q.kind === "multiple") {
    const options = q.options ?? [];
    const order = displayOrder(q.id, options.length);
    out.options = order.map((i) => options[i]);
    out.pick = (q.answer_indexes ?? []).length || 1;
    return out;
  }

  if (q.kind === "ordering") {
    const steps = q.steps ?? [];
    out.steps = displayOrder(q.id, steps.length).map((i) => steps[i]);
    return out;
  }

  if (q.kind === "matching") {
    const pairs = q.pairs ?? [];
    out.lefts = pairs.map((p) => p.left);
    out.rights = displayOrder(`${q.id}:right`, pairs.length).map((i) => pairs[i].right);
    return out;
  }

  return out;
}

/** What the client sends back, in terms of what it was shown. */
export type Submitted =
  /** Indexes into the shuffled options. */
  | { picked: number[] }
  /** The shuffled steps, in the order the student arranged them. */
  | { arranged: number[] }
  /** For each left-hand item, which shuffled right-hand value was chosen. */
  | { chose: (number | null)[] };

/**
 * Translates a submission back into the question's own indexes, so marking
 * compares like with like.
 *
 * The shuffle is recomputed here rather than sent to the client: handing over
 * the mapping for an ordering question would hand over the answer.
 */
export function interpret(
  q: Answerable,
  submitted: Submitted | null,
): import("./grade.ts").Response | null {
  if (!submitted) return null;

  if (q.kind === "single" || q.kind === "multiple") {
    if (!("picked" in submitted)) return null;
    const order = displayOrder(q.id, (q.options ?? []).length);
    const picked = (submitted.picked ?? [])
      .filter((i) => i >= 0 && i < order.length)
      .map((i) => order[i]);
    return { kind: q.kind, picked };
  }

  if (q.kind === "ordering") {
    if (!("arranged" in submitted)) return null;
    const order = displayOrder(q.id, (q.steps ?? []).length);
    // arranged[position] is which shown step was put there; order maps a
    // shown step back to its stored index, and a stored step belongs at the
    // position matching its index.
    const back = (submitted.arranged ?? []).map((shown) =>
      shown >= 0 && shown < order.length ? order[shown] : -1,
    );
    return { kind: "ordering", order: back };
  }

  if (q.kind === "matching") {
    if (!("chose" in submitted)) return null;
    const order = displayOrder(`${q.id}:right`, (q.pairs ?? []).length);
    const assigned = (submitted.chose ?? []).map((shown) =>
      shown != null && shown >= 0 && shown < order.length ? order[shown] : null,
    );
    return { kind: "matching", assigned };
  }

  return null;
}

/**
 * Re-orders marking detail into the order the student saw.
 *
 * `grade` works in the question's own indexes, but options are shuffled on
 * the way out, so handing its detail array straight to the UI would tick and
 * cross the wrong rows. Ordering and matching need no translation: ordering
 * detail is already indexed by position on screen, and matching's left-hand
 * items are presented unshuffled.
 */
export function detailForDisplay(q: Answerable, detail: boolean[]): boolean[] {
  if (q.kind !== "single" && q.kind !== "multiple") return detail;
  const order = displayOrder(q.id, (q.options ?? []).length);
  return order.map((stored) => detail[stored] ?? false);
}

/** How much material one batch of questions reads. A scenario's worth. */
export const QUESTION_BUDGET = 9_000;

/** Successive slices land about this far apart, as a fraction of the whole. */
const GOLDEN = 0.6180339887498949;

/**
 * Which slice of the material a batch of questions reads.
 *
 * Walking the document a slice at a time looks right and is not: a domain's
 * chapters run to sixty-odd slices, while filling one paper takes four or
 * five batches, so sequential offsets would write every networking question
 * out of the opening pages of chapter six and never open the rest.
 *
 * Stepping by the golden ratio puts consecutive batches at opposite ends of
 * the material and still reaches all of it as the pool grows. The same
 * mistake, made once before on flashcards, left the last seventh of every
 * upload unread — and it is invisible from outside, because what comes back
 * looks like perfectly good questions either way.
 */
export function materialSlice(sources: SourceLike[], rotation: number): number {
  const parts = partCount(sources, QUESTION_BUDGET);
  if (parts <= 1) return 0;
  return Math.floor(((rotation ?? 0) * parts * GOLDEN) % parts);
}
