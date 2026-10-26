import type { ReactNode } from "react";

/**
 * A small Markdown renderer that builds React elements directly.
 *
 * Deliberately not an HTML-injecting library: guide text comes back from a
 * language model, and rendering it as elements means it can never carry
 * markup into the page.
 */

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Split on **bold**, *italic* and `code`, keeping the delimiters.
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);

  parts.forEach((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      out.push(<strong key={key}>{part.slice(2, -2)}</strong>);
    } else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      out.push(<code key={key}>{part.slice(1, -1)}</code>);
    } else if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      out.push(<em key={key}>{part.slice(1, -1)}</em>);
    } else if (part) {
      out.push(part);
    }
  });

  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const key = `p-${blocks.length}`;
    blocks.push(<p key={key}>{inline(paragraph.join(" "), key)}</p>);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const key = `l-${blocks.length}`;
    const items = list.items.map((item, i) => (
      <li key={`${key}-${i}`}>{inline(item, `${key}-${i}`)}</li>
    ));
    blocks.push(
      list.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>,
    );
    list = null;
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const content = heading[2];
      const key = `h-${blocks.length}`;
      // Guides only need two heading levels; deeper ones fold into h3.
      blocks.push(
        level <= 2 ? (
          <h2 key={key}>{inline(content, key)}</h2>
        ) : (
          <h3 key={key}>{inline(content, key)}</h3>
        ),
      );
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(line.trim());
    if (bullet) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }

    const ordered = /^\d+[.)]\s+(.*)$/.exec(line.trim());
    if (ordered) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushAll();

  return <div className="guide">{blocks}</div>;
}
