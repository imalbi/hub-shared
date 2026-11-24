import type { ModuleUI } from '../../apps/web/src/lib/module-ui.ts';
import { m } from './copy.ts';
import { useSitesAvailable, useSitesPending, SitesPendingPage, SitesSection, SitesWidget } from './sites.tsx';
export default {
  name: 'sites',
  copy: { title: m.sites_title() },
  useAvailable: useSitesAvailable,
  usePending: useSitesPending,
  pendingPage: SitesPendingPage,
  sections: [{ zone: 'work', id: 'siti', label: m.sites_title, component: SitesSection }],
  widgets: [{ id: 'sites', label: m.sites_title, sizes: ['small', 'medium'], component: SitesWidget }],
} satisfies ModuleUI;
