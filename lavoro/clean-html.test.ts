import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from '../../apps/server/src/core/module-html.ts';
import { cleanHtml } from './clean-html.ts';

// Everything here is invented markup. The server hands the cleaner a blank linkedom document; the browser (16g) will
// hand it `new DOMParser().parseFromString('', 'text/html')`.
const blank = () => parseHTML('<!doctype html><html><body></body></html>').document;
const clean = (html: string) => cleanHtml(blank(), html);

const allowed = ['p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'blockquote'];
const allowedTags = new Set([...allowed, 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

void test('keeps the allowlisted tags and removes every attribute', () => {
  const result = clean(
    '<p class="lead" id="a" style="color:red" onclick="evil()">Hello <b data-x="1" title="t">world</b></p>',
  );
  assert.equal(result.html, '<p>Hello <b>world</b></p>');
  assert.equal(result.text, 'Hello world');
});

void test('drops scripts, styles and embeds together with their content', () => {
  const result = clean(
    [
      '<p>before</p>',
      '<script>alert(1)</script>',
      '<style>p { display: none }</style>',
      '<noscript>no script text</noscript>',
      '<template><b>template text</b></template>',
      '<iframe src="https://example.invalid/x">frame text</iframe>',
      '<object data="x">object text</object>',
      '<svg onload="evil()"><title>svg title</title><text>svg text</text></svg>',
      '<head><title>page title</title></head>',
      '<p>after</p>',
    ].join(''),
  );
  assert.equal(result.html, '<p>before</p><p>after</p>');
  assert.equal(result.text, 'before\nafter');
});

void test('a link keeps its text and loses the javascript: target and the event handlers', () => {
  const result = clean('<p><a href="javascript:steal()" onmouseover="x()">open the offer</a></p>');
  assert.equal(result.html, '<p>open the offer</p>');
  assert.ok(!/javascript|href|onmouseover/.test(result.html));
});

void test('an image with an error handler leaves nothing behind', () => {
  assert.deepEqual(clean('<img src="x" onerror="alert(1)">'), { html: '', text: '' });
});

void test('unknown tags are unwrapped at any depth and their text stays', () => {
  const result = clean('<section><article><custom-tag><b>deep</b> text</custom-tag></article></section>');
  assert.equal(result.html, '<b>deep</b> text');
  assert.equal(result.text, 'deep text');
});

void test('comments are stripped, including ones that hide markup', () => {
  const result = clean('<p>a<!-- <script>x</script> -->b<!--[if IE]><b>ie</b><![endif]--></p>');
  assert.equal(result.html, '<p>ab</p>');
});

void test('elements with no text and no line break are removed from the bottom up', () => {
  const result = clean('<div><p><span> </span></p><ul><li></li></ul><b></b></div><p>keep</p>');
  assert.equal(result.html, '<p>keep</p>');
});

void test('an element holding only a line break survives', () => {
  assert.equal(clean('<p><br></p>').html, '<p><br></p>');
});

void test('entities are decoded in the text and escaped again in the html', () => {
  const result = clean('<p>Tom &amp; Jerry &lt;script&gt;alert(1)&lt;/script&gt; say &quot;hi&quot;</p>');
  assert.equal(result.text, 'Tom & Jerry <script>alert(1)</script> say "hi"');
  assert.equal(result.html, '<p>Tom &amp; Jerry &lt;script&gt;alert(1)&lt;/script&gt; say "hi"</p>');
  assert.ok(!result.html.includes('<script'));
});

void test('blocks and line breaks become lines in the text, spaces inside a line collapse', () => {
  const result = clean('<p>First   line</p><p>Second<br>third \n  part</p><ul><li>one</li><li>two</li></ul>');
  assert.equal(result.text, 'First line\nSecond\nthird part\none\ntwo');
});

void test('inline markup does not split a line', () => {
  assert.equal(clean('<p>Node<b>.js</b> and <i>React</i></p>').text, 'Node.js and React');
});

void test('tag names are matched whatever their case', () => {
  assert.equal(clean('<P ONCLICK="x">A</P><SCRIPT>b</SCRIPT>').html, '<p>A</p>');
});

void test('empty and whitespace-only input give empty output', () => {
  assert.deepEqual(clean(''), { html: '', text: '' });
  assert.deepEqual(clean(' \n\t '), { html: '', text: '' });
});

// The property that matters: whatever goes in, the html has only allowlisted tags and not one attribute.
const hostile = [
  '<scr<script>ipt>alert(1)</scr</script>ipt>',
  '<p onclick=alert(1)>x</p><img src=1 onerror=alert(1)><a href="data:text/html,<script>alert(1)</script>">y</a>',
  '<div style="background:url(javascript:alert(1))"><span onmouseover="x">z</span></div>',
  '<math><mi xlink:href="javascript:alert(1)">m</mi></math><form action="x"><input value="v"></form>',
  '<p>unclosed <b>bold <i>italic',
  '<ul><li>a<ul><li>b</li></ul></li></ul><!-- c --><base href="https://example.invalid/">',
  '<button onclick="x">b</button><select><option>o</option></select><textarea>t</textarea>',
];

void test('hostile input yields only allowlisted tags and no attribute', () => {
  for (const input of hostile) {
    const { html } = clean(input);
    for (const tag of html.matchAll(/<\/?([a-z0-9-]+)([^>]*)>/gi)) {
      assert.ok(allowedTags.has(tag[1] ?? ''), `tag ${tag[1]} from ${input}`);
      assert.equal(tag[2], '', `attribute in ${tag[0]} from ${input}`);
    }
    assert.ok(!/javascript:|onerror|onclick|onmouseover|<script/i.test(html), input);
  }
});

void test('cleaning twice changes nothing', () => {
  for (const input of hostile) {
    const once = clean(input);
    assert.deepEqual(clean(once.html), once, input);
  }
});
