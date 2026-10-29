"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/chrome";
import { postJSON } from "@/lib/fetch-json";

/**
 * Deleting a kit takes its material, cards, attempts and tests with it, so
 * it asks once before doing it. The delete itself runs on the server, which
 * keeps the Supabase browser client — and its 236KB — off this page.
 */
export function DeleteKit({ kitId, title }: { kitId: string; title: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);

    const result = await postJSON(`/api/kits/${kitId}`, {}, "DELETE");

    if (!result.ok) {
      setError(result.error.title);
      setBusy(false);
      return;
    }

    router.replace("/kits");
    router.refresh();
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="min-h-[40px] px-1 text-[13px] text-mute underline underline-offset-2 hover:text-mark"
      >
        Delete this kit
      </button>
    );
  }

  return (
    <div className="border-l-2 border-mark pl-3">
      <p className="text-[14px]">
        Delete <span className="font-medium">{title}</span>?
      </p>
      <p className="mt-1 max-w-[52ch] text-[13px] text-mute">
        Its material, flashcards and your whole answer history go with it. This
        cannot be undone.
      </p>

      {error ? (
        <div className="mt-3">
          <Notice title={error} />
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-4">
        <button
          onClick={() => void remove()}
          disabled={busy}
          className="min-h-[40px] rounded-sm bg-mark px-3.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
        >
          {busy ? "Deleting…" : "Yes, delete it"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="min-h-[40px] px-1 text-[13px] text-mute underline underline-offset-2 hover:text-ink"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
