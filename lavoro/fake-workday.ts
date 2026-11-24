export const hostSite = 'wd103.example.org';
export const hostJobs = 'employer.wd3.example.org';
export const employerSite = {
  host: hostSite,
  tenant: 'example',
  site: 'Carriere',
  company: 'Example SpA',
  searchText: '',
};
export const employerJobs = {
  host: hostJobs,
  tenant: 'example',
  site: 'MainSite',
  company: 'Example Jobs',
  searchText: 'Torino',
};

export const posting = (
  id: string,
  opts: {
    title?: string;
    externalPath?: string;
    locationsText?: string | null;
    bulletFields?: string[];
  } = {},
) => ({
  title: opts.title ?? `Addetto esempio ${id}`,
  externalPath: opts.externalPath ?? `/job/Torino-Centro/Addetto-esempio_${id}`,
  ...(opts.locationsText === null ? {} : { locationsText: opts.locationsText ?? 'Torino' }),
  bulletFields: opts.bulletFields ?? [id],
});

export const list = (jobPostings: ReturnType<typeof posting>[], total = jobPostings.length) => ({
  total,
  jobPostings,
});

export const detail = (
  opts: {
    text?: string;
    location?: string;
    additionalLocations?: string[];
    startDate?: string;
    timeType?: string;
  } = {},
) => ({
  jobPostingInfo: {
    jobDescription: `<p>${opts.text ?? 'Diploma richiesto'}</p><script>hidden()</script>`,
    location: opts.location ?? 'Torino',
    ...(opts.additionalLocations ? { additionalLocations: opts.additionalLocations } : {}),
    startDate: opts.startDate ?? '2026-11-10',
    timeType: opts.timeType ?? 'Full time',
  },
});

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
