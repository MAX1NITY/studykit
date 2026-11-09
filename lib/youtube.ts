import "server-only";

/**
 * Looking up a YouTube video.
 *
 * A video is only usable here as text, which means its captions — and there
 * is no legitimate way for a server to fetch those. The Data API's
 * captions.download must be authorised as the video's owner, which is no use
 * for watching someone else's lecture. Reading the watch page instead was
 * tried and answered with "Sign in to confirm that you're not a bot": YouTube
 * blocks datacentre addresses deliberately, and dressing the request up as a
 * phone app to get past that is circumvention, not engineering.
 *
 * So the transcript comes from where YouTube already offers it — the Show
 * transcript panel under any captioned video, in the student's own browser.
 * They copy it, StudyKit cleans it up. That needs no key, costs nothing,
 * cannot be rate-limited, and does not break when YouTube changes its page.
 *
 * What the server does do is look the video up through oEmbed, a published
 * unauthenticated endpoint meant for exactly this, so the material carries
 * the real title and channel rather than a bare link.
 */

export interface VideoInfo {
  videoId: string;
  title: string;
  author: string | null;
}

/**
 * Title and channel for a video.
 *
 * Returns null rather than throwing: a missing title is cosmetic, and the
 * student can name the material themselves.
 */
export async function fetchVideoInfo(
  videoId: string,
): Promise<VideoInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`,
      )}&format=json`,
      { signal: controller.signal },
    );

    if (!res.ok) return null;

    const data = (await res.json()) as { title?: string; author_name?: string };

    return data.title
      ? {
          videoId,
          title: data.title.trim(),
          author: data.author_name?.trim() || null,
        }
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
