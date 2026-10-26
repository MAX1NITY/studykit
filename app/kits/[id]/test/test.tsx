"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Notice } from "@/components/chrome";
import { postJSON } from "@/lib/fetch-json";

interface Question {
  question: string;
  options: string[];
  concept: string;
}

interface Result {
  chosen: number | null;
  answer_index: number;
  correct: boolean;
  explanation: string;
  concept: string;
}

type Phase = "setup" | "building" | "sitting" | "marked";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export function PracticeTest({ kitId }: { kitId: string }) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [count, setCount] = useState(10);
  const [testId, setTestId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [responses, setResponses] = useState<(number | null)[]>([]);
  const [results, setResults] = useState<Result[] | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<{ title: string; hint?: string } | null>(
    null,
  );

  const startedAt = useRef<number | null>(null);

  // A clock, because sitting a paper to time is the point of a practice test.
  useEffect(() => {
    if (phase !== "sitting") return;
    const timer = setInterval(() => {
      if (startedAt.current) {
        setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  async function build() {
    setPhase("building");
    setError(null);

    const result = await postJSON<{ testId: string; questions: Question[] }>(
      "/api/test",
      { kitId, count },
    );

    if (!result.ok) {
      setError(result.error);
      setPhase("setup");
      return;
    }

    setTestId(result.data.testId);
    setQuestions(result.data.questions);
    setResponses(new Array(result.data.questions.length).fill(null));
    startedAt.current = Date.now();
    setPhase("sitting");
  }

  async function submit() {
    if (!testId) return;
    setError(null);

    const result = await postJSON<{ score: number; results: Result[] }>(
      "/api/test",
      { testId, responses, durationSeconds: elapsed },
      "PUT",
    );

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setResults(result.data.results);
    setScore(result.data.score);
    setPhase("marked");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const answered = responses.filter((r) => r !== null).length;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
      {phase === "setup" || phase === "building" ? (
        <div className="max-w-[54ch]">
          <h1 className="read text-[27px] leading-tight">Practice test</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-mute">
            Multiple choice, drawn from your own material, marked at the end
            rather than question by question. The wrong options are written to
            be tempting, so read them properly.
          </p>

          <div className="mt-8">
            <label htmlFor="count" className="text-[13px] text-mute">
              Questions: <span className="text-ink">{count}</span>
            </label>
            <input
              id="count"
              type="range"
              min={5}
              max={25}
              step={1}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              disabled={phase === "building"}
              className="mt-2 w-full accent-[var(--brass)]"
            />
          </div>

          {error ? (
            <div className="mt-6">
              <Notice title={error.title} hint={error.hint} />
            </div>
          ) : null}

          <button
            onClick={() => void build()}
            disabled={phase === "building"}
            className="mt-8 rounded-sm bg-ink px-5 py-2.5 text-[15px] font-medium text-bg disabled:opacity-40"
          >
            {phase === "building" ? "Writing the paper…" : "Start the test"}
          </button>
        </div>
      ) : null}

      {phase === "sitting" || phase === "marked" ? (
        <>
          <div className="sticky top-0 z-10 -mx-4 mb-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-rule bg-bg px-4 py-3 text-[13px] sm:-mx-6 sm:px-6">
            {phase === "sitting" ? (
              <>
                <span className="text-mute">
                  {answered} of {questions.length} answered
                </span>
                <span className="text-mute">{formatClock(elapsed)}</span>
              </>
            ) : (
              <>
                <span
                  className={
                    score !== null && score / questions.length >= 0.7
                      ? "text-sure"
                      : "text-brass"
                  }
                >
                  {score}/{questions.length} ·{" "}
                  {Math.round(((score ?? 0) / questions.length) * 100)}%
                </span>
                <span className="text-mute">in {formatClock(elapsed)}</span>
              </>
            )}
          </div>

          <ol className="divide-y divide-[var(--rule)]">
            {questions.map((q, i) => {
              const result = results?.[i];
              return (
                <li key={i} className="py-7">
                  <div className="flex gap-3">
                    <span className="shrink-0 pt-1 text-[13px] text-mute">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="read max-w-[56ch] text-[18px] leading-snug">
                        {q.question}
                      </p>

                      <div className="mt-4 space-y-1.5">
                        {q.options.map((option, oi) => {
                          const chosen = responses[i] === oi;
                          const isAnswer = result?.answer_index === oi;
                          const wrongChoice =
                            result && chosen && !result.correct;

                          let classes =
                            "border-rule hover:border-ink cursor-pointer";
                          if (phase === "marked") {
                            classes = "cursor-default border-rule";
                            if (isAnswer) classes = "cursor-default border-sure";
                            if (wrongChoice) classes = "cursor-default border-mark";
                          } else if (chosen) {
                            classes = "border-ink cursor-pointer";
                          }

                          return (
                            <label
                              key={oi}
                              className={`flex items-start gap-3 rounded-sm border px-3 py-2 ${classes}`}
                            >
                              <input
                                type="radio"
                                name={`q${i}`}
                                checked={chosen}
                                disabled={phase === "marked"}
                                onChange={() =>
                                  setResponses((current) => {
                                    const next = [...current];
                                    next[i] = oi;
                                    return next;
                                  })
                                }
                                className="mt-1.5 accent-[var(--ink)]"
                              />
                              <span className="text-[13px] text-mute">
                                {LETTERS[oi]}
                              </span>
                              <span className="min-w-0 flex-1 text-[14.5px] leading-snug">
                                {option}
                              </span>
                              {phase === "marked" && isAnswer ? (
                                <span className="shrink-0 text-[12.5px] text-sure">
                                  correct
                                </span>
                              ) : null}
                              {phase === "marked" && wrongChoice ? (
                                <span className="shrink-0 text-[12.5px] text-mark">
                                  your answer
                                </span>
                              ) : null}
                            </label>
                          );
                        })}
                      </div>

                      {result ? (
                        <p
                          className={`read mt-4 max-w-[58ch] border-l-2 pl-3 text-[15px] leading-relaxed ${
                            result.correct ? "border-sure" : "border-mark"
                          }`}
                        >
                          {result.explanation}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          {error ? (
            <div className="mt-6">
              <Notice title={error.title} hint={error.hint} />
            </div>
          ) : null}

          {phase === "sitting" ? (
            <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-rule pt-6">
              <button
                onClick={() => void submit()}
                className="rounded-sm bg-ink px-5 py-2.5 text-[15px] font-medium text-bg"
              >
                Mark my test
              </button>
              {answered < questions.length ? (
                <span className="text-[13px] text-brass">
                  {questions.length - answered} unanswered will be marked wrong
                </span>
              ) : null}
            </div>
          ) : (
            <div className="mt-8 flex flex-wrap gap-3 border-t border-rule pt-6">
              <button
                onClick={() => {
                  setPhase("setup");
                  setResults(null);
                  setScore(null);
                  setElapsed(0);
                  setTestId(null);
                  setQuestions([]);
                }
                }
                className="rounded-sm bg-ink px-4 py-2 text-[14px] font-medium text-bg"
              >
                Take another
              </button>
              <Link
                href={`/kits/${kitId}`}
                className="rounded-sm border border-rule px-4 py-2 text-[14px] font-medium"
              >
                Back to kit
              </Link>
            </div>
          )}
        </>
      ) : null}
    </main>
  );
}

function formatClock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
