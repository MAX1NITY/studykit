"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/chrome";
import { postJSON, type ApiFailure } from "@/lib/fetch-json";
import { EXAM } from "@/lib/exam/core1";

export function StartMock() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);

  return (
    <div className="mt-8">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const result = await postJSON<{ id: string }>("/api/prep/sittings", {});
          if (!result.ok) {
            setBusy(false);
            return setError(result.error);
          }
          router.refresh();
        }}
        className="rounded-sm bg-ink px-5 py-3 text-[15px] font-medium text-bg disabled:opacity-50"
      >
        {busy ? "Setting the paper…" : `Start the ${EXAM.minutes}-minute mock`}
      </button>
      <p className="mt-2 text-[13px] text-mute">
        The clock starts as soon as you press this.
      </p>
      {error ? (
        <div className="mt-5">
          <Notice title={error.title} hint={error.hint} />
        </div>
      ) : null}
    </div>
  );
}
