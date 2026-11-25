import { PageGrid } from '../../apps/web/src/components/page-grid.tsx';
import { ZonePage } from '../../apps/web/src/shell/zone-page.tsx';
import { DayLine } from '../../apps/web/src/shell/day-line.tsx';
import { StudyToday } from './today.tsx';
import { m } from './copy.ts';
function StudioTab() {
  return (
    <PageGrid>
      <StudyToday />
    </PageGrid>
  );
}
const own = [{ id: 'study', label: m.study_today_tab, component: StudioTab, dayLine: DayLine }];
export function StudyZone() {
  return <ZonePage zone="studio" own={own} />;
}
