import type { ModuleUI } from '../../apps/web/src/lib/module-ui.ts';
import { m } from './copy.ts';
import { Weather } from './today-header.tsx';
import { LocationSearch } from './location-search.tsx';
export default {
  name: 'weather',
  copy: { title: m.weather_title() },
  todayHeader: Weather,
  settingsHeader: LocationSearch,
} satisfies ModuleUI;
