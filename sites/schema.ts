import { integer, primaryKey, sqliteTable, text } from '../../apps/server/src/core/module-db.ts';

export const siteChecks = sqliteTable('site_checks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  site: text('site').notNull(),
  at: integer('at').notNull(),
  status: integer('status'),
  latency: integer('latency').notNull(),
  error: text('error'),
});

export const siteDays = sqliteTable(
  'site_days',
  {
    site: text('site').notNull(),
    day: text('day').notNull(),
    checks: integer('checks').notNull(),
    failed: integer('failed').notNull(),
    downMinutes: integer('down_minutes').notNull(),
    worstStatus: text('worst_status').notNull(),
  },
  (table) => [primaryKey({ columns: [table.site, table.day] })],
);
