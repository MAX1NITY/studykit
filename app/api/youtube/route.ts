import { getSession } from "@/lib/auth";
import { fail, unauthorized } from "@/lib/api";
import { findYouTubeIds, parseYouTubeId } from "@/lib/youtube-url";
import { fetchVideoInfo } from "@/lib/youtube";

/** Only oEmbed lookups happen here; no AI and no large transfer. */
export const maxDuration = 30;

/** Enough for a chapter's worth of videos, few enough to stay quick. */
const MAX_VIDEOS = 12;

/**
 * Looks up the YouTube videos in whatever was pasted.
 *
 * The transcripts are not fetched: see lib/youtube.ts for why there is no
 * legitimate way for a server to do that. This exists so the student pastes
 * links, sees the real titles come back, and knows they have the right
 * videos before going off to copy anything.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { url } = (await request.json().catch(() => ({}))) as { url?: string };

  if (!url?.trim()) return fail("Paste a YouTube link first.");

  // A single link may be a bare id; several must look like links, so that a
  // word in someone's notes is never mistaken for a video.
  const single = parseYouTubeId(url);
  const ids = single ? [single] : findYouTubeIds(url);

  if (ids.length === 0) {
    return fail(
      "No YouTube videos in that.",
      400,
      "Links like youtube.com/watch?v=… or youtu.be/… , separated by commas or new lines. A channel or playlist link will not work.",
    );
  }

  const wanted = ids.slice(0, MAX_VIDEOS);

  // Looked up together: one slow video should not hold up the rest.
  const videos = await Promise.all(
    wanted.map(async (videoId) => {
      const info = await fetchVideoInfo(videoId);
      return {
        videoId,
        title: info?.title ?? null,
        author: info?.author ?? null,
        watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      };
    }),
  );

  return Response.json({
    videos,
    ignored: Math.max(0, ids.length - wanted.length),
  });
}
