// pdf.js runs its parser in a web worker, which must be served as a static
// file rather than bundled. Copy it into public/ before dev and build.
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const from = resolve(
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
);
const to = resolve("public/pdf.worker.min.mjs");

await mkdir(dirname(to), { recursive: true });
await copyFile(from, to);
console.log("copied pdf.js worker -> public/pdf.worker.min.mjs");
