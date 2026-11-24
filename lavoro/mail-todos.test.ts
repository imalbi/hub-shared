import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TODO_LIMIT, selectTodos, todoDeadlines, type MailTodoRow } from './mail-todos.ts';

const now = new Date(2026, 10, 10, 12).getTime();
const day = 86_400_000;
const base = { ask: '', deadline: '' };
const answer = (patch: Record<string, string> = {}) => ({
  application: 'nessuna',
  confidence: 'bassa',
  kind: 'altro',
  why: 'Prova',
  interviewDate: '',
  interviewTime: '',
  interviewPlace: '',
  ...base,
  ...patch,
});
let next = 0;
const row = (patch: Partial<MailTodoRow> = {}, given: Record<string, string> = {}): MailTodoRow => ({
  id: ++next,
  subject: `Oggetto ${next}`,
  sender: 'carla@example.org',
  receivedAt: new Date(now - day),
  checkedAt: new Date(now),
  outcome: 'read',
  answer: answer(given),
  dismissedAt: null,
  answeredAt: null,
  ...patch,
});

void test('only mail that asks something, not dismissed and from the last week, becomes a to-do', () => {
  const rows = [
    row({}, { ask: 'Rispondere a Carla' }),
    row({}, {}),
    row({ dismissedAt: new Date(now) }, { ask: 'Già nascosta' }),
    row({ answeredAt: new Date(now) }, { ask: 'Già risposta' }),
    row({ receivedAt: new Date(now - 8 * day) }, { ask: 'Troppo vecchia' }),
    row({ outcome: 'invalid', answer: null }),
    row({ answer: { not: 'an answer' } }),
  ];
  assert.deepEqual(
    selectTodos(rows, now, 7).map((todo) => todo.ask),
    ['Rispondere a Carla'],
  );
});

void test('the window is the configured number of days', () => {
  const old = row({ receivedAt: new Date(now - 20 * day) }, { ask: 'Di tre settimane fa' });
  assert.equal(selectTodos([old], now, 7).length, 0);
  assert.equal(selectTodos([old], now, 30).length, 1);
});

void test('the soonest deadline comes first, a deadline today is still open, and the list is capped', () => {
  const rows = [
    row({}, { ask: 'Senza scadenza' }),
    row({}, { ask: 'Tardi', deadline: '2026-11-30' }),
    row({}, { ask: 'Oggi', deadline: '2026-11-10' }),
    ...Array.from({ length: 6 }, (_, i) => row({}, { ask: `Altra ${i}`, deadline: '2026-12-31' })),
  ];
  const todos = selectTodos(rows, now, 7);
  assert.equal(todos.length, TODO_LIMIT);
  assert.deepEqual(
    todos.slice(0, 2).map((todo) => todo.ask),
    ['Oggi', 'Tardi'],
  );
  assert.equal(todos[0]?.deadline, new Date(2026, 10, 10, 23, 59).getTime());
  assert.equal(selectTodos([row({}, { ask: 'Data impossibile', deadline: '2026-02-31' })], now, 7)[0]?.deadline, null);
});

void test('todoDeadlines lists open asks with a deadline inside the range, whatever their age', () => {
  const rows = [
    row({}, { ask: 'Inviare i documenti', deadline: '2026-11-17' }),
    row({}, { ask: 'Fuori mese', deadline: '2026-12-02' }),
    row({}, { ask: 'Senza scadenza' }),
    row({ dismissedAt: new Date(now) }, { ask: 'Nascosta', deadline: '2026-11-18' }),
    row({ answeredAt: new Date(now) }, { ask: 'Risposta', deadline: '2026-11-18' }),
    row({ receivedAt: new Date(now - 90 * day) }, { ask: 'Vecchia ma aperta', deadline: '2026-11-20' }),
  ];
  assert.deepEqual(
    todoDeadlines(rows, '2026-11-01', '2026-11-30').map(({ ask, day: due }) => [ask, due]),
    [
      ['Inviare i documenti', '2026-11-17'],
      ['Vecchia ma aperta', '2026-11-20'],
    ],
  );
});

void test('a to-do whose deadline day has passed leaves Oggi; one due today stays', () => {
  const past = row({}, { ask: 'Candidarsi entro la scadenza', deadline: '2026-11-09' });
  const today = row({}, { ask: 'Rispondere', deadline: '2026-11-10' });
  const open = row({}, { ask: 'Completare il profilo' });
  assert.deepEqual(
    selectTodos([past, today, open], now, 7).map((todo) => todo.id),
    [today.id, open.id],
  );
});
