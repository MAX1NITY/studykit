"use client";

import { useState } from "react";
import type { Presented, Submitted } from "@/lib/exam/select";
import { ExamQuestion, emptyAnswer, pickHint } from "@/components/exam-question";

export interface ReviewItem {
  index: number;
  question: Presented;
  submitted: Submitted | null;
  score: number;
  detail: boolean[];
  explanation: string;
  answer: string[];
  attempted: boolean;
}

type Filter = "wrong" | "all";

/**
 * Going back through the paper.
 *
 * Opens on the ones that went wrong, because those are the reason to look at
 * a finished paper at all. Each question shows what was chosen, marked up
 * against the right answer, and then why.
 */
export function Review({ items }: { items: ReviewItem[] }) {
  const [filter, setFilter] = useState<Filter>("wrong");
  const [open, setOpen] = useState<number | null>(null);

  const wrong = items.filter((i) => i.score < 100);
  const shown = filter === "wrong" ? wrong : items;

  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="read text-[19px]">Every question</h2>
        <div className="flex gap-1 text-[13px]">
          {(
            [
              ["wrong", `Dropped marks (${wrong.length})`],
              ["all", `All (${items.length})`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setFilter(value);
                setOpen(null);
              }}
              className={`rounded-sm px-2.5 py-1.5 ${
                filter === value ? "bg-ink text-bg" : "text-mute hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="mt-5 text-[15px] text-sure">
          Nothing dropped. Every question marked full.
        </p>
      ) : (
        <ul className="mt-4 border-t border-rule">
          {shown.map((item) => {
            const isOpen = open === item.index;
            const tone =
              item.score === 100
                ? "text-sure"
                : item.score > 0
                  ? "text-brass"
                  : "text-mark";

            return (
              <li key={item.index} className="border-b border-rule">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : item.index)}
                  aria-expanded={isOpen}
                  className="flex w-full items-baseline gap-3 py-3.5 text-left"
                >
                  <span className="w-7 shrink-0 font-mono text-[12px] tabular-nums text-mute">
                    {item.index}
                  </span>
                  <span className="min-w-0 flex-1 text-[14px] leading-relaxed">
                    {isOpen ? item.question.stem : truncate(item.question.stem)}
                  </span>
                  <span className={`shrink-0 text-[13px] font-medium ${tone}`}>
                    {!item.attempted
                      ? "skipped"
                      : item.score === 100
                        ? "full"
                        : `${item.score}%`}
                  </span>
                </button>

                {isOpen ? (
                  <div className="pb-6 pl-10">
                    {(() => {
                      const hint = pickHint(item.question);
                      return hint ? (
                        <p className="text-[13px] text-mute">{hint}</p>
                      ) : null;
                    })()}

                    <ExamQuestion
                      question={item.question}
                      value={item.submitted ?? emptyAnswer(item.question)}
                      onChange={() => {}}
                      disabled
                      detail={item.attempted ? item.detail : undefined}
                    />

                    {item.score < 100 ? (
                      <div className="mt-5">
                        <p className="text-[13px] text-mute">
                          {item.question.kind === "ordering"
                            ? "The right order:"
                            : item.question.kind === "matching"
                              ? "The right pairing:"
                              : item.answer.length > 1
                                ? "The right answers:"
                                : "The right answer:"}
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {item.answer.map((a, i) => (
                            <li key={i} className="text-[14px] leading-relaxed">
                              {item.question.kind === "ordering" ? `${i + 1}. ` : ""}
                              {a}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <p className="mt-4 border-l-2 border-rule pl-3 text-[14px] leading-relaxed">
                      {item.explanation}
                    </p>

                    <p className="mt-3 font-mono text-[12px] text-mute">
                      {item.question.objective}
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function truncate(text: string, at = 96) {
  return text.length <= at ? text : `${text.slice(0, at).trimEnd()}…`;
}
