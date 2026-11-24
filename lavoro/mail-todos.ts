import { mailAnswerSchema } from './mail-prompt.ts';

/** Oggi shows at most this many, soonest deadline first, from the last `todoDays` days (7 unless the config says so). */
export const TODO_LIMIT = 5;

export type MailTodoRow = {
  id: number;
  subject: string;
  sender: string;
  receivedAt: Date | null;
  checkedAt: Date;
  outcome: 'read' | 'invalid';
  answer: unknown;
  dismissedAt: Date | null;
  answeredAt: Date | null;
};

/** A deadline is a calendar day: it reads as the end of that local day, so "today" is still open. */
function deadlineEnd(deadline: string) {
  const [year = 0, month = 0, day = 0] = deadline.split('-').map(Number);
  const at = new Date(year, month - 1, day, 23, 59);
  return at.getMonth() === month - 1 ? at.getTime() : null;
}

/** The mails whose answer asks the owner for something, not dismissed, not replied to and not past their deadline, from the last `days` days. */
export function selectTodos(rows: readonly MailTodoRow[], now: number, days: number) {
  const since = now - days * 86_400_000;
  return rows
    .flatMap((row) => {
      const answer = mailAnswerSchema.safeParse(row.answer);
      const ask = answer.success ? answer.data.ask.trim() : '';
      const received = (row.receivedAt ?? row.checkedAt).getTime();
      if (row.outcome !== 'read' || row.dismissedAt || row.answeredAt || !ask || received < since) return [];
      const deadline = answer.success && answer.data.deadline ? deadlineEnd(answer.data.deadline) : null;
      // A deadline that has passed is nothing left to do.
      if (deadline !== null && deadline < now) return [];
      return [{ id: row.id, subject: row.subject, sender: row.sender, ask, deadline, receivedAt: received }];
    })
    .toSorted((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity) || b.receivedAt - a.receivedAt)
    .slice(0, TODO_LIMIT);
}

/** The open "Da fare" mails whose deadline falls on a day from `from` to `to` (inclusive, `YYYY-MM-DD`): what the calendar shows. */
export function todoDeadlines(rows: readonly MailTodoRow[], from: string, to: string) {
  return rows.flatMap((row) => {
    const answer = mailAnswerSchema.safeParse(row.answer);
    if (!answer.success || row.outcome !== 'read' || row.dismissedAt || row.answeredAt) return [];
    const ask = answer.data.ask.trim();
    const day = answer.data.deadline;
    if (!ask || !day || deadlineEnd(day) === null || day < from || day > to) return [];
    return [{ id: row.id, day, ask, sender: row.sender }];
  });
}
