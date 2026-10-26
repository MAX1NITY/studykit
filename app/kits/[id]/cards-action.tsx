"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJSON, type ApiFailure } from "@/lib/fetch-json";
import { Notice } from "@/components/chrome";

/**
 * Writes (or rewrites) a kit's flashcards.
 *
 * Shown when a kit has no cards — usually because generation was interrupted
 * — so the material already saved can still be turned into a deck.
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
  const [count, setCount] = useState(16);
  const [error, setError] = useState<ApiFailure | null>(
    initialError ? { title: initialError } : null,
  );

  async function run() {
    setBusy(true);
    setError(null);

    const result = await postJSON(`/api/kits/${kitId}/cards`, {
      count,
      replace: hasCards,
    });

    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    router.refresh();
    setBusy(false);
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
              ? "Rewrite the flashcards"
              : "Write the flashcards"}
        </button>

        <label className="flex items-center gap-2 text-[13px] text-mute">
          <span className="text-ink">{count}</span> cards
          <input
            type="range"
            min={6}
            max={40}
            step={2}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            disabled={busy}
            className="w-32 accent-[var(--brass)]"
          />
        </label>
      </div>
    </div>
  );
}
