import { keywordPattern } from './match.ts';

/** The categories whose keywords appear (as whole words) in the title or the description, in the map's order. */
export function categorize(title: string, description: string, categories: Record<string, string[]>) {
  const text = `${title}\n${description}`;
  return Object.entries(categories)
    .filter(([, keywords]) => keywords.some((keyword) => keywordPattern(keyword).test(text)))
    .map(([name]) => name);
}
