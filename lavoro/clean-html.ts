// The one cleaner for posting descriptions, used by the server (linkedom) and by the desk (16g, the browser's own
// parser). It imports no parser: the caller passes an inert document, so this file runs unchanged on both sides.
// The output is built from the allowlist and escaped text, never by editing the parsed tree, so no attribute, comment
// or unknown tag can leak through and linkedom and a browser serialise it identically.

const keep = new Set(['p', 'br', 'div', 'span', 'mark', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'blockquote']);
for (const level of [1, 2, 3, 4, 5, 6]) keep.add(`h${level}`);
const drop = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'svg', 'head', 'title']);
// Where the plain text starts a new line: a block opens and closes one, `br` is one.
const blocks = new Set(['p', 'div', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

export type CleanHtml = { html: string; text: string };

const isElement = (node: Node): node is Element => node.nodeType === ELEMENT_NODE;
const escapeText = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function walk(parent: Node, pieces: string[]): string {
  let html = '';
  for (const node of parent.childNodes) {
    if (node.nodeType === TEXT_NODE) {
      const text = node.nodeValue ?? '';
      pieces.push(text.replaceAll(/\s+/g, ' '));
      html += escapeText(text);
      continue;
    }
    // Comments, CDATA and processing instructions are neither text nor elements.
    if (!isElement(node)) continue;
    const tag = node.localName.toLowerCase();
    if (drop.has(tag)) continue;
    if (tag === 'br') {
      pieces.push('\n');
      html += '<br>';
      continue;
    }
    const start = pieces.length;
    if (blocks.has(tag)) pieces.push('\n');
    const inner = walk(node, pieces);
    if (blocks.has(tag)) pieces.push('\n');
    // An unknown tag is unwrapped. A kept one with no text and no line break is dropped, which cascades upwards.
    if (!keep.has(tag)) html += inner;
    else if (inner.includes('<br>') || pieces.slice(start).some((piece) => piece.trim() !== ''))
      html += `<${tag}>${inner}</${tag}>`;
  }
  return html;
}

/**
 * `document` must be inert: a linkedom document on the server, the result of `new DOMParser().parseFromString('',
 * 'text/html')` in the browser, never the page's own (parsing into it would load images and fire their handlers).
 */
export function cleanHtml(document: Document, raw: string): CleanHtml {
  const root = document.createElement('div');
  root.innerHTML = raw;
  const pieces: string[] = [];
  const html = walk(root, pieces).trim();
  const text = pieces
    .join('')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
  return { html, text };
}
