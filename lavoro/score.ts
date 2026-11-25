import { categorize } from './categories.ts';
import type { Profile } from './config.ts';
import { locationBonus, locationPasses } from './location.ts';
import { keywordPattern, reasonOf, scoreKeywords } from './match.ts';
import { isProtectedCategory } from './protected-category.ts';
import { stableExclusion, stableReasons, type StableReason } from './stable.ts';
import { requiredYears } from './years.ts';
import { createWorkModeResolver, type WorkMode } from './work-mode.ts';

export type Posting = {
  title: string;
  company: string;
  location: string;
  /** The source's own name (`indeed`): a source listed in `profile.stable.sites` makes the posting Stabile. */
  site?: string;
  description?: string;
  declaredMode?: WorkMode;
  remote?: boolean;
};

export type ScoreResult = {
  titleScore: number;
  descriptionScore: number;
  yearsPenalty: number;
  /** Title, description and years: the only part `minScore` and `minTitleScore` look at. */
  score: number;
  locationBonus: number;
  workModeBonus: number;
  /** Place and work mode: they order the list, they never let a posting in. */
  bonus: number;
  total: number;
  workMode: WorkMode | null;
  /**
   * `rag:+5`, `senior:-4`, `rag:+2 (descr.)`, `torino:+3 (sede)`, `4+ anni:-6`, `remote:+2 (modalità)`; for a Stabile
   * posting also `stabile:azienda|fonte|indeterminato` and, when it cannot be applied to, `escluso:<motivo>`.
   */
  reasons: string[];
};

const yearsPenaltyPoints = -6;
/** A Stabile posting without a positive title weight hit, or with a negative score, does not enter on Stabile alone. */
const floorReason = 'stabile:sotto soglia';
const stableLabel: Record<StableReason, string> = {
  company: 'stabile:azienda',
  site: 'stabile:fonte',
};
type StableInput = Pick<Posting, 'title'> & Partial<Pick<Posting, 'company' | 'site' | 'description'>>;

