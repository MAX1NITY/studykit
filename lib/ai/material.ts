/**
 * Choosing which part of a student's material to read.
 *
 * Uploads are routinely longer than a model can read in one request, so every
 * generator reads a slice at a time. Getting this wrong is quiet and harmful:
 * the student gets cards or a guide for the opening fifth of their notes with
 * nothing to say the rest was skipped, which is worse than having none at all
 * because it looks finished.
 */

export interface SourceLike {
  name: string;
  content: string;
}

/**
 * How much material each kind of request reads at once. A single question
 * needs far less context than a whole study guide, and a smaller slice is
 * both faster and cheaper, so these are deliberately different.
 */
export const BUDGETS = {
  question: 8_000,
  cards: 20_000,
  test: 20_000,
  guide: 30_000,
} as const;

/** How many slices it takes to cover everything at this budget. */
export function partCount(sources: SourceLike[], budget: number): number {
  const total = sources.reduce((n, s) => n + s.content.trim().length, 0);
  return Math.max(1, Math.ceil(total / budget));
}

function join(sources: SourceLike[]): string {
  return sources
    .map((s) => `### ${s.name}\n${s.content.trim()}`)
    .join("\n\n");
}

/**
 * Returns one slice of the material, labelled so the model knows it is
 * reading a part rather than the whole.
 *
 * `offset` is in characters and is interpreted as "which part", so callers can
 * pass `part * budget` to walk the document, or an ever-growing rotation
 * counter to keep varying what gets read. Offsets past the end wrap round to
 * the beginning rather than returning nothing.
 *
 * The final part is pinned to the end of the document, so the tail is always
 * reachable. That makes the last two parts overlap a little, which is the
 * right trade: a repeated paragraph is harmless, an unread one is not.
 */
export function selectMaterial(
  sources: SourceLike[],
  budget: number = BUDGETS.cards,
  offset = 0,
): string {
  const joined = join(sources);
  if (joined.length <= budget) return joined;

  const parts = Math.ceil(joined.length / budget);
  const index = Math.floor(Math.max(offset, 0) / budget) % parts;
  const start = Math.min(index * budget, joined.length - budget);

  // Prefer starting at a paragraph break so the slice doesn't open mid-sentence,
  // but only if one is close by — never skip far enough to lose material.
  const breakAt = joined.indexOf("\n\n", start);
  const from =
    breakAt !== -1 && breakAt - start < 500 && start > 0 ? breakAt + 2 : start;

  return `(This is part ${index + 1} of ${parts} of the student's material. Work only from what is here.)\n\n${joined.slice(from, from + budget)}`;
}
