import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Reads the `Pages:` line of `pdfinfo` output. Anchored to the line: the first number in the text would be wrong. */
export function pageCount(pdfinfo: string): number {
  const match = /^Pages:\s+(\d+)\s*$/m.exec(pdfinfo);
  if (!match?.[1]) throw new Error('no "Pages:" line in the pdfinfo output');
  return Number(match[1]);
}

/** The CV and the letter are one page each. */
export function pagesProblem(pdfinfo: string, expected = 1): string | null {
  const pages = pageCount(pdfinfo);
  return pages === expected ? null : `${pages} pages, expected ${expected}`;
}

async function main(file: string | undefined) {
  if (!file) throw new Error('usage: node pdf-pages.ts <file.pdf>');
  const { stdout } = await run('pdfinfo', [file]);
  const problem = pagesProblem(stdout);
  process.stdout.write(problem ? `FAIL pages: ${problem}\n` : 'OK pages: 1\n');
  if (problem) process.exitCode = 1;
}

if (import.meta.main)
  main(process.argv[2]).catch((error: unknown) => {
    process.stderr.write(`ERROR ${error instanceof Error ? error.message : 'failed'}\n`);
    process.exitCode = 2;
  });
