import type { StableConfig } from './config.ts';
import { comparisonCompany } from './key.ts';
import { escapeRegex, wholeWord } from './match.ts';

// What makes a posting "Stabile" and what drops one the owner cannot apply to (16n1). Pure: no config of its own, no
// I/O. Shared by the scorer, the ingestion and the rescore script.

export type StableReason = 'company' | 'site';
export type StableExclusion = 'laurea' | 'sanitario' | 'patente' | 'altro';
type StablePosting = { title: string; company?: string; site?: string; description?: string };

const phrases = new Map<string, RegExp>();
/** A phrase as whole words, case-insensitive; the spaces of the phrase match any run of whitespace. */
function phrasePattern(phrase: string) {
  let pattern = phrases.get(phrase);
  if (!pattern) {
    pattern = wholeWord(escapeRegex(phrase.trim()).replace(/\s+/g, '\\s+'));
    phrases.set(phrase, pattern);
  }
  return pattern;
}

/**
 * The reasons that hold, empty when the posting is not Stabile. The company is compared on the company field only
 * (a description naming an employer proves nothing), with accents, legal form and case ignored, as whole words:
 * "Gruppo Intesa Sanpaolo" and "Intesa Sanpaolo S.p.A." both match "Intesa Sanpaolo".
 */
export function stableReasons(posting: StablePosting, stable: StableConfig): StableReason[] {
  const reasons: StableReason[] = [];
  const company = ` ${comparisonCompany(posting.company ?? '')} `;
  const listed = stable.companies
    .map(comparisonCompany)
    .filter(Boolean)
    .some((name) => company.includes(` ${name} `));
  if (listed) reasons.push('company');
  if (posting.site !== undefined && stable.sites.some((site) => site === posting.site)) reasons.push('site');
  return reasons;
}

// "Laurea o diploma", "laurea triennale o diploma tecnico" and "laurea in economia, preferibile" are not requirements:
// every drop pattern that ends on the bare word "laurea" refuses to match when one of those follows in the same sentence.
const notOptional = String.raw`(?![^.;\n]{0,60}?(?:(?:\bo|oppure|e\/o|\/)\s*diploma|\b(?:preferibil|gradit|preferenzial)))`;
const laurea = [
  String.raw`laurea\s+(?:obbligatoria|richiesta|indispensabile|necessaria)`,
  String.raw`requisit[io]\s*:?\s*laurea${notOptional}`,
  String.raw`richiest[ao]\s+la\s+laurea${notOptional}`,
  String.raw`possesso\s+(?:della|di)\s+laurea${notOptional}`,
  String.raw`(?:titolo|livello)\s+di\s+studio(?:\s+richiesto)?\s*:?\s*laurea${notOptional}`,
].map((source) => wholeWord(source));

const sanitarioText = [
  String.raw`iscrizione\s+(?:all['’]\s*|al\s+)?albo`,
  String.raw`(?:qualifica|attestato)\s+(?:di\s+)?OSS`,
  String.raw`laurea\s+in\s+infermieristica`,
].map((source) => wholeWord(source));
const sanitarioTitle = wholeWord('infermiere|infermiera|medico|OSS');

// Case-sensitive on purpose: the category is a capital letter, and "patente e automunito" must not read as category E.
// B alone keeps; "B e C" does not.
const patente = [
  wholeWord(
    String.raw`(?:patent[ei]|Patent[ei]|PATENT[EI])\s+(?:di\s+guida\s+)?(?:cat(?:egoria|\.)?\s*)?(?:[AB]1?\s*(?:,|e|o|\/|-)\s*)*(?:C1E|C1|CE|C|D1E|D1|DE|D|E)`,
    'u',
  ),
  wholeWord('CQC|ADR', 'u'),
];

/** The reason a Stabile posting cannot be applied to by a diploma holder, or null. Title and text are both read. */
export function stableExclusion(
  title: string,
  description: string,
  extraPhrases: readonly string[],
): StableExclusion | null {
  const text = `${title}\n${description}`;
  if (laurea.some((pattern) => pattern.test(text))) return 'laurea';
  if (sanitarioTitle.test(title) || sanitarioText.some((pattern) => pattern.test(text))) return 'sanitario';
  if (patente.some((pattern) => pattern.test(text))) return 'patente';
  if (extraPhrases.some((phrase) => phrasePattern(phrase).test(text))) return 'altro';
  return null;
}
