import { wholeWord, escapeRegex } from './match.ts';

// The one blacklist matcher. Ingestion applies it on the server; the zone (16j) imports the same file to reclassify
// saved postings at once, so it imports nothing but the whole-word helper and must stay pure.

export const blacklistFields = ['company', 'title', 'description', 'location', 'site', 'work_mode', 'key'] as const;
export const blacklistMatchTypes = ['equals', 'contains', 'word'] as const;

export type BlacklistField = (typeof blacklistFields)[number];
export type BlacklistRule = {
  id: number;
  enabled: boolean;
  field: BlacklistField;
  matchType: (typeof blacklistMatchTypes)[number];
  value: string;
};
/** What a rule can read: absent fields (a description not fetched yet) never match. */
export type BlacklistPosting = Partial<Record<BlacklistField, string | null>>;

// NFKC folds width and compatibility forms ("Ｆｕｌｌ" to "Full"), then case and runs of spaces are ignored.
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();

export function matchRule(rule: BlacklistRule, posting: BlacklistPosting) {
  if (!rule.enabled) return false;
  const value = normalize(rule.value);
  const field = posting[rule.field];
  // An empty value would match everything under "contains": a rule must say something.
  if (value === '' || field === undefined || field === null) return false;
  const text = normalize(field);
  if (rule.matchType === 'equals') return text === value;
  if (rule.matchType === 'contains') return text.includes(value);
  return wholeWord(escapeRegex(value)).test(text);
}

/** The first enabled rule that matches; one match is enough to exclude. */
export function firstMatchingRule(rules: readonly BlacklistRule[], posting: BlacklistPosting) {
  return rules.find((rule) => matchRule(rule, posting));
}
