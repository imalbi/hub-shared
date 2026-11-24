import { z } from '../../apps/server/src/core/module.ts';

export const locationSchema = z.object({
  name: z.string().min(1).meta({ title: 'Nome', description: 'Nome del luogo mostrato accanto al meteo.' }),
  latitude: z
    .number()
    .min(-90)
    .max(90)
    .meta({ title: 'Latitudine', description: 'Posizione nord-sud del luogo, da -90 a 90.', unit: 'gradi' }),
  longitude: z
    .number()
    .min(-180)
    .max(180)
    .meta({ title: 'Longitudine', description: 'Posizione est-ovest del luogo, da -180 a 180.', unit: 'gradi' }),
});
const forecastSchema = z.object({
  current: z.object({ temperature_2m: z.number(), weather_code: z.number().int() }),
  daily: z.object({
    temperature_2m_min: z.tuple([z.number()]).rest(z.number()),
    temperature_2m_max: z.tuple([z.number()]).rest(z.number()),
  }),
});
const placesSchema = z.object({
  results: z
    .array(
      locationSchema.extend({
        country: z.string().optional(),
        admin1: z.string().optional(),
        admin2: z.string().optional(),
      }),
    )
    .optional(),
});

async function getJson(fetcher: typeof fetch, url: URL) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('Open-Meteo request failed');
  return response.json();
}

export async function searchLocations(fetcher: typeof fetch, name: string) {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name, language: 'it', count: '10' }).toString();
  return placesSchema.parse(await getJson(fetcher, url)).results ?? [];
}

export function createWeather(fetcher: typeof fetch, location: z.infer<typeof locationSchema> | undefined) {
  let state: { name: string; temperature: number; code: number; min: number; max: number; stale: boolean } | null =
    null;
  let closed = false;
  let retryMs = 60_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function refresh() {
    if (!location) return;
    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.search = new URLSearchParams({
        latitude: String(location.latitude),
        longitude: String(location.longitude),
        current: 'temperature_2m,weather_code',
        daily: 'temperature_2m_min,temperature_2m_max',
        timezone: 'auto',
        forecast_days: '1',
      }).toString();
      const data = forecastSchema.parse(await getJson(fetcher, url));
      state = {
        name: location.name,
        temperature: data.current.temperature_2m,
        code: data.current.weather_code,
        min: data.daily.temperature_2m_min[0],
        max: data.daily.temperature_2m_max[0],
        stale: false,
      };
      retryMs = 60_000;
    } catch {
      if (state) state = { ...state, stale: true };
    }
    clearTimeout(timer);
    const delay = state ? 30 * 60_000 : retryMs;
    if (!state) retryMs = Math.min(retryMs * 2, 30 * 60_000);
    if (!closed) timer = setTimeout(() => void refresh(), delay);
  }
  const initial = refresh();
  return {
    read: async () => {
      await initial;
      return state;
    },
    refresh,
    close: () => {
      closed = true;
      clearTimeout(timer);
    },
  };
}
