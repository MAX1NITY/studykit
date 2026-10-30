import type { Mastery, Requirement, Tier } from "@/lib/mastery";

/**
 * The three tiers of a kit, and what is still owed on the next one.
 *
 * The earned tiers collapse to a line and the one being worked towards is
 * open, because the useful question is not "how have I done" but "what does
 * this chapter still want from me". Each tier keeps flashcards, questions and
 * practice tests on separate rows, so the work cannot be met by leaning
 * entirely on whichever one feels easiest.
 */

const ACTIVITY_LABEL: Record<Requirement["activity"], string> = {
  cards: "Flashcards",
  questions: "Smart Study",
  test: "Practice test",
};

function Stars({ earned, total = 3 }: { earned: number; total?: number }) {
  return (
    <span
      className="inline-flex gap-0.5 text-[15px] leading-none"
      aria-label={`${earned} of ${total} tiers earned`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={i < earned ? "text-brass" : "text-[var(--rule)]"}
        >
          {i < earned ? "★" : "☆"}
        </span>
      ))}
    </span>
  );
}

function Bar({ have, need }: { have: number; need: number }) {
  const pct = need > 0 ? Math.min(100, Math.round((have / need) * 100)) : 100;
  return (
    <div
      className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-[var(--rule)]"
      role="presentation"
    >
      <div
        className={`h-full rounded-full ${pct >= 100 ? "bg-sure" : "bg-ink"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function RequirementRow({ requirement }: { requirement: Requirement }) {
  const { label, have, need, unit, met, idle, activity } = requirement;
  const suffix = unit === "percent" ? "%" : "";

  if (idle) {
    return (
      <li className="py-2">
        <div className="flex items-baseline justify-between gap-4 text-[13px]">
          <span className="text-mute">
            <span className="text-mute/70">{ACTIVITY_LABEL[activity]}</span>{" "}
            · {label}
          </span>
        </div>
      </li>
    );
  }

  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-4 text-[13px]">
        <span className={met ? "text-mute" : "text-ink"}>
          <span className="text-mute/70">{ACTIVITY_LABEL[activity]}</span> ·{" "}
          {label}
        </span>
        <span
          className={`shrink-0 tabular-nums ${met ? "text-sure" : "text-mute"}`}
        >
          {have}
          {suffix} / {need}
          {suffix}
        </span>
      </div>
      <Bar have={have} need={need} />
    </li>
  );
}

function TierBlock({ tier, open }: { tier: Tier; open: boolean }) {
  return (
    <li className="border-b border-rule py-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="flex items-baseline gap-2.5 text-[14px] font-medium">
          <Stars earned={tier.stars} total={tier.stars} />
          <span className={tier.met ? "text-mute" : ""}>{tier.name}</span>
        </h3>
        <span
          className={`shrink-0 text-[13px] ${tier.met ? "text-sure" : "text-mute"}`}
        >
          {tier.met ? "earned" : open ? "working on this" : "after that"}
        </span>
      </div>

      {open ? (
        <>
          <p className="mt-1 text-[13px] text-mute">{tier.blurb}</p>
          <ul className="mt-2.5">
            {tier.requirements.map((r, i) => (
              <RequirementRow
                key={`${r.activity}-${r.label}-${i}`}
                requirement={r}
              />
            ))}
          </ul>
        </>
      ) : null}
    </li>
  );
}

export function KitProgress({ mastery }: { mastery: Mastery }) {
  const { stars, tiers, next, remaining } = mastery;

  return (
    <section className="rounded-sm border border-rule px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
        {/* The heading names what has been earned; the open tier below names
            what is being worked towards. Showing the same name twice made it
            look like the chapter was already at that tier. */}
        <h2 className="flex items-baseline gap-3 text-[15px] font-medium">
          <Stars earned={stars} />
          <span className={stars === 0 ? "text-mute" : undefined}>
            {stars === 0 ? "Not started" : tiers[stars - 1].name}
          </span>
        </h2>
        <span className="shrink-0 text-[13px] text-mute">
          {stars} of {tiers.length} tiers
        </span>
      </div>

      {remaining.length > 0 ? (
        <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed">
          <span className="text-mute">To earn it:</span> {sentence(remaining)}.
        </p>
      ) : (
        <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-mute">
          Every tier earned. Nothing here expires, and the cards keep coming
          back on their own schedule — carry on as long as you want to.
        </p>
      )}

      <ul className="mt-3 border-t border-rule">
        {tiers.map((tier) => (
          <TierBlock
            key={tier.stars}
            tier={tier}
            open={next ? tier.stars === next.stars : false}
          />
        ))}
      </ul>
    </section>
  );
}

/** "a, b and c" — the outstanding work as one readable line. */
function sentence(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
