"use client";

import { useState } from "react";
import { findYouTubeIds, parseYouTubeId } from "@/lib/youtube-url";
import { cleanTranscript } from "@/lib/transcript";
import { postJSON } from "@/lib/fetch-json";
import { Notice } from "@/components/chrome";

/**
 * Adding YouTube videos as study material.
 *
 * The transcripts are copied by the student rather than fetched by the app,
 * because there is no legitimate way for a server to fetch them: see
 * lib/youtube.ts. That makes each video two steps, so the job here is to
 * make both short, and to get the links out of the way in one go — a
 * chapter usually has several videos, and looking them up one at a time is
 * the kind of friction that stops people bothering.
 */

export interface VideoSource {
  name: string;
  kind: "url";
  content: string;
}

interface Found {
  videoId: string;
  title: string | null;
  author: string | null;
  watchUrl: string;
}

interface Pending extends Found {
  raw: string;
  ownName: string;
  added: boolean;
}

export function AddVideo({
  onAdd,
  busy,
}: {
  onAdd: (source: VideoSource) => void;
  busy?: boolean;
}) {
  const [links, setLinks] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | undefined>();

  // Counted as it is typed, so nothing is sent that was never going to work.
  const count = links.trim()
    ? parseYouTubeId(links)
      ? 1
      : findYouTubeIds(links).length
    : 0;

  async function look() {
    setError(null);
    setHint(undefined);
    setLooking(true);

    const result = await postJSON<{ videos: Found[]; ignored: number }>(
      "/api/youtube",
      { url: links },
    );
    setLooking(false);

    if (!result.ok) {
      setError(result.error.title);
      setHint(result.error.hint);
      return;
    }

    // Anything already pasted stays; only videos not already listed join it.
    setPending((current) => {
      const have = new Set(current.map((p) => p.videoId));
      const fresh = result.data.videos
        .filter((v) => !have.has(v.videoId))
        .map((v) => ({ ...v, raw: "", ownName: "", added: false }));
      return [...current, ...fresh];
    });

    setLinks("");

    if (result.data.ignored > 0) {
      setError("Only the first 12 videos were taken.");
      setHint(`${result.data.ignored} more were left out — add those next.`);
    }
  }

  function update(videoId: string, patch: Partial<Pending>) {
    setPending((current) =>
      current.map((p) => (p.videoId === videoId ? { ...p, ...patch } : p)),
    );
  }

  function add(video: Pending) {
    const cleaned = cleanTranscript(video.raw);
    const title =
      video.title || video.ownName.trim() || `YouTube video ${video.videoId}`;

    const header = [
      `Transcript of the video "${title}"`,
      video.author ? `by ${video.author}` : null,
    ]
      .filter(Boolean)
      .join(" ");

    onAdd({
      name: title.slice(0, 200),
      kind: "url",
      content: `${header}\n${video.watchUrl}\n\n${cleaned.text}`,
    });

    update(video.videoId, { added: true, raw: "" });
  }

  const waiting = pending.filter((p) => !p.added);

  return (
    <div>
      <label htmlFor="video" className="text-[13px] text-mute">
        Or add videos
      </label>

      <div className="mt-1 flex flex-wrap items-end gap-3">
        <textarea
          id="video"
          value={links}
          onChange={(e) => {
            setLinks(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && count > 0) {
              e.preventDefault();
              void look();
            }
          }}
          rows={2}
          placeholder="Paste one link or several, separated by commas or new lines"
          className="writeline min-w-0 flex-1 py-1.5 text-[15px] leading-relaxed placeholder:text-[14px] placeholder:text-mute/60"
        />
        <button
          type="button"
          onClick={() => void look()}
          disabled={count === 0 || looking || busy}
          className="min-h-[40px] shrink-0 rounded-sm border border-rule px-3 py-1.5 text-[13px] font-medium disabled:opacity-40"
        >
          {looking ? "Looking…" : count > 1 ? `Find ${count}` : "Find it"}
        </button>
      </div>

      {links.trim() && count === 0 ? (
        <p className="mt-1.5 text-[13px] text-brass">
          No YouTube links in that yet.
        </p>
      ) : (
        <p className="mt-1.5 text-[13px] text-mute">
          Each video needs captions. StudyKit cannot pull them down itself —
          YouTube blocks servers from doing that — so you copy them across,
          about ten seconds each.
        </p>
      )}

      {error ? (
        <div className="mt-4">
          <Notice title={error} hint={hint} />
        </div>
      ) : null}

      {pending.length > 0 ? (
        <ul className="mt-5 space-y-5">
          {pending.map((video) => (
            <VideoRow
              key={video.videoId}
              video={video}
              busy={busy}
              onChange={(patch) => update(video.videoId, patch)}
              onAdd={() => add(video)}
              onDrop={() =>
                setPending((c) => c.filter((p) => p.videoId !== video.videoId))
              }
            />
          ))}
        </ul>
      ) : null}

      {waiting.length > 1 ? (
        <p className="mt-4 text-[13px] text-mute">
          {waiting.length} still to paste. Any order, and anything you skip
          can be added later.
        </p>
      ) : null}
    </div>
  );
}

