export function listing(ids = [1], next = false) {
  return JSON.stringify({
    jobs: ids.map((id) => ({
      jobId: String(id),
      jobTitle: `Frontend developer ${id}`,
      jobLocation: 'Exampleville, Examplia',
      contractTypeTitle: 'Permanent',
      contractTypeId: 'PERM',
      minsalary: 28000,
      maxsalary: 30000,
      salaryCurrencySymbol: '€',
      salaryTimeScale: 'annuale',
      postedDate: '2026-11-27T10:00:00Z',
    })),
    pagination: { total: ids.length + (next ? 100 : 0), nextRange: 10 },
  });
}
export const detail = (body = '<p>TypeScript e Docker, diploma richiesto.</p>') =>
  JSON.stringify({ jobDescription: body, companyName: null });
