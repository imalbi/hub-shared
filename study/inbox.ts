import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from '../../apps/server/src/core/module.ts';
import { planSchema } from './plan.ts';

type Issue = { file: string; path: string; message: string };

class InvalidPlan extends Error {
  readonly issues: Issue[];
  constructor(issues: Issue[]) {
    super('Invalid plan');
    this.issues = issues;
  }
}

async function readJson(path: string): Promise<unknown> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error('Invalid plan file');
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readChunk(path: string, name: string): Promise<unknown> {
  try {
    return await readJson(join(path, name));
  } catch {
    throw new InvalidPlan([{ file: name, path: '', message: 'Unable to read plan file' }]);
  }
}

export async function readPlan(path: string) {
  const stat = await lstat(path);
  if (stat.isFile()) {
    const result = planSchema.safeParse(await readJson(path));
    if (!result.success)
      throw new InvalidPlan(
        result.error.issues.map((issue) => ({ file: '', path: issue.path.join('.'), message: issue.message })),
      );
    return result.data;
  }
  if (!stat.isDirectory()) throw new Error('Invalid plan');
  const header = z.record(z.string(), z.unknown()).safeParse(await readChunk(path, 'plan.json'));
  if (!header.success) throw new InvalidPlan([{ file: 'plan.json', path: '', message: 'Expected a plan object' }]);
  const names = (await readdir(path)).filter((name) => /^days-.*\.json$/.test(name)).toSorted();
  const days = [];
  const chunks: { name: string; start: number; end: number }[] = [];
  for (const name of names) {
    const start = days.length;
    const parsed = z.array(z.unknown()).safeParse(await readChunk(path, name));
    if (!parsed.success) throw new InvalidPlan([{ file: name, path: '', message: 'Expected an array of days' }]);
    days.push(...parsed.data);
    chunks.push({ name, start, end: days.length });
  }
  const result = planSchema.safeParse({ ...header.data, days });
  if (!result.success) {
    throw new InvalidPlan(
      result.error.issues.map((issue) => {
        const [part, index, ...rest] = issue.path;
        const chunk =
          part === 'days' && typeof index === 'number'
            ? chunks.find((entry) => index >= entry.start && index < entry.end)
            : undefined;
        return {
          file: chunk?.name ?? 'plan.json',
          path: chunk && typeof index === 'number' ? [index - chunk.start, ...rest].join('.') : issue.path.join('.'),
          message: issue.message,
        };
      }),
    );
  }
  return result.data;
}

export async function listInbox(path: string) {
  const names = await readdir(path, { withFileTypes: true });
  return Promise.all(
    names
      .filter((entry) => entry.isDirectory() || (entry.isFile() && entry.name.endsWith('.json')))
      .map(async (entry) => {
        try {
          const plan = await readPlan(join(path, entry.name));
          return {
            name: entry.name,
            valid: true,
            id: plan.id,
            title: plan.title,
            version: plan.version,
            days: plan.days.length,
            preview: plan.days.slice(0, 4).map((day) => day.title),
            issues: [],
            remainingIssues: 0,
          };
        } catch (error) {
          const issues =
            error instanceof InvalidPlan ? error.issues : [{ file: '', path: '', message: 'Unable to read plan' }];
          return {
            name: entry.name,
            valid: false,
            id: null,
            title: null,
            version: null,
            days: 0,
            preview: [],
            issues: issues.slice(0, 50),
            remainingIssues: Math.max(0, issues.length - 50),
          };
        }
      }),
  );
}
