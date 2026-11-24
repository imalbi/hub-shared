// The identity of a posting is `company|title`, not its URL: the same ad shows up on several sites and queries.
// This function is shared by the server and the zone (`ui.tsx`), so it imports nothing. The stored key is computed
// once and never changes: do not "improve" it without a migration plan for the rows already saved.

// Unicode-aware on purpose: JavaScript's \W is ASCII only and would split "società" at the accent.
const separators = /[^\p{L}\p{N}_]+/gu;
const collapse = (text: string) => text.toLowerCase().replace(separators, ' ').trim();

export function postingKey(company: string, title: string) {
  return `${collapse(company)}|${collapse(title)}`;
}

const legalSuffixes = new Set([
  'srl',
  'srls',
  'spa',
  'sas',
  'snc',
  'ltd',
  'limited',
  'llc',
  'inc',
  'incorporated',
  'gmbh',
  'plc',
  'corp',
  'corporation',
  'bv',
  'ag',
  'sa',
  'nv',
]);
export const plain = (text: string) => collapse(text.normalize('NFKD').replace(/\p{M}+/gu, ''));

const groupWords = new Set(['gruppo', 'group', 'italia', 'italy']);

/**
 * The company as duplicates and blocked-company lists see it: no accents, no trailing legal form, and one name behind
 * a staffing agency ("Iren tramite Synergie"), a parenthesis ("Iren (IRETI via Synergie)") or a group tail
 * ("Gruppo Gecal Informatica - Altair Systems").
 */
export function comparisonCompany(company: string) {
  const head = company.replace(/\([^)]*\)/gu, ' ').split(/\s+tramite\s+|\s+-\s+/iu)[0] ?? company;
  const words = plain(head.replaceAll('.', '')).split(' ').filter(Boolean);
  while (words.length > 1 && (legalSuffixes.has(words.at(-1) ?? '') || groupWords.has(words.at(-1) ?? ''))) words.pop();
  if (words.length > 1 && groupWords.has(words[0] ?? '')) words.shift();
  return words.join(' ');
}

const fillerWords = new Set([
  'per',
  'di',
  'del',
  'della',
  'delle',
  'dei',
  'e',
  'ed',
  'a',
  'il',
  'la',
  'le',
  'of',
  'and',
  'the',
]);

const workModes = /remot|ibrid|hybrid|smart|on ?site|in sede|presenza|full time|part time/iu;
const trailingBracket = /\s*\(([^()]*)\)\s*$/u;

/**
 * Word order, filler words, the gender mark ("Addetto/a"), a reference code, and a trailing bracket that only names the
 * posting's own place or a work mode ("(Torino)", "(ibrido Torino / Milano)") never tell two postings apart. A bracket
 * like "(Java)" does. Changing this changes saved comparison keys: rerun `dedupe.ts` after.
 */
function comparisonTitle(title: string, location: string) {
  const place = plain(location);
  const unplaced = title.replace(trailingBracket, (match, inside: string) => {
    const words = plain(inside).split(' ').filter(Boolean);
    const placeOnly = words.length > 0 && words.every((word) => ` ${place} `.includes(` ${word} `));
    return workModes.test(inside) || placeOnly ? '' : match;
  });
  const bare = unplaced.replace(/\((?:rif|ref|m\/f|f\/m|h\/f|d\/f)[^)]*\)/giu, ' ').replace(/\/[aoe]\b/giu, '');
  return plain(bare)
    .split(' ')
    .filter((word) => word && !fillerWords.has(word))
    .toSorted()
    .join(' ');
}

/** For spotting duplicates only: accents, the legal form, agency wording and word order are ignored. Stored in `jobs.comparison_key`, never used as the key. */
export function comparisonKey(company: string, title: string, location = '') {
  return `${comparisonCompany(company)}|${comparisonTitle(title, location)}`;
}
