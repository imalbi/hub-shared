export type HistoryEntry = {
  id: string;
  title: string;
  artist: string;
  cover: string | null;
  playedAt: number;
};

export type FavoriteEntry = {
  id: string;
  title: string;
  artist: string;
  addedAt: number;
};

export type SuggestionSeed = {
  id: string;
  title: string;
  artist: string;
  cover: string | null;
};

export type RadioSuggestion = {
  artist: string;
  seed: SuggestionSeed;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const AGAIN_MIN_AGE_MS = 14 * DAY_MS;
const AGAIN_LIMIT = 6;
const RADIO_WINDOW_MS = 30 * DAY_MS;
const RADIO_LIMIT = 3;

export function normalizeArtistName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en');
}

export function matchArtist<T extends { name: string }>(candidates: readonly T[], target: string): T | undefined {
  const key = normalizeArtistName(target);
  if (!key) return undefined;
  return candidates.find((candidate) => normalizeArtistName(candidate.name) === key);
}

/**
 * Derive Riascolta favourites and top-artist Radio seeds from local playback history.
 * Returns empty results when history is empty so fresh installs show no suggestions section.
 */
export function computeSuggestions(
  favorites: readonly FavoriteEntry[],
  history: readonly HistoryEntry[],
  now: number,
): { again: SuggestionSeed[]; radios: RadioSuggestion[]; topArtist: string | null } {
  if (history.length === 0) return { again: [], radios: [], topArtist: null };

  const songStats = new Map<string, { lastPlayedAt: number; coverPlayedAt: number; latestCover: string | null }>();
  for (const row of history) {
    const existing = songStats.get(row.id);
    if (!existing) {
      songStats.set(row.id, {
        lastPlayedAt: row.playedAt,
        coverPlayedAt: row.cover !== null ? row.playedAt : -Infinity,
        latestCover: row.cover,
      });
    } else {
      if (row.playedAt > existing.lastPlayedAt) existing.lastPlayedAt = row.playedAt;
      if (row.cover !== null && row.playedAt >= existing.coverPlayedAt) {
        existing.coverPlayedAt = row.playedAt;
        existing.latestCover = row.cover;
      }
    }
  }

  const againCutoff = now - AGAIN_MIN_AGE_MS;
  const again = favorites
    .filter((fav) => {
      const lastPlayedAt = songStats.get(fav.id)?.lastPlayedAt;
      return lastPlayedAt === undefined || lastPlayedAt <= againCutoff;
    })
    .toSorted((a, b) => {
      const aPlayed = songStats.get(a.id)?.lastPlayedAt;
      const bPlayed = songStats.get(b.id)?.lastPlayedAt;
      if (aPlayed === undefined && bPlayed !== undefined) return -1;
      if (aPlayed !== undefined && bPlayed === undefined) return 1;
      if (aPlayed !== undefined && bPlayed !== undefined && aPlayed !== bPlayed) return aPlayed - bPlayed;
      if (a.addedAt !== b.addedAt) return a.addedAt - b.addedAt;
      return a.id.localeCompare(b.id);
    })
    .slice(0, AGAIN_LIMIT)
    .map((fav) => ({
      id: fav.id,
      title: fav.title,
      artist: fav.artist,
      cover: songStats.get(fav.id)?.latestCover ?? null,
    }));

  const radioCutoff = now - RADIO_WINDOW_MS;
  const artistStats = new Map<string, { count: number; lastPlayedAt: number }>();
  for (const row of history) {
    if (row.playedAt < radioCutoff) continue;
    const artist = row.artist.trim();
    if (!artist) continue;
    const existing = artistStats.get(artist);
    if (!existing) artistStats.set(artist, { count: 1, lastPlayedAt: row.playedAt });
    else {
      existing.count++;
      if (row.playedAt > existing.lastPlayedAt) existing.lastPlayedAt = row.playedAt;
    }
  }

  const topArtists = [...artistStats.entries()]
    .map(([artist, stats]) => ({ artist, ...stats }))
    .toSorted((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.lastPlayedAt !== a.lastPlayedAt) return b.lastPlayedAt - a.lastPlayedAt;
      return a.artist.localeCompare(b.artist);
    })
    .slice(0, RADIO_LIMIT);

  const radios: RadioSuggestion[] = [];
  for (const { artist } of topArtists) {
    const artistSongs = new Map<
      string,
      {
        id: string;
        count: number;
        lastPlayedAt: number;
        title: string;
        artist: string;
        coverPlayedAt: number;
        latestCover: string | null;
      }
    >();
    for (const row of history) {
      if (row.artist.trim() !== artist) continue;
      const existing = artistSongs.get(row.id);
      if (!existing) {
        artistSongs.set(row.id, {
          id: row.id,
          count: 1,
          lastPlayedAt: row.playedAt,
          title: row.title,
          artist: row.artist,
          coverPlayedAt: row.cover !== null ? row.playedAt : -Infinity,
          latestCover: row.cover,
        });
      } else {
        existing.count++;
        if (row.playedAt >= existing.lastPlayedAt) {
          existing.lastPlayedAt = row.playedAt;
          existing.title = row.title;
          existing.artist = row.artist;
        }
        if (row.cover !== null && row.playedAt >= existing.coverPlayedAt) {
          existing.coverPlayedAt = row.playedAt;
          existing.latestCover = row.cover;
        }
      }
    }
    const [seed] = [...artistSongs.values()].toSorted((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.lastPlayedAt !== a.lastPlayedAt) return b.lastPlayedAt - a.lastPlayedAt;
      return a.id.localeCompare(b.id);
    });
    if (seed) {
      radios.push({
        artist,
        seed: {
          id: seed.id,
          title: seed.title,
          artist: seed.artist,
          cover: seed.latestCover,
        },
      });
    }
  }

  return { again, radios, topArtist: radios[0]?.artist ?? null };
}
