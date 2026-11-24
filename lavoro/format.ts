import { copy } from './copy.ts';

const KEEP_UPPERCASE = new Set([
  'IT',
  'AI',
  'UI',
  'UX',
  'HR',
  'QA',
  'PHP',
  'SEO',
  'SQL',
  'AWS',
  'GCP',
  'API',
  'ERP',
  'CRM',
  'SRE',
  'B2B',
  'B2C',
  'PLC',
  'NET',
  '.NET',
]);

const collectionTimeFormat = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });
const collectionDayFormat = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Formats the latest collection timestamp relative to the viewer's clock without reading Date.now during render. */
export function formatCollectionLabel(at: number | null, now: number, short = false): string | null {
  if (at === null) return null;
  const todayStart = startOfLocalDay(now);
  const tomorrow = new Date(todayStart);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(todayStart);
  yesterday.setDate(yesterday.getDate() - 1);
  const time = collectionTimeFormat.format(at);

  if (at >= todayStart && at < tomorrow.getTime()) {
    return short ? copy.widget.collection_short_today(time) : copy.widget.collection_today(time);
  }
  if (at >= yesterday.getTime() && at < todayStart) {
    return short ? copy.widget.collection_short_yesterday : copy.widget.collection_yesterday(time);
  }
  const date = collectionDayFormat.format(at);
  return short ? copy.widget.collection_short_date(date) : copy.widget.collection_date(date);
}

export function formatJobTitle(title: string): string {
  if (!title) return '';
  const trimmed = title.trim();
  // Only convert if the title is fully uppercase and has letters
  if (trimmed !== trimmed.toUpperCase() || !/[A-Z]/.test(trimmed)) {
    return trimmed;
  }
  // Title case conversion
  return trimmed
    .toLowerCase()
    .split(/(\s+|[-/(),]+)/)
    .map((word) => {
      const upper = word.toUpperCase();
      if (KEEP_UPPERCASE.has(upper)) return upper;
      if (/^[a-zà-ú]/.test(word)) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
      return word;
    })
    .join('');
}

export function formatWorkMode(mode: string | null | undefined): string | undefined {
  if (!mode) return undefined;
  const lower = mode.toLowerCase().trim();
  if (lower === 'remote') return 'Remoto';
  if (lower === 'hybrid') return 'Ibrido';
  if (lower === 'onsite') return 'In sede';
  return mode;
}

export function cleanSnippet(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type MarkKind = 'exclude' | 'salary' | 'contract' | 'skill';
export type MarkTerm = { text: string; mark: MarkKind };
export type MarkedPart = { text: string; mark: MarkKind | null };

/** Splits plain text on the terms, longest first, so "tempo indeterminato" wins over "tempo". A word keeps its first kind. */
export function splitMarked(text: string, terms: readonly MarkTerm[]): MarkedPart[] {
  const kinds = new Map<string, MarkKind>();
  for (const { text: word, mark } of terms) {
    const key = word.trim().toLowerCase();
    if (key.length >= 2 && !kinds.has(key)) kinds.set(key, mark);
  }
  if (!kinds.size || !text) return [{ text, mark: null }];
  const words = [...kinds.keys()].toSorted((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${words.map((t) => t.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text
    .split(pattern)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, mark: kinds.get(part.toLowerCase()) ?? null }));
}

export function highlightHtmlText(html: string, terms: readonly MarkTerm[]): string {
  if (!terms.length || !html) return html;
  // Tags and entities are the odd parts, so a term never lands inside `<...>` or `&amp;`.
  const parts = html.split(/(<[^>]+>|&[#\w]+;)/g);
  for (let i = 0; i < parts.length; i += 2) {
    const part = parts[i];
    if (part)
      parts[i] = splitMarked(part, terms)
        .map((piece) => (piece.mark ? `<span data-mark="${piece.mark}">${piece.text}</span>` : piece.text))
        .join('');
  }
  return parts.join('');
}

const COMPANY_WORDS = /(?:specializzat|consulenza|settori|fondat|founded|leader|vant[ai]|operiamo|operating since)/i;

const EXP_PATTERNS = [
  // 1. '4-5 anni di esperienza in Data Science' / '3+ anni di esperienza' / '5-10 years of professional experience working with code' / '2/3 anni di esperienza'
  /(?:(?:almeno|minim[oa]|at least|minimum|richiest[ioa]|gradit[ioa]|circa)\s+)?(\d{1,2}(?:\s*[-–/]\s*\d{1,2}|\+)?)\s*(?:anni|years?|yrs?)\b\s*(?:di\s+|of\s+)?(?:(?:comprovata|consolidata|maturata|rilevante|precedente|professionale|professional|relevant|direct|hands-on|prior)\s+)?(?:esperienza|experience)(?:\s+(?:in|su|con|nel|nella|nell'ambito|di|working\s+with|working\s+on|with)\s+([A-Za-z0-9+#./\s-]{2,30}))?/i,
  // 2. 'esperienza di almeno 3 anni in React' / 'esperienza minima di 2 anni'
  /(?:esperienza|experience)\s*(?:(?:comprovata|consolidata|maturata|rilevante|precedente|professionale|professional|relevant|direct|hands-on|prior)\s+)?(?:di\s+|of\s+)?(?:almeno|minim[oa]|at least|minimum)?\s*(?:di\s+)?(\d{1,2}(?:\s*[-–/]\s*\d{1,2}|\+)?)\s*(?:anni|years?|yrs?)\b(?:\s+(?:in|su|con|nel|nella|nell'ambito|di|working\s+with|working\s+on|with)\s+([A-Za-z0-9+#./\s-]{2,30}))?/i,
];

function cleanDomain(d: string | undefined): string | undefined {
  if (!d) return undefined;
  let domain = d
    .trim()
    .replace(/[,;:.].*$/, '')
    .replace(/\s+/g, ' ');
  domain = domain.replace(/^(?:aziende|contesti|realtà|settore|ambito|ambiti)\s+(?:di\s+)?/i, '').trim();
  domain = domain.replace(/\s+(?:strutturate|complesse|internazionali)$/i, '').trim();
  if (domain.length >= 2 && domain.length <= 25 && !/^(?:lavoro|settore|ambito|ruolo|campo)$/i.test(domain)) {
    return domain;
  }
  return undefined;
}

export function extractExperience(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.replace(/<[^>]+>/g, ' ');
  let fallback: string | null = null;

  for (const sentence of text.split(/[.!?\n]+/)) {
    if (COMPANY_WORDS.test(sentence)) continue;
    for (const pat of EXP_PATTERNS) {
      const match = pat.exec(sentence);
      if (match && match[1]) {
        const yearsRange = match[1].replace(/\s+/g, '').replace('–', '-').replace('/', '-');
        const num = parseInt(yearsRange, 10);
        if (num >= 1 && num <= 19) {
          const domain = cleanDomain(match[2]);
          if (domain) {
            return `${yearsRange} anni ${domain}`;
          }
          if (!fallback) fallback = `${yearsRange} anni exp`;
        }
      }
    }
  }
  return fallback;
}
