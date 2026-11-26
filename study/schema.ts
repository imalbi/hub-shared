import { integer, primaryKey, sqliteTable, text } from '../../apps/server/src/core/module-db.ts';

export const resources = sqliteTable('resources', {
  position: integer('position').primaryKey({ autoIncrement: true }),
  id: text('id').notNull().unique(),
  planId: text('plan_id').notNull(),
  subjectId: text('subject_id').notNull(),
  title: text('title').notNull(),
  kind: text('kind', { enum: ['note', 'pdf', 'link'] }).notNull(),
  body: text('body').notNull().default(''),
  url: text('url').notNull().default(''),
  path: text('path').notNull().default(''),
  folder: integer('folder'),
  page: integer('page'),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  revision: integer('revision').notNull().default(1),
});

export const learningBacklog = sqliteTable('learning_backlog', {
  position: integer('position').primaryKey({ autoIncrement: true }),
  id: text('id').notNull().unique(),
  title: text('title').notNull(),
  note: text('note').notNull().default(''),
  url: text('url').notNull().default(''),
  status: text('status', { enum: ['todo', 'active', 'completed'] })
    .notNull()
    .default('todo'),
});

export const plans = sqliteTable('plans', {
  id: text('id').primaryKey(),
  version: integer('version').notNull(),
  header: text('header').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(false),
});

export const days = sqliteTable(
  'days',
  {
    planId: text('plan_id').notNull(),
    id: text('id').notNull(),
    position: integer('position').notNull(),
    data: text('data').notNull(),
  },
  (table) => [primaryKey({ columns: [table.planId, table.id] })],
);

export const progress = sqliteTable(
  'progress',
  {
    planId: text('plan_id').notNull(),
    kind: text('kind').notNull(),
    id: text('id').notNull(),
    value: text('value').notNull(),
  },
  (table) => [primaryKey({ columns: [table.planId, table.kind, table.id] })],
);

export const preferences = sqliteTable('preferences', {
  planId: text('plan_id').primaryKey(),
  weeklyHours: integer('weekly_hours'),
  mix: text('mix'),
});
