export function listing(ids = [1], next = false) {
  return `<div class="job_search_results"><div class="items">${ids.map((id) => `<a class="item" data-task="ICT" data-region="Examplia" data-province="EX" href="/per-le-persone/offerte-di-lavoro/esempio/${id}/"><span class="title">Frontend developer ${id}</span><span class="details">27/11/2026 | ICT | EX</span><span class="description">Per azienda cliente. Tempo indeterminato, RAL € 28000-30000 annuale.</span></a>`).join('')}${next ? '<a rel="next" href="/per-le-persone/offerte-di-lavoro/ict/?page=2">Avanti</a>' : ''}</div></div>`;
}
export const detail = (body = '<p>TypeScript e Docker, diploma richiesto.</p>') =>
  `<div class="offer"><h1>Frontend developer</h1><a href="/">Offerte</a>${body}<p>Tempo indeterminato, RAL € 28000-30000 annuale.</p><div class="et_pb_text_align_center">PRIVACY</div><div style="display:none">HIDDEN</div></div>`;
