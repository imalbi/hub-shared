// Whole-word matching for weights and categories. JavaScript's \w and \b are ASCII only, so "è" or "ì" would break
// a boundary: the classes below are Unicode letters, digits and underscore, with the `u` flag.

export const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `source` as a whole word or phrase; `flags` adds `g` for matchAll. */
export const wholeWord = (source: string, flags = 'iu') =>
  new RegExp(`(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`, flags);

const patterns = new Map<string, RegExp>();
/** A keyword as a whole word with an optional plural `s`: `rag` finds "RAG" and "rags", never "storage". */
export function keywordPattern(keyword: string) {
  let pattern = patterns.get(keyword);
  if (!pattern) {
    pattern = wholeWord(`${escapeRegex(keyword)}s?`);
    patterns.set(keyword, pattern);
  }
  return pattern;
}

export type Scored = { score: number; reasons: string[] };

/** `rag:+5`, `senior:-4`; `suffix` tags where the word was found, for example ` (descr.)`. */
export const reasonOf = (keyword: string, weight: number, suffix = '') =>
  `${keyword}:${weight >= 0 ? '+' : ''}${weight}${suffix}`;

/** Sum of the weights of the keywords found; each counts once, negative weights allowed. `suffix` tags the reason. */
export function scoreKeywords(text: string, weights: Record<string, number>, suffix = ''): Scored {
  let score = 0;
  const reasons: string[] = [];
  for (const [keyword, weight] of Object.entries(weights)) {
    if (!keywordPattern(keyword).test(text)) continue;
    score += weight;
    reasons.push(reasonOf(keyword, weight, suffix));
  }
  return { score, reasons };
}
