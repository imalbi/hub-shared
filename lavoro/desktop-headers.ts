// The headers of a desktop browser, for the sources that read public HTML pages (Rete Informatica Lavoro, LinkedIn in
// 16f). Not personal and not a secret: the friend's scraper sends the same kind of values. This user agent is the one
// the 16e live check used.
export const desktopHeaders = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'it-IT,it;q=0.9,en;q=0.8',
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
} as const;
