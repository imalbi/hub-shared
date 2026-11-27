import { parseHTML } from 'linkedom';
import { agencyDate, agencyUrl, collectAgency } from './agency.ts';
import type { AgencyCard, AgencyPage } from './agency.ts';
import { cleanHtml } from './clean-html.ts';
import type { Source } from './source.ts';

const slug = (value: string) => value.trim().toLowerCase().replaceAll(/\s+/gu, '-');
function terms(text: string) {
  const contract = /(?:tempo indeterminato|tempo determinato|apprendistato|tirocinio|somministrazione)/iu.exec(
    text,
  )?.[0];
  const salary = /\bRAL\s+([^\n;]+?)(?=\.(?:\s|$)|;|\n|$)/iu.exec(text)?.[1]?.trim();
  return { contract, salary };
}
export function readUmana(raw: string, url: string, regions: string[], provinces: string[]): AgencyPage {
  const document = parseHTML(raw).document;
  const root = document.querySelector('.job_search_results .items');
  if (!root) throw new Error('umana: invalid listing');
  const cards: AgencyCard[] = [];
  for (const row of root.querySelectorAll('a.item')) {
    const region = row.getAttribute('data-region');
    const province = row.getAttribute('data-province');
    if (!region || !province) throw new Error('missing listing scope');
    if (!regions.includes(slug(region)) || !provinces.includes(slug(province))) continue;
    const href = row.getAttribute('href');
    const title = row.querySelector('.title')?.textContent?.trim();
    if (!href || !title) throw new Error('invalid agency posting');
    const text = row.querySelector('.description')?.textContent?.trim() ?? '';
    const date = agencyDate(row.querySelector('.details')?.textContent?.trim().split('|')[0]?.trim());
    const description = document.createElement('p');
    description.textContent = text;
    cards.push({
      url: agencyUrl(href, url, '/per-le-persone/offerte-di-lavoro/'),
      title,
      company: 'Umana',
      site: 'umana',
      location: `${province}, ${region}`,
      ...terms(text),
      descriptionHtml: description.outerHTML,
      ...(date ? { postedAt: date } : {}),
    });
  }
  const href = root.querySelector('a[rel="next"]')?.getAttribute('href');
  if (!href && root.querySelector('.pagination, .load-more, [data-next]')) throw new Error('unsupported pagination');
  return { cards, ...(href ? { next: { url: agencyUrl(href, url, '/per-le-persone/offerte-di-lavoro/') } } : {}) };
}
export function readUmanaDetail(card: AgencyCard, raw: string): AgencyCard {
  const document = parseHTML(raw).document;
  const offer = document.querySelector('.offer');
  if (!offer) throw new Error('missing agency detail');
  for (const extra of offer.querySelectorAll(
    'h1, a, .et_pb_text_align_center, [hidden], [style*="display:none"], [style*="display: none"]',
  ))
    extra.remove();
  const cleaned = cleanHtml(document, offer.innerHTML);
  const found = terms(cleaned.text);
  return {
    ...card,
    contract: found.contract ?? card.contract,
    salary: found.salary ?? card.salary,
    descriptionHtml: cleaned.html,
  };
}
export function createUmanaSource(): Source {
  return {
    name: 'umana',
    kind: 'list',
    async search(_input, context) {
      const settings = context.limits.umana;
      if (!settings) throw new Error('search.umana is required');
      return collectAgency(
        'umana',
        settings.functions.map((category) => ({
          url: `https://www.umana.it/per-le-persone/offerte-di-lavoro/${category}/`,
        })),
        settings.maxPages,
        context,
        (raw, current) => readUmana(raw, current.url, settings.regions, settings.provinces),
        readUmanaDetail,
      );
    },
  };
}
