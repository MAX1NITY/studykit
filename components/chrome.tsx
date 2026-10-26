import Link from "next/link";
import type { ReactNode } from "react";

/** The thin status bar across the top of every signed-in screen. */
export function TopBar({
  breadcrumb,
  action,
}: {
  breadcrumb?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
        <Link
          href="/kits"
          className="shrink-0 text-[15px] font-semibold tracking-tight"
        >
          StudyKit
        </Link>
        {breadcrumb ? (
          <div className="min-w-0 flex-1 truncate text-[13px] text-mute">
            {breadcrumb}
          </div>
        ) : (
          <div className="flex-1" />
        )}
        {action}
      </div>
    </header>
  );
}

/** An error or empty-state message: says what happened and what to do next. */
export function Notice({
  title,
  hint,
  tone = "mark",
}: {
  title: string;
  hint?: string | null;
  tone?: "mark" | "brass";
}) {
  const color = tone === "brass" ? "text-brass" : "text-mark";
  const border = tone === "brass" ? "border-brass" : "border-mark";
  return (
    <div className={`border-l-2 ${border} pl-3 py-1`}>
      <p className={`text-sm font-medium ${color}`}>{title}</p>
      {hint ? <p className="mt-1 text-sm text-mute">{hint}</p> : null}
    </div>
  );
}

/** A count with its label, used across the kit list and kit header. */
export function Stat({
  value,
  label,
  tone,
}: {
  value: string | number;
  label: string;
  tone?: "brass" | "sure" | "mark";
}) {
  const color =
    tone === "brass"
      ? "text-brass"
      : tone === "sure"
        ? "text-sure"
        : tone === "mark"
          ? "text-mark"
          : "text-ink";
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-[15px] font-medium ${color}`}>{value}</span>
      <span className="text-[13px] text-mute">{label}</span>
    </div>
  );
}
