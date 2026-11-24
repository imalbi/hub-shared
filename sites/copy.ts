export const m = {
  sites_title: () => 'Siti',
  sites_operational: () => 'Raggiungibile',
  sites_major: () => 'Non raggiungibile',
  sites_degraded: () => 'Interruzioni',
  sites_none: () => 'Nessun dato',
  sites_all: () => 'Tutti i siti sono raggiungibili',
  sites_some_down: () => 'Alcuni siti non sono raggiungibili',
  sites_some_degraded: () => 'Alcuni siti hanno interruzioni',
  sites_unknown: () => 'Stato dei siti non disponibile',
  sites_day: ({
    date,
    status,
    minutes,
  }: {
    date: string | number;
    status: string | number;
    minutes: string | number;
  }) => `${date}: ${status}, ${minutes} minuti di interruzione`,
  sites_help: () => 'Usa le frecce per leggere i giorni.',
  sites_latency: ({ ms }: { ms: string | number }) => `${ms} ms`,
  sites_uptime: () => 'disponibilità',
  sites_ago: ({ days }: { days: string | number }) => `${days} giorni fa`,
  sites_today: () => 'Oggi',
  sites_empty: () => 'Nessun sito configurato.',
  sites_no_down: () => 'Nessun sito non raggiungibile',
  sites_error: () => 'Impossibile leggere lo stato dei siti.',
  tile_loading: () => 'Caricamento',
};
