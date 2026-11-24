// LinkedIn links to one posting come in many shapes (country host, title slug, trailing slash, tracking query, a
// search page with `currentJobId`); the collector stores `https://www.linkedin.com/jobs/view/<id>`. Imports go through
// this so a posting imported by hand and the same posting collected later share one URL.
const LINKEDIN_VIEW = /^\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/u;

export function postingUrl(link: string) {
  const trimmed = link.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if (url.hostname !== 'linkedin.com' && !url.hostname.endsWith('.linkedin.com')) return trimmed;
  const id = LINKEDIN_VIEW.exec(url.pathname)?.[1] ?? url.searchParams.get('currentJobId');
  return id && /^\d+$/u.test(id) ? `https://www.linkedin.com/jobs/view/${id}` : trimmed;
}
