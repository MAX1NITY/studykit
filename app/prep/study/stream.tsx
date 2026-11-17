"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Notice } from "@/components/chrome";
import { getJSON, postJSON, type ApiFailure } from "@/lib/fetch-json";
import type { Presented, Submitted } from "@/lib/exam/select";
import {
  ExamQuestion,
  emptyAnswer,
  isAnswered,
  pickHint,
} from "@/components/exam-question";

interface Marked {
  score: number;
  correct: boolean;
  detail: boolean[];
  explanation: string;
  answer: string[];
}

/**
 * The ongoing study stream.
 *
 * No stars, no target, no end screen: it asks, marks, explains, and asks
 * again. The counter at the top is there to be glanced at, not completed.
 */
export function Stream({
  first,
  firstDomainName,
  startingAnswered,
  startingAccuracy,
}: {
  first: Presented;
  firstDomainName: string;
  startingAnswered: number;
  startingAccuracy: number | null;
}) {
  const [question, setQuestion] = useState<Presented>(first);
  const [domainName, setDomainName] = useState(firstDomainName);
  const [answer, setAnswer] = useState<Submitted>(() => emptyAnswer(first));
  const [marked, setMarked] = useState<Marked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);

  const [answered, setAnswered] = useState(startingAnswered);
  const [marks, setMarks] = useState(
    startingAccuracy == null ? 0 : startingAccuracy * startingAnswered,
  );

  const heading = useRef<HTMLParagraphElement>(null);

  const submit = useCallback(async () => {
    if (busy || marked) return;
    setBusy(true);
    setError(null);

    const result = await postJSON<Marked>("/api/prep/answer", {
      questionId: question.id,
      submitted: answer,
    });

    setBusy(false);
    if (!result.ok) return setError(result.error);

    setMarked(result.data);
    setAnswered((n) => n + 1);
    setMarks((m) => m + result.data.score);
  }, [answer, busy, marked, question.id]);

  const advance = useCallback(async () => {
    setBusy(true);
    setError(null);

    const result = await getJSON<{
      question: Presented | null;
      domainName?: string;
      empty?: boolean;
    }>("/api/prep/next");

    setBusy(false);
    if (!result.ok) return setError(result.error);
    if (!result.data.question) {
      return setError({
        title: "The pool has run out.",
        hint: "Write another batch of questions from the Core 1 page and the stream carries on.",
      });
    }

    setQuestion(result.data.question);
    setDomainName(result.data.domainName ?? "");
    setAnswer(emptyAnswer(result.data.question));
    setMarked(null);
    heading.current?.focus();
  }, []);

  // Enter submits, then Enter moves on: the stream is meant to be sat with
  // one hand on the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "SELECT" || tag === "TEXTAREA") return;
      e.preventDefault();
      if (marked) void advance();
      else if (isAnswered(answer)) void submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, answer, marked, submit]);

  const hint = pickHint(question);
  const accuracy = answered ? Math.round(marks / answered) : null;

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p
          ref={heading}
          tabIndex={-1}
          aria-live="polite"
          className="text-[13px] text-mute outline-none"
        >
          <span className="font-mono">{question.objective}</span> {"·"}{" "}
          {domainName}
        </p>
        <p className="text-[13px] text-mute">
          {answered} answered
          {accuracy == null ? "" : ` · ${accuracy}% of the marks`}
        </p>
      </div>

      <div className="mt-6">
        <p className="read text-[19px] leading-relaxed">{question.stem}</p>
        {hint ? <p className="mt-1.5 text-[13px] text-mute">{hint}</p> : null}

        <ExamQuestion
          question={question}
          value={answer}
          onChange={setAnswer}
          disabled={marked != null}
          detail={marked?.detail}
        />
      </div>

      {marked ? (
        <div
          className={`mt-7 border-l-2 pl-4 ${
            marked.correct
              ? "border-sure"
              : marked.score > 0
                ? "border-brass"
                : "border-mark"
          }`}
        >
          <p
            className={`text-[14px] font-medium ${
              marked.correct
                ? "text-sure"
                : marked.score > 0
                  ? "text-brass"
                  : "text-mark"
            }`}
          >
            {marked.correct
              ? "Correct"
              : marked.score > 0
                ? `Partly right — ${marked.score}% of the marks`
                : "Not right"}
          </p>

          {!marked.correct ? (
            <div className="mt-2">
              <p className="text-[13px] text-mute">
                {question.kind === "ordering"
                  ? "The right order:"
                  : question.kind === "matching"
                    ? "The right pairing:"
                    : marked.answer.length > 1
                      ? "The right answers:"
                      : "The right answer:"}
              </p>
              <ul className="mt-1 space-y-0.5">
                {marked.answer.map((a, i) => (
                  <li key={i} className="text-[14px] leading-relaxed">
                    {question.kind === "ordering" ? `${i + 1}. ` : ""}
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="mt-3 text-[14px] leading-relaxed">{marked.explanation}</p>
        </div>
      ) : null}

      {error ? (
        <div className="mt-6">
          <Notice title={error.title} hint={error.hint} />
        </div>
      ) : null}

      <div className="mt-8 flex items-center gap-3">
        {marked ? (
          <button
            type="button"
            onClick={advance}
            disabled={busy}
            className="rounded-sm bg-ink px-4 py-2.5 text-[14px] font-medium text-bg disabled:opacity-50"
          >
            {busy ? "Finding one…" : "Next question"}
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={busy || !isAnswered(answer)}
            className="rounded-sm bg-ink px-4 py-2.5 text-[14px] font-medium text-bg disabled:opacity-40"
          >
            {busy ? "Marking…" : "Check answer"}
          </button>
        )}
        <span className="text-[12px] text-mute">Enter</span>
      </div>
    </>
  );
}
