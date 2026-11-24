import type { ModuleUI } from '../../apps/web/src/lib/module-ui.ts';
import { copy } from './copy.ts';
import { MailTile } from './deck-tile.tsx';
import { PostaSection } from './posta-section.tsx';
import { mailMessages } from './records.ts';
import { useMailTodayLines } from './today-line.ts';
import { useMailAvailable } from './use-mail.ts';
import { MailWidget } from './widget.tsx';

export const mailUI = {
  name: 'mail',
  copy: { title: copy.title },
  useAvailable: useMailAvailable,
  todayItems: useMailTodayLines,
  records: mailMessages,
  sections: [{ zone: 'messages', id: 'mail', label: () => copy.title, component: PostaSection, fill: true }],
  widgets: [{ id: 'mail', label: () => copy.title, sizes: ['small', 'medium'], component: MailWidget }],
  deck: { id: 'mail', label: () => copy.title, page: 'desk', at: 8, tiles: [MailTile] },
} satisfies ModuleUI;

export default mailUI;
