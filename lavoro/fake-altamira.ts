export const employer = { listUrl: 'https://board.example.org/', company: 'Example' };
export const listing = (ids = [1], next = '') =>
  `<html><body><table><tr><td data-title="Titolo">Titolo</td></tr>${ids.map((id) => `<tr class="GRID_DAT_ROW"><td data-title="Titolo"><a href="/annunci-lavoro/frontend-${id}.htm">Frontend developer ${id}</a></td><td data-title="Data di pubblicazione">01/11/2026</td><td data-title="Sedi">Exampleville</td></tr>`).join('')}</table>${next ? `<a rel="next" href="${next}">Successiva</a>` : ''}</body></html>`;
export const detail =
  '<section class="job-detail"><div data-title="Testo"><div class="LABLE"><p>TypeScript e Docker</p><script>secret()</script></div></div></section>';
