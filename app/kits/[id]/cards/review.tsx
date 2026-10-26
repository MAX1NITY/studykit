"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Notice } from "@/components/chrome";
import {
  formatInterval,
  previewIntervals,
  review,
  type Grade,
} from "@/lib/srs";

interface Card {
  id: string;
  front: string;
  back: string;
  concept: string | null;
  ease: number;
  interval_days: number;
  repetitions: number;
  lapses: number;
}

const GRADES: { grade: Grade; label: string; key: string; tone: string }[] = [
  { grade: "again", label: "Again", key: "1", tone: "text-mark" },
  { grade: "hard", label: "Hard", key: "2", tone: "text-brass" },
  { grade: "good", label: "Good", key: "3", tone: "text-ink" },
  { grade: "easy", label: "Easy", key: "4", tone: "text-sure" },
];

export function CardReview({ kitId }: { kitId: string }) {
  const supabase = useMemo(() => createClient(), []);

  const [queue, setQueue] = useState<Card[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [again, setAgain] = useState(0);

  const card = queue[0] ?? null;

  // Load the due queue once. Awaiting before any state update keeps this
  // effect free of synchronous setState.
  useEffect(() => {
    let cancelled = false;

    supabase
      .from("cards")
      .select("id, front, back, concept, ease, interval_days, repetitions, lapses")
      .eq("kit_id", kitId)
      .lte("due_at", new Date().toISOString())
      .order("due_at", { ascending: true })
      .limit(60)
      .then(({ data, error: queryError }) => {
        if (cancelled) return;
        if (queryError) setError(queryError.message);
        else setQueue((data ?? []) as Card[]);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [kitId, supabase]);

  const grade = useCallback(
    async (chosen: Grade) => {
      if (!card) return;

      const next = review(card, chosen);
      setRevealed(false);
      setDone((n) => n + 1);
      if (chosen === "again") setAgain((n) => n + 1);

      // Drop the card from the front of the queue. A lapsed card goes to the
      // back so it comes round again in this same session.
      setQueue((current) => {
        const [head, ...rest] = current;
        if (chosen === "again" && head) {
          return [...rest, { ...head, ...next }];
        }
        return rest;
      });

      const { error: updateError } = await supabase
        .from("cards")
        .update({
          ease: next.ease,
          interval_days: next.interval_days,
          repetitions: next.repetitions,
          lapses: next.lapses,
          due_at: next.due_at,
          last_reviewed_at: next.last_reviewed_at,
        })
        .eq("id", card.id);

      if (updateError) setError(updateError.message);
    },
    [card, supabase],
  );

  // Space reveals the answer, then 1-4 grade it.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!card) return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (!revealed) setRevealed(true);
        else void grade("good");
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

  const previews = card ? previewIntervals(card) : null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-rule pb-3 text-[13px]">
        <span className="text-mute">
          {loading
            ? "Loading cards…"
            : queue.length > 0
              ? `${queue.length} left in this session`
              : "Session complete"}
        </span>
        {done > 0 ? (
          <span className="text-mute">
            {done} reviewed
            {again > 0 ? (
              <>
                {" · "}
                <span className="text-mark">{again} to relearn</span>
              </>
            ) : null}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="mt-8">
          <Notice title={error} />
        </div>
      ) : null}

      {!loading && !card ? (
        <div className="mt-16 max-w-[52ch]">
          <h1 className="read text-[24px] leading-snug">
            {done > 0 ? "Done for now." : "Nothing is due yet."}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-mute">
            {done > 0
              ? "Cards you graded Good or Easy will come back when the interval is up. Anything you marked Again is due again in ten minutes."
              : "Spaced repetition means waiting is part of it. Come back when cards fall due, or use Smart Study in the meantime, which has no schedule."}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={`/kits/${kitId}/study`}
              className="rounded-sm bg-ink px-4 py-2 text-[14px] font-medium text-bg"
            >
              Go to Smart Study
            </Link>
            <Link
              href={`/kits/${kitId}`}
              className="rounded-sm border border-rule px-4 py-2 text-[14px] font-medium"
            >
              Back to kit
            </Link>
          </div>
        </div>
      ) : null}

      {card ? (
        <>
          <div className="flex flex-1 flex-col justify-center py-10">
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
                className="mt-8 self-start rounded-sm border border-ink px-4 py-2 text-[14px] font-medium"
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
                    className="rounded-sm border border-rule px-3 py-2.5 text-left hover:border-ink"
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
              {card.repetitions > 0 ? (
                <p className="mt-3 text-[12.5px] text-mute">
                  Seen {card.repetitions} time
                  {card.repetitions === 1 ? "" : "s"} · current interval{" "}
                  {formatInterval(card.interval_days)}
                  {card.lapses > 0 ? ` · forgotten ${card.lapses}×` : ""}
                </p>
              ) : (
                <p className="mt-3 text-[12.5px] text-mute">First time seeing this card.</p>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
