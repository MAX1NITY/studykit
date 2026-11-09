"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJSON } from "@/lib/fetch-json";
import { Notice } from "@/components/chrome";

/** Below this there is not enough to make decent questions from. */
const MIN_CHARS = 200;

/**
 * Adds written notes to a kit that already exists.
 *
 * The kit page could only take videos, so anything typed had to go in when
 * the kit was first built — which meant holding it all unsaved until every
 * last piece of material was ready. Saving runs no AI, so what is pasted
 * cannot be lost to a slow model.
 */
export function AddNotesToKit({ kitId }: { kitId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chars = text.trim().length;

  async function save() {
    setSaving(true);
    setError(null);

    const title = name.trim() || "Pasted notes";
    const result = await postJSON(`/api/kits/${kitId}/sources`, {
      name: title,
      kind: "note",
      content: text.trim(),
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.error.title);
      return;
    }

    setAdded(title);
    setName("");
    setText("");
    router.refresh();
  }

  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-[40px] rounded-sm border border-rule px-3 py-1.5 text-[13px] font-medium"
        >
          Add written notes
        </button>
        {added ? (
          <p className="mt-3 text-[13px] text-sure" role="status">
            Added “{added}”.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <label htmlFor="notes" className="text-[13px] text-mute">
        Paste notes to add to this kit
      </label>
      <textarea
        id="notes"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder="A chapter, lecture notes, a summary you wrote…"
        className="writeline read mt-1 w-full py-2 text-[16px] leading-relaxed placeholder:font-sans placeholder:text-[15px] placeholder:text-mute/60"
      />

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="What are these notes? (optional)"
        className="writeline mt-3 w-full py-1.5 text-[15px] placeholder:text-mute/60"
      />

      {error ? (
        <div className="mt-3">
          <Notice
            title={error}
            hint="Nothing was saved, and your text is still in the box — try again."
          />
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span
          className={`text-[13px] ${chars > 0 && chars < MIN_CHARS ? "text-brass" : "text-mute"}`}
        >
          {chars === 0
            ? "Nothing pasted yet."
            : chars < MIN_CHARS
              ? `${chars} characters — too little to build questions from.`
              : `${Math.max(1, Math.round(chars / 1000))}k characters`}
        </span>
        <span className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[13px] text-mute underline underline-offset-2 hover:text-ink"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={chars < MIN_CHARS || saving}
            className="min-h-[40px] rounded-sm bg-ink px-4 py-1.5 text-[13px] font-medium text-bg disabled:opacity-40"
          >
            {saving ? "Saving…" : "Add these notes"}
          </button>
        </span>
      </div>
    </div>
  );
}
