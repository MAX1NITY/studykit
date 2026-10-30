import Link from "next/link";
import type { KitMastery, Ladder } from "@/lib/mastery";

/**
 * Each way of studying, with the three stars it has earned and the one plain
 * sentence of what the next star wants.
 *
 * The stars sit on the feature rather than on the kit because they are
 * different skills — recognising a flashcard is not answering cold, and
 * neither is sitting a timed paper — and because a shared ladder would let a
 * strong night on cards carry a feature that had not been opened.
 */

function Stars({ earned, dim }: { earned: number; dim?: boolean }) {
  return (
    <span
      className="inline-flex gap-0.5 text-[15px] leading-none"
      aria-label={`${earned} of 3 stars`}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className={
            i < earned
              ? dim
                ? "text-mute"
                : "text-brass"
              : "text-[var(--rule)]"
          }
        >
          {i < earned ? "★" : "☆"}
        </span>
      ))}
    </span>
  );
}

/** How far through the next star this ladder is, as a single fraction. */
function nextStarProgress(ladder: Ladder): number {
  if (!ladder.next) return 1;
  const parts = ladder.next.requirements.map((r) =>
    r.need > 0 ? Math.min(1, r.have / r.need) : 1,
  );
  return parts.reduce((n, p) => n + p, 0) / parts.length;
}

function FeatureRow({ ladder, blurb }: { ladder: Ladder; blurb: string }) {
  const pct = Math.round(nextStarProgress(ladder) * 100);

  return (
    <li className="border-b border-rule">
      <Link
        href={ladder.href}
        className="group block py-5"
        aria-label={`${ladder.name}, ${ladder.stars} of 3 stars`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="text-[16px] font-medium group-hover:underline group-hover:underline-offset-4">
            {ladder.name}
          </h2>
          {/* Only the stars: naming the tier here read as the state you were
              in rather than the one you were heading for, and the sentence
              underneath already says what it wants. */}
          <span className="flex shrink-0 items-baseline gap-2.5">
            {ladder.next ? null : (
              <span className="text-[13px] text-sure">all three</span>
            )}
            <Stars earned={ladder.stars} dim={!ladder.available} />
          </span>
        </div>

        <p className="mt-0.5 max-w-[52ch] text-[13.5px] leading-relaxed text-mute">
          {blurb}
        </p>

        {!ladder.available ? (
          <p className="mt-2 text-[13px] text-brass">{ladder.note}</p>
        ) : ladder.remaining.length > 0 ? (
          <>
            <p className="mt-2 max-w-[58ch] text-[13.5px] leading-relaxed">
              <span className="text-mute">Next star:</span>{" "}
              {sentence(ladder.remaining)}.
            </p>
            <div
              className="mt-2 h-[3px] w-full max-w-[58ch] overflow-hidden rounded-full bg-[var(--rule)]"
              role="presentation"
            >
              <div
                className="h-full rounded-full bg-ink"
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        ) : (
          <p className="mt-2 text-[13.5px] text-mute">
            Nothing left to earn here. Keep going as long as it is useful.
          </p>
        )}
      </Link>
    </li>
  );
}

const BLURBS: Record<string, string> = {
  study: "Typed or multiple choice, marked and explained. Gets harder as you get better.",
  cards: "Spaced repetition. Cards you miss come back sooner.",
  test: "Multiple choice, marked at the end like a real paper.",
};

export function KitProgress({
  mastery,
  guideHref,
  hasGuide,
}: {
  mastery: KitMastery;
  guideHref: string;
  hasGuide: boolean;
}) {
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule pb-2.5">
        <h2 className="text-[13px] text-mute">Where this chapter stands</h2>
        <span className="text-[13px] text-mute">
          <span className="text-brass">{"★"}</span> {mastery.stars} of{" "}
          {mastery.total} earned
        </span>
      </div>

      <ul>
        {mastery.ladders.map((ladder) => (
          <FeatureRow
            key={ladder.feature}
            ladder={ladder}
            blurb={BLURBS[ladder.feature]}
          />
        ))}

        {/* The guide is reading, not practice, so it earns nothing. */}
        <li className="border-b border-rule">
          <Link
            href={guideHref}
            className="group flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-5"
          >
            <div className="min-w-0 max-w-[52ch]">
              <h2 className="text-[16px] font-medium group-hover:underline group-hover:underline-offset-4">
                Revision guide
              </h2>
              <p className="mt-0.5 text-[13.5px] leading-relaxed text-mute">
                The material condensed, with the easily-confused pairs called
                out.
              </p>
            </div>
            <span
              className={`shrink-0 text-[13px] ${hasGuide ? "text-mute" : "text-brass"}`}
            >
              {hasGuide ? "Ready to read" : "Write it"}
            </span>
          </Link>
        </li>
      </ul>
    </section>
  );
}

/** "a, b and c" — the outstanding work as one readable line. */
function sentence(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
