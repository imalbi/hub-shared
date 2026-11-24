import net from 'node:net';
import { isPrivateOrLoopbackIp, isPublicHostname } from './public-host.ts';

export const MAX_SCRAPER_BYTES = 4 * 1024 * 1024;
export const MAX_SCRAPER_REDIRECTS = 5;

function registrableSuffix(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/\.$/u, '').split('.').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('.') : '';
}

export function sameSiteHost(initialHostname: string, targetHostname: string): boolean {
  const initial = initialHostname.toLowerCase().replace(/\.$/u, '');
  const target = targetHostname.toLowerCase().replace(/\.$/u, '');
  if (!isPublicHostname(initial) || !isPublicHostname(target)) return false;
  if (initial === target) return true;
  const suffix = registrableSuffix(initial);
  return suffix.length > 0 && suffix === registrableSuffix(target);
}

function assertAllowedRedirectTarget(initialUrl: URL, nextUrl: URL) {
  if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
    throw new Error('redirect protocol refused');
  }
  const rawHost = nextUrl.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (net.isIP(rawHost) !== 0) {
    if (isPrivateOrLoopbackIp(rawHost)) throw new Error('redirect to private address refused');
    throw new Error('redirect off-site refused');
  }
  if (!isPublicHostname(rawHost) || !sameSiteHost(initialUrl.hostname, rawHost)) {
    throw new Error('redirect off-site refused');
  }
}

export async function fetchBounded(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit = {},
  maxRedirects = MAX_SCRAPER_REDIRECTS,
): Promise<Response> {
  const initialUrl = new URL(url);
  let currentUrl = initialUrl;
  const method = (init.method ?? 'GET').toUpperCase();

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetcher(currentUrl.href, {
      ...init,
      redirect: 'manual',
    });
    if (response.status < 300 || response.status >= 400) {
      return response;
    }
    await response.body?.cancel();
    if (method !== 'GET' && method !== 'HEAD') {
      throw new Error('redirect on non-GET request refused');
    }
    const location = response.headers.get('location');
    if (!location) {
      throw new Error('redirect missing location');
    }
    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      throw new Error('invalid redirect location');
    }
    assertAllowedRedirectTarget(initialUrl, nextUrl);
    currentUrl = nextUrl;
  }

  throw new Error('too many redirects');
}

export async function readBoundedText(response: Response, maxBytes = MAX_SCRAPER_BYTES): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    await response.body?.cancel();
    throw new Error('response body exceeds size cap');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error('response body exceeds size cap');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes).toString('utf8');
}

export async function readBoundedJson(response: Response, maxBytes = MAX_SCRAPER_BYTES): Promise<unknown> {
  return JSON.parse(await readBoundedText(response, maxBytes));
}
