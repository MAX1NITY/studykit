import { DOMAINS, EXAM, domainQuota } from "./core1.ts";

/**
 * What the pool should end up looking like.
 *
 * Mostly single-answer, because that is mostly what the exam is. The
 * performance-based shapes are a small slice on purpose: CompTIA says to
 * expect between two and five of them in 90 questions, so a pool stuffed
 * with them would make every mock unrepresentative.
 */
export const MIX: { kind: string; share: number }[] = [
  { kind: "single", share: 0.72 },
  { kind: "multiple", share: 0.18 },
  { kind: "ordering", share: 0.05 },
  { kind: "matching", share: 0.05 },
];

export interface PoolCount {
  domain: string;
  kind: string;
  count: number;
}

export interface PlanItem {
  domain: string;
  kind: string;
  count: number;
  /** Which slice of the material to read. Derived, so it keeps advancing. */
  rotation: number;
}

/** How many questions of each kind a domain wants, for `papers` papers. */
function targets(papers: number): Map<string, number> {
  const quota = domainQuota(EXAM.questions);
  const want = new Map<string, number>();
  for (const d of DOMAINS) {
    for (const { kind, share } of MIX) {
      want.set(`${d.id}:${kind}`, Math.max(1, Math.round(quota[d.id] * papers * share)));
    }
  }
  return want;
}

/** How many questions are still missing from the pool. */
export function planRemaining(counts: PoolCount[], papers: number): number {
  const have = new Map(counts.map((c) => [`${c.domain}:${c.kind}`, c.count]));
  let missing = 0;
  for (const [key, want] of targets(papers)) {
    missing += Math.max(0, want - (have.get(key) ?? 0));
  }
  return missing;
}

/**
 * The batches still to write, in the order to write them.
 *
 * Two properties matter more than they look.
 *
 * Rotation is derived from how many questions of that kind already exist
 * rather than counted within a run, so stopping and starting again carries on
 * through the material instead of re-reading the slices it has already used.
 *
 * And the order round-robins across domain and kind rather than finishing one
 * before starting the next. A run that gets interrupted — a closed tab, a
 * rate limit, a flat battery — then leaves a pool spread across the whole
 * syllabus rather than eighteen questions about troubleshooting and nothing
 * else. Within a round, whatever is furthest behind goes first.
 */
export function planBatches(
  counts: PoolCount[],
  papers: number,
  batchSize: number,
): PlanItem[] {
  const have = new Map(counts.map((c) => [`${c.domain}:${c.kind}`, c.count]));
  const want = targets(papers);

  // How many batches each domain-and-kind still needs, and where its material
  // rotation has reached.
  const pending: { key: string; left: number; rotation: number }[] = [];
  for (const [key, target] of want) {
    const already = have.get(key) ?? 0;
    const short = target - already;
    if (short > 0) {
      pending.push({
        key,
        left: Math.ceil(short / batchSize),
        rotation: Math.floor(already / batchSize),
      });
    }
  }

  const plan: PlanItem[] = [];
  let round = 0;

  while (pending.some((p) => p.left > 0)) {
    // Furthest behind first within each round.
    const ready = pending
      .filter((p) => p.left > 0)
      .sort((a, b) => b.left - a.left);

    for (const item of ready) {
      const [domain, kind] = item.key.split(":");
      const target = want.get(item.key) ?? 0;
      const already = have.get(item.key) ?? 0;
      const written = plan
        .filter((p) => `${p.domain}:${p.kind}` === item.key)
        .reduce((n, p) => n + p.count, 0);
      const outstanding = target - already - written;
      if (outstanding <= 0) {
        item.left = 0;
        continue;
      }

      plan.push({
        domain,
        kind,
        count: Math.min(batchSize, outstanding),
        rotation: item.rotation + round,
      });
      item.left -= 1;
    }

    round += 1;
    // Nothing should make this loop forever, but a plan is not worth hanging
    // a request over if the arithmetic above ever disagrees with itself.
    if (round > 200) break;
  }

  return plan;
}
