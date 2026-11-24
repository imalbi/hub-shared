import { requestUrl } from './test-http.ts';

// Invented inPA answers shaped like the portal's search (field names from the 16n2 live check, every value made up),
// shared by the source test and the collection test. No real competition text.

export type FakeItem = {
  id: string;
  titolo: string;
  figuraRicercata?: string;
  descrizione?: string;
  sedi?: string[];
  entiRiferimento?: string[];
  dataPubblicazione?: string;
  categorie?: string[];
};

export function item(n: number, patch: Partial<FakeItem> = {}): FakeItem {
  return {
    id: `id${String(n).padStart(4, '0')}`,
    titolo: `Concorso pubblico per la copertura di un posto di operatore ${n}`,
    figuraRicercata: `Operatore ${n}`,
    descrizione: `<p>Bando ${n}. Titolo di studio: diploma di scuola superiore.</p>`,
    sedi: ['Examplia', 'Exampleville'],
    entiRiferimento: [`Comune di Esempio ${n}`],
    dataPubblicazione: '2026-11-05T09:30:00Z',
    categorie: ['Concorso'],
    ...patch,
  };
}

/** One page of the answer, with the paging fields the portal sends. */
export const page = (items: FakeItem[], last: boolean) =>
  JSON.stringify({ content: items, last, totalElements: items.length, totalPages: last ? 1 : 2, number: 0 });

export type Seen = { url: string; body: unknown; method: string | undefined };

/** A fetch that answers with the given responses in order and records every request. */
export function serveInpa(responses: Array<() => Response>) {
  const requests: Seen[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    requests.push({
      url: requestUrl(input),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      method: init?.method,
    });
    const next = responses[requests.length - 1];
    if (!next) throw new Error('fake inPA: no response left');
    return next();
  };
  return { fetch: fetchFn, requests };
}

export const ok = (body: string) => () =>
  new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
