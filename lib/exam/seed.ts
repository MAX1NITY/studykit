import "server-only";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { declaredObjectives } from "./select";

export interface SeedChapter {
  ordinal: number;
  title: string;
  domain: string;
  objectives: string[];
  content: string;
}

interface IndexEntry {
  chapter: number;
  title: string;
  file: string;
}

/**
 * Reads the Core 1 syllabus text shipped with the app.
 *
 * The chapters live as files rather than as a generated TypeScript module so
 * they are not bundled into every serverless function: only the seed route
 * needs them, and only once per account.
 *
 * Each chapter's domain and objectives are read back out of its own CompTIA
 * header rather than taken from the index, so the app and the files cannot
 * drift apart: whatever the parser says is what gets stored.
 */
export async function readSeedChapters(): Promise<SeedChapter[]> {
  const dir = path.join(process.cwd(), "content", "core1");

  let index: IndexEntry[];
  try {
    index = JSON.parse(await readFile(path.join(dir, "index.json"), "utf8"));
  } catch {
    // No index: fall back to the filenames, which are ordered by prefix.
    // A missing directory is the normal case in a deployment — the chapters
    // are gitignored — so it reads as "nothing to seed" rather than an error,
    // and /prep offers the file drop instead.
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".txt")).sort();
    } catch {
      return [];
    }
    index = files.map((file, i) => ({
      chapter: i + 1,
      title: file.replace(/^\d+-/, "").replace(/\.txt$/, "").replace(/-/g, " "),
      file,
    }));
  }

  const chapters: SeedChapter[] = [];

  for (const entry of index) {
    const content = (await readFile(path.join(dir, entry.file), "utf8")).trim();
    if (content.length < 500) continue;
    const { domain, objectives } = declaredObjectives(content);
    chapters.push({
      ordinal: entry.chapter,
      title: entry.title,
      domain,
      objectives,
      content,
    });
  }

  return chapters.sort((a, b) => a.ordinal - b.ordinal);
}
