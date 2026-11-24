// Invented Rete Informatica Lavoro pages and a fetch that serves them, shared by the source and engine tests. The
// markup follows the friend's fixtures and what the 16e live check confirmed (counts only); every value is invented.

export type CardOptions = {
  day?: Date;
  place?: string;
  remote?: string;
  code?: string;
  company?: string;
  slug?: string;
};

const twoDigits = (n: number) => String(n).padStart(2, '0');
const shortDay = (day: Date) =>
  `${twoDigits(day.getDate())}/${twoDigits(day.getMonth() + 1)}/${twoDigits(day.getFullYear() % 100)}`;

export function card(id: number, title: string, options: CardOptions = {}) {
  const { day = new Date(2026, 10, 5), place = 'Exampleville (EX)', remote = 'Parziale', code = '' } = options;
  const company = options.company ?? `Company ${id}`;
  let meta = place ? `<li><i class="fa fa-map-marker" aria-hidden="true"></i> ${place}</li>` : '';
  if (remote) meta += `<li><i class="fa fa-home" aria-hidden="true"></i> Remote working: ${remote}</li>`;
  const codeTag = code ? ` <span class="ol-code">· ${code}</span>` : '';
  return `<article class="ol-card " >
    <a class="ol-card-link" href="/lavoro/${id}/${options.slug ?? `slug-${id}-exampleville`}" aria-label="x"></a>
    <div class="ol-main">
      <div class="ol-top"><span class="ol-badge ol-badge--new">Nuovo</span></div>
      <h2 class="ol-title">${title}${codeTag}</h2>
      <div class="ol-co">${company}</div>
      <ul class="ol-meta">${meta}<li>Full time</li><li>Middle</li></ul>
    </div>
    <div class="ol-side"><span class="ol-data">${shortDay(day)}</span></div>
  </article>`;
}

export const listing = (...cards: string[]) =>
  `<html><body><div class="ol-lista">${cards.join('')}</div></body></html>`;

export type DetailOptions = {
  place?: string;
  remote?: string;
  posted?: string;
  body?: string;
  linkedCompany?: boolean;
  jsonLd?: boolean;
};

export function detail(title: string, company: string, options: DetailOptions = {}) {
  const {
    place = 'Otherville (OT)',
    remote = 'Parziale',
    posted = '2026-11-03T10:36:28+01:00',
    body = '<p>Invented backend work.</p>',
    linkedCompany = true,
    jsonLd = true,
  } = options;
  let meta = linkedCompany
    ? `<a class="an-meta-co" href="https://reteinformaticalavoro.it/azienda/1-x">${company}</a>`
    : '';
  if (place) meta += `<span class="an-meta-sep" aria-hidden="true">·</span><span>${place}</span>`;
  if (remote) meta += `<span class="an-meta-sep" aria-hidden="true">·</span><span>Remote working: ${remote}</span>`;
  const facts = remote ? `<div><dt>Remote working</dt><dd>${remote}</dd></div>` : '';
  // As on the site: raw line breaks and tabs inside a JSON-LD string.
  const ld =
    '{"@context": "http://schema.org", "@type": "JobPosting", ' +
    `"datePosted": "${posted}", "description": "line one\n\tline two", ` +
    `"hiringOrganization": {"@type": "Organization", "name": "${company}"}, "title": "${title}"}`;
  return `<html><head><script type="${jsonLd ? 'application/ld+json' : 'text/plain'}">${ld}</script></head><body>
<h1 class="an-h1">${title}</h1>
<div class="an-meta">${meta}</div>
<p class="an-data">Pubblicata il 02/11/2026</p>
<article class="an-card an-desc"><h2 class="an-h2">Descrizione</h2>
<div class="an-testo">${body}</div></article>
<dl class="an-dl">${facts}<div><dt>Seniority</dt><dd>Middle</dd></div></dl>
</body></html>`;
}

import { requestUrl } from './test-http.ts';

export const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

/** A fetch that answers GETs from `handler` (by URL) and records the URLs asked for. */
export function serveHtml(handler: (url: string, index: number) => Response | Promise<Response>) {
  const urls: string[] = [];
  const fetchFake: typeof fetch = async (url) => {
    const target = requestUrl(url);
    urls.push(target);
    return handler(target, urls.length - 1);
  };
  return { fetch: fetchFake, urls };
}

export const LIST_URL = 'https://reteinformaticalavoro.it/offerte-di-lavoro';
export const jobLink = (id: number) => `https://reteinformaticalavoro.it/lavoro/${id}`;
