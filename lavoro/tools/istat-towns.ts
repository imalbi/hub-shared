import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeTown } from '../town-name.ts';

const source = 'https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.csv';
const [input, date] = process.argv.slice(2);
if (!input || !date || !/^\d{4}-\d{2}-\d{2}$/u.test(date))
  throw new Error('Usage: node istat-towns.ts <csv> <download-date>');
const text = new TextDecoder('iso-8859-1').decode(readFileSync(input));
const rows: string[][] = [];
let row: string[] = [];
let field = '';
let quoted = false;
for (let i = 0; i < text.length; i++) {
  const char = text[i];
  if (char === '"') {
    if (quoted && text[i + 1] === '"') {
      field += '"';
      i++;
    } else quoted = !quoted;
  } else if (!quoted && (char === ';' || char === '\n')) {
    row.push(field.replace(/\r$/u, ''));
    field = '';
    if (char === '\n') {
      rows.push(row);
      row = [];
    }
  } else field += char;
}
if (quoted) throw new Error('Unclosed CSV field');
if (field || row.length) {
  row.push(field);
  rows.push(row);
}
const headers = rows.shift();
const townIndex = headers?.indexOf('Denominazione in italiano') ?? -1;
const provinceIndex = headers?.indexOf('Sigla automobilistica') ?? -1;
if (townIndex < 0 || provinceIndex < 0) throw new Error('Missing ISTAT columns');
const towns = new Map<string, Set<string>>();
for (const values of rows) {
  const town = values[townIndex];
  const province = values[provinceIndex];
  if (!town || !province || !/^[A-Z]{2}$/u.test(province)) throw new Error('Invalid ISTAT row');
  const key = normalizeTown(town);
  const provinces = towns.get(key) ?? new Set<string>();
  provinces.add(province);
  towns.set(key, provinces);
}
const entries = [...towns]
  .toSorted(([a], [b]) => a.localeCompare(b, 'en'))
  .map(
    ([name, provinces]) =>
      `  ${JSON.stringify(name)}: ${JSON.stringify([...provinces].toSorted((a, b) => a.localeCompare(b, 'en')))},`,
  )
  .join('\n');
const output = `// Generated from ${source}, downloaded ${date}.\n// Run tools/istat-towns.ts with the CSV and its download date.\nexport const provinceTowns: Record<string, string[]> = {\n${entries}\n};\n`;
writeFileSync(fileURLToPath(new URL('../province-towns.ts', import.meta.url)), output);
