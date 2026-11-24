import { z } from '../../apps/server/src/core/module.ts';

// Reads the last dry run ("Prova raccolta") from the local server and prints it as a table, until the zone exists
// (16g). Run it from the repository root: `node modules.local/lavoro/print-dry-run.ts`. Read-only: one GET of // guard-private: allow Repository-local module path
// `lavoro.state` from the PC (loopback needs no token); it never starts a collection. `HUB_PORT` moves the port.

const rowSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string(),
  score: z.number(),
  total: z.number(),
  reasons: z.array(z.string()),
  workMode: z.string().nullable(),
});

const stateSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('invalid-config'),
    issues: z.array(z.object({ path: z.string(), message: z.string() })),
  }),
  z.object({
    status: z.literal('ready'),
    collection: z
      .object({ kind: z.string(), searchesDone: z.number(), searchesTotal: z.number(), newCount: z.number() })
      .nullable(),
    last: z
      .object({
        kind: z.string(),
        finishedAt: z.number(),
        status: z.string(),
        newCount: z.number(),
        excludedCount: z.number(),
      })
      .nullable(),
    dryRun: z.array(rowSchema).nullable(),
    dryRunRequirements: z.record(z.string(), z.number()).nullable(),
  }),
]);

const fit = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, width - 3)}...` : text.padEnd(width);

/** The text to print for the answer of `lavoro.state`; an answer of another shape is named, never echoed. */
export function formatState(raw: unknown): string {
  const parsed = stateSchema.safeParse(raw);
  if (!parsed.success) return 'Unexpected answer from the server (is it the same version as this script?).';
  const state = parsed.data;
  if (state.status === 'invalid-config')
    return ['The profile is invalid:', ...state.issues.map((issue) => `  ${issue.path}: ${issue.message}`)].join('\n');

  const lines: string[] = [];
  if (state.collection)
    lines.push(
      `The ${state.collection.kind} is running: ${state.collection.searchesDone} of ${state.collection.searchesTotal} searches, ${state.collection.newCount} found so far.`,
    );
  if (state.last) {
    const at = new Date(state.last.finishedAt).toLocaleTimeString('it-IT');
    lines.push(
      `Last run: ${state.last.kind}, ${state.last.status}, ${at}, ${state.last.newCount} new, ${state.last.excludedCount} excluded by rules`,
    );
  }
  const dropped = Object.entries(state.dryRunRequirements ?? {});
  if (dropped.length)
    lines.push(`Dropped by requirement: ${dropped.map(([reason, n]) => `${reason} ${n}`).join(', ')}`);
  if (state.dryRun === null) {
    lines.push(
      'No dry run in memory. Start "Prova raccolta" from the palette (Ctrl+K), wait for it to end, then run this again.',
    );
    return lines.join('\n');
  }
  if (state.dryRun.length === 0) {
    lines.push('The last dry run listed nothing.');
    return lines.join('\n');
  }
  const cells = (
    total: string,
    score: string,
    title: string,
    company: string,
    place: string,
    mode: string,
    why: string,
  ) =>
    [total.padStart(7), score.padStart(5), fit(title, 44), fit(company, 24), fit(place, 26), fit(mode, 7), why]
      .join('  ')
      .trimEnd();
  lines.push(
    `${state.dryRun.length} postings, best first:`,
    cells('total', 'score', 'title', 'company', 'location', 'mode', 'reasons'),
  );
  for (const row of state.dryRun)
    lines.push(
      cells(
        row.total.toFixed(1),
        row.score.toFixed(1),
        row.title,
        row.company,
        row.location,
        row.workMode ?? '-',
        row.reasons.join(', '),
      ),
    );
  return lines.join('\n');
}

async function main() {
  const url = `http://127.0.0.1:${process.env.HUB_PORT ?? '4180'}/trpc/lavoro.state`;
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch {
    console.error(`Cannot reach ${url}: is hub.service running?`);
    process.exit(1);
  }
  if (!response.ok) {
    console.error(`The server answered ${response.status}.`);
    process.exit(1);
  }
  const body = z.object({ result: z.object({ data: z.unknown() }) }).safeParse(await response.json());
  process.stdout.write(`${formatState(body.success ? body.data.result.data : undefined)}\n`);
}

// Importing this file (the tests do) must never reach for the server.
if (import.meta.main) await main();
