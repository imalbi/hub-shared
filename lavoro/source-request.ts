import { fetchBounded, readBoundedText } from './bounded-fetch.ts';
import { desktopHeaders } from './desktop-headers.ts';
import { retryAfter } from './inpa.ts';
import { isPublicHostname } from './public-host.ts';
import type { SourceContext } from './source.ts';

export function publicSourceUrl(value: string, base?: string): string {
  const url = new URL(value, base);
  if (url.protocol !== 'https:' || !isPublicHostname(url.hostname) || url.username || url.password || url.port)
    throw new Error('invalid public URL');
  url.hash = '';
  return url.href;
}

/** One clock per collection, shared by listing, detail and retry requests. */
export function sourceRequest(site: string, context: SourceContext, requestTimeoutMs = 20_000) {
  let last = Number.NEGATIVE_INFINITY;
  return async (url: string, init: RequestInit = {}): Promise<string> => {
    try {
      publicSourceUrl(url);
      const headers = new Headers(desktopHeaders);
      new Headers(init.headers).forEach((value, name) => headers.set(name, value));
      for (let attempt = 0; ; attempt++) {
        const delay = last + 1000 - context.now();
        if (delay > 0) await context.sleep(delay);
        context.signal.throwIfAborted();
        const response = await fetchBounded(context.fetch, url, {
          ...init,
          headers,
          signal: AbortSignal.any([context.signal, AbortSignal.timeout(requestTimeoutMs)]),
        }).finally(() => {
          last = context.now();
        });
        if (response.status === 429) {
          await response.body?.cancel();
          const wait = retryAfter(response.headers.get('retry-after'), context.now());
          if (attempt >= 2 || wait > 120_000) throw new Error('HTTP 429');
          context.reportWait?.(site, Math.ceil(wait / 1000));
          try {
            await context.sleep(wait);
          } finally {
            context.reportWait?.(site, null);
          }
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`HTTP ${response.status}`);
        }
        return await readBoundedText(response);
      }
    } catch (error) {
      if (context.signal.aborted) throw error;
      const status = error instanceof Error && /^HTTP \d{3}$/u.test(error.message) ? error.message : 'request failed';
      // Raw fetch errors may contain private URLs; only the safe category reaches job logs.
      // oxlint-disable-next-line preserve-caught-error
      throw new Error(`${site}: ${status}`);
    }
  };
}
