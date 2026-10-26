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
