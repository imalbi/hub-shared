export function listing(ids = [1], next = false) {
  return `<div class="ggp-job-results">${ids.map((id) => `<article class="ggp-job-item"><a class="ggp-job-title-url" href="/offerte-lavoro-dettaglio/esempio/${id}/"><h2 class="ggp-job-item-title">Frontend developer ${id}</h2></a><div class="job-tags"><div class="job-tag">Informatica</div><div class="job-tag">Contratto a tempo indeterminato - in azienda</div></div><div class="job-item-meta-row"><span class="visually-hidden">Luogo di lavoro:</span><span>Exampleville, EX, Examplia</span></div></article>`).join('')}</div>${next ? '<a class="page-link next" href="/offerte-lavoro/examplia-re/exampleville-pr/?npage=2&job=ict">Avanti</a>' : ''}`;
}
export const detail = (body = '<p>TypeScript e Docker, diploma richiesto.</p>') =>
  `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', description: body, datePosted: '27/11/2026' }).replaceAll('<', '\\u003c')}</script>`;
