type Day = { subject: string; minutes?: number; done: boolean };

export function effectiveMix(mix: Record<string, number>, states: Record<string, string>) {
  const active = Object.entries(mix).filter(([id]) => states[id] !== 'paused' && states[id] !== 'passed');
  const total = active.reduce((sum, [, share]) => sum + share, 0);
  return Object.fromEntries(
    Object.entries(mix).map(([id, share]) => [
      id,
      states[id] === 'paused' || states[id] === 'passed'
        ? 0
        : total
          ? (share * 100) / total
          : active.length
            ? 100 / active.length
            : 0,
    ]),
  );
}

export function orderDays<T extends Day>(
  days: T[],
  states: Record<string, string>,
  mix: Record<string, number> | null,
): T[] {
  const visible = days.filter(
    (day) =>
      day.done ||
      (states[day.subject] !== 'paused' && states[day.subject] !== 'passed' && (!mix || (mix[day.subject] ?? 0) > 0)),
  );
  if (!mix) return visible;
  const open = visible.filter((day) => !day.done);
  const selected: T[] = [];
  const minutes = new Map<string, number>();
  let total = 0;
  while (open.length) {
    let best = 0;
    let deficit = -Infinity;
    const considered = new Set<string>();
    open.forEach((day, index) => {
      if (considered.has(day.subject)) return;
      considered.add(day.subject);
      const value = ((mix[day.subject] ?? 0) * total) / 100 - (minutes.get(day.subject) ?? 0);
      if (value > deficit) {
        deficit = value;
        best = index;
      }
    });
    const [day] = open.splice(best, 1);
    if (!day) break;
    selected.push(day);
    const weight = day.minutes ?? 1;
    total += weight;
    minutes.set(day.subject, (minutes.get(day.subject) ?? 0) + weight);
  }
  let index = 0;
  return visible.map((day) => (day.done ? day : (selected[index++] ?? day)));
}

export function estimate(minutes: number, share: number, weeklyHours: number) {
  const hoursPerWeek = (weeklyHours * share) / 100;
  return {
    hoursPerWeek,
    hoursRemaining: minutes / 60,
    weeksRemaining: hoursPerWeek > 0 ? minutes / 60 / hoursPerWeek : null,
  };
}
