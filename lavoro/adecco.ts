import { z } from '../../apps/server/src/core/module.ts';
import { agencyDate, collectAgency } from './agency.ts';
import type { AgencyCard, AgencyPage, AgencyRequest } from './agency.ts';
import type { Source } from './source.ts';

const job = z.object({
  jobId: z.string().regex(/^[a-z0-9-]+$/iu),
  jobTitle: z.string().min(1),
  jobLocation: z.string(),
  contractTypeTitle: z.string().nullable().optional(),
  contractTypeId: z.string().nullable().optional(),
  minsalary: z.number().nullable().optional(),
  maxsalary: z.number().nullable().optional(),
  salaryCurrencySymbol: z.string().nullable().optional(),
  salaryTimeScale: z.string().nullable().optional(),
  postedDate: z.string().nullable().optional(),
});
const response = z.object({
  jobs: z.array(job),
  pagination: z.object({ total: z.number().int().nonnegative(), nextRange: z.number().int().nonnegative() }),
});
const detailResponse = z.object({ jobDescription: z.string(), companyName: z.string().nullable().optional() });
function contract(title: string | null | undefined, id: string | null | undefined) {
  if (id === 'PERM') return 'Tempo indeterminato';
  if (id === 'TEMP') return 'Tempo determinato';
  return title?.trim() || undefined;
}
export function adeccoRequest(city: string, category: string, range = 0): AgencyRequest {
  return {
    url: 'https://www.adecco.com/api/data/jobs/summarized',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        queryString: `&q=${encodeURIComponent(category.replaceAll('-', ' '))}&location:${encodeURIComponent(city.replaceAll('-', ' '))}&sort=PostedDate desc`,
        filtersToDisplay: '',
        range,
        siteName: 'adecco',
        brand: 'adecco',
        countryCode: 'it',
        languageCode: 'it-IT',
      }),
    },
  };
}
const requestBody = z.object({ range: z.number().int().nonnegative() });
export function readAdecco(raw: string, current: AgencyRequest, city: string): AgencyPage {
  const result = response.parse(JSON.parse(raw));
  const range = requestBody.parse(JSON.parse(typeof current.init?.body === 'string' ? current.init.body : '{}')).range;
  if (result.pagination.total > range && result.jobs.length === 0) throw new Error('empty nonempty listing');
  const cards = result.jobs
    .filter((item) =>
      item.jobLocation
        .toLowerCase()
        .split(',')
        .some((part) => part.trim() === city.replaceAll('-', ' ')),
    )
    .map((item): AgencyCard => {
      const date = agencyDate(item.postedDate ?? undefined);
      const amounts = [
        ...new Set([item.minsalary, item.maxsalary].filter((n) => n !== undefined && n !== null && n > 0)),
      ];
      return {
        url: `https://www.adecco.com/it-it/offerte-lavoro?jobId=${item.jobId.toLowerCase()}`,
        detailUrl: `https://www.adecco.com/api/data/jobs/job-description-details/${item.jobId}/adecco/it/it-IT/job-details`,
        title: item.jobTitle,
        company: 'Adecco',
        site: 'adecco',
        location: item.jobLocation,
        contract: contract(item.contractTypeTitle, item.contractTypeId),
        ...(date ? { postedAt: date } : {}),
        ...(amounts.length
          ? { salary: `${item.salaryCurrencySymbol ?? ''} ${amounts.join('-')} ${item.salaryTimeScale ?? ''}`.trim() }
          : {}),
      };
    });
  if (range + result.jobs.length >= result.pagination.total) return { cards };
  if (result.pagination.nextRange <= range) throw new Error('invalid next range');
  const body = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(typeof current.init?.body === 'string' ? current.init.body : '{}'));
  return {
    cards,
    next: {
      ...current,
      init: { ...current.init, body: JSON.stringify({ ...body, range: result.pagination.nextRange }) },
    },
  };
}
export function readAdeccoDetail(card: AgencyCard, raw: string): AgencyCard {
  const result = detailResponse.parse(JSON.parse(raw));
  return { ...card, company: result.companyName?.trim() || card.company, descriptionHtml: result.jobDescription };
}
export function createAdeccoSource(): Source {
  return {
    name: 'adecco',
    kind: 'list',
    async search(_input, context) {
      const settings = context.limits.adecco;
      if (!settings) throw new Error('search.adecco is required');
      // Each scope retains its city while the shared collector follows POST ranges.
      const scopes = settings.cities.flatMap((city) =>
        settings.functions.map((category) => adeccoRequest(city, category)),
      );
      return collectAgency(
        'adecco',
        scopes,
        settings.maxPages,
        context,
        (raw, current) => {
          const body = z
            .object({ queryString: z.string() })
            .parse(JSON.parse(typeof current.init?.body === 'string' ? current.init.body : '{}'));
          const city = decodeURIComponent(/&location:([^&]+)/u.exec(body.queryString)?.[1] ?? '');
          return readAdecco(raw, current, city);
        },
        readAdeccoDetail,
      );
    },
  };
}
