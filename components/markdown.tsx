import type { ReactNode } from "react";

/**
 * A small Markdown renderer that builds React elements directly.
 *
 * Deliberately not an HTML-injecting library: guide text comes back from a
 * language model, and building elements means it can never carry markup into
 * the page.
 *
 * It handles what a model actually writes when asked for a study guide —
 * headings, nested bullets, numbered steps, tables, rules, quotes, fenced
 * code and links. Anything it does not recognise is shown as plain text,
 * which is the right failure: a stray marker is a blemish, whereas dropping
 * a line would lose something the student needs.
 */

// ------------------------------------------------------------------ inline

/*
 * Code spans are matched first so a backtick can hold asterisks without them
 * turning into emphasis. Single-asterisk emphasis requires a non-space right
 * after the opening marker, which keeps arithmetic like "2 * 3 and 4 * 5"
 * from being read as italics.
 */
const INLINE_SOURCE =
  "(`[^`]+`)|(\\[[^\\]\\n]*\\]\\([^)\\s]*\\))|(\\*\\*\\*[^\\n]+?\\*\\*\\*)|(\\*\\*[^\\n]+?\\*\\*)|(\\*[^\\s*][^\\n]*?\\*)|(_[^\\s_][^\\n]*?_)";

/** Only ordinary web links become anchors; anything else stays as text. */
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

export function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;

  // A fresh matcher per call: this function recurses into link labels, and a
  // shared /g regex would have its lastIndex reset by the inner call, leaving
  // the outer loop scanning the same text forever.
  const scanner = new RegExp(INLINE_SOURCE, "g");
  let match: RegExpExecArray | null;

  while ((match = scanner.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const key = `${keyPrefix}-i${n++}`;
    const token = match[0];

    if (token.startsWith("`")) {
      out.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      out.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">
            {inline(label, key)}
          </a>
        ) : (
          <span key={key}>{inline(label, key)}</span>
        ),
      );
    } else if (token.startsWith("***")) {
      out.push(
        <strong key={key}>
          <em>{token.slice(3, -3)}</em>
        </strong>,
      );
    } else if (token.startsWith("**")) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    }

    last = match.index + token.length;
    // A zero-length match would never advance; nothing in the pattern can
    // produce one, but the guard keeps that guarantee local.
    if (token.length === 0) scanner.lastIndex += 1;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ------------------------------------------------------------- block model

interface ListItem {
  text: string[];
  children: ListBlock | null;
}

