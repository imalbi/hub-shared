import { copy } from './copy.ts';
import { cleanSnippet, extractExperience, type MarkTerm } from './format.ts';
import { isProtectedCategory } from './protected-category.ts';
import { extractSalary, extractSalaryMatch } from './salary.ts';
import type { JobRow } from './server.ts';
import { stableExclusion } from './stable.ts';

// What the detail says at the top, and which words of the description carry it. Pure: the UI renders both, it decides
// nothing. It reuses what the scorer wrote into `reasons` and the helpers that already read the text; no new extraction.

const text = copy.detail.summary;

export type SummaryRow = { id: 'exclude' | 'consider' | 'favor'; label: string; items: string[] };

const noise = /^(?:data|dati|date)$/i;
const contractPhrases = ['tempo indeterminato', 'permanent contract'];
const hasContractPhrase = (body: string | null | undefined) => {
  const lower = (body ?? '').toLowerCase();
  return contractPhrases.some((phrase) => lower.includes(phrase));
};

type Reading = {
  /** Words with a negative weight, in scorer order. */
  negative: string[];
  positive: string[];
  yearsOver: number | null;
  yearsAsked: number | null;
  permanent: boolean;
};

/** `senior:-4`, `torino:+3 (sede)`, `5+ anni:-6`, `3 anni`; `stabile:*` bookkeeping and the work mode bonus say nothing here. */
function readReasons(reasons: readonly string[]): Reading {
  const reading: Reading = { negative: [], positive: [], yearsOver: null, yearsAsked: null, permanent: false };
  for (const reason of reasons) {
    if (reason === 'stabile:indeterminato') {
      reading.permanent = true;
      continue;
    }
    const over = /^(\d+)\+ anni:-\d+$/.exec(reason);
    if (over?.[1]) {
      reading.yearsOver = Number(over[1]);
      continue;
    }
    const asked = /^(\d+) anni$/.exec(reason);
    if (asked?.[1]) {
      reading.yearsAsked = Number(asked[1]);
      continue;
    }
    const signed = /^(.+?):([+-])\d+(?:\s*\((.*)\))?$/.exec(reason);
    if (
      !signed?.[1] ||
      signed[3] === 'modalità' ||
      signed[1].startsWith('stabile') ||
      signed[1] === 'categorie protette'
    )
      continue;
    const word = signed[1].trim();
    if (word.length < 2 || noise.test(word)) continue;
    if (signed[2] === '+' && contractPhrases.includes(word.toLowerCase())) {
      reading.permanent = true;
      continue;
    }
    (signed[2] === '-' ? reading.negative : reading.positive).push(word);
  }
  return reading;
}

const bodyOf = (job: JobRow) => job.descriptionHtml ?? job.description;

function exclusionOf(job: JobRow) {
  const description = job.description ?? cleanSnippet(job.descriptionHtml);
  return stableExclusion(job.title, description, []);
}

const exclusionText = { laurea: text.laurea, patente: text.patente, sanitario: text.sanitario, altro: '' };
const exclusionWord = { laurea: 'laurea', patente: 'patente', sanitario: 'albo', altro: '' };

function unique(items: readonly string[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Three short rows, an empty one left out. */
export function detailSummary(job: JobRow): SummaryRow[] {
  const reading = readReasons(job.reasons);
  const body = bodyOf(job);
  const exclusion = exclusionOf(job);
  const salary = extractSalary(body);
  const permanent = reading.permanent || hasContractPhrase(body);
  const exclude = unique([
    ...reading.negative,
    ...(reading.yearsOver === null ? [] : [text.years_over(reading.yearsOver)]),
    ...(exclusion && exclusionText[exclusion] ? [exclusionText[exclusion]] : []),
  ]);
  const consider = [
    ...(reading.yearsAsked === null ? [] : [text.years_asked(reading.yearsAsked)]),
    ...(job.workMode === 'onsite' ? [text.on_site] : []),
    ...(isProtectedCategory(job.title, job.description) ? [text.protected] : []),
  ];
  const favor = unique([
    ...reading.positive,
    ...(salary ? [text.salary(salary)] : []),
    ...(permanent ? [text.permanent] : []),
  ]);
  const rows: SummaryRow[] = [
    { id: 'exclude', label: text.exclude, items: exclude },
    { id: 'consider', label: text.consider, items: consider },
    { id: 'favor', label: text.favor, items: favor },
  ];
  return rows.filter((row) => row.items.length > 0);
}

/** The words of the description to mark, first kind wins for a word named twice. */
export function markTerms(job: JobRow): MarkTerm[] {
  const reading = readReasons(job.reasons);
  const body = bodyOf(job);
  const exclusion = exclusionOf(job);
  const terms: MarkTerm[] = reading.negative.map((word) => ({ text: word, mark: 'exclude' }));
  if (reading.yearsOver !== null) {
    const years = /^(\d+(?:[-–/]\d+)?\+?\s*anni)/i.exec(extractExperience(body) ?? '')?.[1];
    if (years) terms.push({ text: years, mark: 'exclude' });
  }
  if (exclusion && exclusionWord[exclusion]) terms.push({ text: exclusionWord[exclusion], mark: 'exclude' });
  const salary = extractSalaryMatch(body);
  if (salary) {
    for (const rawToken of salary.rawTokens) {
      // Strip whitespace-separated leading currency so HTML `&nbsp;` between `€` and digits never prevents a text match.
      const clean = rawToken
        .trim()
        .replace(/^(?:€|(?:euro|eur)\b)\s+/i, '')
        .trim();
      if (clean.length >= 2) terms.push({ text: clean, mark: 'salary' });
    }
  }
  if (reading.permanent || hasContractPhrase(body)) {
    const lower = (body ?? '').toLowerCase();
    for (const phrase of contractPhrases) if (lower.includes(phrase)) terms.push({ text: phrase, mark: 'contract' });
  }
  for (const word of [...reading.positive, ...job.categories])
    if (word.length >= 2 && !noise.test(word)) terms.push({ text: word, mark: 'skill' });
  const seen = new Set<string>();
  return terms.filter((term) => {
    const key = term.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
