import { escapeRegex, wholeWord } from './match.ts';
import type { JobRow } from './server.ts';

export type AdvancedSearchMode = 'all_words' | 'exact_phrase' | 'identical_field';

export type AdvancedSearch = {
  mode: AdvancedSearchMode;
  wholeWordsOnly?: boolean;
  fields: {
    title?: string;
    company?: string;
    description?: string;
    location?: string;
    notes?: string;
  };
};

export type ParsedFreeSearch = {
  positiveWords: string[];
  positivePhrases: string[];
  negativeWords: string[];
  negativePhrases: string[];
};

/** Normalizes text by removing diacritics/accents, lowercasing and normalizing whitespace. */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Parses raw input query into positive and negative words and quoted phrases. */
export function parseFreeSearch(query: string): ParsedFreeSearch {
  const positiveWords: string[] = [];
  const positivePhrases: string[] = [];
  const negativeWords: string[] = [];
  const negativePhrases: string[] = [];

  const trimmed = query.trim();
  if (!trimmed) {
    return { positiveWords, positivePhrases, negativeWords, negativePhrases };
  }

  // Regex to extract: (-?)"([^"]+)" or (-?\S+)
  const regex = /(-?)"([^"]+)"|(-?\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(trimmed)) !== null) {
    if (match[2] !== undefined) {
      // Quoted phrase
      const isNegative = match[1] === '-';
      const phrase = normalizeSearch(match[2]);
      if (phrase) {
        if (isNegative) negativePhrases.push(phrase);
        else positivePhrases.push(phrase);
      }
    } else if (match[3] !== undefined) {
      // Word
      const raw = match[3];
      const isNegative = raw.startsWith('-');
      const word = normalizeSearch(isNegative ? raw.slice(1) : raw);
      if (word) {
        if (isNegative) negativeWords.push(word);
        else positiveWords.push(word);
      }
    }
  }

  return { positiveWords, positivePhrases, negativeWords, negativePhrases };
}

function jobSearchText(job: JobRow): string {
  return normalizeSearch(
    [
      job.title,
      job.company,
      job.location,
      job.description ?? '',
      job.categories.join(' '),
      job.application?.notes ?? '',
    ].join(' '),
  );
}

export function matchesFreeSearch(job: JobRow, parsed: ParsedFreeSearch): boolean {
  const text = jobSearchText(job);

  // Check negative phrases and words: if any match, reject
  for (const negPhrase of parsed.negativePhrases) {
    if (text.includes(negPhrase)) return false;
  }
  for (const negWord of parsed.negativeWords) {
    if (text.includes(negWord)) return false;
  }

  // Check positive phrases: all must appear
  for (const posPhrase of parsed.positivePhrases) {
    if (!text.includes(posPhrase)) return false;
  }

  // Check positive words: all must appear
  for (const posWord of parsed.positiveWords) {
    if (!text.includes(posWord)) return false;
  }

  return true;
}

export function matchesAdvancedSearch(job: JobRow, adv?: AdvancedSearch): boolean {
  if (!adv) return true;
  const { mode, wholeWordsOnly = false, fields } = adv;

  const entries: Array<[keyof AdvancedSearch['fields'], string | null | undefined]> = [
    ['title', job.title],
    ['company', job.company],
    ['location', job.location],
    ['description', job.description],
    ['notes', job.application?.notes],
  ];

  for (const [fieldKey, jobVal] of entries) {
    const rawInput = fields[fieldKey];
    if (!rawInput || !rawInput.trim()) continue;

    const input = normalizeSearch(rawInput);
    if (!input) continue;

    const target = normalizeSearch(jobVal ?? '');
    if (!target) return false;

    if (mode === 'identical_field') {
      if (target !== input) return false;
    } else if (mode === 'exact_phrase') {
      if (wholeWordsOnly) {
        const re = wholeWord(escapeRegex(input));
        if (!re.test(target)) return false;
      } else {
        if (!target.includes(input)) return false;
      }
    } else if (mode === 'all_words') {
      const words = input.split(' ').filter(Boolean);
      for (const word of words) {
        if (wholeWordsOnly) {
          const re = wholeWord(escapeRegex(word));
          if (!re.test(target)) return false;
        } else {
          if (!target.includes(word)) return false;
        }
      }
    }
  }

  return true;
}

/** Returns list of terms to highlight (positive terms only). */
export function highlightTerms(query: string, adv?: AdvancedSearch): string[] {
  const terms = new Set<string>();
  const parsed = parseFreeSearch(query);

  for (const word of parsed.positiveWords) terms.add(word);
  for (const phrase of parsed.positivePhrases) {
    for (const w of phrase.split(' ').filter(Boolean)) terms.add(w);
  }

  if (adv) {
    for (const val of Object.values(adv.fields)) {
      if (!val) continue;
      const normalized = normalizeSearch(val);
      for (const w of normalized.split(' ').filter(Boolean)) terms.add(w);
    }
  }

  return Array.from(terms);
}
