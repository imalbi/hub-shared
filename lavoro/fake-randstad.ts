export function listing(ids = [1], next = false) {
  const data = {
    initialValues: {
      results: ids.map((id) => ({
        id: String(id),
        jobTitle: `Frontend developer ${id}`,
        clientDetail: { name: null },
        webDetails: { postedUrl: [{ href: `https://www.randstad.it/offerte-lavoro/esempio_${id}/`, lang: 'it' }] },
        jobInformation: { jobTypes: ['Tempo indeterminato'] },
        workLocationAddress: { locality: 'Exampleville', administrativeArea: 'Examplia' },
        postingDetail: { postingTime: '2026-11-27T10:00:00Z' },
        payRates: { salaryMin: 28000, salaryMax: 30000, currencySymbol: '€', unitDisplay: 'annuale' },
      })),
      meta: { page: 1, total: ids.length },
    },
  };
  const flight = `6:${JSON.stringify(['$', '$L6', null, data])}\n`;
  return `<script>self.__next_f.push(${JSON.stringify([1, flight])})</script>${next ? '<a href="/offerte-lavoro/re-examplia/ci-exampleville/s-ict/page-2/">2</a>' : ''}`;
}
export const detail = (body = '<p>TypeScript e Docker, diploma richiesto.</p>') =>
  `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', description: body, datePosted: '2026-11-27' }).replaceAll('<', '\\u003c')}</script>`;
