"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/chrome";
import { postJSON, type ApiFailure } from "@/lib/fetch-json";

interface Added {
  added: number;
  chars: number;
  unclassified: string[];
}

/** A filename turned into something readable as a chapter title. */
function titleFrom(name: string) {
  return name
    .replace(/\.[a-z]+$/i, "")
    .replace(/^\d+[-_. ]*/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Takes the Core 1 chapters as text files.
 *
 * Reading them in the browser rather than pasting thirteen times, and
 * rather than shipping the chapters with the app: this repository is public,
 * and the material is a textbook.
 *
 * Each chapter's domain is read from the CompTIA objective header it already
 * carries, so they file themselves on the way in.
 */
export function AddChapters() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Added | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);

  const send = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    setDone(null);

    const chapters: { title: string; content: string }[] = [];
    for (const file of Array.from(files).sort((a, b) => a.name.localeCompare(b.name))) {
      const content = await file.text();
      if (content.trim().length < 200) continue;
      chapters.push({ title: titleFrom(file.name), content });
    }

    if (!chapters.length) {
      setBusy(false);
      return setError({
        title: "Nothing readable in those files.",
        hint: "Plain text files, one per chapter, a few hundred characters or more.",
      });
    }

    // Sent in groups: thirteen chapters is well over a megabyte, which is
    // more than one request should be carrying.
    let added = 0;
    let chars = 0;
    const unclassified: string[] = [];

    for (let i = 0; i < chapters.length; i += 3) {
      const result = await postJSON<Added>("/api/prep/material", {
        chapters: chapters.slice(i, i + 3),
      });
      if (!result.ok) {
        setBusy(false);
        setError(result.error);
        router.refresh();
        return;
      }
      added += result.data.added;
      chars += result.data.chars;
      unclassified.push(...(result.data.unclassified ?? []));
    }

    setBusy(false);
    setDone({ added, chars, unclassified });
    router.refresh();
  };

  return (
    <div className="mt-6">
      <input
        ref={input}
        type="file"
        multiple
        accept=".txt,.md,text/plain"
        className="hidden"
        onChange={(e) => void send(e.target.files)}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="rounded-sm bg-ink px-4 py-2.5 text-[14px] font-medium text-bg disabled:opacity-50"
      >
        {busy ? "Reading the chapters…" : "Add chapters from files"}
      </button>
      <p className="mt-2 max-w-[58ch] text-[13px] leading-relaxed text-mute">
        One text file per chapter. Each one is filed under the domain its own
        CompTIA objective header declares, so there is nothing to sort by hand.
      </p>

      {done ? (
        <p className="mt-4 text-[14px] text-sure">
          Added {done.added} chapter{done.added === 1 ? "" : "s"},{" "}
          {Math.round(done.chars / 1000).toLocaleString()}k characters.
          {done.unclassified.length
            ? ` ${done.unclassified.length} could not be matched to a domain: ${done.unclassified.join(", ")}.`
            : ""}
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
