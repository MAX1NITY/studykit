import type { Ladder } from "@/lib/mastery";

/**
 * One feature's stars, compact enough to sit on the screen you are working
 * on rather than the one you came from.
 *
 * Progress you can only see by leaving is not progress you can act on: the
 * whole point of a target is that it is in front of you while you decide
 * whether to answer one more.
 */
export function StarStrip({ ladder }: { ladder: Ladder }) {
  const next = ladder.next;

  // How far through the next star this is, across all of its requirements.
  const pct = next
    ? Math.round(
        (next.requirements.reduce(
          (n, r) => n + (r.need > 0 ? Math.min(1, r.have / r.need) : 1),
          0,
        ) /
          next.requirements.length) *
          100,
      )
    : 100;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
      <span
        className="inline-flex shrink-0 gap-0.5 text-[14px] leading-none"
        aria-label={`${ladder.stars} of 3 stars on ${ladder.name}`}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden
            className={i < ladder.stars ? "text-brass" : "text-[var(--rule)]"}
          >
            {i < ladder.stars ? "★" : "☆"}
          </span>
        ))}
      </span>

      {next ? (
        <>
          <span className="min-w-0 flex-1 text-mute">
            {ladder.remaining.length > 0
              ? capitalise(joinWords(ladder.remaining))
              : "Nearly there"}
          </span>
          <span
            className="h-[3px] w-20 shrink-0 overflow-hidden rounded-full bg-[var(--rule)]"
            role="presentation"
          >
            <span
              className="block h-full rounded-full bg-ink"
              style={{ width: `${pct}%` }}
            />
          </span>
        </>
      ) : (
        <span className="text-sure">
          All three earned — keep going as long as it helps.
        </span>
      )}
    </div>
  );
}

function joinWords(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
