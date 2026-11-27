import { parseHTML } from 'linkedom';
import { agencyJsonDetail, agencyUrl, collectAgency } from './agency.ts';
import type { AgencyCard, AgencyPage } from './agency.ts';
import type { Source } from './source.ts';

export function readGigroup(raw: string, url: string): AgencyPage {
  const document = parseHTML(raw).document;
  const root = document.querySelector('.ggp-job-results');
  if (!root) throw new Error('gigroup: invalid listing');
  const cards = [...root.querySelectorAll('article.ggp-job-item')].map((row): AgencyCard => {
    const link = row.querySelector('a.ggp-job-title-url[href]');
    const href = link?.getAttribute('href');
    const title = row.querySelector('.ggp-job-item-title')?.textContent?.trim();
    if (!href || !title) throw new Error('invalid agency posting');
    const location = [...row.querySelectorAll('.job-item-meta-row')].find((row) =>
      /Luogo di lavoro:/iu.test(row.textContent ?? ''),
    );
    const locationText = [...(location?.querySelectorAll('span') ?? [])]
      .filter((span) => !span.classList.contains('visually-hidden'))
      .map((span) => span.textContent?.trim())
      .filter(Boolean)
      .join(' ');
    const contract = [...row.querySelectorAll('.job-tags .job-tag')]
      .map((tag) => tag.textContent?.trim() ?? '')
      .find((text) => /contratto|apprendistato|tirocinio|somministrazione/iu.test(text));
    return {
      url: agencyUrl(href, url, '/offerte-lavoro-dettaglio/'),
      title,
      company: 'Gi Group',
      site: 'gigroup',
      location: locationText,
      contract,
    };
  });
  const href = document.querySelector('a.page-link.next[href]')?.getAttribute('href');
  return { cards, ...(href ? { next: { url: agencyUrl(href, url, '/offerte-lavoro/') } } : {}) };
}

export function createGigroupSource(): Source {
  return {
    name: 'gigroup',
    kind: 'list',
    async search(_input, context) {
      const settings = context.limits.gigroup;
      if (!settings) throw new Error('search.gigroup is required');
      const scopes = settings.cities.flatMap((city) =>
        settings.functions.map((category) => {
          const url = new URL('https://www.gigroup.it/offerte-lavoro/');
          url.search = new URLSearchParams({ job: category, placeOfWork: city, npage: '1' }).toString();
          return { url: url.href };
        }),
      );
      return collectAgency(
        'gigroup',
        scopes,
        settings.maxPages,
        context,
        (raw, current) => readGigroup(raw, current.url),
        agencyJsonDetail,
      );
    },
  };
}
