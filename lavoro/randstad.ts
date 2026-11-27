import { parseHTML } from 'linkedom';
import { z } from '../../apps/server/src/core/module.ts';
import { agencyDate, agencyJsonDetail, agencyUrl, collectAgency } from './agency.ts';
import type { AgencyCard, AgencyPage } from './agency.ts';
import type { Source } from './source.ts';

const job = z.object({
  id: z.string().min(1),
  jobTitle: z.string().min(1),
  clientDetail: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
  webDetails: z.object({ postedUrl: z.array(z.object({ href: z.string(), lang: z.string() })).min(1) }),
  jobInformation: z.object({ jobTypes: z.array(z.string()) }),
  description: z.object({ shortDescription: z.string().nullable().optional() }).nullable().optional(),
  workLocationAddress: z
    .object({
      locality: z.string().nullable().optional(),
      administrativeArea: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  postingDetail: z.object({ postingTime: z.string().nullable().optional() }).nullable().optional(),
  payRates: z
    .object({
      salaryMin: z.number().nullable().optional(),
      salaryMax: z.number().nullable().optional(),
      currencySymbol: z.string().nullable().optional(),
      unitDisplay: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});
const values = z.object({
  results: z.array(job),
  meta: z.object({ total: z.number().int().nonnegative(), page: z.number().int().positive() }),
});
const record = z.tuple([z.unknown(), z.unknown(), z.unknown(), z.object({ initialValues: values })]);

export function readRandstad(raw: string, url: string): AgencyPage {
  const document = parseHTML(raw).document;
  let flight = '';
  for (const script of document.querySelectorAll('script')) {
    const match = /^self\.__next_f\.push\((.*)\)$/su.exec(script.textContent?.trim() ?? '');
    if (!match) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(match[1] ?? '');
    } catch {
      continue;
    }
    const part = z.tuple([z.literal(1), z.string()]).safeParse(payload);
    if (part.success) flight += part.data[1];
  }
  for (const match of flight.matchAll(/[0-9a-f]+:(\[.*)\n/gu)) {
    let value: unknown;
    try {
      value = JSON.parse(match[1] ?? '');
    } catch {
      continue;
    }
    const parsed = record.safeParse(value);
    if (!parsed.success) continue;
    const { results, meta } = parsed.data[3].initialValues;
    const cards = results.map((item): AgencyCard => {
      const href =
        item.webDetails.postedUrl.find((link) => link.lang === 'it')?.href ?? item.webDetails.postedUrl[0]?.href;
      if (!href) throw new Error('missing posting URL');
      const pay = item.payRates;
      const amounts = [pay?.salaryMin, pay?.salaryMax].filter((n) => n !== null && n !== undefined && n > 0);
      const date = agencyDate(item.postingDetail?.postingTime ?? undefined);
      return {
        url: agencyUrl(href, url, '/offerte-lavoro/'),
        title: item.jobTitle,
        company: item.clientDetail?.name?.trim() || 'Randstad',
        site: 'randstad',
        location: [item.workLocationAddress?.locality, item.workLocationAddress?.administrativeArea]
          .filter(Boolean)
          .join(', '),
        contract: item.jobInformation.jobTypes.join(', '),
        ...(amounts.length
          ? {
              salary:
                `${pay?.currencySymbol ?? ''} ${[...new Set(amounts)].join('-')} ${pay?.unitDisplay ?? ''}`.trim(),
            }
          : {}),
        ...(date ? { postedAt: date } : {}),
        descriptionHtml: item.description?.shortDescription ?? '',
      };
    });
    const href = [...document.querySelectorAll('a[href]')]
      .map((link) => link.getAttribute('href') ?? '')
      .find((href) => new RegExp(`/page-${meta.page + 1}/?$`, 'u').test(href));
    if (meta.total > 0 && !cards.length) throw new Error('empty nonempty listing');
    if (!href && meta.total > meta.page * 30) throw new Error('missing pagination');
    return { cards, ...(href ? { next: { url: agencyUrl(href, url, '/offerte-lavoro/') } } : {}) };
  }
  throw new Error('randstad: invalid listing');
}

export function createRandstadSource(): Source {
  return {
    name: 'randstad',
    kind: 'list',
    async search(_input, context) {
      const settings = context.limits.randstad;
      if (!settings) throw new Error('search.randstad is required');
      const scopes = settings.regions.flatMap((region) =>
        settings.cities.flatMap((city) =>
          settings.functions.map((category) => ({
            url: `https://www.randstad.it/offerte-lavoro/re-${region}/ci-${city}/s-${category}/`,
          })),
        ),
      );
      return collectAgency(
        'randstad',
        scopes,
        settings.maxPages,
        context,
        (raw, current) => readRandstad(raw, current.url),
        agencyJsonDetail,
      );
    },
  };
}
