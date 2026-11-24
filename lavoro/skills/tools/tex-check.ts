import { readFile } from 'node:fs/promises';

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: '\\input', pattern: /\\input(?![a-zA-Z])/u },
  { name: '\\include', pattern: /\\include(?![a-zA-Z])/u },
  { name: '\\openin', pattern: /\\openin(?![a-zA-Z])/u },
  { name: '\\openout', pattern: /\\openout(?![a-zA-Z])/u },
  { name: '\\read', pattern: /\\read(?![a-zA-Z])/u },
  { name: '\\write18', pattern: /\\write\s*18(?![0-9])/u },
  { name: '\\immediate\\write', pattern: /\\immediate\s*\\write(?![a-zA-Z])/u },
  { name: '\\catcode', pattern: /\\catcode(?![a-zA-Z])/u },
  { name: '\\scantokens', pattern: /\\scantokens(?![a-zA-Z])/u },
  { name: '\\csname', pattern: /\\csname(?![a-zA-Z])/u },
];

/** Strips unescaped `%` TeX comments line by line so comments cannot fail or hide real escapes (`\%`). */
function stripTexComments(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      let escaped = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '%') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

function splitAtDocument(tex: string): { preamble: string; body: string } | null {
  const marker = '\\begin{document}';
  const index = tex.indexOf(marker);
  if (index < 0) return null;
  const splitPoint = index + marker.length;
  return { preamble: tex.slice(0, splitPoint), body: tex.slice(splitPoint) };
}

/** Static safety checks for LaTeX files compiled from posting-derived inputs; empty list means pass. */
export function texProblems(tex: string, templateTex?: string): string[] {
  const problems: string[] = [];
  const doc = splitAtDocument(tex);
  if (!doc) {
    problems.push('missing \\begin{document}');
  }

  let checkPreamble = true;
  if (templateTex !== undefined && doc) {
    const templateDoc = splitAtDocument(templateTex);
    if (!templateDoc) {
      problems.push('template missing \\begin{document}');
    } else if (doc.preamble !== templateDoc.preamble) {
      problems.push('preamble differs from template');
    } else {
      checkPreamble = false;
    }
  }

  const target = doc ? `${checkPreamble ? doc.preamble : ''}\n${doc.body}` : tex;
  const active = stripTexComments(target);
  for (const { name, pattern } of FORBIDDEN_PATTERNS) {
    if (pattern.test(active)) {
      problems.push(`forbidden TeX command ${name}`);
    }
  }
  return problems;
}

async function main(file: string | undefined, templateFile: string | undefined) {
  if (!file) throw new Error('usage: node tex-check.ts <file.tex> [template.tex]');
  const [tex, template] = await Promise.all([
    readFile(file, 'utf8'),
    templateFile ? readFile(templateFile, 'utf8') : Promise.resolve(undefined),
  ]);
  const problems = texProblems(tex, template);
  process.stdout.write(problems.length ? problems.map((p) => `FAIL ${p}\n`).join('') : 'OK tex\n');
  if (problems.length) process.exitCode = 1;
}

if (import.meta.main)
  main(process.argv[2], process.argv[3]).catch((error: unknown) => {
    process.stderr.write(`ERROR ${error instanceof Error ? error.message : 'failed'}\n`);
    process.exitCode = 2;
  });
