"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Notice } from "@/components/chrome";
import { postJSON, type ApiFailure } from "@/lib/fetch-json";

type Format = "choice" | "written" | "mixed";

interface Question {
  attemptId: string;
  format: "choice" | "written";
  question: string;
  options?: string[];
  concept: string;
  difficulty: number;
  targeted: boolean;
}

interface Verdict {
  format: "choice" | "written";
  verdict: "correct" | "partial" | "incorrect";
  score: number;
  explanation: string;
  missed: string[];
  expected: string;
  answer_index?: number;
  chosen_index?: number;
}

const VERDICT_LABEL: Record<Verdict["verdict"], string> = {
  correct: "Correct",
  partial: "Partly right",
  incorrect: "Not right",
};

const VERDICT_COLOR: Record<Verdict["verdict"], string> = {
  correct: "text-sure",
  partial: "text-brass",
  incorrect: "text-mark",
};

const VERDICT_BORDER: Record<Verdict["verdict"], string> = {
  correct: "border-sure",
  partial: "border-brass",
  incorrect: "border-mark",
};

const FORMATS: { value: Format; label: string }[] = [
  { value: "choice", label: "Multiple choice" },
  { value: "written", label: "Written" },
  { value: "mixed", label: "Mixed" },
];

const LETTERS = ["A", "B", "C", "D", "E", "F"];

interface Outcome {
  question?: Question;
  error?: ApiFailure;
}

/** Asks the server for the next question. Kept free of state so the mount
 *  effect can await it before touching React state. */
async function requestQuestion(
  kitId: string,
  format: Format,
): Promise<Outcome> {
  const result = await postJSON<Question>("/api/study/next", { kitId, format });
  return result.ok ? { question: result.data } : { error: result.error };
}

/** Remembered per kit, so returning to a kit resumes how you were studying. */
function storedFormat(kitId: string): Format {
  try {
    const saved = localStorage.getItem(`studykit.format.${kitId}`);
    if (saved === "choice" || saved === "written" || saved === "mixed") {
      return saved;
    }
  } catch {
    // Private windows and blocked storage both land here; the default is fine.
  }
  return "choice";
}