interface ListBlock {
  ordered: boolean;
  items: ListItem[];
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const BULLET = /^([-*+])\s+(.*)$/;
const ORDERED = /^(\d+)[.)]\s+(.*)$/;
const FENCE = /^(?:```|~~~)(.*)$/;
const QUOTE = /^>\s?(.*)$/;

/** A table needs a header row and a |---|---| rule under it. */
function isTableRule(line: string): boolean {
  return /^\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function indentOf(line: string): number {
  const match = /^[ \t]*/.exec(line);
  // A tab counts as four columns, which is how a model usually means it.
  return (match?.[0] ?? "").replace(/\t/g, "    ").length;
}

/**
 * Turns consecutive list lines into a tree.
 *
 * Indentation used to be stripped before parsing, which flattened every
 * sub-bullet into its parent list — a hierarchy the model wrote on purpose
 * came out as one long undifferentiated run.
 */
function buildList(
  lines: { indent: number; ordered: boolean; text: string; cont?: boolean }[],
  from: number,
  indent: number,
): { block: ListBlock; next: number } {
  const block: ListBlock = { ordered: lines[from].ordered, items: [] };
  let i = from;

  while (i < lines.length) {
    const line = lines[i];

    if (line.indent < indent) break;

    if (line.indent > indent) {
      const nested = buildList(lines, i, line.indent);
      const parent = block.items[block.items.length - 1];
      if (parent) parent.children = nested.block;
      i = nested.next;
      continue;
    }

    // A wrapped line belongs to the item above it, not to a new paragraph.
    if (line.cont) {
      const parent = block.items[block.items.length - 1];
      if (parent) parent.text.push(line.text);
      i += 1;
      continue;
    }

    if (line.ordered !== block.ordered) break;

    block.items.push({ text: [line.text], children: null });
    i += 1;
  }

  return { block, next: i };
}

function renderList(block: ListBlock, key: string): ReactNode {
  const items = block.items.map((item, i) => (
    <li key={`${key}-${i}`}>
      {inline(item.text.join(" "), `${key}-${i}`)}
      {item.children ? renderList(item.children, `${key}-${i}-c`) : null}
    </li>
  ));

  return block.ordered ? (
    <ol key={key}>{items}</ol>
  ) : (
    <ul key={key}>{items}</ul>
  );
}

// ---------------------------------------------------------------- renderer

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];

  let paragraph: string[] = [];
  let listLines: {
    indent: number;
    ordered: boolean;
    text: string;
    cont?: boolean;
  }[] = [];
  let quote: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const key = `p-${blocks.length}`;
    blocks.push(<p key={key}>{inline(paragraph.join(" "), key)}</p>);
    paragraph = [];
  };

  const flushList = () => {
    if (!listLines.length) return;
    const key = `l-${blocks.length}`;
    const base = Math.min(...listLines.map((l) => l.indent));
    let i = 0;
    while (i < listLines.length) {
      const { block, next } = buildList(listLines, i, base);
      blocks.push(renderList(block, `${key}-${i}`));
      i = next > i ? next : i + 1;
    }
    listLines = [];
  };

  const flushQuote = () => {
    if (!quote.length) return;
    const key = `q-${blocks.length}`;
    blocks.push(
      <blockquote key={key}>{inline(quote.join(" "), key)}</blockquote>,
    );
    quote = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trimEnd();
    const line = raw.trim();

    // ------------------------------------------------------- fenced code
    const fence = FENCE.exec(line);
    if (fence) {
      flushAll();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index].trim())) {
        body.push(lines[index]);
        index += 1;
      }
      const key = `c-${blocks.length}`;
      blocks.push(
        <pre key={key}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (!line) {
      flushAll();
      continue;
    }

    // ------------------------------------------------------------ tables
    if (
      line.includes("|") &&
      index + 1 < lines.length &&
      isTableRule(lines[index + 1].trim())
    ) {
      flushAll();
      const header = splitRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().includes("|")) {
        rows.push(splitRow(lines[index].trim()));
        index += 1;
      }
      index -= 1;

      const key = `t-${blocks.length}`;
      blocks.push(
        <table key={key}>
          <thead>
            <tr>
              {header.map((cell, i) => (
                <th key={`${key}-h${i}`}>{inline(cell, `${key}-h${i}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={`${key}-r${r}`}>
                {header.map((_, c) => (
                  <td key={`${key}-r${r}c${c}`}>
                    {inline(row[c] ?? "", `${key}-r${r}c${c}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    // ----------------------------------------------------------- heading
    const heading = HEADING.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const key = `h-${blocks.length}`;
      blocks.push(
        level <= 1 ? (
          <h2 key={key} className="first-of-type:mt-0">
            {inline(heading[2], key)}
          </h2>
        ) : level === 2 ? (
          <h2 key={key}>{inline(heading[2], key)}</h2>
        ) : (
          <h3 key={key}>{inline(heading[2], key)}</h3>
        ),
      );
      continue;
    }

    // -------------------------------------------------------------- rule
    if (RULE.test(line)) {
      flushAll();
      blocks.push(<hr key={`r-${blocks.length}`} />);
      continue;
    }

    // -------------------------------------------------------- blockquote
    const quoted = QUOTE.exec(line);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }
    flushQuote();

    // ------------------------------------------------------------- lists
    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);

    if (bullet || ordered) {
      flushParagraph();
      listLines.push({
        indent: indentOf(raw),
        ordered: Boolean(ordered),
        text: (bullet ?? ordered)![2],
      });
      continue;
    }

    // An indented line directly under a list item continues that item.
    if (listLines.length && indentOf(raw) > 0) {
      listLines.push({
        indent: listLines[listLines.length - 1].indent,
        ordered: listLines[listLines.length - 1].ordered,
        text: line,
        cont: true,
      });
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushAll();

  return <div className="guide">{blocks}</div>;
}
