"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Notice } from "@/components/chrome";
import { postJSON } from "@/lib/fetch-json";

interface Question {
  attemptId: string;
  question: string;
  concept: string;
  difficulty: number;
  targeted: boolean;
}

interface Verdict {
  verdict: "correct" | "partial" | "incorrect";
  score: number;
  explanation: string;
  missed: string[];
  expected: string;
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

interface Outcome {
  question?: Question;
  error?: { title: string; hint?: string };
}

/**
 * Asks the server for the next question. Kept outside the component and free
 * of state so the mount effect can await it before touching React state.
 */
async function requestQuestion(kitId: string): Promise<Outcome> {
  const result = await postJSON<Question>("/api/study/next", { kitId });
  return result.ok ? { question: result.data } : { error: result.error };
}

export function SmartStudy({ kitId }: { kitId: string }) {
  const [question, setQuestion] = useState<Question | null>(null);
  const [answer, setAnswer] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<{ title: string; hint?: string } | null>(
    null,
  );
  const [history, setHistory] = useState<number[]>([]);

  const answerBox = useRef<HTMLTextAreaElement>(null);

  const apply = useCallback((outcome: Outcome) => {
    if (outcome.error) setError(outcome.error);
    else if (outcome.question) setQuestion(outcome.question);
    setLoading(false);
  }, []);

  // First question. The await comes before any state update, so this effect
  // never sets state synchronously.
  useEffect(() => {
    let cancelled = false;
    requestQuestion(kitId).then((outcome) => {
      if (!cancelled) apply(outcome);
    });
    return () => {
      cancelled = true;
    };
  }, [kitId, apply]);

  /** Moves to the next question. Only ever called from an interaction. */
  const loadQuestion = useCallback(async () => {
    setLoading(true);
    setError(null);
    setVerdict(null);
    setAnswer("");
    apply(await requestQuestion(kitId));
  }, [apply, kitId]);

  // Put the cursor in the answer box as soon as a question arrives.
  useEffect(() => {
    if (question && !verdict) answerBox.current?.focus();
  }, [question, verdict]);

  const submit = useCallback(async () => {
    if (!question || marking || !answer.trim()) return;

    setMarking(true);
    setError(null);

    const result = await postJSON<Verdict>("/api/study/grade", {
      attemptId: question.attemptId,
      answer,
    });

    if (!result.ok) {
      setError(result.error);
    } else {
      setVerdict(result.data);
      setHistory((h) => [...h, result.data.score]);
    }

    setMarking(false);
  }, [answer, marking, question]);

  // Cmd/Ctrl + Enter submits; Enter alone moves on once marked.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (verdict) void loadQuestion();
        else void submit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loadQuestion, submit, verdict]);

  const average = history.length
    ? Math.round(history.reduce((a, b) => a + b, 0) / history.length)
    : null;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
      {/* Status line: difficulty, what is being targeted, session score. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-rule pb-3 text-[13px]">
        <div className="flex items-center gap-3">
          <span className="text-mute">Difficulty</span>
          <span className="flex gap-1" aria-label={`${question?.difficulty ?? 0} of 5`}>
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
          <h1 className="read mt-10 max-w-[34ch] text-[27px] leading-[1.3] font-normal sm:text-[31px]">
            {question.question}
          </h1>

          {/* Once marked, the answer collapses to what was written: a tall
              empty box under the verdict is just dead space. */}
          {verdict ? (
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
          )}

          {!verdict ? (
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <button
                onClick={() => void submit()}
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
                <span className="text-[13px] text-mute">{verdict.score}%</span>
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
                <span className="text-[13px] text-mute">
                  Or press {modifierHint()} + Enter
                </span>
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
