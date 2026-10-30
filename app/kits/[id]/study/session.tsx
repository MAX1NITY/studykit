"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Notice } from "@/components/chrome";
import { StarStrip } from "@/components/star-strip";
import { masteryOf, type KitProgress } from "@/lib/mastery";
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

/** Asks the server to refill the pool. Returns null if the call failed. */
async function requestTopUp(
  kitId: string,
  format: Format,
): Promise<{ ready: number; full: boolean } | null> {
  const result = await postJSON<{ ready: number; full: boolean }>(
    "/api/study/queue",
    { kitId, format },
  );
  return result.ok
    ? { ready: result.data.ready, full: Boolean(result.data.full) }
    : null;
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

const NEVER_CHANGES = () => () => {};
const clientModifier = () =>
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
    ? "\u2318"
    : "Ctrl";
const serverModifier = () => "Ctrl";

export function SmartStudy({
  kitId,
  initialQuestion = null,
  startingProgress,
}: {
  kitId: string;
  /** Served with the page, so the first question needs no round trip. */
  initialQuestion?: Question | null;
  /** This kit's standing when the page loaded; counted on from here. */
  startingProgress: KitProgress;
}) {
  const [format, setFormat] = useState<Format>("choice");
  const [question, setQuestion] = useState<Question | null>(initialQuestion);
  const [answer, setAnswer] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [loading, setLoading] = useState(initialQuestion === null);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [history, setHistory] = useState<number[]>([]);

  const answerBox = useRef<HTMLTextAreaElement>(null);
  const verdictBox = useRef<HTMLDivElement>(null);

  /*
   * The modifier key this keyboard actually has.
   *
   * Reading navigator while rendering would contradict the server's "Ctrl"
   * and break hydration on a Mac, and an iPhone would have been told to
   * press a key it does not have.
   */
  const modifier = useSyncExternalStore(
    NEVER_CHANGES,
    clientModifier,
    serverModifier,
  );

  const [ready, setReady] = useState<number | null>(null);

  /*
   * The kit's standing, kept up to date as answers land.
   *
   * Recomputed here rather than re-fetched: the server already sent the
   * starting point, and every answer's effect on it is known locally, so the
   * stars move the instant a question is marked instead of after a reload.
   */
  const [progress, setProgress] = useState<KitProgress>(startingProgress);

  const recordAnswer = useCallback((score: number, difficulty: number) => {
    setProgress((p) => ({
      ...p,
      answered: p.answered + 1,
      recentScores: [score, ...p.recentScores].slice(0, 20),
      hardCorrect: p.hardCorrect + (score >= 70 && difficulty >= 4 ? 1 : 0),
    }));
  }, []);

  /*
   * The question after this one, fetched while the student reads the verdict.
   *
   * Pressing "Next question" used to clear the screen and ask the server from
   * scratch, so there was a spinner on every single advance even though the
   * question was already written and waiting in the pool. Reading an
   * explanation takes seconds; that is more than enough time to have the next
   * one in hand.
   */
  const aheadRef = useRef<{
    format: Format;
    promise: Promise<Outcome>;
    outcome: Outcome | null;
  } | null>(null);

  const poolRef = useRef({ full: false, inFlight: false });

  /*
   * Questions are kept as a pool of unanswered rows in the database, so
   * taking the next one is a read rather than a twenty-second wait. The pool
   * refills in the background while studying, and because it lives in the
   * database it survives between sessions: come back tomorrow and the
   * questions are already written.
   */

  const apply = useCallback((outcome: Outcome) => {
    if (outcome.error) setError(outcome.error);
    else if (outcome.question) setQuestion(outcome.question);
    setLoading(false);
  }, []);

  /** Starts fetching the question after this one, if nothing is in hand. */
  const lookAhead = useCallback(
    (asking: Format) => {
      if (aheadRef.current?.format === asking) return;
      const entry: {
        format: Format;
        promise: Promise<Outcome>;
        outcome: Outcome | null;
      } = {
        format: asking,
        promise: requestQuestion(kitId, asking),
        outcome: null,
      };
      aheadRef.current = entry;
      void entry.promise.then((outcome) => {
        // Only record it if this is still the question we are waiting on.
        if (aheadRef.current === entry) entry.outcome = outcome;
      });
    },
    [kitId],
  );

  /*
   * The page is rendered with a multiple-choice question already in it, which
   * covers the common case with no request at all. Only a stored preference
   * for a different format, or an empty pool, needs anything fetched here.
   */
  useEffect(() => {
    let cancelled = false;
    const saved = storedFormat(kitId);

    if (saved === "choice" && initialQuestion) {
      return;
    }

    requestQuestion(kitId, saved).then((outcome) => {
      if (cancelled) return;
      setFormat(saved);
      apply(outcome);
    });

    return () => {
      cancelled = true;
    };
  }, [kitId, apply, initialQuestion]);

  // Keep the pool filled behind the student, not in front of them. The work
  // is awaited before any state is touched, so this effect never writes state
  // synchronously. A failure here stays silent: it is work nobody asked for.
  useEffect(() => {
    if (!question || error) return;

    // Don't ask again while the pool is known to be full and still deep: this
    // fired on every advance and five calls in six did nothing but spend a
    // round trip and an exact COUNT. Two overlapping calls also each read a
    // stale count and both topped up, overshooting the target.
    const pool = poolRef.current;
    if (pool.inFlight) return;
    if (pool.full && (ready ?? 0) > 3) return;

    pool.inFlight = true;
    let cancelled = false;

    requestTopUp(kitId, format).then((state) => {
      pool.inFlight = false;
      if (cancelled || state === null) return;
      pool.full = state.full;
      setReady(state.ready);
    });

    return () => {
      cancelled = true;
    };
  }, [question, format, error, kitId, ready]);

  /** Moves to the next question. Only ever called from an interaction. */
  const loadQuestion = useCallback(
    async (override?: Format) => {
      const asking = override ?? format;

      setError(null);
      setVerdict(null);
      setAnswer("");

      const ahead = aheadRef.current;
      aheadRef.current = null;

      if (ahead && ahead.format === asking) {
        // Already here: swap it in without blanking the screen first.
        if (ahead.outcome) {
          apply(ahead.outcome);
          setReady((n) => (n === null ? n : Math.max(n - 1, 0)));
          return;
        }
        // On its way: wait for it rather than asking twice.
        setLoading(true);
        apply(await ahead.promise);
        setReady((n) => (n === null ? n : Math.max(n - 1, 0)));
        return;
      }

      // Nothing in hand, so say that something is happening: clearing the
      // verdict without this left the answered question on screen looking
      // frozen.
      setLoading(true);
      const outcome = await requestQuestion(kitId, asking);
      apply(outcome);
      setReady((n) => (n === null ? n : Math.max(n - 1, 0)));
    },
    [apply, format, kitId],
  );

  function chooseFormat(next: Format) {
    aheadRef.current = null;
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
      recordAnswer(result.data.score, question.difficulty);
      lookAhead(format);
    }

    setMarking(false);
  }, [answer, marking, question, lookAhead, format, recordAnswer]);

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
        recordAnswer(result.data.score, question.difficulty);
        lookAhead(format);
      }

      setMarking(false);
    },
    [marking, question, verdict, lookAhead, format, recordAnswer],
  );

  // Put the cursor in the answer box as soon as a written question arrives.
  useEffect(() => {
    if (question?.format === "written" && !verdict) answerBox.current?.focus();
  }, [question, verdict]);

  /*
   * Move to the verdict once it is marked.
   *
   * Answering disabled the button that had focus, so focus fell back to the
   * document and tabbing started again from the top bar. On a phone the
   * "Next question" button also landed below the fold, so every question
   * ended with a scroll.
   */
  useEffect(() => {
    if (!verdict) return;
    const box = verdictBox.current;
    if (!box) return;
    box.focus({ preventScroll: true });
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [verdict]);

  // Cmd/Ctrl+Enter submits or moves on; 1-4 pick an option.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      /*
       * A shortcut must never override the control the student has focused.
       * Enter used to be swallowed everywhere, so tabbing to "Written" and
       * pressing Enter loaded another multiple-choice question instead of
       * switching, and Enter on "End session" did nothing at all.
       */
      const target = event.target;
      const onControl =
        target instanceof HTMLElement &&
        (target.tagName === "BUTTON" ||
          target.tagName === "A" ||
          target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (verdict) void loadQuestion();
        else if (question?.format === "written") void submitWritten();
        return;
      }

      if (question?.format === "choice" && !verdict && !marking && !onControl) {
        const index = Number(event.key) - 1;
        if (Number.isInteger(index) && index >= 0 && index < (question.options?.length ?? 0)) {
          event.preventDefault();
          void submitChoice(index);
        }
      }

      // The verdict panel itself is focused after marking, so Enter there
      // still advances; Enter on any other control does that control's job.
      if (verdict && event.key === "Enter" && !onControl) {
        event.preventDefault();
        void loadQuestion();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loadQuestion, marking, question, submitChoice, submitWritten, verdict]);

  // The Smart Study ladder only; the other two are earned on their own pages.
  const ladder = masteryOf(progress, kitId).ladders.find(
    (l) => l.feature === "study",
  )!;

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
              className={`min-h-[40px] rounded-sm px-3.5 py-2 text-[13.5px] disabled:opacity-50 ${
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
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-rule py-2.5 text-[13px]">
        <div className="flex items-center gap-3">
          <span className="text-mute">Difficulty</span>
          <span
            className="flex gap-1"
            aria-label={`${question?.difficulty ?? 0} of 5`}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <span
                key={n}
                className={`h-[7px] w-[7px] rounded-full ${
                  question && n <= question.difficulty
                    ? "bg-[var(--ink)]"
                    : "border border-[var(--mute)] opacity-60"
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

        <span className="flex items-center gap-3 text-mute">
          {ready !== null && ready > 0 ? (
            <span title="Questions already written and waiting">
              {ready} ready
            </span>
          ) : null}
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
        </span>
      </div>

      {/* The stars, where the answering happens. Seeing progress only on the
          kit page meant leaving the thing it was measuring. */}
      <div className="border-y border-rule py-2.5">
        <StarStrip ladder={ladder} />
      </div>

      {error ? (
        <div className="mt-8">
          <Notice title={error.title} hint={error.hint} />
          <button
            onClick={() => void loadQuestion()}
            className="mt-4 min-h-[44px] rounded-sm border border-ink px-4 py-2 text-[14px] font-medium"
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
                className="min-h-[44px] rounded-sm bg-ink px-4 py-2 text-[14px] font-medium text-bg disabled:opacity-40"
              >
                {marking ? "Marking…" : "Check answer"}
              </button>
              <span className="text-[13px] text-mute">
                Or press {modifier} + Enter
              </span>
              <button
                onClick={() => void loadQuestion()}
                className="ml-auto min-h-[40px] px-1 text-[13px] text-mute underline underline-offset-2 hover:text-ink"
              >
                Skip this one
              </button>
            </div>
          ) : null}

          {question.format === "choice" && !verdict ? (
            <div className="mt-5">
              <button
                onClick={() => void loadQuestion()}
                className="min-h-[40px] px-1 text-[13px] text-mute underline underline-offset-2 hover:text-ink"
              >
                Skip this one
              </button>
            </div>
          ) : null}

          {/* -------------------------------------------------- verdict */}
          {verdict ? (
            <div
              ref={verdictBox}
              tabIndex={-1}
              role="status"
              aria-live="polite"
              className={`settle mt-8 border-l-2 pl-4 outline-none ${VERDICT_BORDER[verdict.verdict]}`}
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
                  className="min-h-[44px] rounded-sm bg-ink px-4 py-2 text-[14px] font-medium text-bg"
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

