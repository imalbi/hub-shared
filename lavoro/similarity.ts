import { agencySites, plain, resolveCompany } from './key.ts';

export function fingerprint(text: string, minDescriptionChars = 200): ReadonlySet<string> {
  if (text.trim().length < minDescriptionChars) return new Set();
  const words = plain(text)
    .split(' ')
    .filter((word) => word.length > 1)
    .slice(0, 400);
  const shingles = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) shingles.add(words.slice(i, i + 3).join(' '));
  return shingles;
}

export function descriptionSimilarity(a: string, b: string, minDescriptionChars = 200) {
  const left = fingerprint(a, minDescriptionChars);
  const right = fingerprint(b, minDescriptionChars);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const shingle of left) if (right.has(shingle)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

type Employer = { company: string; site: string };
export function canCompareDescriptions(a: Employer, b: Employer, aliases: Readonly<Record<string, string>>) {
  return (
    agencySites.has(a.site) ||
    agencySites.has(b.site) ||
    resolveCompany(a.company, aliases) === resolveCompany(b.company, aliases)
  );
}
