"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getJSON, postJSON } from "@/lib/fetch-json";
import { Notice } from "@/components/chrome";
import {
  RELEARN_MINUTES,
  formatInterval,
  previewIntervals,
  review,
  type Grade,
} from "@/lib/srs";

export interface Card {
  id: string;
  front: string;
  back: string;
  concept: string | null;
  ease: number;
  interval_days: number;
  repetitions: number;
  lapses: number;
  due_at: string;
}

/** A card that was failed and is waiting out its relearning delay. */
interface Waiting {
  card: Card;
  dueAt: number;
}

const GRADES: { grade: Grade; label: string; key: string; tone: string }[] = [
  { grade: "again", label: "Again", key: "1", tone: "text-mark" },
  { grade: "hard", label: "Hard", key: "2", tone: "text-brass" },
  { grade: "good", label: "Good", key: "3", tone: "text-ink" },
  { grade: "easy", label: "Easy", key: "4", tone: "text-sure" },
];

/** True when the keystroke belongs to whatever the student has focused. */
function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "BUTTON" ||
    tag === "A" ||
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function CardReview({
  kitId,
  initialQueue,
  initialRelearn,
  initialMore,
}: {
  kitId: string;
  initialQueue: Card[];
  initialRelearn: Card[];
  initialMore: boolean;
}) {
  const [queue, setQueue] = useState<Card[]>(initialQueue);
  const [relearn, setRelearn] = useState<Waiting[]>(() =>
    initialRelearn.map((c) => ({ card: c, dueAt: Date.parse(c.due_at) })),
  );

  const [more, setMore] = useState(initialMore);
  const [revealed, setRevealed] = useState(false);
  const [finished, setFinished] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());

  // Grading is in-flight per card id. Without this, two activations of the
  // same card shift the *next*, unseen card off the queue and count it as
  // reviewed — which is how a card could be silently skipped on a slow phone.
  const gradingRef = useRef<string | null>(null);
  const doneIdsRef = useRef<Set<string>>(new Set());
  const loadingMoreRef = useRef(false);

  // A relearning card whose time has come takes priority: it is overdue, and
  // getting it back in front of the student is the point of relearning.
  const readyIndex = relearn.findIndex((w) => w.dueAt <= tick);
  const card = readyIndex >= 0 ? relearn[readyIndex].card : (queue[0] ?? null);
  const pending = readyIndex >= 0 ? [] : relearn;

  const grade = useCallback(
    async (chosen: Grade) => {
      if (!card || gradingRef.current === card.id) return;
      gradingRef.current = card.id;

      const id = card.id;
      const next = review(card, chosen);
      const lapsed = chosen === "again";

      setRevealed(false);
      setQueue((q) => q.filter((c) => c.id !== id));
      setRelearn((r) => {
        const without = r.filter((w) => w.card.id !== id);
        return lapsed
          ? [
              ...without,
              { card: { ...card, ...next }, dueAt: Date.parse(next.due_at) },
            ]
          : without;
      });

      if (lapsed) {
        doneIdsRef.current.delete(id);
      } else if (!doneIdsRef.current.has(id)) {
        doneIdsRef.current.add(id);
        setFinished((n) => n + 1);
      }

      const result = await postJSON(`/api/cards`, { cardId: id, grade: chosen });
      gradingRef.current = null;

      // The write failed, so the card is still due in the database. Put it
      // back rather than leaving the student believing it was recorded.
      if (!result.ok) {
        setError(result.error.title);
        setRelearn((r) => r.filter((w) => w.card.id !== id));
        setQueue((q) => (q.some((c) => c.id === id) ? q : [card, ...q]));
        if (!lapsed && doneIdsRef.current.delete(id)) {
          setFinished((n) => Math.max(0, n - 1));
        }
      }
    },
    [card],
  );

  // Space reveals the answer; 1-4 grade it. Nothing here claims Enter, and
  // nothing fires while a button or link is focused, so Enter on the "Again"
  // button presses Again instead of being swallowed and recorded as Good,
  // and the keyboard can still reach "End session".
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!card || event.metaKey || event.ctrlKey || event.altKey) return;
      if (typingInto(event.target)) return;

      if (event.key === " " && !revealed) {
        event.preventDefault();
        setRevealed(true);
        return;
      }

      if (revealed) {
        const match = GRADES.find((g) => g.key === event.key);
        if (match) {
          event.preventDefault();
          void grade(match.grade);
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, grade, revealed]);

  // Keep the relearning countdown honest, and bring a card back the moment
  // its delay is up. Only runs while something is actually waiting.
  useEffect(() => {
    if (pending.length === 0) return;
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending.length]);

  /*
   * One sitting loads a batch at a time. When the batch runs out there may be
   * more waiting, so fetch the next batch instead of announcing that the
   * session is over — the screen used to say "Done for now" with cards still
   * due. Every state write happens after the await, so this stays clear of
   * synchronous updates during an effect.
   */
  useEffect(() => {
    if (card || pending.length > 0 || !more || loadingMoreRef.current) return;
    loadingMoreRef.current = true;

    void (async () => {
      const result = await getJSON<{
        ready: Card[];
        relearning: Card[];
        more: boolean;
      }>(`/api/cards?kit=${kitId}`);
      loadingMoreRef.current = false;

      if (!result.ok) {
        setError(result.error.title);
        setMore(false);
        return;
      }

      const unseen = (cards: Card[]) =>
        cards.filter((c) => !doneIdsRef.current.has(c.id));

      const ready = unseen(result.data.ready);
      const relearning = unseen(result.data.relearning);

      setMore(result.data.more && ready.length + relearning.length > 0);
      setQueue(ready);
      setRelearn(
        relearning.map((c) => ({ card: c, dueAt: Date.parse(c.due_at) })),
      );
    })();
  }, [card, pending.length, more, kitId]);

  const previews = card ? previewIntervals(card) : null;
  const left = queue.length + relearn.length;
  const soonest = pending.length
    ? Math.min(...pending.map((w) => w.dueAt))
    : null;
  const waitMinutes =
    soonest === null ? 0 : Math.max(1, Math.ceil((soonest - tick) / 60_000));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-rule pb-3 text-[13px]">
        <span className="text-mute">
          {left > 0
            ? `${left} left in this session`
            : finished > 0
              ? "Session complete"
              : ""}
        </span>
        {finished > 0 || relearn.length > 0 ? (
          <span className="text-mute">
            {finished} card{finished === 1 ? "" : "s"} done
            {relearn.length > 0 ? (
              <>
                {" · "}
                <span className="text-mark">
                  {relearn.length} relearning
                </span>
              </>
            ) : null}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="mt-6">
          <Notice
            title={error}
            hint="That review was not saved, so the card is still due. Try again."
          />
        </div>
      ) : null}

      {/* Everything is due later: say when, and let them push on if they want. */}
      {!card && pending.length > 0 ? (
        <div className="mt-12 max-w-[52ch]">
          <h1 className="read text-[24px] leading-snug">
            {pending.length} card{pending.length === 1 ? "" : "s"} to relearn.
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-mute">
            Cards you forget come back after about {RELEARN_MINUTES} minutes,
            which is long enough for the recall to be worth something. The next
            one is ready in {waitMinutes} minute{waitMinutes === 1 ? "" : "s"},
            and will appear here on its own.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => {
                // Move them into the sitting rather than winding the clock
                // forward: a shifted clock would also make the *next* card
                // they fail instantly due, which is the loop that drove a
                // card's ease to the floor in seconds.
                setQueue((q) => [...q, ...pending.map((w) => w.card)]);
                setRelearn([]);
              }}
              className="min-h-[44px] rounded-sm bg-ink px-4 py-2 text-[14px] font-medium text-bg"
            >
              Review them now
            </button>
            <Link
              href={`/kits/${kitId}/study`}
              className="flex min-h-[44px] items-center rounded-sm border border-rule px-4 py-2 text-[14px] font-medium"
            >
              Go to Smart Study
            </Link>
          </div>
        </div>
      ) : null}

      {!card && pending.length === 0 ? (
        <div className="mt-12 max-w-[52ch]">
          <h1 className="read text-[24px] leading-snug">
            {finished > 0 ? "Done for now." : "Nothing is due yet."}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-mute">
            {finished > 0
              ? `${finished} card${finished === 1 ? "" : "s"} reviewed. Each one comes back when its interval is up — that spacing is what makes it stick.`
              : "Spaced repetition means waiting is part of it. Come back when cards fall due, or use Smart Study in the meantime, which has no schedule."}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={`/kits/${kitId}/study`}
              className="flex min-h-[44px] items-center rounded-sm bg-ink px-4 py-2 text-[14px] font-medium text-bg"
            >
              Go to Smart Study
            </Link>
            <Link
              href={`/kits/${kitId}`}
              className="flex min-h-[44px] items-center rounded-sm border border-rule px-4 py-2 text-[14px] font-medium"
            >
              Back to kit
            </Link>
          </div>
        </div>
      ) : null}

      {card ? (
        <>
          {/* Fixed top padding rather than vertical centring: centring moved
              the question up by over a hundred pixels the instant the answer
              appeared, so every card lurched as it was revealed. */}
          <div className="flex flex-1 flex-col pt-10 pb-6 sm:pt-14">
            {card.concept ? (
              <p className="text-[13px] text-mute">{card.concept}</p>
            ) : null}

            <h1 className="read mt-3 max-w-[32ch] text-[27px] leading-[1.3] font-normal sm:text-[30px]">
              {card.front}
            </h1>

            {revealed ? (
              <div className="settle mt-7 border-t border-rule pt-6">
                <p className="read max-w-[58ch] text-[18px] leading-relaxed">
                  {card.back}
                </p>
              </div>
            ) : (
              <button
                onClick={() => setRevealed(true)}
                className="mt-8 min-h-[44px] self-start rounded-sm border border-ink px-4 py-2 text-[14px] font-medium"
              >
                Show answer
                <span className="ml-2 text-mute">Space</span>
              </button>
            )}
          </div>

          {revealed && previews ? (
            <div className="border-t border-rule pt-4 pb-2">
              <p className="text-[13px] text-mute">How well did you know it?</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {GRADES.map(({ grade: g, label, key, tone }) => (
                  <button
                    key={g}
                    onClick={() => void grade(g)}
                    className="min-h-[56px] rounded-sm border border-rule px-3 py-2.5 text-left hover:border-ink"
                  >
                    <span className={`block text-[14px] font-medium ${tone}`}>
                      {label}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] text-mute">
                      {previews[g]} · key {key}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[12.5px] text-mute">
                {card.repetitions > 0 || card.lapses > 0
                  ? `Seen ${card.repetitions + card.lapses} time${card.repetitions + card.lapses === 1 ? "" : "s"} · current interval ${formatInterval(card.interval_days)}${card.lapses > 0 ? ` · forgotten ${card.lapses}×` : ""}`
                  : "First time seeing this card."}
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
