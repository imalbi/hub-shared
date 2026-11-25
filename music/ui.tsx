import type { ModuleUI } from '../../apps/web/src/lib/module-ui.ts';
import { MusicPage } from './page.tsx';
import { UpcomingTracks } from './upcoming.tsx';
export default {
  name: 'music',
  mediaUpcoming: UpcomingTracks,
  copy: { title: 'Musica' },
  sections: [{ zone: 'media', id: 'media', label: () => 'Media', component: MusicPage, fill: true, float: true }],
} satisfies ModuleUI;
