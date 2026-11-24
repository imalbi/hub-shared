import { parseHTML } from '../../apps/server/src/core/module-html.ts';
import { z } from '../../apps/server/src/core/module.ts';
import { fetchBounded, readBoundedJson } from './bounded-fetch.ts';
import { cleanHtml } from './clean-html.ts';
import { desktopHeaders } from './desktop-headers.ts';
import { retryAfter } from './inpa.ts';
import type { Profile } from './config.ts';
import type { Card, SearchInput, SearchResult, Source, SourceContext } from './source.ts';

const SITE = 'workday';
const PAGE_SIZE = 20;
const fail = (message: string) => new Error(`${SITE}: ${message}`);
const squash = (text: string | null | undefined) => (text ?? '').split(/\s+/u).filter(Boolean).join(' ');

export type WorkdayEmployer = Profile['search']['workday']['employers'][number];

const itemSchema = z.object({
  title: z.string(),
  externalPath: z.string().regex(/^\/[^\s?#]+$/u),
  locationsText: z.string().nullish(),
});

const pageSchema = z.object({
  total: z.number().int().nonnegative().optional(),
  jobPostings: z.array(itemSchema),
});

const detailSchema = z.object({
  jobPostingInfo: z.object({
    jobDescription: z.string().nullish(),
    location: z.string().nullish(),
    additionalLocations: z.array(z.string()).nullish(),
    startDate: z.string().nullish(),
    timeType: z.string().nullish(),
  }),
});

export function listUrl(employer: WorkdayEmployer): string {
  return `https://${employer.host}/wday/cxs/${employer.tenant}/${employer.site}/jobs`;
}

export function detailUrl(employer: WorkdayEmployer, externalPath: string): string {
  return `https://${employer.host}/wday/cxs/${employer.tenant}/${employer.site}${externalPath}`;
}

export function publicUrl(employer: WorkdayEmployer, externalPath: string): string {
  if (employer.host.toLowerCase().endsWith('.myworkdaysite.com')) {
    return `https://${employer.host}/recruiting/${employer.tenant}/${employer.site}${externalPath}`;
  }
  return `https://${employer.host}/${employer.site}${externalPath}`;
}

export type WorkdayRow = { externalPath: string; card: Card };

export function readPage(value: unknown, employer: WorkdayEmployer): { rows: WorkdayRow[]; total: number | undefined } {
  const parsed = pageSchema.safeParse(value);
  if (!parsed.success) throw fail('the search response changed');
  const rows: WorkdayRow[] = [];
  for (const item of parsed.data.jobPostings) {
    const title = squash(item.title);
    if (!title) continue;
    rows.push({
      externalPath: item.externalPath,
      card: {
        url: publicUrl(employer, item.externalPath),
        title,
        company: employer.company,
        location: squash(item.locationsText),
        site: SITE,
      },
    });
  }
  return { rows, total: parsed.data.total };
}

export function readDetail(
  value: unknown,
  cleaner: Document,
  fallbackLocation: string,
): Pick<Card, 'description' | 'descriptionHtml' | 'location' | 'postedAt'> {
  const parsed = detailSchema.safeParse(value);
  if (!parsed.success) throw fail('the detail response changed');
  const info = parsed.data.jobPostingInfo;

  const seenPlaces = new Set<string>();
  const places: string[] = [];
  for (const rawPlace of [info.location, ...(info.additionalLocations ?? [])]) {
    const place = squash(rawPlace);
    if (!place) continue;
    const key = place.toLowerCase();
    if (seenPlaces.has(key)) continue;
    seenPlaces.add(key);
    places.push(place);
  }
  const location = places.length ? places.join(', ') : fallbackLocation;

  const cleaned = cleanHtml(cleaner, info.jobDescription ?? '');
  if (!cleaned.text) throw fail('the detail response changed');

  const timeType = squash(info.timeType);
  const headerText = timeType ? `Orario: ${timeType}` : '';
  const heading = cleaner.createElement('p');
  heading.textContent = headerText;

  let postedAt: Date | undefined;
  const startDate = squash(info.startDate);
  if (/^\d{4}-\d{2}-\d{2}$/u.test(startDate)) {
    const parsedDate = new Date(startDate);
    if (!Number.isNaN(parsedDate.getTime())) postedAt = parsedDate;
  }

  return {
    location,
    description: [headerText, cleaned.text].filter(Boolean).join('\n'),
    descriptionHtml: `${headerText ? heading.outerHTML : ''}${cleaned.html}`,
    ...(postedAt ? { postedAt } : {}),
  };
}

export function createWorkdaySource({ requestTimeoutMs = 20_000 }: { requestTimeoutMs?: number } = {}): Source {
  const cleaner = parseHTML('<!doctype html><html><body></body></html>').document;

  async function search(_input: SearchInput, context: SourceContext): Promise<SearchResult> {
    let last = Number.NEGATIVE_INFINITY;

    async function requestJson(url: string, init: RequestInit): Promise<unknown> {
      for (let attempt = 0; ; attempt++) {
        const delay = last + 1000 - context.now();
        if (delay > 0) await context.sleep(delay);
        if (context.signal.aborted) throw context.signal.reason;
        const timeout = AbortSignal.timeout(requestTimeoutMs);
        let response: Response;
        try {
          response = await fetchBounded(context.fetch, url, {
            ...init,
            signal: AbortSignal.any([context.signal, timeout]),
          });
        } catch (error) {
          if (context.signal.aborted) throw error;
          throw fail(timeout.aborted ? 'request timed out' : 'request failed');
        } finally {
          last = context.now();
        }
        if (response.status === 429) {
          await response.body?.cancel();
          const wait = retryAfter(response.headers.get('retry-after'), context.now());
          if (attempt >= 2 || wait > 120_000) throw fail('HTTP 429');
          context.reportWait?.(SITE, Math.ceil(wait / 1000));
          try {
            await context.sleep(wait);
          } finally {
            context.reportWait?.(SITE, null);
          }
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw fail(`HTTP ${response.status}`);
        }
        try {
          return await readBoundedJson(response);
        } catch {
          throw fail('the search response changed');
        }
      }
    }

    const cards: Card[] = [];
    const seenUrls = new Set<string>();
    let firstError: Error | undefined;
    let capped = false;

    for (const employer of context.limits.workday.employers) {
      try {
        let fresh = 0;
        let failedDetails = 0;
        const seenPaths = new Set<string>();
        let page1Total: number | undefined;
        let done = false;

        for (let page = 0; page < context.limits.workday.maxPages; page++) {
          const offset = page * PAGE_SIZE;
          const payload = await requestJson(listUrl(employer), {
            method: 'POST',
            headers: {
              ...desktopHeaders,
              'content-type': 'application/json',
              accept: 'application/json',
            },
            body: JSON.stringify({
              appliedFacets: {},
              limit: PAGE_SIZE,
              offset,
              searchText: employer.searchText,
            }),
          });
          const parsed = readPage(payload, employer);
          // Workday returns total on offset=0 only and 0 on subsequent pages.
          if (page === 0) page1Total = parsed.total ?? 0;

          let added = 0;
          for (const row of parsed.rows) {
            if (seenPaths.has(row.externalPath)) continue;
            seenPaths.add(row.externalPath);
            added++;
            if (seenUrls.has(row.card.url)) continue;
            seenUrls.add(row.card.url);
            if (context.isKnown(row.card.url)) {
              cards.push(row.card);
              continue;
            }
            fresh++;
            try {
              const rawDetail = await requestJson(detailUrl(employer, row.externalPath), {
                method: 'GET',
                headers: { ...desktopHeaders, accept: 'application/json' },
              });
              const detail = readDetail(rawDetail, cleaner, row.card.location);
              cards.push({ ...row.card, ...detail });
            } catch (error) {
              if (context.signal.aborted) throw error;
              failedDetails++;
              cards.push({ ...row.card, detailsMissing: true });
            }
          }

          if (parsed.rows.length === 0 || added === 0) {
            done = true;
            break;
          }
          if (page1Total !== undefined && offset + PAGE_SIZE >= page1Total) {
            done = true;
            break;
          }
        }
        if (!done) capped = true;

        context.log.info({ company: employer.company, read: seenPaths.size, fresh, failedDetails }, 'Workday done');
      } catch (error) {
        if (context.signal.aborted) return { cards };
        const safe =
          error instanceof Error && error.message.startsWith(`${SITE}: `) ? error : fail('unexpected failure');
        firstError ??= safe;
        context.log.warn({ company: employer.company, message: safe.message }, 'Workday employer failed');
      }
    }

    return { cards, ...(firstError ? { error: firstError } : {}), complete: !firstError && !capped };
  }

  return { name: SITE, kind: 'list', search };
}
