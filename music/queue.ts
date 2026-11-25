import type { Song } from './youtube.ts';

/** `seed`: the one song a radio started from (null for a playlist or when nothing plays). */
type Queue = { current: Song | null; seed: Song | null; upcoming: Song[]; played: string[]; errors: number };
type Action =
  | { type: 'play'; song: Song }
  | { type: 'load'; songs: Song[] }
  | { type: 'refill'; songs: Song[] }
  | { type: 'advance'; error: boolean }
  | { type: 'stop' };

export const emptyQueue: Queue = { current: null, seed: null, upcoming: [], played: [], errors: 0 };

export function queueReducer(state: Queue, action: Action): Queue {
  if (action.type === 'stop')
    return { ...emptyQueue, played: state.current ? [...state.played, state.current.id] : state.played };
  if (action.type === 'load')
    return {
      current: action.songs[0] ?? null,
      seed: action.songs.length === 1 ? (action.songs[0] ?? null) : null,
      upcoming: action.songs.slice(1),
      played: state.current ? [...state.played, state.current.id] : state.played,
      errors: 0,
    };
  if (action.type === 'play')
    return {
      current: action.song,
      seed: action.song,
      upcoming: [],
      played: state.current ? [...state.played, state.current.id] : state.played,
      errors: 0,
    };
  if (action.type === 'refill') {
    const seen = new Set([...state.played, state.current?.id, ...state.upcoming.map((song) => song.id)]);
    const upcoming = [...state.upcoming];
    for (const song of action.songs) {
      if (!seen.has(song.id)) {
        seen.add(song.id);
        upcoming.push(song);
      }
    }
    return { ...state, upcoming };
  }
  const errors = action.error ? state.errors + 1 : 0;
  const current = errors >= 3 ? null : (state.upcoming[0] ?? null);
  return {
    current,
    seed: current ? state.seed : null,
    upcoming: errors >= 3 ? [] : state.upcoming.slice(1),
    played: state.current ? [...state.played, state.current.id] : state.played,
    errors,
  };
}
