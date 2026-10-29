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

  const [marking, setMarking] = useState(false);

  const startedAt = useRef<number | null>(null);
  // One paper at a time. Racing "Start the test" used to create several
  // papers and leave testId pointing at a different one from the questions
  // on screen, so answers could be marked against the wrong paper.
  const buildingRef = useRef(false);
  const markingRef = useRef(false);

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

  /*
   * An unfinished paper survives leaving the page.
   *
   * Reloading, pressing Back or clicking "Leave" used to drop the student
   * straight back to the setup screen with their answers and their clock
   * gone, while the row sat unsubmitted in the database forever. The paper
   * itself is already stored server-side, so keeping the answers here is
   * enough to pick it up where it was left.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const saved = await readSaved(kitId);
      if (cancelled || !saved) return;

      setTestId(saved.testId);
      setQuestions(saved.questions);
      setResponses(saved.responses);
      startedAt.current = saved.startedAt;
      setElapsed(Math.floor((Date.now() - saved.startedAt) / 1000));
      setPhase("sitting");
    })();

    return () => {
      cancelled = true;
    };
  }, [kitId]);

  // Keep the saved copy in step with what is on screen.
  useEffect(() => {
    if (phase !== "sitting" || !testId || !startedAt.current) return;
    writeSaved(kitId, {
      testId,
      questions,
      responses,
      startedAt: startedAt.current,
    });
  }, [kitId, phase, testId, questions, responses]);

  async function build() {
    if (buildingRef.current) return;
    buildingRef.current = true;
    setPhase("building");
    setError(null);

    const result = await postJSON<{ testId: string; questions: Question[] }>(
      "/api/test",
      { kitId, count },
    );

    buildingRef.current = false;

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
    if (!testId || markingRef.current) return;
    markingRef.current = true;
    setMarking(true);
    setError(null);

    const result = await postJSON<{ score: number; results: Result[] }>(
      "/api/test",
      { testId, responses, durationSeconds: elapsed },
      "PUT",
    );

    markingRef.current = false;
    setMarking(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    clearSaved(kitId);
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
              className="mt-2 h-6 w-full accent-[var(--brass)]"
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
            className="mt-8 min-h-[44px] rounded-sm bg-ink px-5 py-2.5 text-[15px] font-medium text-bg disabled:opacity-40"
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
                          // Once marked, show what was actually submitted.
                          // Reading the live radios here let a click that
                          // landed while marking was in flight contradict the
                          // score: the header said 3/3 while the ticked
                          // option was the wrong one.
                          const chosen = result
                            ? result.chosen === oi
                            : responses[i] === oi;
                          const isAnswer = result?.answer_index === oi;
                          const wrongChoice =
                            result && chosen && !result.correct;
                          const rightChoice =
                            result && chosen && result.correct;

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
                              className={`flex min-h-[48px] items-center gap-3 rounded-sm border px-3 py-3 ${classes}`}
                            >
                              <input
                                type="radio"
                                name={`q${i}`}
                                checked={chosen}
                                // Locked while marking, so a late click
                                // cannot disagree with the paper that was
                                // actually submitted.
                                disabled={phase === "marked" || marking}
                                onChange={() =>
                                  setResponses((current) => {
                                    const next = [...current];
                                    next[i] = oi;
                                    return next;
                                  })
                                }
                                className="size-[18px] shrink-0 accent-[var(--ink)]"
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
                              {/* A right answer was unlabelled, so a question
                                  you got right and one you skipped looked
                                  identical on the marked paper. */}
                              {phase === "marked" && rightChoice ? (
                                <span className="shrink-0 text-[12.5px] text-sure">
                                  your answer
                                </span>
                              ) : null}
                            </label>
                          );
                        })}
                      </div>

                      {result && result.chosen === null ? (
                        <p className="mt-3 text-[12.5px] text-brass">
                          You left this one blank.
                        </p>
                      ) : null}

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
                disabled={marking}
                className="min-h-[44px] rounded-sm bg-ink px-5 py-2.5 text-[15px] font-medium text-bg disabled:opacity-40"
              >
                {marking ? "Marking…" : "Mark my test"}
              </button>
              {!marking && answered < questions.length ? (
                <span className="text-[13px] text-brass">
                  {questions.length - answered} unanswered will be marked wrong
                </span>
              ) : null}
            </div>
          ) : (
            <div className="mt-8 flex flex-wrap gap-3 border-t border-rule pt-6">
              <button
                onClick={() => {
                  clearSaved(kitId);
                  setPhase("setup");
                  setResults(null);
                  setScore(null);
                  setElapsed(0);
                  setTestId(null);
                  setQuestions([]);
                }
                }
                className="min-h-[44px] rounded-sm bg-ink px-4 py-2 text-[14px] font-medium text-bg"
              >
                Take another
              </button>
              <Link
                href={`/kits/${kitId}`}
                className="flex min-h-[44px] items-center rounded-sm border border-rule px-4 py-2 text-[14px] font-medium"
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
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

// ------------------------------------------------- an unfinished paper

interface SavedTest {
  testId: string;
  questions: Question[];
  responses: (number | null)[];
  startedAt: number;
}

const savedKey = (kitId: string) => `studykit:test:${kitId}`;

/**
 * Async only so the caller can await it: that keeps the restore out of a
 * synchronous effect body, which React's rules disallow.
 */
async function readSaved(kitId: string): Promise<SavedTest | null> {
  try {
    const raw = window.localStorage.getItem(savedKey(kitId));
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedTest;
    const sane =
      saved?.testId &&
      Array.isArray(saved.questions) &&
      saved.questions.length > 0 &&
      Array.isArray(saved.responses) &&
      saved.responses.length === saved.questions.length &&
      typeof saved.startedAt === "number";
    if (!sane) return null;

    // A paper left for a day is not a sitting worth resuming.
    if (Date.now() - saved.startedAt > 12 * 3600_000) {
      window.localStorage.removeItem(savedKey(kitId));
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

function writeSaved(kitId: string, saved: SavedTest) {
  try {
    window.localStorage.setItem(savedKey(kitId), JSON.stringify(saved));
  } catch {
    // Private browsing, or storage full. Resuming is a convenience.
  }
}

function clearSaved(kitId: string) {
  try {
    window.localStorage.removeItem(savedKey(kitId));
  } catch {
    // Nothing to do: the saved copy expires on its own.
  }
}
