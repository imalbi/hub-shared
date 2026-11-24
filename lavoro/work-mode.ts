import type { Profile } from './config.ts';
import { escapeRegex, wholeWord } from './match.ts';

export type WorkMode = 'remote' | 'hybrid' | 'onsite';
export type ModeSource = {
  title: string;
  location: string;
  description?: string;
  /** What the source itself declares (Indeed attributes, the list's "Remote working" line): it wins. */
  declared?: WorkMode;
  /** The older boolean "remote" flag some sources set: the last resort. */
  remote?: boolean;
};

// Regex sources, matched as whole words. Defaults in code; the profile can only add plain phrases.
const inTitleOrLocation = {
  // "hybrid cloud" is an architecture, not a way of working.
  hybrid: ['ibrid[oa]', 'hybrid(?!\\s+(?:cloud|architecture|infrastructure|system))'],
  remote: ['full[ -]remote', 'remote', 'remoto', 'telelavoro', 'wfh', 'work from home'],
  onsite: ['on-?site', 'in sede', 'in presenza', 'in ufficio', 'office-based'],
};
const inDescription = {
  hybrid: [
    'modalit[àa] di lavoro:?\\s*ibrid[oa]',
    'modalit[àa] ibrid[oa]',
    'lavoro (?:in\\s+)?ibrido',
    'hybrid (?:role|work|working|model|position)',
    '\\d+\\s+giorn[oi] (?:a|alla|per) settimana (?:in|presso)\\s+(?:ufficio|sede|presenza)',
    '\\d+\\s+days? (?:a|per) week (?:in|at) the office',
    'smart[ -]?working (?:ibrid[oa]|misto)',
    'smart[ -]?working(?!\\s+(?:al\\s+)?100%|\\s+(?:full|totale|completo)|\\s+da\\s+remoto)',
    'formula ibrida',
    'modalit[àa] mista',
    // "Sede di lavoro: Ibrido/da remoto (city)": a city with some remote days, not a remote job.
    'ibrid[oa]\\s*/\\s*(?:da\\s+)?remot[oa]',
    '(?:da\\s+)?remot[oa]\\s*/\\s*ibrid[oa]',
  ],
  remote: [
    'full[ -]remote',
    'fully remote',
    '100%\\s*(?:da\\s+)?remot[eo]',
    'completamente da remoto',
    '(?:lavor(?:o|are)\\s+)?da remoto',
    'remote[ -]first',
    'telelavoro',
    'work from home',
    'wfh',
    'sede(?:\\s+operativa)?:\\s*(?:da\\s+)?remot[oa]',
    'opportunit[àa] di lavorare da remoto',
    'opportunity to work remotely',
    'work remotely',
    'smart[ -]?working (?:al\\s+)?100%',
    'smart[ -]?working (?:full|totale|completo)',
    'smart[ -]?working da remoto',
  ],
  onsite: [
    'on-?site',
    'in sede',
    'presso la nostra sede',
    'presso i nostri uffici',
    'in presenza',
    'in ufficio',
    'office-based',
  ],
};
const negation = /(?<![\p{L}\p{N}_])(?:non|no|not|nessun[oa]?|senza)(?![\p{L}\p{N}_])/iu;

/** A match is ignored when a negation sits in the 80 characters before it, with no sentence break in between. */
function firstAffirmed(pattern: RegExp, text: string) {
  for (const match of text.matchAll(pattern)) {
    const before =
      text
        .slice(Math.max(0, match.index - 80), match.index)
        .split(/[.!?\n]/)
        .at(-1) ?? '';
    if (!negation.test(before)) return true;
  }
  return false;
}

type Patterns = Record<'hybrid' | 'remote' | 'onsite', RegExp>;
function compile(defaults: Record<keyof Patterns, string[]>, extra: Profile['patterns']['workMode']): Patterns {
  const build = (mode: keyof Patterns) =>
    wholeWord([...defaults[mode], ...extra[mode].map(escapeRegex)].join('|'), 'giu');
  return { hybrid: build('hybrid'), remote: build('remote'), onsite: build('onsite') };
}

/** Compiled once per profile. A city alone never means on-site: with no signal the mode is null (unspecified). */
export function createWorkModeResolver(extra: Profile['patterns']['workMode']) {
  const head = compile(inTitleOrLocation, extra);
  const body = compile(inDescription, extra);
  return (posting: ModeSource): WorkMode | null => {
    if (posting.declared) return posting.declared;
    const place = `${posting.title}\n${posting.location}`;
    const text = posting.description ?? '';
    if (firstAffirmed(head.hybrid, place) || firstAffirmed(body.hybrid, text)) return 'hybrid';
    if (firstAffirmed(head.remote, place)) return 'remote';
    if (firstAffirmed(head.onsite, place)) return 'onsite';
    if (firstAffirmed(body.remote, text)) return 'remote';
    if (firstAffirmed(body.onsite, text)) return 'onsite';
    return posting.remote ? 'remote' : null;
  };
}
