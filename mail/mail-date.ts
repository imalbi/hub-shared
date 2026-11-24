const format = new Intl.DateTimeFormat('it', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** The day is always shown: comparing with today would read the clock during render. Unparsable dates show nothing. */
export function mailDate(date: string | null) {
  const parsed = date ? new Date(date) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? format.format(parsed) : '';
}
