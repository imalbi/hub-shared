import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createModuleClient } from '../../apps/web/src/lib/module-client.ts';
import type { TodayDay, TodayLine } from '../../apps/web/src/lib/module-ui.ts';
import { copy } from './copy.ts';
import type definition from './server.ts';

const client = createModuleClient<typeof definition>('lavoro');
const todosKey = ['lavoro', 'mail-todos'];
const day = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });

/** Oggi's "Da fare" lines (step 66): the mail of the last days that asks the owner for something, one row each, hideable. Today only. */
export function useMailTodos(when: TodayDay): TodayLine[] | null {
  const cache = useQueryClient();
  const info = useQuery({ queryKey: [...todosKey, 'info'], queryFn: () => client.mailCheck.info.query() });
  // shortcut: polled every minute; a new check lands within one tick.
  const todos = useQuery({
    queryKey: todosKey,
    queryFn: () => client.mailCheck.todos.query(),
    enabled: info.data?.enabled === true,
    refetchInterval: 60_000,
  });
  if (when !== 'today' || !todos.data?.length) return null;
  return todos.data.map((todo) => ({
    id: `lavoro-todo-${todo.id}`,
    chip: copy.today.chip,
    text: todo.ask,
    muted:
      copy.today.todo.from(todo.sender) +
      (todo.deadline !== null ? `, ${copy.today.todo.deadline(day.format(todo.deadline))}` : ''),
    dismiss: {
      label: copy.today.todo.hide(todo.ask),
      run: () => {
        void client.mailCheck.dismissTodo
          .mutate({ id: todo.id })
          .then(() => cache.invalidateQueries({ queryKey: todosKey }));
      },
    },
  }));
}
