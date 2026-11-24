import { parseHTML } from '../../apps/server/src/core/module-html.ts';
import { fetchBounded, readBoundedText } from './bounded-fetch.ts';
import { cleanHtml } from './clean-html.ts';
import { desktopHeaders } from './desktop-headers.ts';
import type { Card, SearchInput, Source, SourceContext } from './source.ts';

const base = 'https://www.linkedin.com';
const fail = (reason: string) => new Error(`linkedin: ${reason}`);
type State = {
  requests: number;
  limited: number;
  consecutive: number;
  interval: number;
  next: number;
  budget: number;
  blocked: string;
  turn: Promise<void>;
};

export function createLinkedinSource({ random = Math.random }: { random?: () => number } = {}): Source {
  const states = new WeakMap<AbortSignal, State>();
  const cleaner = parseHTML('<html><body></body></html>').document;
  function state(ctx: SourceContext): State {
    let value = states.get(ctx.signal);
    if (!value) {
      value = {
        requests: 0,
        limited: 0,
        consecutive: 0,
        interval: ctx.limits.linkedin.minIntervalSeconds * 1000,
        next: -Infinity,
        budget: ctx.limits.linkedin.retryBudgetSeconds * 1000,
        blocked: '',
        turn: Promise.resolve(),
      };
      states.set(ctx.signal, value);
    }
    return value;
  }
  async function get(url: string, ctx: SourceContext) {
    const s = state(ctx);
    const previous = s.turn;
    let release = () => {};
    s.turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const config = ctx.limits.linkedin;
      let started = ctx.now();
      for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
        if (s.blocked) throw fail(s.blocked);
        if (s.requests >= config.maxRequests) {
          s.blocked = 'request budget exhausted';
          throw fail(s.blocked);
        }
        const delay = s.next - ctx.now();
        if (delay > 0) await wait(delay, ctx);
        if (ctx.signal.aborted) throw fail('cancelled');
        if (attempt === 0) started = ctx.now();
        s.requests++;
        s.next = ctx.now() + s.interval * (1 + random() * 0.3);
        let response: Response;
        try {
          response = await fetchBounded(ctx.fetch, url, {
            headers: desktopHeaders,
            signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(20000)]),
          });
        } catch {
          throw fail('request failed');
        }
        if (response.status !== 429) {
          s.consecutive = 0;
          if (!response.ok) {
            await response.body?.cancel();
            throw fail(`HTTP ${response.status}`);
          }
          return parseHTML(await readBoundedText(response)).document;
        }
        await response.body?.cancel();
        s.limited++;
        s.consecutive++;
        s.interval = Math.min(s.interval * 1.5, 30000);
        if (s.consecutive >= config.maxConsecutive429) s.blocked = 'consecutive HTTP 429';
        if (s.blocked || attempt + 1 >= config.maxAttempts) {
          s.blocked ||= 'HTTP 429';
          throw fail(s.blocked);
        }
        const header = response.headers.get('retry-after')?.trim() ?? '';
        const parsed = /^\d+$/u.test(header) ? Number(header) * 1000 : Date.parse(header) - ctx.now();
        const retry = Math.max(
          Math.min(config.backoffSeconds * 1000 * 2 ** attempt, config.maxBackoffSeconds * 1000) * (1 + random() * 0.2),
          Number.isFinite(parsed) ? parsed : 0,
        );
        if (ctx.now() - started + Math.max(retry, s.next - ctx.now()) > 180000) {
          s.blocked = 'HTTP 429';
          throw fail(s.blocked);
        }
        if (retry > s.budget) {
          s.blocked = 'retry budget exhausted';
          throw fail(s.blocked);
        }
        s.budget -= retry;
        await wait(retry, ctx);
      }
      throw fail('HTTP 429');
    } finally {
      release();
    }
  }
  async function wait(ms: number, ctx: SourceContext) {
    ctx.reportWait?.('linkedin', Math.ceil(ms / 1000));
    try {
      await ctx.sleep(ms);
    } finally {
      ctx.reportWait?.('linkedin', null);
    }
  }
  async function search(input: SearchInput, ctx: SourceContext) {
    const config = ctx.limits.linkedin;
    const params = new URLSearchParams({
      keywords: input.query.keywords,
      location: input.location,
      f_TPR: `r${input.hoursOld * 3600}`,
      sortBy: input.query.sortBy ?? config.sortBy,
    });
    const geoId = input.query.geoId ?? config.geoId;
    const experience = input.query.experience ?? config.experience;
    const types = input.query.workTypes ?? config.workTypes;
    if (geoId) params.set('geoId', geoId);
    if (experience.length) params.set('f_E', experience.join(','));
    if (types.length) params.set('f_WT', types.join(','));
    const cards: Card[] = [];
    const seen = new Set<string>();
    let start = 0,
      pages = 0,
      known = 0,
      stop = 'limit';
    try {
      while (cards.length < input.maxResults && start < 1000) {
        params.set('start', String(start));
        const doc = await get(`${base}/jobs-guest/jobs/api/seeMoreJobPostings/search?${params}`, ctx);
        const elements = [...doc.querySelectorAll('.base-search-card')];
        pages++;
        if (!elements.length) {
          stop = 'empty';
          break;
        }
        start += elements.length;
        let added = 0,
          fresh = 0;
        for (const element of elements) {
          const id = element.getAttribute('data-entity-urn')?.split(':').at(-1) ?? '';
          const title = element.querySelector('h3')?.textContent?.trim() ?? '';
          const company = element.querySelector('h4')?.textContent?.trim() ?? '';
          if (!id || !title || !company) continue;
          const url = `${base}/jobs/view/${id}`;
          if (seen.has(url)) continue;
          seen.add(url);
          added++;
          if (!ctx.isKnown(url)) fresh++;
          const date = new Date(element.querySelector('time[datetime]')?.getAttribute('datetime') ?? '');
          cards.push({
            url,
            title,
            company,
            location: element.querySelector('span.job-search-card__location')?.textContent?.trim() ?? '',
            site: 'linkedin',
            ...(Number.isNaN(date.getTime()) ? {} : { postedAt: date }),
          });
          if (cards.length >= input.maxResults) break;
        }
        known = fresh ? 0 : known + 1;
        if (!added) {
          stop = 'repeat';
          break;
        }
        if (input.knownPagesToStop && known >= input.knownPagesToStop) {
          stop = 'known';
          break;
        }
        if (elements.length < 10) {
          stop = 'short';
          break;
        }
      }
      if (start >= 1000) stop = 'offset';
      ctx.log.info({ pages, cards: cards.length, stop }, 'LinkedIn search done');
      return { cards };
    } catch (error) {
      ctx.log.info({ pages, cards: cards.length, stop: 'error' }, 'LinkedIn search done');
      return {
        cards,
        error: error instanceof Error && error.message.startsWith('linkedin: ') ? error : fail('unexpected failure'),
      };
    }
  }
  return {
    name: 'linkedin',
    kind: 'search',
    search,
    finish: (ctx) => {
      const s = states.get(ctx.signal);
      if (s)
        ctx.log.info(
          { requests: s.requests, rateLimited: s.limited, blocked: s.blocked || 'none' },
          'LinkedIn throttle summary',
        );
    },
    describe: async (card, ctx) => {
      const doc = await get(card.url, ctx);
      const body = doc.querySelector('div.show-more-less-html__markup');
      return body ? cleanHtml(cleaner, body.innerHTML) : '';
    },
  };
}
