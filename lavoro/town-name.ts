export function normalizeTown(name: string) {
  return (
    name
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      // ISTAT writes the straight apostrophe; some sources write the typographic one inside a name.
      .replaceAll('’', "'")
      .replace(/([aeiou])'(?=\s*$)/u, '$1')
      .replace(/\s+/gu, ' ')
      .trim()
  );
}
