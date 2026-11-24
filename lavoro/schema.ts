import { index, integer, real, sqliteTable, text, uniqueIndex } from '../../apps/server/src/core/module-db.ts';
import { applicationStatuses, type ApplicationStatus } from './application-status.ts';
import { blacklistFields, blacklistMatchTypes } from './blacklist.ts';

// Timestamps are `timestamp_ms`, booleans `boolean`, like the core schema. User-state tables (archive, trash,
// favourites, applications) track posting state by key.

/** One row per posting. The key never changes and a collection never overwrites a row (see `ingest.ts`). */
export const jobs = sqliteTable(
  'jobs',
  {
    // `postingKey` as it was when the row was saved: never recomputed, so editing a title cannot lose the hooks to it.
    key: text('key').primaryKey(),
    comparisonKey: text('comparison_key').notNull(),
    title: text('title').notNull(),
    company: text('company').notNull(),
    location: text('location').notNull(),
    site: text('site').notNull(),
    url: text('url').notNull().unique(),
    applyUrl: text('apply_url'),
    score: real('score').notNull(),
    total: real('total').notNull(),
    reasons: text('reasons', { mode: 'json' }).$type<string[]>().notNull(),
    categories: text('categories', { mode: 'json' }).$type<string[]>().notNull(),
    description: text('description'),
    // Cleaned by `clean-html.ts`; null when the source only hands over text (a described card).
    descriptionHtml: text('description_html'),
    workMode: text('work_mode', { enum: ['remote', 'hybrid', 'onsite'] }),
    isRemote: integer('is_remote', { mode: 'boolean' }).notNull(),
    detailsMissing: integer('details_missing', { mode: 'boolean' }).notNull(),
    postedAt: integer('posted_at', { mode: 'timestamp_ms' }),
    firstSeen: integer('first_seen', { mode: 'timestamp_ms' }).notNull(),
    importedAt: integer('imported_at', { mode: 'timestamp_ms' }),
    // The rule that excluded the posting; no foreign key on purpose, so the row outlives a deleted rule.
    blacklistRule: integer('blacklist_rule'),
  },
  (table) => [index('jobs_comparison_key_idx').on(table.comparisonKey)],
);