// Administrative phrases ("posta elettronica", CIE) and Leonardo's corporate sector list are not the electronics trade.
const stripNonTechnicalElectronics = (text: string) =>
  text
    .replace(/\b(posta|fatturazione|firma|carta d['’]identità)\s+elettronica\b|\(CIE\)/giu, '$1')
    .replace(/\belicotteri,\s*velivoli,\s*aerostrutture,\s*elettronica\b/giu, 'Elicotteri, Velivoli, Aerostrutture');

const camelBoundary = /\p{Ll}\p{Lu}|\p{Lu}\p{Lu}\p{Ll}/u;

/** Split glued CamelCase tokens (`DesignerJunior`, `PCBDesigner`) unless a weighted keyword already matches the whole token. */
function splitGluedTitle(title: string, titleWeights: Record<string, number>) {
  const keywords = Object.keys(titleWeights);
  return title.replace(/\p{L}+/gu, (token) => {
    if (!camelBoundary.test(token)) return token;
    if (keywords.some((keyword) => keywordPattern(keyword).test(token))) return token;
    return token.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2');
  });
}

function scoreTitleKeywords(title: string, titleWeights: Record<string, number>) {
  const split = splitGluedTitle(title, titleWeights);
  if (split === title) return scoreKeywords(title, titleWeights);
  let score = 0;
  const reasons: string[] = [];
  for (const [keyword, weight] of Object.entries(titleWeights)) {
    if (!keywordPattern(keyword).test(title) && !keywordPattern(keyword).test(split)) continue;
    score += weight;
    reasons.push(reasonOf(keyword, weight));
  }
  return { score, reasons };
}

/** Everything that judges a posting, compiled once for a profile. */
export function createScorer(profile: Profile) {
  const { weights, filter, patterns } = profile;
  const { stable } = profile;
  const resolveMode = createWorkModeResolver(patterns.workMode);

  /** Empty without a `stable` section, so a profile without one never takes a Stabile path. */
  function stableOf(posting: StableInput) {
    return stable ? stableReasons(posting, stable) : [];
  }

  function scoreTitle(title: string) {
    return scoreTitleKeywords(title, weights.title);
  }

  function score(posting: Posting): ScoreResult {
    const description = posting.description ?? '';
    const title = scoreTitle(posting.title);
    const technical = stripNonTechnicalElectronics(description);
    const body = scoreKeywords(technical, weights.description, ' (descr.)');
    const reasons = [...title.reasons, ...body.reasons];

    const years = requiredYears(description, patterns.years.companySentence);
    let yearsPenalty = 0;
    if (years !== null) {
      yearsPenalty = years > filter.maxYearsExperience ? yearsPenaltyPoints : 0;
      reasons.push(yearsPenalty ? `${years}+ anni:${yearsPenalty}` : `${years} anni`);
    }

    const protectedCategory = isProtectedCategory(posting.title, description);
    let protectedPenalty = 0;
    if (protectedCategory) {
      protectedPenalty = -100;
      reasons.push('categorie protette:-100');
    }

    // A Stabile posting is ranked by its own title weights and may be dropped by what it requires. A posting that
    // clears the developer gates on its own is never dropped here: developer postings are judged as before.
    const total = title.score + body.score + yearsPenalty + protectedPenalty;
    let stableScore = 0;
    let stableBonus = 0;
    const stableFound = stableOf(posting);
    if (stable && stableFound.length) {
      reasons.push(...stableFound.map((reason) => stableLabel[reason]));
      const ranking = scoreTitleKeywords(posting.title, stable.titleWeights);
      stableScore = ranking.score;
      reasons.push(...ranking.reasons);
      const developerScore = total;
      const clearsGates =
        !protectedCategory && developerScore >= filter.minScore && title.score >= filter.minTitleScore;
      const exclusion = clearsGates ? null : stableExclusion(posting.title, description, stable.excludePhrases);
      if (exclusion) reasons.push(`escluso:${exclusion}`);
      // The floor: Stabile decides what a posting is, the floor decides whether it enters the list.
      const hitsPositiveWeight = Object.entries(stable.titleWeights).some(
        ([keyword, weight]) => weight > 0 && keywordPattern(keyword).test(posting.title),
      );
      const failsFloor = !clearsGates && (!hitsPositiveWeight || total + stableScore < 0 || yearsPenalty < 0);
      if (failsFloor) reasons.push(floorReason);
      if (!protectedCategory && !exclusion && !failsFloor && stable.bonus > 0) {
        stableBonus = stable.bonus;
        reasons.push(`stabile:+${stableBonus} (azienda)`);
      }
    }

    const place = locationBonus(posting.location, weights.location);
    const workMode = resolveMode({ ...posting, declared: posting.declaredMode });
    const modeBonus = workMode ? weights.workMode[workMode] : 0;
    reasons.push(...place.reasons);
    if (workMode && modeBonus) reasons.push(reasonOf(workMode, modeBonus, ' (modalità)'));

    const bonus = place.bonus + modeBonus + stableBonus;
    return {
      titleScore: title.score,
      descriptionScore: body.score,
      yearsPenalty,
      score: total + stableScore,
      locationBonus: place.bonus,
      workModeBonus: modeBonus,
      bonus,
      total: total + stableScore + bonus,
      workMode,
      reasons,
    };
  }

  return {
    scoreTitle,
    score,
    /**
     * Bonuses are left out on purpose: a role off topic does not get in because it is in the right city. A Stabile
     * posting skips the developer gates, and `escluso:` still drops it.
     */
    isSelected: (result: Pick<ScoreResult, 'score' | 'titleScore'> & { reasons?: string[] }) => {
      const has = (prefix: string) => result.reasons?.some((r) => r.startsWith(prefix)) ?? false;
      if (has('categorie protette:') || has('escluso:')) return false;
      if (has('stabile:') && !has(floorReason)) return true;
      return result.score >= filter.minScore && result.titleScore >= filter.minTitleScore;
    },
    /** True when the card alone already makes the posting Stabile (company, source, or a phrase in the text it has). */
    isStable: (posting: StableInput) => stableOf(posting).length > 0,
    passesLocation: (posting: Posting) =>
      locationPasses(
        {
          title: posting.title,
          location: posting.location,
          modeResolved: true,
          remote: resolveMode({ ...posting, declared: posting.declaredMode }) === 'remote',
        },
        stable?.extraLocations.length && stableOf(posting).length
          ? { ...filter, allowedLocations: [...filter.allowedLocations, ...stable.extraLocations] }
          : filter,
      ),
    categories: (posting: StableInput) => {
      const found = categorize(
        posting.title,
        stripNonTechnicalElectronics(posting.description ?? ''),
        profile.categories,
      );
      return stable && !found.includes(stable.category) && stableOf(posting).length
        ? [...found, stable.category]
        : found;
    },
  };
}
