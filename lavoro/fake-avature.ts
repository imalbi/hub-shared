export const enel = {
  listUrl: 'https://enel.example.org/it/careers/JobOpenings',
  company: 'Example Energy',
  country: '',
};
export const bank = {
  listUrl: 'https://bank.example.org/en/jobs/SearchJobs',
  company: 'Example Bank',
  country: 'Italy',
};
export function listing(
  employer: typeof enel,
  items: Array<{ id: number; location: string }>,
  total = items.length,
  hasNext = false,
): string {
  return `<html><body><div>${total} risultati</div>${items.map(({ id, location }) => `<article><div class="article__header__text"><h3 class="article__header__text__title"><a href="${new URL(`JobDetail/${id}`, employer.listUrl)}">Addetto esempio ${id}</a></h3><div class="article__header__text__subtitle"><span class="${employer.country ? 'job-info-icon_world' : 'article__header__text__subtitle--location'}">${location}</span></div></div></article>`).join('')}${hasNext ? '<a class="list-controls__pagination__item paginationNextLink">Next</a>' : ''}</body></html>`;
}
// Shaped like the live detail: labeled metadata fields first, then unlabeled job text blocks, all in .article--details.
const field = (label: string, value: string) =>
  `<div class="article__content__view__field"><div class="article__content__view__field__label">${label}</div><div class="article__content__view__field__value">${value}</div></div>`;
export const detail = `<div class="article--details">${field('Job ID', '90001')}${field('Country', 'Italy')}${field('City', 'Torino, Rivoli')}${field('', '<p>Diploma richiesto</p><script>hidden()</script>')}${field('', '<p>Turni a rotazione</p>')}</div><script type="application/ld+json">{"@type":"JobPosting","datePosted":"2026-11-01"}</script>`;