export const opinions = sqliteTable('opinions', {
  key: text('key')
    .primaryKey()
    .references(() => jobs.key, { onDelete: 'cascade' }),
  verdict: text('verdict', { mode: 'json' }).notNull(),
  model: text('model').notNull(),
  inputHash: text('input_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const bandoTexts = sqliteTable('bando_texts', {
  key: text('key')
    .primaryKey()
    .references(() => jobs.key, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
});

/** Written by 16h; a purged key counts as seen and is never saved again. */
export const purgedJobs = sqliteTable('purged_jobs', {
  key: text('key').primaryKey(),
  purgedAt: integer('purged_at', { mode: 'timestamp_ms' }).notNull(),
  codes: text('codes'),
});

/** Managed from the zone (16j); a collection only reads it. */
export const blacklistRules = sqliteTable('blacklist_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  field: text('field', { enum: blacklistFields }).notNull(),
  matchType: text('match_type', { enum: blacklistMatchTypes }).notNull(),
  value: text('value').notNull(),
  note: text('note').notNull().default(''),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/** The seen cache: URLs already judged, kept for `knownDays`. */
export const knownUrls = sqliteTable('known_urls', {
  url: text('url').primaryKey(),
  seenAt: integer('seen_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * Postings the score gates refused by a few points (`filter.nearMiss`), kept with their text for 30 days and at most
 * 300 rows so the owner can see what a word would have let in. Never a posting a rule, place or age refused.
 */
export const nearMisses = sqliteTable('near_misses', {
  key: text('key').primaryKey(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  company: text('company').notNull(),
  location: text('location').notNull(),
  site: text('site').notNull(),
  score: real('score').notNull(),
  titleScore: real('title_score').notNull(),
  total: real('total').notNull(),
  reasons: text('reasons', { mode: 'json' }).$type<string[]>().notNull(),
  minScore: real('min_score').notNull(),
  minTitleScore: real('min_title_score').notNull(),
  description: text('description'),
  firstSeen: integer('first_seen', { mode: 'timestamp_ms' }).notNull(),
  lastSeen: integer('last_seen', { mode: 'timestamp_ms' }).notNull(),
});

/** One row per finished collection or dry run; the last one feeds `state.last`. */
export const collections = sqliteTable('collections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind', { enum: ['prova', 'raccolta'] }).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }).notNull(),
  status: text('status', { enum: ['done', 'cancelled', 'failed', 'partial'] }).notNull(),
  newCount: integer('new_count').notNull(),
  excludedCount: integer('excluded_count').notNull(),
  searches: integer('searches').notNull(),
  failedSearches: integer('failed_searches').notNull(),
});

/** User-state: archived postings. */
export const jobArchive = sqliteTable('job_archive', {
  key: text('key').primaryKey(),
  at: integer('at', { mode: 'timestamp_ms' }).notNull(),
});

/** User-state: postings moved to trash / deleted. */
export const jobDeleted = sqliteTable('job_deleted', {
  key: text('key').primaryKey(),
  at: integer('at', { mode: 'timestamp_ms' }).notNull(),
});

export { applicationStatuses, type ApplicationStatus };

/** User-state: job applications. */
export const jobApplied = sqliteTable('job_applied', {
  key: text('key').primaryKey(),
  appliedAt: integer('applied_at', { mode: 'timestamp_ms' }).notNull(),
  status: text('status', { enum: applicationStatuses }).notNull().default('pending'),
  closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
  reason: text('reason'),
  notes: text('notes'),
});

export const applicationAddress = sqliteTable(
  'application_address',
  {
    key: text('key').notNull(),
    address: text('address').notNull(),
    origin: text('origin', { enum: ['sent', 'thread', 'manual'] }).notNull(),
    addedAt: integer('added_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [uniqueIndex('application_address_unique').on(table.key, table.address)],
);

export const jobMailLink = sqliteTable(
  'job_mail_link',
  {
    key: text('key').notNull(),
    account: text('account').notNull(),
    messageId: text('message_id').notNull(),
    linkedAt: integer('linked_at', { mode: 'timestamp_ms' }).notNull(),
    linkReason: text('link_reason', { enum: ['address', 'model'] }),
  },
  (table) => [
    uniqueIndex('job_mail_link_unique').on(table.key, table.account, table.messageId),
    index('job_mail_link_key_idx').on(table.key),
  ],
);

/** Scheduled and past interviews for an application. */
export const jobInterview = sqliteTable(
  'job_interview',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    key: text('key').notNull(),
    scheduledAt: integer('scheduled_at', { mode: 'timestamp_ms' }).notNull(),
    label: text('label').notNull(),
  },
  (table) => [index('job_interview_key_idx').on(table.key)],
);

/**
 * Every received mail the local model has read, keyed by account and Message-ID, so a restart or a later poll never
 * reads one twice (step 39 polls without a page). `answer` is the parsed model answer; it feeds "Da fare" in Oggi.
 */
export const mailChecked = sqliteTable(
  'mail_checked',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    account: text('account').notNull(),
    messageId: text('message_id').notNull(),
    // Kept for the list in Oggi: a row names the mail by its subject and sender.
    subject: text('subject').notNull(),
    sender: text('sender').notNull(),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }),
    checkedAt: integer('checked_at', { mode: 'timestamp_ms' }).notNull(),
    // `invalid` is an answer that never parsed: it is stored so one bad mail is not read again on every run.
    outcome: text('outcome', { enum: ['read', 'invalid'] }).notNull(),
    answer: text('answer', { mode: 'json' }),
    dismissedAt: integer('dismissed_at', { mode: 'timestamp_ms' }),
    // When the owner replied in the thread (a sent message after this mail): the item leaves "Da fare".
    answeredAt: integer('answered_at', { mode: 'timestamp_ms' }),
  },
  (table) => [uniqueIndex('mail_checked_unique').on(table.account, table.messageId)],
);

/** What the model proposes and the owner confirms or dismisses; nothing here changes an application on its own. */
export const mailProposals = sqliteTable(
  'mail_proposals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind', { enum: ['link', 'status', 'interview'] }).notNull(),
    key: text('key').notNull(),
    account: text('account').notNull(),
    messageId: text('message_id').notNull(),
    subject: text('subject').notNull(),
    why: text('why').notNull(),
    // `status` proposals carry the status, `interview` ones the date and label.
    status: text('status', { enum: applicationStatuses }),
    scheduledAt: integer('scheduled_at', { mode: 'timestamp_ms' }),
    label: text('label'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    resolution: text('resolution', { enum: ['accepted', 'dismissed'] }),
  },
  (table) => [
    uniqueIndex('mail_proposals_unique').on(table.kind, table.key, table.account, table.messageId),
    index('mail_proposals_key_idx').on(table.key),
  ],
);
