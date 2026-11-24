import { effectiveApplicationStatus } from './applications.ts';
import { comparisonCompany } from './key.ts';
import type { ApplicationStatus } from './schema.ts';

export type CompanyApplication = { title: string; appliedAt: number; status: ApplicationStatus };

type Job = { key: string; company: string; title: string };
type Application = {
  key: string;
  appliedAt: number;
  status: ApplicationStatus;
  interviews?: readonly { scheduledAt: number | Date }[] | null;
};

export function sameCompanyApplications(jobs: readonly Job[], applications: readonly Application[]) {
  const jobsByKey = new Map(jobs.map((job) => [job.key, job]));
  const byCompany = new Map<string, (CompanyApplication & { key: string })[]>();
  for (const application of applications) {
    const job = jobsByKey.get(application.key);
    if (!job) continue;
    const company = comparisonCompany(job.company);
    if (!company) continue;
    const list = byCompany.get(company) ?? [];
    // The 21-day expiry is shown the way the Candidature tab shows it.
    list.push({
      key: job.key,
      title: job.title,
      appliedAt: application.appliedAt,
      status: effectiveApplicationStatus(application),
    });
    byCompany.set(company, list);
  }
  return new Map(
    jobs.map((job) => [
      job.key,
      (byCompany.get(comparisonCompany(job.company)) ?? [])
        .filter((app) => app.key !== job.key)
        .toSorted((a, b) => b.appliedAt - a.appliedAt)
        .map(({ title, appliedAt, status }) => ({ title, appliedAt, status })),
    ]),
  );
}

/** Zone pages patch their local copy of the list after an apply or an edit; this refreshes the field on every job. */
export function withCompanyApplications<
  J extends Job & {
    application: {
      appliedAt: number;
      status: ApplicationStatus;
      interviews?: readonly { scheduledAt: number | Date }[] | null;
    } | null;
  },
>(jobs: readonly J[]): (J & { companyApplications: CompanyApplication[] })[] {
  const others = sameCompanyApplications(
    jobs,
    jobs.flatMap((job) => (job.application ? [{ key: job.key, ...job.application }] : [])),
  );
  return jobs.map((job) => ({ ...job, companyApplications: others.get(job.key) ?? [] }));
}
