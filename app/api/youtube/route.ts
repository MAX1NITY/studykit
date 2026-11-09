import { getSession } from "@/lib/auth";
import { fail, unauthorized } from "@/lib/api";
import { parseYouTubeId } from "@/lib/youtube-url";
import { fetchVideoInfo } from "@/lib/youtube";

/** Only an oEmbed lookup happens here; no AI and no large transfer. */
export const maxDuration = 30;

/**
 * Looks up a YouTube video so its transcript can be labelled properly.
 *
 * The transcript itself is not fetched: see lib/youtube.ts for why there is
 * no legitimate way for a server to do that. This exists so the student
 * pastes a link, sees the real title come back, and knows they have the
 * right video before they go and copy anything.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { url } = (await request.json().catch(() => ({}))) as { url?: string };

  if (!url?.trim()) return fail("Paste a YouTube link first.");

  const videoId = parseYouTubeId(url);
  if (!videoId) {
    return fail(
      "That does not look like a YouTube video link.",
      400,
      "Something like youtube.com/watch?v=… or youtu.be/… is what this expects. A channel or playlist link will not work.",
    );
  }

  const info = await fetchVideoInfo(videoId);

  return Response.json({
    videoId,
    title: info?.title ?? null,
    author: info?.author ?? null,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
  });
}
