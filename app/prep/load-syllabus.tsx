"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/chrome";
import { postJSON, type ApiFailure } from "@/lib/fetch-json";

/**
 * Loads the Core 1 chapters that ship with the app.
 *
 * One press rather than thirteen pastes. The chapters carry their own
 * CompTIA objective headers, so each one files itself under the right domain
 * on the way in.
 */
export function LoadSyllabus() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);

  return (
    <div className="mt-6">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const result = await postJSON<{ chapters: number }>("/api/prep/seed", {});
          setBusy(false);
          if (!result.ok) return setError(result.error);
          router.refresh();
        }}
        className="rounded-sm bg-ink px-4 py-2.5 text-[14px] font-medium text-bg disabled:opacity-50"
      >
        {busy ? "Loading the chapters…" : "Load the Core 1 chapters"}
      </button>
      <p className="mt-2 max-w-[56ch] text-[13px] leading-relaxed text-mute">
        All thirteen chapters of Core 1, filed by the objectives each one
        declares. Takes a few seconds.
      </p>
      {error ? (
        <div className="mt-5">
          <Notice title={error.title} hint={error.hint} />
        </div>
      ) : null}
    </div>
  );
}
