"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/chrome";
import { postJSON } from "@/lib/fetch-json";

export function GuideActions({
  kitId,
  hasGuide,
}: {
  kitId: string;
  hasGuide: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<{ title: string; hint?: string } | null>(
    null,
  );

  async function generate() {
    // `busy` state only takes effect on the next render, so two activations
    // in one tick both got through and wrote two guides.
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);

    const result = await postJSON("/api/guide", { kitId });
    busyRef.current = false;

    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    router.refresh();
    setBusy(false);
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        onClick={() => void generate()}
        disabled={busy}
        className={`min-h-[44px] rounded-sm px-4 py-2 text-[14px] font-medium disabled:opacity-40 ${
          hasGuide ? "border border-rule" : "bg-ink text-bg"
        }`}
      >
        {busy ? "Writing…" : hasGuide ? "Rewrite it" : "Write the guide"}
      </button>
      {error ? <Notice title={error.title} hint={error.hint} /> : null}
    </div>
  );
}
