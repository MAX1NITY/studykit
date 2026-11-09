/**
 * Recognising a YouTube link.
 *
 * Kept apart from the fetching so it runs in the browser too: the link can
 * be checked as it is pasted, rather than after a round trip that was never
 * going to work.
 */

const ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Pulls the video id out of whatever form of link was pasted.
 *
 * Returns null when the input is not a YouTube video, so the caller can say
 * so plainly instead of fetching something meaningless.
 */
export function parseYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // A bare id, which is what people paste surprisingly often.
  if (ID.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const youTubeHost =
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com" ||
    host === "youtu.be";

  if (!youTubeHost) return null;

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return ID.test(id) ? id : null;
  }

  const v = url.searchParams.get("v");
  if (v && ID.test(v)) return v;

  // /shorts/ID, /embed/ID, /live/ID, /v/ID
  const match = /^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/.exec(
    url.pathname,
  );
  return match ? match[1] : null;
}
