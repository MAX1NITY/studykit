"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { extractFile, type Extracted } from "@/lib/extract";
import { postJSON, type ApiFailure } from "@/lib/fetch-json";
import { Notice } from "@/components/chrome";

/** Below this, there is not enough material to make decent questions. */
const MIN_CHARS = 200;

export function NewKitForm() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [pasted, setPasted] = useState("");
  const [files, setFiles] = useState<Extracted[]>([]);
  const [cardCount, setCardCount] = useState(24);

  const [reading, setReading] = useState(false);
  const [stage, setStage] = useState<"idle" | "saving" | "writing">("idle");
  const [error, setError] = useState<ApiFailure | null>(null);

  const building = stage !== "idle";

  const totalChars =
    pasted.trim().length + files.reduce((n, f) => n + f.content.length, 0);
  const ready = totalChars >= MIN_CHARS && !building && !reading;

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setReading(true);
    setError(null);

    const added: Extracted[] = [];
    for (const file of Array.from(list)) {
      try {
        added.push(await extractFile(file));
      } catch (cause) {
        setError({
          title: cause instanceof Error ? cause.message : "Could not read that file.",
        });
      }
    }

    if (added.length) setFiles((current) => [...current, ...added]);
    setReading(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function build() {
    setError(null);

    const sources = [
      ...files.map((f) => ({ name: f.name, kind: f.kind, content: f.content })),
      ...(pasted.trim()
        ? [{ name: "Pasted notes", kind: "note", content: pasted.trim() }]
        : []),
    ];

    // Step one saves the material. It involves no AI, so it is quick and
    // cannot time out — once this returns, nothing you uploaded can be lost.
    setStage("saving");
    const created = await postJSON<{ kit: { id: string } }>("/api/kits", {
      sources,
      title: title.trim() || undefined,
    });

    if (!created.ok) {
      setError(created.error);
      setStage("idle");
      return;
    }

    const kitId = created.data.kit.id;

    // Step two writes the flashcards. If it fails, the kit still exists and
    // the kit page offers to write them again, so we go there either way.
    setStage("writing");
    const cards = await postJSON(`/api/kits/${kitId}/cards`, {
      count: cardCount,
    });

    if (!cards.ok) {
      const reason = encodeURIComponent(cards.error.title);
      router.replace(`/kits/${kitId}?cards=failed&why=${reason}`);
      return;
    }

    router.replace(`/kits/${kitId}`);
  }

  return (
    <div className="mt-10 space-y-8">
      <div>
        <label htmlFor="title" className="text-[13px] text-mute">
          Name it (optional — otherwise one is written for you)
        </label>
        <input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="CompTIA A+ core 1, chapter 3"
          className="writeline mt-1 py-1.5 text-[15px] placeholder:text-mute/60"
        />
      </div>

      <div>
        <label htmlFor="pasted" className="text-[13px] text-mute">
          Paste your notes
        </label>
        <textarea
          id="pasted"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={10}
          placeholder="Paste a chapter, lecture notes, a summary you wrote…"
          className="writeline read mt-1 py-2 text-[16px] leading-relaxed placeholder:font-sans placeholder:text-[15px] placeholder:text-mute/60"
        />
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-[13px] text-mute">Or add files</span>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={reading}
            className="rounded-sm border border-rule px-3 py-1.5 text-[13px] font-medium disabled:opacity-50"
          >
            {reading ? "Reading…" : "Choose files"}
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".pdf,.txt,.md,.markdown,.csv,.json,application/pdf,text/*"
          onChange={(e) => addFiles(e.target.files)}
          className="hidden"
        />
        <p className="mt-1.5 text-[13px] text-mute">
          PDF, .txt or .md. A scanned PDF has no text to read, so it will not
          work.
        </p>

        {files.length > 0 ? (
          <ul className="mt-4 border-t border-rule">
            {files.map((file, i) => (
              <li
                key={`${file.name}-${i}`}
                className="flex items-baseline justify-between gap-4 border-b border-rule py-2.5"
              >
                <span className="min-w-0 truncate text-[14px]">{file.name}</span>
                <span className="flex shrink-0 items-baseline gap-3">
                  <span className="text-[13px] text-mute">
                    {Math.round(file.content.length / 1000)}k characters
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setFiles((current) => current.filter((_, n) => n !== i))
                    }
                    className="text-[13px] text-mute underline underline-offset-2 hover:text-mark"
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div>
        <label htmlFor="cards" className="text-[13px] text-mute">
          Flashcards to make: <span className="text-ink">{cardCount}</span>
        </label>
        <input
          id="cards"
          type="range"
          min={10}
          max={60}
          step={2}
          value={cardCount}
          onChange={(e) => setCardCount(Number(e.target.value))}
          className="mt-2 w-full accent-[var(--brass)]"
        />
      </div>

      {error ? <Notice title={error.title} hint={error.hint} /> : null}

      <div className="flex flex-wrap items-center gap-4 border-t border-rule pt-6">
        <button
          type="button"
          onClick={build}
          disabled={!ready}
          className="rounded-sm bg-ink px-5 py-2.5 text-[15px] font-medium text-bg disabled:opacity-40"
        >
          {stage === "saving"
            ? "Saving your material…"
            : stage === "writing"
              ? "Writing the flashcards…"
              : "Build the kit"}
        </button>
        <span className="text-[13px] text-mute">
          {totalChars < MIN_CHARS
            ? `${MIN_CHARS - totalChars} more characters needed`
            : `${Math.round(totalChars / 1000)}k characters ready`}
        </span>
      </div>

      {stage === "writing" ? (
        <p className="read max-w-[56ch] text-[15px] leading-relaxed text-mute">
          Your material is saved, so nothing can be lost from here. Reading it
          through and writing the cards usually takes twenty to forty seconds.
        </p>
      ) : null}
    </div>
  );
}
