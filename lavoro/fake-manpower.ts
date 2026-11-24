export type FakeCard = { id: number; contract?: string; salary?: string };
export function listing(items: FakeCard[], next = ''): string {
  return `<html><body>${items.map(({ id, contract = 'Somministrazione', salary = '' }) => `<div class="card-body"><div class="job-actionbar"><time class="date">01/11/2026</time></div><div class="job-skills"><div class="company">Manpower</div></div><div class="job-position"><h2 class="title manpower"><a href="/it/annuncio-lavoro/ict/example/ruolo/${id}">Addetto esempio ${id}</a></h2>${salary ? `<div class="salary">${salary}</div>` : ''}</div><div class="job-details"><div class="location">Torino, Piemonte, TO</div><div class="type">${contract}</div><div class="industry">ICT</div></div></div>`).join('')}${next ? `<a class="page-link more" href="${next}">Succ.</a>` : ''}</body></html>`;
}
// Shaped like the live detail: metadata fields as inline text in job-details-text blocks, the posting text in
// details-rich-text, the legal notes in a separate rich-text-block.
export const detailWith = (contract: string) =>
  `<div class="job-header">Header</div><div class="job-details-list"><div class="job-details-text"> <!-- -->Codice annuncio: <!-- --> <!-- -->90001</div><div class="job-details-text">Contratto: <!-- --> <!-- -->${contract}</div><div class="job-details-text">Opportunità Green: <!-- --> <!-- -->No</div></div><div class="details-rich-text"><h2><p>Descrizione</p></h2><p>Diploma richiesto</p><p>Turni disponibili</p><script>hidden()</script></div><div class="rich-text-block">NOTE LEGALI esempio</div>`;
export const detail = detailWith('Somministrazione');