function VideoRow({
  video,
  busy,
  onChange,
  onAdd,
  onDrop,
}: {
  video: Pending;
  busy?: boolean;
  onChange: (patch: Partial<Pending>) => void;
  onAdd: () => void;
  onDrop: () => void;
}) {
  const cleaned = video.raw.trim() ? cleanTranscript(video.raw) : null;
  const tooShort =
    cleaned !== null && cleaned.text.length > 0 && cleaned.text.length < 200;
  const needsName = !video.title && !video.ownName.trim();

  if (video.added) {
    return (
      <li className="border-l-2 border-sure pl-4 text-[14px]">
        <span className="text-sure">Added</span>{" "}
        <span className="text-mute">
          {video.title || video.ownName || video.videoId}
        </span>
      </li>
    );
  }

  return (
    <li className="border-l-2 border-brass pl-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {video.title ? (
          <div className="min-w-0">
            <p className="text-[15px] font-medium">{video.title}</p>
            {video.author ? (
              <p className="text-[13px] text-mute">{video.author}</p>
            ) : null}
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            {/* oEmbed answers for any public video, so an empty result
                usually means the link is wrong or the video is private. It
                can also just mean YouTube did not answer, which is no reason
                to stop someone pasting a transcript they already have. */}
            <p className="text-[13.5px] text-brass">
              No title came back for {video.videoId} — check the link, or name
              it yourself.
            </p>
            <input
              value={video.ownName}
              onChange={(e) => onChange({ ownName: e.target.value })}
              placeholder="What is this video?"
              className="writeline mt-1.5 w-full py-1.5 text-[15px] placeholder:text-mute/60"
            />
          </div>
        )}

        <button
          type="button"
          onClick={onDrop}
          className="shrink-0 text-[13px] text-mute underline underline-offset-2 hover:text-mark"
        >
          Skip
        </button>
      </div>

      <p className="mt-2 text-[13px] leading-relaxed text-mute">
        <a
          href={video.watchUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-ink underline underline-offset-2"
        >
          Open it
        </a>{" "}
        → expand the description →{" "}
        <span className="text-ink">Show transcript</span> → select the panel
        and copy.
      </p>

      <textarea
        value={video.raw}
        onChange={(e) => onChange({ raw: e.target.value })}
        rows={4}
        placeholder="Paste the transcript here — timestamps and all, they get stripped out."
        className="writeline mt-2 w-full py-2 text-[14px] leading-relaxed placeholder:text-[13px] placeholder:text-mute/60"
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <span
          className={`text-[13px] ${tooShort ? "text-brass" : "text-mute"}`}
        >
          {!cleaned
            ? "Nothing pasted yet."
            : tooShort
              ? `Only ${cleaned.text.length} characters — too little to build questions from.`
              : `${Math.max(1, Math.round(cleaned.text.length / 1000))}k characters of speech${
                  cleaned.cuesRemoved > 0
                    ? `, ${cleaned.cuesRemoved} timestamps stripped`
                    : ""
                }`}
        </span>
        <button
          type="button"
          onClick={onAdd}
          disabled={
            !cleaned?.text || cleaned.text.length < 200 || needsName || busy
          }
          className="min-h-[40px] rounded-sm bg-ink px-4 py-1.5 text-[13px] font-medium text-bg disabled:opacity-40"
        >
          Add this one
        </button>
      </div>
    </li>
  );
}
