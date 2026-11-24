export type Run = { text: string; bold?: boolean; code?: boolean; href?: string };
export type Block =
  | { type: 'heading'; level: number; runs: Run[] }
  | { type: 'paragraph' | 'source'; runs: Run[] }
  | { type: 'list'; items: Run[][] }
  | { type: 'rule' };

function inline(text: string): Run[] {
  const runs: Run[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > end) runs.push({ text: text.slice(end, match.index) });
    if (match[1]) runs.push({ text: match[1], bold: true });
    else if (match[2]) runs.push({ text: match[2], code: true });
    else if (match[3] && match[4]) runs.push({ text: match[3], href: match[4] });
    end = match.index + match[0].length;
  }
  if (end < text.length) runs.push({ text: text.slice(end) });
  return runs;
}

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let items: Run[][] = [];
  function flush() {
    if (paragraph.length) blocks.push({ type: 'paragraph', runs: inline(paragraph.join(' ')) });
    if (items.length) blocks.push({ type: 'list', items });
    paragraph = [];
    items = [];
  }
  for (const line of text.split(/\r?\n/)) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const source = /^<sub>(Fonte:.*?)<\/sub>\s*$/.exec(line);
    const list = /^-\s+(.+)$/.exec(line);
    if (!line.trim()) flush();
    else if (heading?.[1] && heading[2]) {
      flush();
      blocks.push({ type: 'heading', level: heading[1].length, runs: inline(heading[2]) });
    } else if (source?.[1]) {
      flush();
      blocks.push({ type: 'source', runs: inline(source[1]) });
    } else if (/^---\s*$/.test(line)) {
      flush();
      blocks.push({ type: 'rule' });
    } else if (list?.[1]) {
      if (paragraph.length) flush();
      items.push(inline(list[1]));
    } else {
      if (items.length) flush();
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}
