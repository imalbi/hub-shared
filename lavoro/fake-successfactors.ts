// Invented markup modelled on the public page structure, with fake employers and jobs.
export const host = 'jobs.example.org';
export const url = (id: number, domain = host) => `https://${domain}/job/example/${id}/`;
export function table(start: number, total: number, ids: number[]) {
  return `<span>Risultati <b>${start + 1} – ${start + ids.length}</b> di <b>${total}</b></span>${ids.map((id) => `<tr class="data-row"><td><a class="jobTitle-link" href="/job/example/${id}/?x=1">Addetto esempio ${id}</a><span class="jobLocation">Torino, IT</span></td></tr>`).join('')}`;
}
export function tiles(start: number, total: number, ids: number[]) {
  return `<span id="tile-search-results-label">Visualizzazione da ${start + 1} a ${start + ids.length} di ${total} offerte</span><ul data-per-page="${ids.length}">${ids.map((id) => `<li class="job-tile" data-url="/job/example/${id}/?x=1"><a class="jobTitle-link">Addetto esempio ${id}</a><div id="job-${id}-desktop-section-multilocation-value">Torino, IT</div><div>Invented employer from page</div></li>`).join('')}</ul>`;
}
export const detail = (text = 'Diploma richiesto') =>
  `<div itemprop="description"><p>${text}</p><script>hidden()</script></div><meta itemprop="datePosted" content="2026-11-01">`;
export const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(`<html><body>${body}</body></html>`, { status, headers });
