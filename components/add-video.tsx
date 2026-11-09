"use client";

import { useState } from "react";
import { parseYouTubeId } from "@/lib/youtube-url";
import { cleanTranscript } from "@/lib/transcript";
import { postJSON } from "@/lib/fetch-json";
import { Notice } from "@/components/chrome";

/**
 * Adding a YouTube video as study material.
 *
 * The transcript is copied by the student rather than fetched by the app,
 * because there is no legitimate way for a server to fetch it: see
 * lib/youtube.ts. That makes this two steps, so the job here is to make
 * both of them short — confirm the right video by its real title, then
 * take the paste and show exactly what will be kept from it.
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

export function AddVideo({
  onAdd,
  busy,
}: {
  onAdd: (source: VideoSource) => void;
  busy?: boolean;
}) {
  const [link, setLink] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [looking, setLooking] = useState(false);
  const [raw, setRaw] = useState("");
  const [ownName, setOwnName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | undefined>();

  // Checked as it is typed, so a bad link is caught before any round trip.
  const looksLikeVideo = parseYouTubeId(link) !== null;
  const cleaned = raw.trim() ? cleanTranscript(raw) : null;

  async function look() {
    setError(null);
    setHint(undefined);
    setLooking(true);

    const result = await postJSON<Found>("/api/youtube", { url: link });
    setLooking(false);

    if (!result.ok) {
      setError(result.error.title);
      setHint(result.error.hint);
      return;
    }

    setFound(result.data);
    setOwnName("");
  }

  function add() {
    if (!cleaned?.text || !found) return;

    // `||` not `??`: an empty name is a string, not nullish, and would
    // otherwise win over the fallback.
    const title =
      found.title || ownName.trim() || `YouTube video ${found.videoId}`;
    const header = [
      `Transcript of the video "${title}"`,
      found.author ? `by ${found.author}` : null,
    ]
      .filter(Boolean)
      .join(" ");

    onAdd({
      name: title.slice(0, 200),
      kind: "url",
      content: `${header}\n${found.watchUrl}\n\n${cleaned.text}`,
    });

    setLink("");
    setFound(null);
    setRaw("");
  }

  return (
    <div>
      <label htmlFor="video" className="text-[13px] text-mute">
        Or add a video
      </label>

      <div className="mt-1 flex flex-wrap items-end gap-3">
        <input
          id="video"
          type="url"
          inputMode="url"
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            setFound(null);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && looksLikeVideo && !looking) {
              e.preventDefault();
              void look();
            }
          }}
          placeholder="https://www.youtube.com/watch?v=…"
          className="writeline min-w-0 flex-1 py-1.5 text-[15px] placeholder:text-mute/60"
        />
        <button
          type="button"
          onClick={() => void look()}
          disabled={!looksLikeVideo || looking || busy}
          className="min-h-[40px] shrink-0 rounded-sm border border-rule px-3 py-1.5 text-[13px] font-medium disabled:opacity-40"
        >
          {looking ? "Looking…" : "Find it"}
        </button>
      </div>

      {link.trim() && !looksLikeVideo ? (
        <p className="mt-1.5 text-[13px] text-brass">
          That is not a YouTube video link yet.
        </p>
      ) : (
        <p className="mt-1.5 text-[13px] text-mute">
          The video needs captions. StudyKit cannot pull them down itself —
          YouTube blocks servers from doing that — so you copy them across,
          which takes about ten seconds.
        </p>
      )}

      {error ? (
        <div className="mt-4">
          <Notice title={error} hint={hint} />
        </div>
      ) : null}

      {found ? (
        <div className="mt-5 border-l-2 border-brass pl-4">
          {found.title ? (
            <>
              <p className="text-[15px] font-medium">{found.title}</p>
              {found.author ? (
                <p className="text-[13px] text-mute">{found.author}</p>
              ) : null}
            </>
          ) : (
            <>
              {/* oEmbed answers for any public video, so an empty result
                  usually means the link is wrong or the video is private.
                  It can also just mean YouTube did not answer, and that is
                  no reason to stop someone pasting a transcript they have
                  in front of them — so this names it instead of blocking. */}
              <p className="text-[14px] text-brass">
                No title came back. Check the link is right — or if the video
                is private or unlisted, just name it yourself.
              </p>
              <input
                value={ownName}
                onChange={(e) => setOwnName(e.target.value)}
                placeholder="What is this video?"
                className="writeline mt-2 w-full py-1.5 text-[15px] placeholder:text-mute/60"
              />
            </>
          )}

          <ol className="mt-3 space-y-1 text-[13.5px] leading-relaxed text-mute">
            <li>
              1.{" "}
              <a
                href={found.watchUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-ink underline underline-offset-2"
              >
                Open the video
              </a>{" "}
              and expand the description.
            </li>
            <li>2. Press <span className="text-ink">Show transcript</span>.</li>
            <li>3. Select the whole panel, copy it, and paste it below.</li>
          </ol>

          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={6}
            placeholder="Paste the transcript here — timestamps and all, they get stripped out."
            className="writeline mt-3 w-full py-2 text-[14px] leading-relaxed placeholder:text-[13px] placeholder:text-mute/60"
          />

          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[13px] text-mute">
              {cleaned
                ? `${Math.max(1, Math.round(cleaned.text.length / 1000))}k characters of speech${
                    cleaned.cuesRemoved > 0
                      ? `, ${cleaned.cuesRemoved} timestamps stripped`
                      : ""
                  }`
                : "Nothing pasted yet."}
            </span>
            <button
              type="button"
              onClick={add}
              disabled={
                !cleaned?.text ||
                cleaned.text.length < 200 ||
                (!found.title && !ownName.trim()) ||
                busy
              }
              className="min-h-[40px] rounded-sm bg-ink px-4 py-1.5 text-[13px] font-medium text-bg disabled:opacity-40"
            >
              Add this video
            </button>
          </div>

          {cleaned && cleaned.text.length > 0 && cleaned.text.length < 200 ? (
            <p className="mt-1 text-[13px] text-brass">
              That is only {cleaned.text.length} characters — too little to
              build questions from.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
