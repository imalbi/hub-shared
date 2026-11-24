import net from 'node:net';
import { PinnedHttpError, pinnedRequest, TRPCError, type PinnedTarget } from '../../apps/server/src/core/module.ts';
import { parseHTML } from '../../apps/server/src/core/module-html.ts';
import { cleanHtml } from './clean-html.ts';
import { isPrivateOrLoopbackIp, isPublicHostname } from './public-host.ts';
import { readDetail } from './rete-informatica.ts';
import type { ModeSource, WorkMode } from './work-mode.ts';

export { isPrivateOrLoopbackIp };

export type ImportedPosting = {
  url: string;
  title: string;
  company: string;
  location: string;
  site: string;
  applyUrl: string | null;
  description: string;
  descriptionHtml: string;
  workMode: WorkMode | null;
  isRemote: boolean;
  postedAt: number | null;
};

const CONTROL_CHARS = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}]+`, 'gu');

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const IMPORT_TIMEOUT_MS = 5000;

export async function assertPublicTarget(
  parsedUrl: URL,
  lookup?: (hostname: string) => Promise<string[]> | string[],
): Promise<PinnedTarget> {
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only http and https protocols are supported' });
  }

  const rawHost = parsedUrl.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  const ipVersion = net.isIP(rawHost);
  if (ipVersion !== 0) {
    if (isPrivateOrLoopbackIp(rawHost)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Private or loopback address refused' });
    }
    return { address: rawHost, family: ipVersion === 6 ? 6 : 4 };
  }

  if (!isPublicHostname(rawHost)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Private or loopback address refused' });
  }

  let addresses: string[];
  if (lookup) {
    addresses = await lookup(rawHost);
  } else {
    const dns = await import('node:dns/promises');
    try {
      const records = await dns.lookup(rawHost, { all: true });
      addresses = records.map((rec) => rec.address);
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'DNS resolution failed' });
    }
  }

  if (!addresses || addresses.length === 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Could not resolve hostname' });
  }

  let firstTarget: PinnedTarget | undefined;
  for (const address of addresses) {
    const cleanAddress = address.replace(/^\[|\]$/gu, '').trim();
    const version = net.isIP(cleanAddress);
    if (version === 0 || isPrivateOrLoopbackIp(cleanAddress)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Resolved to private or loopback address' });
    }
    firstTarget ??= { address: cleanAddress, family: version === 6 ? 6 : 4 };
  }
  if (!firstTarget) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Could not resolve hostname' });
  }
  return firstTarget;
}

function mapNetworkError(err: unknown): TRPCError {
  if (err instanceof TRPCError) return err;
  if (err instanceof PinnedHttpError) {
    if (err.code === 'PAYLOAD_TOO_LARGE') {
      return new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: err.message });
    }
    if (err.code === 'TIMEOUT') {
      return new TRPCError({ code: 'TIMEOUT', message: 'Request timed out' });
    }
    return new TRPCError({ code: 'BAD_REQUEST', message: 'Fetch failed' });
  }
  const msg = String(err);
  if (
    msg.includes('TimeoutError') ||
    msg.includes('timeout') ||
    msg.includes('aborted') ||
    msg.includes('AbortError')
  ) {
    return new TRPCError({ code: 'TIMEOUT', message: 'Request timed out' });
  }
  return new TRPCError({ code: 'BAD_REQUEST', message: 'Fetch failed' });
}

async function readFetchResponseText(response: Response, maxBytes: number): Promise<string> {
  const clHeader = response.headers.get('content-length');
  if (clHeader && Number(clHeader) > maxBytes) {
    throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'Response body exceeds size cap' });
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
        throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'Response body exceeds size cap' });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes).toString('utf-8');
}

export async function fetchPage(
  url: string,
  options: {
    fetch?: typeof fetch;
    lookup?: (hostname: string) => Promise<string[]> | string[];
    timeoutMs?: number;
    maxBytes?: number;
  } = {},
): Promise<{ text: string; finalUrl: string }> {
  let currentUrl: URL;
  try {
    currentUrl = new URL(url);
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid URL' });
  }

  const initialHost = currentUrl.host;
  const timeoutMs = options.timeoutMs ?? IMPORT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_IMPORT_BYTES;
  // Use Node's pinned-lookup HTTP client for live fetches so DNS rebinding cannot occur between check and connect;
  // custom test fetchers still run with their injected mock after target validation.
  const usePinned = !options.fetch || options.fetch === globalThis.fetch;
  const fetcher = options.fetch ?? fetch;

  for (let hop = 0; hop < 2; hop++) {
    const pinnedTarget = await assertPublicTarget(currentUrl, options.lookup);
    if (usePinned) {
      let response;
      try {
        response = await pinnedRequest(currentUrl, pinnedTarget, {
          signal: AbortSignal.timeout(timeoutMs),
          maxBytes,
        });
      } catch (err) {
        throw mapNetworkError(err);
      }
      if (response.status >= 300 && response.status < 400) {
        if (hop > 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Multiple redirects refused' });
        const location = response.headers.get('location');
        if (!location) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Redirect without Location header' });
        let redirectUrl: URL;
        try {
          redirectUrl = new URL(location, currentUrl);
        } catch {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid redirect Location header' });
        }
        if (redirectUrl.host !== initialHost) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cross-host redirect refused' });
        }
        currentUrl = redirectUrl;
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `HTTP ${response.status}` });
      }
      return { text: response.text, finalUrl: currentUrl.href };
    }

    let response: Response;
    try {
      response = await fetcher(currentUrl.href, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual',
      });
    } catch (err) {
      throw mapNetworkError(err);
    }

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      if (hop > 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Multiple redirects refused' });
      const location = response.headers.get('location');
      if (!location) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Redirect without Location header' });
      let redirectUrl: URL;
      try {
        redirectUrl = new URL(location, currentUrl);
      } catch {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid redirect Location header' });
      }
      if (redirectUrl.host !== initialHost) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cross-host redirect refused' });
      }
      currentUrl = redirectUrl;
      continue;
    }

    if (!response.ok) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `HTTP ${response.status}` });
    }
    return { text: await readFetchResponseText(response, maxBytes), finalUrl: currentUrl.href };
  }

  throw new TRPCError({ code: 'BAD_REQUEST', message: 'Multiple redirects refused' });
}

export function parsePostingFromHtml(
  html: string,
  url: string,
  cleaner: Document,
  options: { workModeResolver?: (source: ModeSource) => WorkMode | null } = {},
): ImportedPosting {
  const doc = parseHTML(html).document;
  const parsedUrl = new URL(url);
  const host = parsedUrl.hostname.toLowerCase();

  const canonicalHref = doc.querySelector('link[rel="canonical"]')?.getAttribute('href');
  let finalUrl = url;
  if (canonicalHref) {
    try {
      const resolved = new URL(canonicalHref, url);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') finalUrl = resolved.href;
    } catch {
      finalUrl = url;
    }
  }

  let title = '';
  let company = '';
  let location = '';
  let site = '';
  let applyUrl: string | null = null;
  let description = '';
  let descriptionHtml = '';
  let workMode: WorkMode | null = null;
  let isRemote = false;
  let postedAt: number | null = null;

  // 1. Check known sources
  if (host.includes('reteinformaticalavoro.')) {
    site = 'rete-informatica';
    const detail = readDetail(doc, cleaner);
    if (detail.title) title = detail.title;
    if (detail.company) company = detail.company;
    if (detail.location) location = detail.location;
    if (detail.description) description = detail.description;
    if (detail.descriptionHtml) descriptionHtml = detail.descriptionHtml;
    if (detail.declaredMode) workMode = detail.declaredMode;
    if (detail.postedAt) postedAt = detail.postedAt.getTime();
  } else if (host.includes('linkedin.')) {
    site = 'linkedin';
    title = doc.querySelector('h1.top-card-layout__title, h1.topcard__title, h1')?.textContent?.trim() ?? '';
    company =
      doc
        .querySelector(
          'a.topcard__org-name-link, .topcard__flavor--black-link, span.topcard__flavor, .topcard__flavor, h4',
        )
        ?.textContent?.trim() ?? '';
    location =
      doc
        .querySelector('span.topcard__flavor--bullet, .top-card-layout__first-subline .topcard__flavor--bullet')
        ?.textContent?.trim() ?? '';
    const descEl = doc.querySelector('div.show-more-less-html__markup');
    if (descEl) {
      const cleaned = cleanHtml(cleaner, descEl.innerHTML);
      description = cleaned.text;
      descriptionHtml = cleaned.html;
    }
    const timeEl = doc.querySelector('time[datetime]');
    if (timeEl) {
      const dt = timeEl.getAttribute('datetime');
      if (dt) {
        const t = new Date(dt).getTime();
        if (!isNaN(t)) postedAt = t;
      }
    }
  } else if (host.includes('indeed.')) {
    site = 'indeed';
    title =
      doc.querySelector('h1.jobsearch-JobInfoHeader-title, h1.jobsearch-JobComponent-title, h1')?.textContent?.trim() ??
      '';
    company =
      doc
        .querySelector(
          '[data-company-name="true"], .jobsearch-CompanyInfoContainer a, .jobsearch-InlineCompanyRating-companyHeader, .companyName',
        )
        ?.textContent?.trim() ?? '';
    location =
      doc
        .querySelector('[data-testid="job-location"], .jobsearch-JobInfoHeader-companyLocation, .companyLocation')
        ?.textContent?.trim() ?? '';
    const descEl = doc.querySelector('#jobDescriptionText, .jobsearch-jobDescriptionText');
    if (descEl) {
      const cleaned = cleanHtml(cleaner, descEl.innerHTML);
      description = cleaned.text;
      descriptionHtml = cleaned.html;
    }
  }

  // 2. Structured data (JSON-LD JobPosting)
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const raw = script.textContent ?? '';
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      try {
        data = JSON.parse(raw.replaceAll(CONTROL_CHARS, ' '));
      } catch {
        continue;
      }
    }

    const dataRecord = asRecord(data);
    const candidates: unknown[] = Array.isArray(data)
      ? data
      : dataRecord && Array.isArray(dataRecord['@graph'])
        ? dataRecord['@graph']
        : [data];

    for (const item of candidates) {
      const posting = asRecord(item);
      if (!posting) continue;
      const typeMatch =
        posting.type === 'JobPosting' ||
        posting['@type'] === 'JobPosting' ||
        (Array.isArray(posting['@type']) && posting['@type'].includes('JobPosting'));
      if (!typeMatch) continue;
      if (!title) title = textValue(posting.title);
      if (!company) {
        const hiring = posting.hiringOrganization;
        const hiringRecord = asRecord(hiring);
        if (typeof hiring === 'string') company = hiring.trim();
        else if (hiringRecord && 'name' in hiringRecord) company = textValue(hiringRecord.name);
      }
      if (!location) {
        const loc = posting.jobLocation;
        const locRecord = asRecord(loc);
        if (typeof loc === 'string') location = loc.trim();
        else if (locRecord) {
          const addr = locRecord.address;
          const addrRecord = asRecord(addr);
          if (typeof addr === 'string') location = addr.trim();
          else if (addrRecord) {
            const parts = [addrRecord.addressLocality, addrRecord.addressRegion, addrRecord.addressCountry]
              .map(textValue)
              .filter(Boolean);
            location = parts.join(', ').trim();
          } else if ('name' in locRecord) {
            location = textValue(locRecord.name);
          }
        }
      }
      if (!description) {
        const rawDescription = textValue(posting.description);
        if (rawDescription) {
          const cleaned = cleanHtml(cleaner, rawDescription);
          description = cleaned.text;
          descriptionHtml = cleaned.html;
        }
      }
      if (!postedAt) {
        const rawDate = textValue(posting.datePosted);
        if (rawDate) {
          const d = new Date(rawDate).getTime();
          if (!isNaN(d)) postedAt = d;
        }
      }
      if (textValue(posting.jobLocationType).toLowerCase() === 'telecommute') {
        workMode = 'remote';
        isRemote = true;
      }
      if (!applyUrl && posting.directApply && typeof posting.directApply === 'string') {
        try {
          const resolved = new URL(posting.directApply);
          if (resolved.protocol === 'http:' || resolved.protocol === 'https:') applyUrl = resolved.href;
        } catch {
          /* Non-URL directApply values are ignored. */
        }
      }
    }
  }

  // 3. Fallback: og: meta tags
  if (!title) {
    const ogTitle = doc.querySelector('meta[property="og:title"], meta[name="og:title"]')?.getAttribute('content');
    if (ogTitle) title = ogTitle.trim();
  }
  if (!description) {
    const ogDesc = doc
      .querySelector('meta[property="og:description"], meta[name="og:description"]')
      ?.getAttribute('content');
    if (ogDesc) {
      const cleaned = cleanHtml(cleaner, ogDesc);
      description = cleaned.text;
      descriptionHtml = cleaned.html;
    }
  }
  if (!site) {
    const ogSite = doc
      .querySelector('meta[property="og:site_name"], meta[name="og:site_name"]')
      ?.getAttribute('content');
    if (ogSite) site = ogSite.trim();
  }

  // 4. Fallback defaults
  if (!site) {
    site = host.replace(/^www\./u, '');
  }
  if (!title) {
    title = doc.querySelector('title')?.textContent?.trim() ?? '';
  }

  // 5. Fallback work mode
  if (workMode === null) {
    if (options.workModeResolver) {
      workMode = options.workModeResolver({ title, location, description });
      isRemote = workMode === 'remote';
    } else {
      isRemote = false;
    }
  } else {
    isRemote = workMode === 'remote';
  }

  return {
    url: finalUrl,
    title,
    company,
    location,
    site,
    applyUrl,
    description,
    descriptionHtml,
    workMode,
    isRemote,
    postedAt,
  };
}

export async function fetchAndParsePosting(
  url: string,
  cleaner: Document,
  options: {
    fetch?: typeof fetch;
    lookup?: (hostname: string) => Promise<string[]> | string[];
    timeoutMs?: number;
    maxBytes?: number;
    workModeResolver?: (source: ModeSource) => WorkMode | null;
  } = {},
): Promise<ImportedPosting> {
  const { text, finalUrl } = await fetchPage(url, options);
  return parsePostingFromHtml(text, finalUrl, cleaner, options);
}
