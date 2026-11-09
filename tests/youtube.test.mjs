/**
 * Recognising a YouTube link.
 *
 * The parsing is the half of this feature that can be tested offline, and
 * it is the half a student hits first: a link that is rejected for the wrong
 * reason, or accepted and then fetched as nonsense, both waste their time.
 */
import assert from "node:assert/strict";

const { parseYouTubeId } = await import("../lib/youtube-url.ts");

const ID = "dQw4w9WgXcQ";

// --- the shapes people actually paste ------------------------------------
for (const link of [
  `https://www.youtube.com/watch?v=${ID}`,
  `https://youtube.com/watch?v=${ID}`,
  `http://www.youtube.com/watch?v=${ID}`,
  `www.youtube.com/watch?v=${ID}`,
  `youtube.com/watch?v=${ID}`,
  `https://m.youtube.com/watch?v=${ID}`,
  `https://music.youtube.com/watch?v=${ID}`,
  `https://www.youtube-nocookie.com/embed/${ID}`,
  `https://youtu.be/${ID}`,
  `https://youtu.be/${ID}?si=AbCdEfGhIjKlMnOp`,
  `https://www.youtube.com/shorts/${ID}`,
  `https://www.youtube.com/embed/${ID}`,
  `https://www.youtube.com/live/${ID}`,
  `https://www.youtube.com/v/${ID}`,
  // Timestamps and playlists ride along on shared links.
  `https://www.youtube.com/watch?v=${ID}&t=42s`,
  `https://www.youtube.com/watch?v=${ID}&list=PLabcdef&index=3`,
  `https://youtu.be/${ID}?t=90`,
  // Pasted with whitespace, as happens from a chat message.
  `  https://www.youtube.com/watch?v=${ID}  `,
  // A bare id, which people paste surprisingly often.
  ID,
]) {
  assert.equal(parseYouTubeId(link), ID, `failed to read: ${link}`);
}

// --- things that are not a YouTube video ---------------------------------
for (const nope of [
  "",
  "   ",
  "not a link",
  "https://example.com/watch?v=dQw4w9WgXcQ",
  "https://vimeo.com/123456",
  "https://www.youtube.com/",
  "https://www.youtube.com/@somechannel",
  "https://www.youtube.com/results?search_query=network",
  // A playlist is not a video: fetching one would get nothing useful.
  "https://www.youtube.com/playlist?list=PLabcdef",
  // Right host, wrong id length.
  "https://www.youtube.com/watch?v=tooshort",
  "https://youtu.be/waytoolongforanid123",
  // A lookalike host must not be trusted.
  "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
  "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
]) {
  assert.equal(
    parseYouTubeId(nope),
    null,
    `should not have been read as a video: ${JSON.stringify(nope)}`,
  );
}

// --- ids using the full character set ------------------------------------
for (const id of ["a_b-c_d-e_f", "___________", "-----------", "0123456789A"]) {
  assert.equal(parseYouTubeId(`https://youtu.be/${id}`), id);
}

console.log("YouTube links: all assertions passed");
