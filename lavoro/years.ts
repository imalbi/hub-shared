import { escapeRegex } from './match.ts';

// A sentence about the company ("leader nel settore con almeno 20 anni di esperienza") is not a requirement.
const companySentence = [
  'specializzat',
  'consulenza',
  'settori',
  'fondat',
  'founded',
  'leader',
  'vant[ai]',
  'operiamo',
  'operating since',
];

const rangeOrPlus = '(\\d{1,2})\\s*(?:\\+|[-–/]\\s*(\\d{1,2}))';
const singleNum = '(\\d{1,2})';
const prefix = '(?:\\b(?:almeno|minimo|richiest[oiae]|richiedesi|con|at\\s+least|minimum)\\s+)(?:di\\s+)?';
const optPrefix = '(?:\\b(?:almeno|minimo|richiest[oiae]|richiedesi|con|at\\s+least|minimum)\\s+)?(?:di\\s+)?';

const qualifiers =
  '(?:comprovata|consolidata|maturata|professionale|pregressa|precedente|lavorativa|rilevante|professional|hands-on|relevant|proven|prior|practical|software|software\\s+engineering|software\\s+development)';
const expWord = '(?:esperienza|esperienze|experience)';

// Pattern 1 (with range or plus, prefix optional): e.g. "1–2 anni di esperienza", "1+ anni di esperienza", "3/4 anni di esperienza", "5+ years of experience"
const patRange = new RegExp(
  `${optPrefix}${rangeOrPlus}\\s*(?:anni|years?|yrs?)\\b(?:\\s*(?:di|of))?(?:\\s+${qualifiers})*\\s+${expWord}`,
  'giu',
);

// Pattern 2 (single number, prefix mandatory): e.g. "almeno 3 anni di esperienza", "at least 5 years of experience", "richiesti 2 anni di esperienza"
const patSingle = new RegExp(
  `${prefix}${singleNum}\\s*(?:anni|years?|yrs?)\\b(?:\\s*(?:di|of))?(?:\\s+${qualifiers})*\\s+${expWord}`,
  'giu',
);

// Pattern 3 (inverted order): e.g. "esperienza di almeno 3 anni", "esperienza professionale di 2 anni"
const patInverted = new RegExp(
  `${expWord}(?:\\s+${qualifiers})*\\s+(?:di\\s+)?(?:almeno|minimo|richiest[oiae]|con)?\\s*(?:${rangeOrPlus}|${singleNum})\\s*(?:anni|years?|yrs?)\\b`,
  'giu',
);

const patterns = [patRange, patSingle, patInverted];

/** The smallest number of years the description asks for (1 to 19), or null. `extraCompanyWords` extend the skip list. */
export function requiredYears(description: string, extraCompanyWords: readonly string[] = []) {
  const skip = new RegExp([...companySentence, ...extraCompanyWords.map(escapeRegex)].join('|'), 'iu');
  const found: number[] = [];
  for (const sentence of description.split(/[.!?]+/)) {
    if (skip.test(sentence)) continue;
    for (const pat of patterns) {
      for (const match of sentence.matchAll(pat)) {
        for (const text of [match[1], match[2], match[3]]) {
          const years = Number(text);
          if (text !== undefined && years >= 1 && years <= 19) found.push(years);
        }
      }
    }
  }
  return found.length ? Math.min(...found) : null;
}
