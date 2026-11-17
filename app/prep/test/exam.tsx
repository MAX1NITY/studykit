"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/chrome";
import { postJSON, type ApiFailure } from "@/lib/fetch-json";
import type { Presented, Submitted } from "@/lib/exam/select";
import {
  ExamQuestion,
  emptyAnswer,
  isAnswered,
  pickHint,
} from "@/components/exam-question";

type Draft = Record<string, Submitted>;

/** mm:ss, or h:mm:ss once there is an hour on the clock. */
function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function Exam({
  sittingId,
  questions,
  draft: initialDraft,
  msRemaining,
}: {
  sittingId: string;
  questions: Presented[];
  draft: Draft;
  msRemaining: number;
}) {
  const router = useRouter();
  const [at, setAt] = useState(0);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [showNav, setShowNav] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);

  // A deadline, not a countdown. A sleeping tab stops firing intervals, so a
  // counter that ticked down would come back owing minutes it never spent;
  // this works out what is left from the wall clock each time instead. It is
  // fixed on mount rather than during render, because the time is only known
  // on the client.
  const [left, setLeft] = useState(msRemaining);

  const draftRef = useRef(draft);
  const submittedRef = useRef(false);

  const question = questions[at];
  const answeredCount = useMemo(
    () => questions.filter((q) => isAnswered(draft[q.id])).length,
    [draft, questions],
  );

  // --------------------------------------------------------------- submit
  const finish = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);

    const result = await postJSON<{ id: string }>(
      `/api/prep/sittings/${sittingId}`,
      { draft: draftRef.current },
    );

    if (!result.ok) {
      submittedRef.current = false;
      setSubmitting(false);
      return setError(result.error);
    }

    router.push(`/prep/test/${sittingId}`);
  }, [router, sittingId]);

  // Tick the clock, and hand the paper in the moment it reaches zero. The
  // deadline is fixed once, here, because the current time is only knowable
  // on the client.
  useEffect(() => {
    const endsAt = Date.now() + msRemaining;
    const id = setInterval(() => {
      const ms = endsAt - Date.now();
      setLeft(ms);
      if (ms <= 0) void finish();
    }, 1000);
    return () => clearInterval(id);
  }, [msRemaining, finish]);

  // The autosave timer reads the draft twenty seconds after the fact, so it
  // needs the latest one rather than the one captured when it was set up.
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Save every twenty seconds, so a closed tab or a dead battery costs at
  // most the last few answers rather than the paper.
  const dirty = useRef(false);
  useEffect(() => {
    const id = setInterval(() => {
      if (!dirty.current || submittedRef.current) return;
      dirty.current = false;
      void postJSON(`/api/prep/sittings/${sittingId}`, { draft: draftRef.current }, "PUT");
    }, 20_000);
    return () => clearInterval(id);
  }, [sittingId]);

  const answer = (next: Submitted) => {
    dirty.current = true;
    setDraft((d) => ({ ...d, [question.id]: next }));
  };

  const go = (index: number) => {
    setAt(Math.max(0, Math.min(questions.length - 1, index)));
    setShowNav(false);
    window.scrollTo({ top: 0 });
  };

  // Arrow keys move between questions, which is how the real thing is sat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") go(at + 1);
      if (e.key === "ArrowLeft") go(at - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, questions.length]);

  const hint = pickHint(question);
  const urgent = left < 5 * 60 * 1000;

  if (submitting) {
    return (
      <div className="py-16 text-center">
        <p className="read text-[20px]">Marking your paper{"…"}</p>
        <p className="mt-2 text-[14px] text-mute">
          {answeredCount} of {questions.length} answered.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* ------------------------------------------------------ the clock */}
      <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between gap-3 border-b border-rule bg-bg px-4 py-2.5 sm:-mx-6 sm:px-6">
        <button
          type="button"
          onClick={() => setShowNav((s) => !s)}
          className="text-[13px] text-mute hover:text-ink"
          aria-expanded={showNav}
        >
          Question {at + 1} of {questions.length}
          <span className="ml-2 text-[12px]">{showNav ? "▲" : "▼"}</span>
        </button>

        <div className="flex items-center gap-4">
          <span className="text-[13px] text-mute">{answeredCount} answered</span>
          <span
            aria-live="off"
            className={`font-mono text-[15px] tabular-nums ${urgent ? "text-mark" : "text-ink"}`}
          >
            {clock(left)}
          </span>
        </div>
      </div>

      {/* ------------------------------------------------- the navigator */}
      {showNav ? (
        <div className="mt-4 rounded-sm border border-rule p-3">
          <div className="grid grid-cols-10 gap-1.5">
            {questions.map((q, i) => {
              const done = isAnswered(draft[q.id]);
              const flag = flagged.has(q.id);
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Question ${i + 1}${done ? ", answered" : ", not answered"}${flag ? ", flagged" : ""}`}
                  className={`relative min-h-[34px] rounded-sm border text-[12px] tabular-nums ${
                    i === at
                      ? "border-ink bg-ink text-bg"
                      : done
                        ? "border-rule bg-ink/[0.06]"
                        : "border-rule text-mute"
                  }`}
                >
                  {i + 1}
                  {flag ? (
                    <span className="absolute right-0.5 top-0 text-brass" aria-hidden>
                      {"•"}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[12px] text-mute">
            Filled means answered. A dot means flagged for another look.
          </p>
        </div>
      ) : null}

      {/* ------------------------------------------------- the question */}
      <div className="mt-7">
        <p className="read text-[19px] leading-relaxed">{question.stem}</p>
        {hint ? <p className="mt-1.5 text-[13px] text-mute">{hint}</p> : null}

        <ExamQuestion
          question={question}
          value={draft[question.id] ?? emptyAnswer(question)}
          onChange={answer}
        />
      </div>

      {error ? (
        <div className="mt-6">
          <Notice title={error.title} hint={error.hint} />
        </div>
      ) : null}

      {/* -------------------------------------------------------- moving */}
      <div className="mt-9 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => go(at - 1)}
            disabled={at === 0}
            className="rounded-sm border border-rule px-3 py-2 text-[14px] disabled:opacity-35"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => go(at + 1)}
            disabled={at === questions.length - 1}
            className="rounded-sm bg-ink px-4 py-2 text-[14px] font-medium text-bg disabled:opacity-35"
          >
            Next
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              setFlagged((f) => {
                const next = new Set(f);
                if (next.has(question.id)) next.delete(question.id);
                else next.add(question.id);
                return next;
              })
            }
            className={`text-[13px] ${
              flagged.has(question.id) ? "text-brass" : "text-mute hover:text-ink"
            }`}
          >
            {flagged.has(question.id) ? "Flagged" : "Flag"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-sm border border-ink px-3 py-2 text-[14px]"
          >
            Finish
          </button>
        </div>
      </div>

      {/* ------------------------------------------------- hand it in */}
      {confirming ? (
        <div className="mt-6 border-l-2 border-brass pl-4">
          <p className="text-[15px]">
            Hand in with {answeredCount} of {questions.length} answered?
          </p>
          {answeredCount < questions.length ? (
            <p className="mt-1 text-[14px] text-mute">
              The {questions.length - answeredCount} you have not answered will
              be marked zero, the same as on the day. There is still{" "}
              {clock(left)} on the clock.
            </p>
          ) : null}
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={finish}
              className="rounded-sm bg-ink px-4 py-2 text-[14px] font-medium text-bg"
            >
              Hand it in and mark it
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-sm border border-rule px-4 py-2 text-[14px]"
            >
              Keep going
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
