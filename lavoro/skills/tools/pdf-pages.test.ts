import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageCount, pagesProblem } from './pdf-pages.ts';

const info = (pages: number) =>
  `Title:          Invented\nPage size:      595.276 x 841.89 pts (A4)\nPages:          ${pages}\nFile size:      12345 bytes\n`;

void test('one page passes, two pages fail, for a CV and for a letter alike', () => {
  assert.equal(pagesProblem(info(1)), null);
  assert.equal(pagesProblem(info(2)), '2 pages, expected 1');
});

void test('a missing Pages line is an error, not zero', () => {
  assert.throws(() => pageCount('Title: Invented\nPage size: 595 x 842 pts\n'), /no "Pages:" line/);
  assert.throws(() => pagesProblem(''), /no "Pages:" line/);
});

void test('the Pages line is read, not the first number in the output', () => {
  const text = `Title: 7 notes\nPage size: 595 x 842 pts\nPages:          1\n`;
  assert.equal(pageCount(text), 1);
});
