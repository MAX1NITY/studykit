"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/chrome";
import { postJSON, type ApiFailure } from "@/lib/fetch-json";
import { DOMAINS, EXAM, domainQuota } from "@/lib/exam/core1";

/**
 * How much to write in one go.
 *
 * One paper's worth is the smallest useful amount: below it a mock exam
 * cannot be set at all. Three is where a second mock stops being a repeat of
 * the first.
 */
const CHOICES = [
  { papers: 1, label: "Enough for one mock" },
  { papers: 3, label: "Three mocks' worth" },
] as const;

/** Keep calling while the server reports work left, up to this many times. */
const MAX_CALLS = 24;

/** A call that comes back empty-handed gets this many more chances. */
const MAX_STALLS = 3;

interface Result {
  saved: number;
  duplicates: number;
  rejected: number;
  batches: number;
  remaining: number;
  done: boolean;
  stalled?: boolean;
  throttled?: boolean;
  lastError?: string | null;
}

/**
 * How long to sit out a rate limit.
 *
 * The free Gemini tier limits requests per minute, and its own advice on
 * being refused is to wait a minute. Waiting is better than stopping: the
 * questions already written are kept, so the only cost is the wait.
 */
const THROTTLE_WAIT_MS = 65_000;
const MAX_THROTTLE_WAITS = 6;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function PoolBuilder() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const stop = useRef(false);

  const quota = domainQuota(EXAM.questions);
  const perPaper = DOMAINS.reduce((n, d) => n + quota[d.id], 0);

  /**
   * Each request writes for as long as it safely can — several batches, not
   * one — so this loop makes a handful of sturdy calls rather than fifteen
   * brittle ones. A call that fails or comes back with nothing is tried
   * again instead of ending the run, because the questions already written
   * are kept server-side and nothing is lost by carrying on.
   */
  const run = useCallback(
    async (papers: number) => {
      stop.current = false;
      setRunning(true);
      setError(null);
      setNote(null);
      setSaved(0);

      let total = 0;
      let stalls = 0;
      let throttleWaits = 0;

      for (let call = 0; call < MAX_CALLS; call += 1) {
        if (stop.current) break;

        const result = await postJSON<Result>("/api/prep/generate", { papers });

        if (!result.ok) {
          stalls += 1;
          if (stalls >= MAX_STALLS) {
            setError(result.error);
            break;
          }
          setNote("That call did not come back. Trying again…");
          continue;
        }

        total += result.data.saved;
        setSaved(total);
        setRemaining(result.data.remaining);

        if (result.data.done) {
          setNote(null);
          break;
        }

        // The key is rate-limited rather than broken. Sitting it out is
        // nearly always right: nothing already written is lost, and a
        // per-minute limit clears on its own.
        if (result.data.throttled) {
          throttleWaits += 1;
          if (throttleWaits > MAX_THROTTLE_WAITS) {
            setError({
              title: "Gemini keeps refusing on its rate limit.",
              hint:
                "That is usually the free tier's daily cap rather than the per-minute one, in which case it will work again tomorrow. " +
                `${total} question${total === 1 ? "" : "s"} written so far are saved, and starting again later carries on from there.`,
            });
            break;
          }
          setNote("Rate-limited by Gemini — waiting a minute, then carrying on");
          await sleep(THROTTLE_WAIT_MS);
          continue;
        }

        if (result.data.saved === 0) {
          stalls += 1;
          if (stalls >= MAX_STALLS) {
            setError({
              title: "Question writing has stopped making progress.",
              hint:
                result.data.lastError ??
                "The AI returned nothing usable several times over. A free Gemini key has a daily limit; if that is it, this will work again tomorrow. /api/health?ping=1 says which models the key can reach.",
            });
            break;
          }
          setNote("That batch came back empty. Trying again…");
          continue;
        }

        stalls = 0;
        setNote(null);
      }

      setRunning(false);
      router.refresh();
    },
    [router],
  );

  return (
    <div className="mt-6">
      {!running ? (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {CHOICES.map((choice) => (
              <button
                key={choice.papers}
                type="button"
                onClick={() => run(choice.papers)}
                className="rounded-sm border border-ink px-4 py-2 text-[14px] font-medium"
              >
                {choice.label}
                <span className="ml-2 font-normal text-mute">
                  {perPaper * choice.papers}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-mute">
            Keep this tab open while it runs {"—"} one mock{"’"}s worth
            takes a few minutes. It counts what is already written first, so
            stopping and coming back later fills the gap rather than starting
            over, and a batch that fails costs that batch rather than the run.
          </p>
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              onClick={() => {
                stop.current = true;
                setNote("Stopping after this batch…");
              }}
              className="rounded-sm border border-rule px-4 py-2 text-[14px]"
            >
              Stop
            </button>
            <p className="text-[13px] text-mute" aria-live="polite">
              {saved} written
              {remaining != null && remaining > 0 ? `, ${remaining} to go` : ""}
              {note ? ` · ${note}` : ""}
            </p>
          </div>
          <p className="mt-2 text-[12px] text-mute">
            Questions are saved as they are written, so nothing is lost if you
            stop or lose the connection.
          </p>
        </div>
      )}

      {!running && saved > 0 ? (
        <p className="mt-3 text-[13px] text-sure">
          Added {saved} question{saved === 1 ? "" : "s"}
          {remaining ? `. ${remaining} still to write.` : ". The pool is full."}
        </p>
      ) : null}

      {error ? (
        <div className="mt-4">
          <Notice title={error.title} hint={error.hint} />
        </div>
      ) : null}
    </div>
  );
}
