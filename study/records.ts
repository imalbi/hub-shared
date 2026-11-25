import type { RecordSource } from '../../apps/web/src/lib/module-ui.ts';
import { m } from './copy.ts';
import { studyClient, studySubjects } from './use-study.ts';

/**
 * Studio days in the palette (step 64), found by title on the server from the index (no day body). Open days have no
 * date of their own (the calendar only slides them), so the detail ends with the state, not a day.
 */
export const studyDays: RecordSource = {
  id: 'study-days',
  label: m.zone_study,
  get: async (id, signal) => {
    const [days, headers] = await Promise.all([
      studyClient.daysById.query({ keys: [id] }, { signal }),
      studyClient.active.query(undefined, { signal }),
    ]);
    const day = days[0];
    if (!day) return null;
    return {
      id: day.key,
      title: day.g === null ? day.title : m.study_today_line({ g: day.g, title: day.title }),
      detail: [
        studySubjects(headers).find((subject) => subject.key === day.subject)?.label,
        day.done ? m.study_done() : m.study_record_open(),
      ]
        .filter(Boolean)
        .join(' · '),
      href: '/desk/studio?tab=piano',
    };
  },
  search: async (query, signal) => {
    const found = await studyClient.searchRecords.query({ query }, { signal });
    const subjects = studySubjects(found.headers);
    return {
      total: found.total,
      rows: found.rows.map((day) => ({
        id: day.key,
        title: day.g === null ? day.title : m.study_today_line({ g: day.g, title: day.title }),
        detail: [
          subjects.find((subject) => subject.key === day.subject)?.label,
          day.done ? m.study_done() : m.study_record_open(),
        ]
          .filter(Boolean)
          .join(' · '),
        href: '/desk/studio?tab=piano',
      })),
    };
  },
};
