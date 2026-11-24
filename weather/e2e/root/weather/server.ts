import { defineModule, z } from '../../../../../apps/server/src/core/module.ts';
import base from '../../../server.ts';
export default defineModule({
  name: base.name,
  config: z.unknown(),
  settingsSchema: base.config,
  create(deps) {
    return base.create({
      ...deps,
      config: deps.config ?? { name: 'Località esempio', latitude: 1, longitude: 2 },
      fetch: async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith('https://geocoding-api.open-meteo.com/'))
          return Response.json({
            results: [{ name: 'Località esempio', latitude: 1, longitude: 2, admin1: 'Regione esempio' }],
          });
        return Response.json({
          current: { temperature_2m: 19, weather_code: 3 },
          daily: { temperature_2m_min: [12], temperature_2m_max: [23] },
        });
      },
    });
  },
});
