import { firstMatchingRule, type BlacklistPosting, type BlacklistRule } from './blacklist.ts';
import { isProtectedCategory } from './protected-category.ts';
import type { JobRow } from './server.ts';

export type PostingTab = 'applications' | 'trash' | 'blacklisted' | 'archive' | 'review';

export type UserState = {
  archive?: ReadonlySet<string>;
  trash?: ReadonlySet<string>;
  applications?: ReadonlySet<string>;
};

/**
 * Calculates which tab a posting belongs to based on fixed precedence:
 * 1. Has application? -> 'applications'
 * 2. In trash? -> 'trash'
 * 3. Has blacklist rule (saved or matches active enabled rule) or reserved for protected category? -> 'blacklisted'
 * 4. Archived? -> 'archive'
 * 5. Default -> 'review' (Da valutare)
 */
export function tabOf(posting: JobRow, userState?: UserState, rules?: readonly BlacklistRule[]): PostingTab {
  if (posting.application !== null || userState?.applications?.has(posting.key)) return 'applications';
  if (posting.deletedAt !== null || userState?.trash?.has(posting.key)) return 'trash';

  // Check saved blacklist rule, protected category position, or dynamic matching rule
  if (posting.blacklistRule !== null) return 'blacklisted';
  if (isProtectedCategory(posting.title, posting.description)) return 'blacklisted';
  if (rules && rules.length > 0) {
    const candidate: BlacklistPosting = {
      company: posting.company,
      title: posting.title,
      description: posting.description,
      location: posting.location,
      site: posting.site,
      work_mode: posting.workMode,
      key: posting.key,
    };
    if (firstMatchingRule(rules, candidate)) return 'blacklisted';
  }

  if (posting.archivedAt !== null || userState?.archive?.has(posting.key)) return 'archive';
  return 'review';
}
