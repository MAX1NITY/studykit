/**
 * Cleaning a pasted transcript.
 *
 * Whatever comes out of YouTube's panel has to survive this intact: losing a
 * line of a lecture is invisible at paste time and shows up later as a gap
 * in the cards. Dropping clock readings matters nearly as much — they would
 * otherwise eat a third of the material budget.
 */
import assert from "node:assert/strict";

const { cleanTranscript } = await import("../lib/transcript.ts");

// --- YouTube's own panel: timestamp line, then the caption ---------------
{
  const { text, cuesRemoved } = cleanTranscript(`0:00
welcome to networking fundamentals
0:04
today we are looking at the OSI model
0:09
there are seven layers`);

  assert.equal(
    text,
    "welcome to networking fundamentals today we are looking at the OSI model there are seven layers",
  );
  assert.equal(cuesRemoved, 3);
}

// --- the same panel with the timestamp inline ----------------------------
{
  const { text } = cleanTranscript(`0:00 welcome to networking
1:23 the OSI model has seven layers
12:04 and that is the physical layer`);

  assert.equal(
    text,
    "welcome to networking the OSI model has seven layers and that is the physical layer",
  );
}

// --- hours, and a downloaded SRT file ------------------------------------
{
  const { text, cuesRemoved } = cleanTranscript(`1
00:00:01,000 --> 00:00:04,000
A switch operates at layer two.

2
00:00:04,500 --> 00:00:08,000
A router operates at layer three.`);

  assert.equal(
    text,
    "A switch operates at layer two.\nA router operates at layer three.",
  );
  assert.ok(cuesRemoved >= 4, `expected cue lines stripped, got ${cuesRemoved}`);
}

// --- WebVTT --------------------------------------------------------------
{
  const { text } = cleanTranscript(`WEBVTT

00:01.000 --> 00:04.000
DHCP hands out addresses

00:04.000 --> 00:07.000
on a timed lease`);

  assert.equal(text, "DHCP hands out addresses on a timed lease");
  assert.ok(!text.includes("WEBVTT"));
}

// --- sound annotations are not content -----------------------------------
{
  const { text } = cleanTranscript(`0:00
[Music]
0:05
so the CMOS battery [Applause] keeps the clock running
0:09
♪ ♪`);

  assert.equal(text, "so the CMOS battery keeps the clock running");
}

// --- a long hours-marked lecture keeps every word ------------------------
{
  const { text } = cleanTranscript(`1:02:03
the final topic is subnetting
1:02:10
which we will cover next week`);

  assert.equal(text, "the final topic is subnetting which we will cover next week");
}

// --- A NUMBER THAT IS CONTENT MUST NOT BE EATEN AS A CUE NUMBER ---------
// "100" on its own line is a thing a speaker says, not an SRT index.
{
  const { text } = cleanTranscript(`0:00
how many addresses
0:03
100
0:05
in that range`);

  assert.match(text, /100/, `a spoken number was swallowed: ${text}`);
}

// --- plain prose passes through unharmed --------------------------------
{
  const prose = "A switch forwards frames using MAC addresses.";
  const { text, cuesRemoved } = cleanTranscript(prose);
  assert.equal(text, prose);
  assert.equal(cuesRemoved, 0, "nothing should be stripped from plain notes");
}

// --- sentences keep their boundaries ------------------------------------
{
  const { text } = cleanTranscript(`0:00
This is the first sentence.
0:04
This is the second.`);
  assert.equal(text, "This is the first sentence.\nThis is the second.");
}

// --- the scrolling panel's repeated line is collapsed -------------------
{
  const { text } = cleanTranscript(`0:00
the subnet mask determines the network portion
0:04
the subnet mask determines the network portion of the address`);
  assert.equal(
    (text.match(/the subnet mask determines the network portion/g) ?? []).length,
    1,
    `the repeated line was kept twice: ${text}`,
  );
}

// --- empty in, empty out ------------------------------------------------
assert.equal(cleanTranscript("").text, "");
assert.equal(cleanTranscript("\n\n  \n").text, "");

console.log("Transcript cleaning: all assertions passed");

// --- a repeated number must be judged on its own line, not the first one -
// Looking the line up by text rather than by index checked the wrong
// neighbour: here the first "2" is an SRT index and the second is speech.
{
  const { text } = cleanTranscript(`1
00:00:01,000 --> 00:00:04,000
layer one is physical

2
00:00:04,000 --> 00:00:07,000
how many layers are there
2
and that is wrong`);

  assert.match(text, /how many layers are there 2 and that is wrong/, text);
}

console.log("Transcript cleaning (indexing): passed");