export function SmartStudy({ kitId }: { kitId: string }) {
  const [format, setFormat] = useState<Format>("choice");
  const [question, setQuestion] = useState<Question | null>(null);
  const [answer, setAnswer] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [history, setHistory] = useState<number[]>([]);

  const answerBox = useRef<HTMLTextAreaElement>(null);

  const apply = useCallback((outcome: Outcome) => {
    if (outcome.error) setError(outcome.error);
    else if (outcome.question) setQuestion(outcome.question);
    setLoading(false);
  }, []);

  // First question. The awaits come before any state update, so this effect
  // never sets state synchronously.
  useEffect(() => {
    let cancelled = false;
    const saved = storedFormat(kitId);

    requestQuestion(kitId, saved).then((outcome) => {
      if (cancelled) return;
      setFormat(saved);
      apply(outcome);
    });

    return () => {
      cancelled = true;
    };
  }, [kitId, apply]);

  /** Moves to the next question. Only ever called from an interaction. */
  const loadQuestion = useCallback(
    async (override?: Format) => {
      setLoading(true);
      setError(null);
      setVerdict(null);
      setAnswer("");
      apply(await requestQuestion(kitId, override ?? format));
    },
    [apply, format, kitId],
  );

  function chooseFormat(next: Format) {
    setFormat(next);
    try {
      localStorage.setItem(`studykit.format.${kitId}`, next);
    } catch {
      // Not being able to remember the choice is not worth failing over.
    }
    void loadQuestion(next);
  }

  /** Written answers go to the AI to be marked. */
  const submitWritten = useCallback(async () => {
    if (!question || marking || !answer.trim()) return;

    setMarking(true);
    setError(null);

    const result = await postJSON<Verdict>("/api/study/grade", {
      attemptId: question.attemptId,
      answer,
    });

    if (!result.ok) setError(result.error);
    else {
      setVerdict(result.data);
      setHistory((h) => [...h, result.data.score]);
    }

    setMarking(false);
  }, [answer, marking, question]);

  /** A chosen option is marked by comparison on the server: no AI, no wait. */
  const submitChoice = useCallback(
    async (index: number) => {
      if (!question || marking || verdict) return;

      setMarking(true);
      setError(null);

      const result = await postJSON<Verdict>("/api/study/grade", {
        attemptId: question.attemptId,
        choiceIndex: index,
      });

      if (!result.ok) setError(result.error);
      else {
        setVerdict(result.data);
        setHistory((h) => [...h, result.data.score]);
      }

      setMarking(false);
    },
    [marking, question, verdict],
  );

  // Put the cursor in the answer box as soon as a written question arrives.
  useEffect(() => {
    if (question?.format === "written" && !verdict) answerBox.current?.focus();
  }, [question, verdict]);

  // Cmd/Ctrl+Enter submits or moves on; 1-4 pick an option.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (verdict) void loadQuestion();
        else if (question?.format === "written") void submitWritten();
        return;
      }

      if (question?.format === "choice" && !verdict && !marking) {
        const index = Number(event.key) - 1;
        if (Number.isInteger(index) && index >= 0 && index < (question.options?.length ?? 0)) {
          event.preventDefault();
          void submitChoice(index);
        }
      }

      if (verdict && event.key === "Enter") {
        event.preventDefault();
        void loadQuestion();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loadQuestion, marking, question, submitChoice, submitWritten, verdict]);

  const average = history.length
    ? Math.round(history.reduce((a, b) => a + b, 0) / history.length)
    : null;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
      {/* How you want to be asked. */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2 pb-3">
        {FORMATS.map((option) => {
          const active = format === option.value;
          return (
            <button
              key={option.value}
              onClick={() => chooseFormat(option.value)}
              disabled={loading || marking}
              aria-pressed={active}
              className={`rounded-sm px-2.5 py-1 text-[13px] disabled:opacity-50 ${
                active
                  ? "bg-ink text-bg font-medium"
                  : "text-mute hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {/* Status: difficulty, what is being targeted, session score. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-y border-rule py-2.5 text-[13px]">
        <div className="flex items-center gap-3">
          <span className="text-mute">Difficulty</span>
          <span
            className="flex gap-1"
            aria-label={`${question?.difficulty ?? 0} of 5`}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <span
                key={n}
                className={`h-1.5 w-1.5 rounded-full ${
                  question && n <= question.difficulty
                    ? "bg-[var(--ink)]"
                    : "bg-[var(--rule)]"
                }`}
              />
            ))}
          </span>
          {question?.concept ? (
            <span className={question.targeted ? "text-brass" : "text-mute"}>
              {question.targeted ? "drilling " : ""}
              {question.concept}
            </span>
          ) : null}
        </div>

        {history.length > 0 ? (
          <span className="text-mute">
            {history.length} answered
            {average !== null ? (
              <>
                {" · "}
                <span
                  className={
                    average >= 70
                      ? "text-sure"
                      : average >= 50
                        ? "text-brass"
                        : "text-mark"
                  }
                >
                  {average}% this session
                </span>
              </>
            ) : null}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="mt-8">
          <Notice title={error.title} hint={error.hint} />
          <button
            onClick={() => void loadQuestion()}
            className="mt-4 rounded-sm border border-ink px-4 py-2 text-[14px] font-medium"
          >
            Try again
          </button>
        </div>
      ) : null}

      {loading && !error ? (
        <p className="read mt-14 text-[20px] text-mute">Writing a question…</p>
      ) : null}

      {question && !loading && !error ? (
        <>
          <h1 className="read mt-10 max-w-[36ch] text-[25px] leading-[1.3] font-normal sm:text-[29px]">
            {question.question}
          </h1>

          {/* ------------------------------------------- multiple choice */}
          {question.format === "choice" ? (
            <div className="mt-8 space-y-2">
              {(question.options ?? []).map((option, index) => {
                const isAnswer = verdict?.answer_index === index;
                const wasChosen = verdict?.chosen_index === index;
                const wrongChoice = wasChosen && !isAnswer;

                let classes = "border-rule hover:border-ink";
                if (verdict) {
                  classes = "border-rule";
                  if (isAnswer) classes = "border-sure";
                  if (wrongChoice) classes = "border-mark";
                }

                return (
                  <button
                    key={index}
                    onClick={() => void submitChoice(index)}
                    disabled={Boolean(verdict) || marking}
                    className={`flex w-full items-start gap-3 rounded-sm border px-3.5 py-3 text-left disabled:cursor-default ${classes}`}
                  >
                    <span className="shrink-0 pt-0.5 text-[13px] text-mute">
                      {LETTERS[index]}
                    </span>
                    <span className="min-w-0 flex-1 text-[15px] leading-snug">
                      {option}
                    </span>
                    {verdict && isAnswer ? (
                      <span className="shrink-0 pt-0.5 text-[12.5px] text-sure">
                        correct
                      </span>
                    ) : null}
                    {verdict && wrongChoice ? (
                      <span className="shrink-0 pt-0.5 text-[12.5px] text-mark">
                        your answer
                      </span>
                    ) : null}
                  </button>
                );
              })}

              {!verdict ? (
                <p className="pt-1 text-[13px] text-mute">
                  Click an answer, or press 1–{question.options?.length ?? 4}.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* -------------------------------------------------- written */}
          {question.format === "written" ? (
            verdict ? (
              <div className="mt-8 border-b border-rule pb-4">
                <p className="text-[13px] text-mute">Your answer</p>
                <p className="read mt-1.5 max-w-[60ch] text-[17px] leading-relaxed">
                  {answer}
                </p>
              </div>
            ) : (
              <div className="mt-9">
                <label htmlFor="answer" className="sr-only">
                  Your answer
                </label>
                <textarea
                  id="answer"
                  ref={answerBox}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  disabled={marking}
                  rows={4}
                  placeholder="Answer in your own words."
                  className="writeline read py-2 text-[17px] leading-relaxed placeholder:font-sans placeholder:text-[15px] placeholder:text-mute/60 disabled:opacity-70"
                />
              </div>
            )
          ) : null}

          {question.format === "written" && !verdict ? (
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <button
                onClick={() => void submitWritten()}
                disabled={marking || !answer.trim()}
                className="rounded-sm bg-ink px-4 py-2 text-[14px] font-medium text-bg disabled:opacity-40"
              >
                {marking ? "Marking…" : "Check answer"}
              </button>
              <span className="text-[13px] text-mute">
                Or press {modifierHint()} + Enter
              </span>
              <button
                onClick={() => void loadQuestion()}
                className="ml-auto text-[13px] text-mute underline underline-offset-2 hover:text-ink"
              >
                Skip this one
              </button>
            </div>
          ) : null}

          {question.format === "choice" && !verdict ? (
            <div className="mt-5">
              <button
                onClick={() => void loadQuestion()}
                className="text-[13px] text-mute underline underline-offset-2 hover:text-ink"
              >
                Skip this one
              </button>
            </div>
          ) : null}

          {/* -------------------------------------------------- verdict */}
          {verdict ? (
            <div
              className={`settle mt-8 border-l-2 pl-4 ${VERDICT_BORDER[verdict.verdict]}`}
            >
              <div className="flex items-baseline gap-3">
                <span
                  className={`text-[15px] font-medium ${VERDICT_COLOR[verdict.verdict]}`}
                >
                  {VERDICT_LABEL[verdict.verdict]}
                </span>
                {verdict.format === "written" ? (
                  <span className="text-[13px] text-mute">{verdict.score}%</span>
                ) : null}
              </div>

              <p className="read mt-3 max-w-[60ch] text-[16px] leading-relaxed">
                {verdict.explanation}
              </p>

              {verdict.missed.length > 0 ? (
                <div className="mt-4">
                  <p className="text-[13px] text-mute">You left out</p>
                  <ul className="mt-1.5 space-y-1.5">
                    {verdict.missed.map((item, i) => (
                      <li
                        key={i}
                        className="read flex max-w-[58ch] gap-2 text-[15px] leading-relaxed"
                      >
                        <span aria-hidden className="select-none text-mute">
                          &mdash;
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <button
                  onClick={() => void loadQuestion()}
                  className="rounded-sm bg-ink px-4 py-2 text-[14px] font-medium text-bg"
                >
                  Next question
                </button>
                <span className="text-[13px] text-mute">Or press Enter</span>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

/** Shows the right modifier key for the platform, once mounted. */
function modifierHint() {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent)
    ? "⌘"
    : "Ctrl";
}
