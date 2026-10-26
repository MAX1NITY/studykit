"use client";

import { useState } from "react";
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
  const [error, setError] = useState<{ title: string; hint?: string } | null>(
    null,
  );

  async function generate() {
    setBusy(true);
    setError(null);

    const result = await postJSON("/api/guide", { kitId });

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
        className={`rounded-sm px-4 py-2 text-[14px] font-medium disabled:opacity-40 ${
          hasGuide ? "border border-rule" : "bg-ink text-bg"
        }`}
      >
        {busy ? "Writing…" : hasGuide ? "Rewrite it" : "Write the guide"}
      </button>
      {error ? <Notice title={error.title} hint={error.hint} /> : null}
    </div>
  );
}
