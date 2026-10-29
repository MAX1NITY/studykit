/**
 * The guide renderer takes model output and must never let markup through.
 * It builds React elements, so this renders it to static HTML and checks
 * both the formatting and that injected markup stays inert text.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath, pathToFileURL } from "node:url";

// Node cannot strip types from JSX, so compile the component first.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const out = path.join(root, ".markdown-test-build");

fs.rmSync(out, { recursive: true, force: true });
execFileSync(
  "npx",
  [
    "tsc", "components/markdown.tsx",
    "--jsx", "react-jsx",
    "--module", "esnext",
    "--target", "es2022",
    "--moduleResolution", "bundler",
    "--skipLibCheck",
    "--outDir", out,
  ],
  { cwd: root, stdio: "inherit" },
);

const { Markdown } = await import(
  pathToFileURL(path.join(out, "markdown.js")).href
);

const render = (text) => renderToStaticMarkup(Markdown({ text }));

// --- headings ---------------------------------------------------------------
let html = render("## Mitosis\n### Prophase\nText here.");
assert.match(html, /<h2>Mitosis<\/h2>/);
assert.match(html, /<h3>Prophase<\/h3>/);
assert.match(html, /<p>Text here\.<\/p>/);

// deeper headings fold to h3 rather than disappearing
assert.match(render("#### Deep"), /<h3>Deep<\/h3>/);

// --- lists ------------------------------------------------------------------
html = render("- one\n- two\n- three");
assert.match(html, /<ul>.*<li>one<\/li>.*<li>two<\/li>.*<li>three<\/li>.*<\/ul>/s);

html = render("1. first\n2. second");
assert.match(html, /<ol>.*<li>first<\/li>.*<li>second<\/li>.*<\/ol>/s);

// switching list type starts a new list, it does not merge
html = render("- bullet\n1. number");
assert.match(html, /<ul>/);
assert.match(html, /<ol>/);

// --- inline formatting ------------------------------------------------------
html = render("The **mitochondrion** is the `powerhouse` and *italic* too.");
assert.match(html, /<strong>mitochondrion<\/strong>/);
assert.match(html, /<code>powerhouse<\/code>/);
assert.match(html, /<em>italic<\/em>/);

// --- paragraphs join wrapped lines, blank lines split them ------------------
html = render("line one\nline two\n\nsecond para");
assert.match(html, /<p>line one line two<\/p>/);
assert.match(html, /<p>second para<\/p>/);

// --- markup in the model's output must render as text, never as HTML --------
const hostile = '<img src=x onerror="alert(1)"> and <script>alert(2)</script>';
html = render(hostile);
assert.ok(!html.includes("<img"), "raw <img> leaked into the output");
assert.ok(!html.includes("<script"), "raw <script> leaked into the output");
assert.match(html, /&lt;img/, "markup should be escaped text");
assert.match(html, /&lt;script/, "markup should be escaped text");

// the same inside a heading and a list item
html = render("## <b>bold</b>\n- <i>item</i>");
assert.ok(!html.includes("<b>") && !html.includes("<i>"), "markup leaked");

// --- empty input does not throw --------------------------------------------
assert.doesNotThrow(() => render(""));
assert.doesNotThrow(() => render("\n\n\n"));

fs.rmSync(out, { recursive: true, force: true });
console.log("Markdown renderer: all assertions passed");

// ---------------------------------------------------------------------------
// What a model actually writes in a study guide.
//
// These all used to come out wrong: sub-bullets were flattened into their
// parent list, a table became one run-on paragraph, and ---, > and ``` were
// printed as literal characters. None of it showed up in testing because the
// seeded sample guides happened to avoid every one of them.
// ---------------------------------------------------------------------------

// Nested bullets keep their hierarchy.
{
  const html = render(`- Storage
  - HDD
  - SSD
- Memory`);
  assert.match(html, /<ul>.*<li>Storage<ul>/s, `nested list was flattened: ${html}`);
  assert.match(html, /<li>HDD<\/li><li>SSD<\/li>/s);
  assert.match(html, /<li>Memory<\/li>/);
}

// A table renders as a table.
{
  const html = render(`| Scheme | Max |
| --- | --- |
| MBR | 2TB |
| GPT | 9ZB |`);
  assert.match(html, /<table>/);
  assert.match(html, /<th>Scheme<\/th><th>Max<\/th>/);
  assert.match(html, /<td>MBR<\/td><td>2TB<\/td>/);
  assert.match(html, /<td>GPT<\/td><td>9ZB<\/td>/);
  assert.ok(!html.includes("| ---"), "table rule leaked into the output");
}

// A horizontal rule is a rule, not the characters.
{
  const html = render("Before\n\n---\n\nAfter");
  assert.match(html, /<hr\s*\/?>/);
  assert.ok(!/<p>---<\/p>/.test(html), "--- rendered as a paragraph");
}

// Blockquotes and fenced code use their own elements.
{
  assert.match(render("> Remember this"), /<blockquote>Remember this<\/blockquote>/);
  const fenced = render("```\nipconfig /all\n```");
  assert.match(fenced, /<pre><code>ipconfig \/all<\/code><\/pre>/);
  assert.ok(!fenced.includes("```"), "code fence markers leaked");
}

// A wrapped bullet stays one bullet instead of splitting the list in two.
{
  const html = render(`- A long point that carries on
  onto a second line
- The next point`);
  const items = html.match(/<li>/g) ?? [];
  assert.equal(items.length, 2, `wrapped bullet split the list: ${html}`);
  assert.match(html, /carries on onto a second line/);
  assert.equal((html.match(/<ul>/g) ?? []).length, 1, "list was split in two");
}

// Emphasis: triple asterisks, and arithmetic that must not become italics.
{
  const html = render("***critical*** and 2 * 3 and 4 * 5");
  assert.match(html, /<strong><em>critical<\/em><\/strong>/);
  assert.ok(!html.includes("<em> 3 and 4 </em>"), `stray italics: ${html}`);
  assert.match(html, /2 \* 3 and 4 \* 5/);
}

// Links become anchors; anything that is not an ordinary web link does not.
{
  const html = render("See [the docs](https://example.com/a) now");
  assert.match(html, /<a href="https:\/\/example\.com\/a"[^>]*>the docs<\/a>/);
  assert.ok(!html.includes("](") , "link syntax leaked into the output");

  const unsafe = render("[click](javascript:alert(1))");
  assert.ok(!unsafe.includes("javascript:"), `unsafe href rendered: ${unsafe}`);
  assert.match(unsafe, /click/);
}

// Ordered steps still work, and a numbered list is not merged with bullets.
{
  const html = render("1. First\n2. Second\n\n- Bullet");
  assert.match(html, /<ol><li>First<\/li><li>Second<\/li><\/ol>/);
  assert.match(html, /<ul><li>Bullet<\/li><\/ul>/);
}

console.log("Markdown guide formatting: all assertions passed");
