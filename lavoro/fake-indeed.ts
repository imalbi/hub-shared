import { requestBody, requestUrl } from './test-http.ts';

// Invented Indeed responses and a fetch that serves them, shared by the source tests and the engine tests. The shape
// follows the friend's source and what the live check confirmed at the top level (status 200, `data.jobSearch.results`).

export type Seen = {
  url: string;
  method: string;
  headers: Record<string, string>;
  query: string;
  signal: AbortSignal | null;
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fetch that answers from `handler` and records what was asked. */
export function serve(handler: (request: Seen, index: number) => Response | Promise<Response>) {
  const requests: Seen[] = [];
  const fetchFake: typeof fetch = async (url, init) => {
    const body: { query: string } = JSON.parse(requestBody(init?.body));
    const request: Seen = {
      url: requestUrl(url),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers)),
      query: body.query,
      signal: init?.signal ?? null,
    };
    requests.push(request);
    return handler(request, requests.length - 1);
  };
  return { fetch: fetchFake, requests };
}

export const pageOf = (jobs: unknown[], nextCursor: string | null = null) => ({
  data: { jobSearch: { pageInfo: { nextCursor }, results: jobs.map((job) => ({ job })) } },
});

export function job(n: number, patch: Record<string, unknown> = {}) {
  return {
    key: `key${n}`,
    title: `Backend developer ${n}`,
    sourceEmployerName: `Source Co ${n}`,
    datePublished: 1_790_000_000_000,
    description: { html: `<p onclick="x()">We use typescript ${n}</p><script>alert(1)</script>` },
    location: { countryCode: 'IT', admin1Code: 'EX', city: 'Exampleville' },
    attributes: [],
    employer: { name: `Company ${n}` },
    recruit: { viewJobUrl: `https://careers.example/apply/${n}` },
    ...patch,
  };
}
