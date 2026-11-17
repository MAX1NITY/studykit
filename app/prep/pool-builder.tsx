"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/chrome";
import { postJSON, type ApiFailure } from "@/lib/fetch-json";
import { DOMAINS, EXAM, domainQuota } from "@/lib/exam/core1";

/**
 * How much to write in one go.
 *
 * One paper's worth is the smallest useful amount: below it, a mock exam
 * cannot be set at all. Three is where a second mock stops being a repeat of
 * the first. Offering both because the difference is roughly ten minutes
 * against half an hour of waiting, and that is his call rather than mine.
 */
const CHOICES = [
  { papers: 1, label: "Enough for one mock" },
  { papers: 3, label: "Three mocks' worth" },
] as const;

/**
 * The shape of the pool.
 *
 * Mostly single-answer, because that is mostly what the exam is. The
 * performance-based shapes are a small slice on purpose: CompTIA says to
 * expect between two and five of them in 90 questions, so a pool stuffed with
 * them would make every mock unrepresentative.
 */
const MIX: { kind: string; share: number }[] = [
  { kind: "single", share: 0.72 },
  { kind: "multiple", share: 0.18 },
  { kind: "ordering", share: 0.05 },
  { kind: "matching", share: 0.05 },
];

// The generate route caps a batch at eight. Six keeps the number of round
// trips down without making any single call long enough to be cut off.
const BATCH = 6;

interface Progress {
  done: number;
  saved: number;
  skipped: number;
  current: string;
}

export function PoolBuilder() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const stop = useRef(false);

  const quota = domainQuota(EXAM.questions);

  const run = useCallback(async (papers: number) => {
    stop.current = false;
    setRunning(true);
    setError(null);

    // What is already written, so stopping and starting again picks up where
    // it left off rather than beginning the whole pool over.
    const counts = new Map<string, Map<string, number>>();
    const current = await postJSON<{
      rows: { domain: string; kind: string; count: number }[];
    }>("/api/prep/pool", {});

    if (current.ok) {
      for (const row of current.data.rows ?? []) {
        if (!counts.has(row.domain)) counts.set(row.domain, new Map());
        counts.get(row.domain)!.set(row.kind, row.count);
      }
    }

    const want: { domain: string; kind: string; missing: number }[] = [];
    for (const d of DOMAINS) {
      const target = quota[d.id] * papers;
      for (const { kind, share } of MIX) {
        const need = Math.max(1, Math.round(target * share));
        const have = counts.get(d.id)?.get(kind) ?? 0;
        if (have < need) want.push({ domain: d.id, kind, missing: need - have });
      }
    }

    // Biggest gap first, so an interrupted run still leaves the pool balanced
    // rather than deep in one domain and empty in another.
    want.sort((a, b) => b.missing - a.missing);

    const batches: { domain: string; kind: string; count: number; rotation: number }[] = [];
    const rotation = new Map<string, number>();
    for (const item of want) {
      let left = item.missing;
      while (left > 0) {
        const key = `${item.domain}:${item.kind}`;
        const r = rotation.get(key) ?? 0;
        rotation.set(key, r + 1);
        batches.push({
          domain: item.domain,
          kind: item.kind,
          count: Math.min(BATCH, left),
          // Each batch reads a different slice of the chapter, so the pool
          // covers the whole syllabus instead of its opening pages.
          rotation: r,
        });
        left -= BATCH;
      }
    }

    let saved = 0;
    let skipped = 0;

    for (let i = 0; i < batches.length; i += 1) {
      if (stop.current) break;
      const batch = batches[i];
      const name = DOMAINS.find((d) => d.id === batch.domain)?.name ?? batch.domain;

      setProgress({
        done: i,
        saved,
        skipped,
        current: `${name} · ${LABEL[batch.kind] ?? batch.kind}`,
      });

      const result = await postJSON<{ saved: number; duplicates: number }>(
        "/api/prep/generate",
        batch,
      );

      if (!result.ok) {
        setError(result.error);
        break;
      }

      saved += result.data.saved;
      skipped += result.data.duplicates;
    }

    setProgress((p) =>
      p ? { ...p, done: batches.length, saved, skipped, current: "" } : null,
    );
    setRunning(false);
    router.refresh();
  }, [quota, router]);



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
                  {DOMAINS.reduce((n, d) => n + quota[d.id], 0) * choice.papers}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-mute">
            Each batch is one AI call of about six questions, so one mock{"\u2019"}s
            worth is roughly ten minutes and three is closer to half an hour.
            You can stop whenever you like and carry on later {"\u2014"} it
            counts what is already written and only fills the gap.
          </p>
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              onClick={() => {
                stop.current = true;
              }}
              className="rounded-sm border border-rule px-4 py-2 text-[14px]"
            >
              Stop after this batch
            </button>
            <p className="text-[13px] text-mute">
              {progress?.current ? `Writing ${progress.current}` : "Working"}
              {progress ? ` · ${progress.saved} saved` : ""}
              {progress?.skipped ? ` · ${progress.skipped} were repeats` : ""}
            </p>
          </div>
          <p className="mt-2 text-[12px] text-mute">
            Keep this tab open while it runs.
          </p>
        </div>
      )}

      {!running && progress && progress.saved + progress.skipped > 0 ? (
        <p className="mt-3 text-[13px] text-mute">
          Added {progress.saved} question{progress.saved === 1 ? "" : "s"}
          {progress.skipped
            ? `; ${progress.skipped} came back as repeats and were dropped`
            : ""}
          .
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

const LABEL: Record<string, string> = {
  single: "single answer",
  multiple: "select two or three",
  ordering: "ordering steps",
  matching: "matching",
};
