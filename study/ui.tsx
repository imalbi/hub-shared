import './style.css';
import type { ModuleUI } from '../../apps/web/src/lib/module-ui.ts';
import { BookOpenIcon } from '@phosphor-icons/react';
import { m } from './copy.ts';
import { studyDays } from './records.ts';
import { useStudyDaySummary, useStudyTodayLines } from './today-line.ts';
import { StudyLibrary } from './library.tsx';
import { StudyBacklog } from './backlog.tsx';
import { useStudyCalendarItems } from './calendar.ts';
import { StudyPlan } from './plan.tsx';
import { StudyPlans } from './plans.tsx';
import { StudyReview } from './review.tsx';
import { StudyWidget } from './widget.tsx';
import { StudyZone } from './zone.tsx';
export default {
  name: 'study',
  copy: { title: m.zone_study() },
  todayItems: useStudyTodayLines,
  daySummary: useStudyDaySummary,
  records: studyDays,
  calendarItems: useStudyCalendarItems,
  zone: { id: 'studio', label: m.zone_study, icon: BookOpenIcon, page: StudyZone, ownTabs: true },
  sections: [
    { zone: 'studio', id: 'piano', label: m.study_plan, component: StudyPlan },
    { zone: 'studio', id: 'ripasso', label: m.study_review, component: StudyReview },
    { zone: 'studio', id: 'libreria', label: m.study_library, component: StudyLibrary },
    { zone: 'studio', id: 'piani', label: m.study_subjects, component: StudyPlans },
    { zone: 'studio', id: 'backlog', label: m.study_backlog, component: StudyBacklog },
  ],
  widgets: [{ id: 'study', label: m.zone_study, sizes: ['small', 'medium', 'large'], component: StudyWidget }],
} satisfies ModuleUI;
