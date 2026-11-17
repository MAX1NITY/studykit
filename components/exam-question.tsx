"use client";

import type { Presented, Submitted } from "@/lib/exam/select";

const LETTERS = ["A", "B", "C", "D", "E", "F", "G"];

/** Whether an answer counts as given, for progress counters. */
export function isAnswered(value: Submitted | undefined): boolean {
  if (!value) return false;
  if ("picked" in value) return value.picked.length > 0;
  if ("arranged" in value) return value.arranged.length > 0;
  if ("chose" in value) return value.chose.some((c) => c != null);
  return false;
}

/** The answer a freshly shown question starts with. */
export function emptyAnswer(q: Presented): Submitted {
  if (q.kind === "ordering") {
    // Starts in the order shown, so dragging nothing is still an answer that
    // can be marked rather than a blank.
    return { arranged: (q.steps ?? []).map((_, i) => i) };
  }
  if (q.kind === "matching") return { chose: (q.lefts ?? []).map(() => null) };
  return { picked: [] };
}

export function ExamQuestion({
  question,
  value,
  onChange,
  disabled = false,
  /** Per-element verdicts from marking, shown on the review screen. */
  detail,
}: {
  question: Presented;
  value: Submitted;
  onChange: (next: Submitted) => void;
  disabled?: boolean;
  detail?: boolean[];
}) {
  // ------------------------------------------------- single and multiple
  if (question.kind === "single" || question.kind === "multiple") {
    const picked = "picked" in value ? value.picked : [];
    const multi = question.kind === "multiple";

    const toggle = (i: number) => {
      if (disabled) return;
      if (!multi) return onChange({ picked: [i] });
      onChange({
        picked: picked.includes(i)
          ? picked.filter((p) => p !== i)
          : [...picked, i],
      });
    };

    return (
      <ul className="mt-5 space-y-2">
        {(question.options ?? []).map((option, i) => {
          const on = picked.includes(i);
          const verdict = detail?.[i];
          const tone =
            detail == null
              ? on
                ? "border-ink bg-ink/[0.04]"
                : "border-rule hover:border-mute"
              : verdict === false
                ? "border-mark bg-mark/[0.04]"
                : on
                  ? "border-sure bg-sure/[0.04]"
                  : "border-rule";

          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => toggle(i)}
                disabled={disabled}
                aria-pressed={on}
                className={`flex w-full items-start gap-3 rounded-sm border px-3 py-3 text-left text-[15px] leading-relaxed transition-colors disabled:cursor-default ${tone}`}
              >
                <span
                  className={`mt-px shrink-0 font-mono text-[13px] ${on ? "text-ink" : "text-mute"}`}
                >
                  {LETTERS[i]}
                </span>
                <span className="min-w-0">{option}</span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  // ------------------------------------------------------------ ordering
  if (question.kind === "ordering") {
    const steps = question.steps ?? [];
    const arranged = "arranged" in value ? value.arranged : steps.map((_, i) => i);

    const move = (from: number, to: number) => {
      if (disabled || to < 0 || to >= arranged.length) return;
      const next = [...arranged];
      [next[from], next[to]] = [next[to], next[from]];
      onChange({ arranged: next });
    };

    return (
      <ol className="mt-5 space-y-2">
        {arranged.map((shown, position) => {
          const verdict = detail?.[position];
          const tone =
            detail == null
              ? "border-rule"
              : verdict
                ? "border-sure bg-sure/[0.04]"
                : "border-mark bg-mark/[0.04]";

          return (
            <li
              key={shown}
              className={`flex items-center gap-3 rounded-sm border px-3 py-2.5 ${tone}`}
            >
              <span className="w-5 shrink-0 font-mono text-[13px] text-mute">
                {position + 1}
              </span>
              <span className="min-w-0 flex-1 text-[15px] leading-relaxed">
                {steps[shown]}
              </span>
              {!disabled ? (
                <span className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    onClick={() => move(position, position - 1)}
                    disabled={position === 0}
                    aria-label={`Move "${steps[shown]}" up`}
                    className="flex h-[22px] w-9 items-center justify-center text-mute hover:text-ink disabled:opacity-25"
                  >
                    {"▲"}
                  </button>
                  <button
                    type="button"
                    onClick={() => move(position, position + 1)}
                    disabled={position === arranged.length - 1}
                    aria-label={`Move "${steps[shown]}" down`}
                    className="flex h-[22px] w-9 items-center justify-center text-mute hover:text-ink disabled:opacity-25"
                  >
                    {"▼"}
                  </button>
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    );
  }

  // ------------------------------------------------------------ matching
  if (question.kind === "matching") {
    const lefts = question.lefts ?? [];
    const rights = question.rights ?? [];
    const chose = "chose" in value ? value.chose : lefts.map(() => null);

    return (
      <ul className="mt-5 space-y-2">
        {lefts.map((left, i) => {
          const verdict = detail?.[i];
          const tone =
            detail == null
              ? "border-rule"
              : verdict
                ? "border-sure bg-sure/[0.04]"
                : "border-mark bg-mark/[0.04]";

          return (
            <li
              key={i}
              className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm border px-3 py-2.5 ${tone}`}
            >
              <span className="min-w-[8rem] flex-1 text-[15px]">{left}</span>
              <select
                value={chose[i] ?? ""}
                disabled={disabled}
                aria-label={`Match for ${left}`}
                onChange={(e) => {
                  const next = [...chose];
                  next[i] = e.target.value === "" ? null : Number(e.target.value);
                  onChange({ chose: next });
                }}
                className="min-h-[40px] shrink-0 rounded-sm border border-rule bg-bg px-2 py-1.5 text-[14px] disabled:text-mute"
              >
                <option value="">{"— choose —"}</option>
                {rights.map((right, j) => (
                  <option key={j} value={j}>
                    {right}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
    );
  }

  return null;
}

/** "(Select TWO.)" and the like, as CompTIA prints it. */
export function pickHint(question: Presented): string | null {
  if (question.kind === "multiple") {
    const words = ["", "ONE", "TWO", "THREE", "FOUR"];
    return `(Select ${words[question.pick ?? 2] ?? "TWO"}.)`;
  }
  if (question.kind === "ordering") return "(Put the steps in order.)";
  if (question.kind === "matching") return "(Match each item.)";
  return null;
}
