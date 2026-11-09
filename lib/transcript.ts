/**
 * Cleaning up a pasted transcript.
 *
 * What comes out of YouTube's Show transcript panel is timestamps and text
 * interleaved, one caption cue per line. Fed in raw, a third of the material
 * budget would be clock readings, and the model would have to work out which
 * half of each line was speech. People also paste subtitle files they have
 * downloaded, so SRT and WebVTT are understood too.
 *
 * No server-only marker: the browser cleans the paste as it is made, so the
 * student sees what will actually be stored before they commit to it.
 */

/** 0:05 · 12:34 · 1:02:03, with optional hours and milliseconds. */
const TIMESTAMP_ONLY = /^\(?\[?(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\]?\)?$/;
const LEADING_TIMESTAMP =
  /^\(?\[?(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\]?\)?\s+/;
/** 00:00:01,000 --> 00:00:04,000, the SRT and WebVTT cue header. */
const CUE_RANGE = /-->/;
/** A bare cue number on its own line, as SRT files have. */
const CUE_NUMBER = /^\d{1,5}$/;
/** [Music], (applause), ♪ — annotations, not things to be questioned on. */
const ANNOTATION = /[[(][^\])\n]{1,40}[\])]/g;

export interface CleanedTranscript {
  text: string;
  /** Cue lines recognised and stripped, as a sign the paste was understood. */
  cuesRemoved: number;
}

export function cleanTranscript(raw: string): CleanedTranscript {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");

  const kept: string[] = [];
  let cuesRemoved = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    if (trimmed === "WEBVTT" || trimmed.startsWith("NOTE ")) continue;

    if (TIMESTAMP_ONLY.test(trimmed) || CUE_RANGE.test(trimmed)) {
      cuesRemoved += 1;
      continue;
    }

    // An SRT cue number is only a cue number when a time range follows it;
    // otherwise it is something the speaker said. Peek at the next line by
    // index, not by searching for this line's text, which would find the
    // first identical line rather than this one.
    if (CUE_NUMBER.test(trimmed) && CUE_RANGE.test(lines[i + 1]?.trim() ?? "")) {
      cuesRemoved += 1;
      continue;
    }

    const withoutStamp = trimmed.replace(LEADING_TIMESTAMP, "");
    if (withoutStamp !== trimmed) cuesRemoved += 1;

    const text = withoutStamp.replace(ANNOTATION, " ").replace(/♪/g, " ").trim();
    if (text) kept.push(text);
  }

  /*
   * Captions are broken mid-sentence at display width, so joining with
   * spaces restores the speech. A line that already ends a sentence keeps
   * its break, which gives the model something to hold on to in auto
   * captions that have no punctuation at all.
   */
  let text = "";
  for (const line of kept) {
    if (!text) {
      text = line;
      continue;
    }
    text += /[.!?:]$/.test(text) ? "\n" : " ";
    text += line;
  }

  // YouTube's panel repeats the previous line as the next one scrolls in.
  text = text.replace(/\b(.{12,}?)\s+\1\b/g, "$1");

  return { text: text.replace(/[ \t]+/g, " ").trim(), cuesRemoved };
}
