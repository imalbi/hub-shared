/** Extracts a string URL from `fetch` request inputs without triggering `no-base-to-string`. */
export function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

/** Extracts a string request body from `RequestInit['body']` without triggering `no-base-to-string`. */
export function requestBody(body: BodyInit | null | undefined): string {
  return typeof body === 'string' ? body : '';
}
