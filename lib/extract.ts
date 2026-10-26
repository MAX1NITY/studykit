"use client";

/**
 * Pulls plain text out of a file in the browser.
 *
 * PDF parsing happens client-side on purpose: the file never leaves the
 * device, and only the extracted text is sent to the server.
 */

const TEXT_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
];

export interface Extracted {
  name: string;
  kind: "text" | "pdf";
  content: string;
}

export async function extractFile(file: File): Promise<Extracted> {
  const isPdf =
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    return { name: file.name, kind: "pdf", content: await extractPdf(file) };
  }

  const looksTextual =
    TEXT_TYPES.includes(file.type) ||
    file.type.startsWith("text/") ||
    /\.(txt|md|markdown|csv|json|rtf)$/i.test(file.name);

  if (!looksTextual) {
    throw new Error(
      `${file.name} is not a file StudyKit can read. Use a PDF, .txt or .md file, or paste the text instead.`,
    );
  }

  return { name: file.name, kind: "text", content: await file.text() };
}

async function extractPdf(file: File): Promise<string> {
  // Loaded on demand so pdf.js stays out of the initial bundle.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const doc = await loadingTask.promise;

  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) pages.push(text);
    page.cleanup();
  }

  // The loading task owns the worker; destroying it releases both.
  await loadingTask.destroy();

  const joined = pages.join("\n\n");
  if (!joined.trim()) {
    throw new Error(
      `No text could be read from ${file.name}. It is probably a scan of a page rather than a text PDF.`,
    );
  }

  return joined;
}
