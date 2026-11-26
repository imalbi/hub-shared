import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

// `phone` is null when the CV source prints none: the check then asks for the email only.
export type AtsExpectation = { email: string; phone: string | null; headings: string[] };

const privateUse = /[-]/u;
// Hyphen to horizontal bar, and the minus sign: a parser reads "2025 – 2026" as one token or drops it.
const dashNextToYear = /\d{4}\s*[‐-―−]|[‐-―−]\s*\d{4}/u;

/** What a parser reading the PDF's text layer would trip on; an empty list means the check passes. */
export function atsProblems(text: string, expected: AtsExpectation): string[] {
  const problems: string[] = [];
  if (!text.includes(expected.email)) problems.push('email is not literal text');
  if (expected.phone !== null && !text.includes(expected.phone)) problems.push('phone is not literal text');
  if (privateUse.test(text)) problems.push('private-use glyph in the text (an icon font)');
  const lower = text.toLowerCase();
  let cursor = 0;
  for (const heading of expected.headings) {
    const at = lower.indexOf(heading.toLowerCase(), cursor);
    if (at < 0) problems.push(`heading order: "${heading}" missing or out of order`);
    else cursor = at + heading.length;
  }
  if (dashNextToYear.test(text)) problems.push('a year is joined to a Unicode dash, use ASCII " - "');
  return problems;
}

/** Contact values and section headings as the CV source writes them, so no personal value lives in this file. */
export function expectationFromTex(tex: string): AtsExpectation {
  const shown = (scheme: string) => {
    const match = new RegExp(`\\\\href\\{${scheme}:([^}]*)\\}(?:\\{([^}]*)\\})?`).exec(tex);
    return match?.[1] ? (match[2] ?? match[1]).trim() : null;
  };
  const email = shown('mailto');
  if (!email) throw new Error('no \\href{mailto:...} in the source');
  const headings = [...tex.matchAll(/\\section\*?\{([^}]*)\}/g)].flatMap((match) => (match[1] ? [match[1]] : []));
  return { email, phone: shown('tel'), headings };
}

async function main(file: string | undefined, texFile: string | undefined) {
  if (!file || !texFile) throw new Error('usage: node ats-text.ts <file.pdf> <cv-source.tex>');
  const expected = expectationFromTex(await readFile(texFile, 'utf8'));
  const { stdout } = await run('pdftotext', [file, '-']);
  const problems = atsProblems(stdout, expected);
  process.stdout.write(problems.length ? problems.map((p) => `FAIL ${p}\n`).join('') : 'OK ats\n');
  if (problems.length) process.exitCode = 1;
}

if (import.meta.main)
  main(process.argv[2], process.argv[3]).catch((error: unknown) => {
    process.stderr.write(`ERROR ${error instanceof Error ? error.message : 'failed'}\n`);
    process.exitCode = 2;
  });
