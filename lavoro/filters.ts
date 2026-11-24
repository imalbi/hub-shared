import type { JobRow } from './server.ts';

export type FirstSeenPreset = 'today' | '3d' | '7d' | '30d' | 'always' | 'custom';

export type LavoroFilters = {
  firstSeen?: FirstSeenPreset;
  customFrom?: number;
  customTo?: number;
  minScore?: number;
  workModes?: Array<'remote' | 'hybrid' | 'onsite'>;
  sources?: string[];
  categories?: string[];
  locations?: string[];
  companies?: string[];
};

export type FilterCounts = {
  workModes: Record<string, number>;
  sources: Record<string, number>;
  categories: Record<string, number>;
  locations: Record<string, number>;
  companies: Record<string, number>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function matchesFirstSeen(
  firstSeen: number,
  preset: FirstSeenPreset = 'always',
  from?: number,
  to?: number,
  now = Date.now(),
): boolean {
  if (preset === 'always') return true;

  if (preset === 'today') {
    const nowDate = new Date(now);
    const target = new Date(firstSeen);
    return (
      nowDate.getFullYear() === target.getFullYear() &&
      nowDate.getMonth() === target.getMonth() &&
      nowDate.getDate() === target.getDate()
    );
  }

  if (preset === '3d') return now - firstSeen <= 3 * DAY_MS;
  if (preset === '7d') return now - firstSeen <= 7 * DAY_MS;
  if (preset === '30d') return now - firstSeen <= 30 * DAY_MS;

  if (preset === 'custom') {
    if (from !== undefined && firstSeen < from) return false;
    if (to !== undefined && firstSeen > to) return false;
    return true;
  }

  return true;
}

export function matchesFilters(
  job: JobRow,
  filters: LavoroFilters,
  now = Date.now(),
  skipFilterKey?: keyof LavoroFilters,
): boolean {
  if (skipFilterKey !== 'firstSeen') {
    if (!matchesFirstSeen(job.firstSeen, filters.firstSeen, filters.customFrom, filters.customTo, now)) return false;
  }

  if (skipFilterKey !== 'minScore' && filters.minScore !== undefined) {
    if (job.total < filters.minScore) return false;
  }

  if (skipFilterKey !== 'workModes' && filters.workModes && filters.workModes.length > 0) {
    if (!job.workMode || !filters.workModes.includes(job.workMode)) return false;
  }

  if (skipFilterKey !== 'sources' && filters.sources && filters.sources.length > 0) {
    if (!filters.sources.includes(job.site)) return false;
  }

  if (skipFilterKey !== 'categories' && filters.categories && filters.categories.length > 0) {
    if (!job.categories.some((cat) => filters.categories!.includes(cat))) return false;
  }

  if (skipFilterKey !== 'locations' && filters.locations && filters.locations.length > 0) {
    if (!filters.locations.includes(job.location)) return false;
  }

  if (skipFilterKey !== 'companies' && filters.companies && filters.companies.length > 0) {
    if (!filters.companies.includes(job.company)) return false;
  }

  return true;
}

export function computeFilterCounts(jobs: JobRow[], filters: LavoroFilters, now = Date.now()): FilterCounts {
  const result: FilterCounts = {
    workModes: {},
    sources: {},
    categories: {},
    locations: {},
    companies: {},
  };

  // For workModes: evaluate all other filters except workModes
  for (const job of jobs) {
    if (matchesFilters(job, filters, now, 'workModes')) {
      if (job.workMode) {
        result.workModes[job.workMode] = (result.workModes[job.workMode] ?? 0) + 1;
      }
    }
  }

  // For sources: evaluate all other filters except sources
  for (const job of jobs) {
    if (matchesFilters(job, filters, now, 'sources')) {
      result.sources[job.site] = (result.sources[job.site] ?? 0) + 1;
    }
  }

  // For categories: evaluate all other filters except categories
  for (const job of jobs) {
    if (matchesFilters(job, filters, now, 'categories')) {
      for (const cat of job.categories) {
        result.categories[cat] = (result.categories[cat] ?? 0) + 1;
      }
    }
  }

  // For locations: evaluate all other filters except locations
  for (const job of jobs) {
    if (matchesFilters(job, filters, now, 'locations')) {
      result.locations[job.location] = (result.locations[job.location] ?? 0) + 1;
    }
  }

  // For companies: evaluate all other filters except companies
  for (const job of jobs) {
    if (matchesFilters(job, filters, now, 'companies')) {
      result.companies[job.company] = (result.companies[job.company] ?? 0) + 1;
    }
  }

  return result;
}

export function clearMultiChoiceFilters(filters: LavoroFilters): LavoroFilters {
  return {
    firstSeen: filters.firstSeen,
    customFrom: filters.customFrom,
    customTo: filters.customTo,
    minScore: filters.minScore,
    workModes: [],
    sources: [],
    categories: [],
    locations: [],
    companies: [],
  };
}

export function formatRelativeDate(timestamp: number, now = Date.now()): string {
  const nowDate = new Date(now);
  const targetDate = new Date(timestamp);

  const isToday =
    nowDate.getFullYear() === targetDate.getFullYear() &&
    nowDate.getMonth() === targetDate.getMonth() &&
    nowDate.getDate() === targetDate.getDate();

  const pad = (n: number) => String(n).padStart(2, '0');

  if (isToday) {
    return `oggi ${pad(targetDate.getHours())}:${pad(targetDate.getMinutes())}`;
  }

  // Check yesterday
  const yesterdayDate = new Date(now - DAY_MS);
  const isYesterday =
    yesterdayDate.getFullYear() === targetDate.getFullYear() &&
    yesterdayDate.getMonth() === targetDate.getMonth() &&
    yesterdayDate.getDate() === targetDate.getDate();

  if (isYesterday) {
    return 'ieri';
  }

  const diffDays = Math.floor((now - timestamp) / DAY_MS);
  if (diffDays >= 2 && diffDays <= 30) {
    return `${diffDays} giorni fa`;
  }

  return `${pad(targetDate.getDate())}/${pad(targetDate.getMonth() + 1)}/${targetDate.getFullYear()}`;
}
