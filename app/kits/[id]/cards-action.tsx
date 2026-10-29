"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJSON, type ApiFailure } from "@/lib/fetch-json";
import { Notice } from "@/components/chrome";

interface CardsResult {
  card_count: number;
  total_cards: number;
  part: number;
  parts: number;
  covered: boolean;
}

/**
 * Writes flashcards for a kit, working through the whole of its material.
 *
 * Long uploads are read a slice at a time, so this keeps going until every
 * slice has been covered rather than leaving the student with cards for the
 * opening fifth of what they uploaded — which is worse than having none,
 * because it looks finished.
 */
export function GenerateCards({
  kitId,
  hasCards,
  initialError,
}: {
  kitId: string;
  hasCards: boolean;
  initialError?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [count, setCount] = useState(16);
  const [error, setError] = useState<ApiFailure | null>(
    initialError ? { title: initialError } : null,
  );

  async function run() {
    setBusy(true);
    setError(null);
    setProgress("Reading your material…");

    let madeAny = false;

    // Each request covers one slice. Looping here keeps every request short
    // enough to finish comfortably, while still ending with full coverage.
    for (let guard = 0; guard < 12; guard += 1) {
      const result = await postJSON<CardsResult>(`/api/kits/${kitId}/cards`, {
        count,
        ...(guard === 0 && !hasCards ? { part: 0 } : {}),
      });

      if (!result.ok) {
        // Partial progress is still progress: keep what was written and say so.
        setError(
          madeAny
            ? {
                title: `Covered part of your material, then stopped: ${result.error.title}`,
                hint: "The cards already written are saved. Press again to carry on.",
              }
            : result.error,
        );
        break;
      }

      madeAny = true;
      const { part, parts, total_cards, covered } = result.data;
      setProgress(
        covered
          ? `Done — ${total_cards} cards across all ${parts} parts.`
          : `Part ${part} of ${parts} done (${total_cards} cards so far)…`,
      );

      if (covered || parts <= 1) break;
    }

    router.refresh();
    setBusy(false);
    setTimeout(() => setProgress(null), 4000);
  }

  return (
    <div>
      {error ? (
        <div className="mb-4">
          <Notice
            title={error.title}
            hint={
              error.hint ??
              "Your material is safe — only the card writing failed. Try again, or ask for fewer cards."
            }
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <button
          onClick={() => void run()}
          disabled={busy}
          className={`rounded-sm px-4 py-2 text-[14px] font-medium disabled:opacity-40 ${
            hasCards ? "border border-rule" : "bg-ink text-bg"
          }`}
        >
          {busy
            ? "Writing…"
            : hasCards
              ? "Write cards for the rest"
              : "Write the flashcards"}
        </button>

        <label className="flex items-center gap-2 text-[13px] text-mute">
          <span className="text-ink">{count}</span> per part
          <input
            type="range"
            min={6}
            max={40}
            step={2}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            disabled={busy}
            className="w-28 accent-[var(--brass)]"
          />
        </label>
      </div>

      {progress ? (
        <p className="mt-3 text-[13px] text-mute" role="status">
          {progress}
        </p>
      ) : null}
    </div>
  );
}
