// Invented IRENfutura pages and a fetch that serves them, shared by the source and engine tests. The markup follows the
// structure seen in the 16n3a live check (class names, the stray closing tag, an id with a space in the link); every
// title, id, place and text is made up.

export const BOARD_URL = 'https://irenfutura.gruppoiren.it/irenlavoraconnoi/Default.aspx?tabid=188';
export const detailUrl = (id: string) =>
  `https://irenfutura.gruppoiren.it/irenlavoraconnoi/Default.aspx?tabid=201&jobid=${encodeURIComponent(id)}`;

export type ElementOptions = {
  region?: string;
  id?: string;
  title?: string;
  town?: string | null;
  abstract?: string;
  agency?: string;
};

/** One posting of the board: `n` makes the id (`AV 1001`, with a space like the real ones) and the title. */
export function element(n: number, options: ElementOptions = {}) {
  const { region = '02', id = `AV ${1000 + n}`, abstract = `Invented duties ${n}.`, agency } = options;
  const town = options.town === undefined ? 'Exampleville' : options.town;
  const title = options.title ?? `Addetto/a esempio ${n}`;
  const shown = town === null ? title : `${title} (${town})`;
  const agencyLine = agency
    ? `\n</br><small>La selezione in una prima fase è seguita - su incarico di Iren - da <b>${agency}</b></small>`
    : '';
  return `<div class="col-md-12 col-sm-12 col-xs-12 element ${region}" data-category="${region}">

<div class="item_description">
<a href="/irenlavoraconnoi/Default.aspx?tabid=201&jobid=${id}"><span><h4>${shown}</h4></b></span></a><i><small>${abstract}</small></i>${agencyLine}
</div>
</div>`;
}

export const board = (...elements: string[]) =>
  `<html><body><div class="row isotope">${elements.join('\n')}</div></body></html>`;

export type DetailOptions = {
  agency?: string;
  deadline?: string;
  abstract?: string;
  body?: string;
  level?: string;
  degree?: string;
};

/** The detail page: label and value rows in `xmp-form-row`, the long text in one `h3` with raw line breaks. */
export function detail(title: string, options: DetailOptions = {}) {
  const {
    agency,
    deadline = '10/12/2026',
    abstract = 'Invented abstract.',
    body = 'Invented description.\nRequisiti richiesti:\n•\tEsperienza: invented years',
    level = 'Diploma di istruzione secondaria superiore',
    degree = 'Diploma tecnico',
  } = options;
  const agencyRow = agency
    ? `<div class="xmp-form-row"><i>La selezione in una prima fase è seguita - su incarico di Iren - da:</i>&nbsp;<h3><span class="hue_block white normal">&nbsp;${agency}&nbsp;</span></h3></div>`
    : '';
  return `<html><body><div class="xmp-form xmp-zz_jobposting_detail">
  <div class="xmp-form-row"><i>Titolo:</i>&nbsp;</Label><h1><span class="bold">&nbsp;${title}&nbsp;</span></h1></div>
    ${agencyRow}
    <div class="xmp-form-row"><i>Data Scadenza:</i><h3><span class="hue_block white normal">&nbsp;${deadline}&nbsp;</span></h3></div>
	<hr>
    <div class="xmp-form-row"><i>Abstract:</i>&nbsp;<h3><i>${abstract}</i></h3></div>
    <div class="xmp-form-row"><i>Descrizione</i><h3>${body}
</h3></div>
	<hr>
    <div class="xmp-form-row"><i>Sede di lavoro (provincia di):</i><h3><span class="hue_block white normal">&nbsp;EXAMPLEVILLE&nbsp;</span></h3></div>
<hr>
    <div class="xmp-form-row"><i>Livello di studio:</i>&nbsp;<h3><span class="hue_block white normal">&nbsp;${level}&nbsp;</span></h3></div>
    <div class="xmp-form-row"><i>Titolo di studio richiesto:</i>&nbsp;</Label><h3><span class="hue_block white normal">&nbsp;${degree}&nbsp;</span></h3></div>
</div></body></html>`;
}

import { requestUrl } from './test-http.ts';

export const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

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
