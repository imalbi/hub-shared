export const host = 'jobs.example.org';
export const employer = { host, site: 'CX_1', company: 'Configured employer' };
export const url = (id: number) => `https://${host}/hcmUI/CandidateExperience/it/sites/CX_1/job/${id}`;
export const job = (id: number, location = 'Torino, Italy') => ({
  Id: String(id),
  Title: `ADDETTO/A esempio ${id}`,
  PrimaryLocation: location,
  secondaryLocations: [{ Name: 'Altra città, Italy' }],
  PostedDate: '2026-11-01',
  ShortDescriptionStr: 'Breve descrizione',
  LegalEmployer: 'Wrong employer',
});
export const list = (ids: number[], total = ids.length) => ({
  items: [{ TotalJobsCount: total, requisitionList: ids.map((id) => job(id)) }],
});
export const detail = (text = 'Diploma richiesto') => ({
  items: [
    {
      ExternalDescriptionStr: `<p>${text}</p><script>hidden()</script>`,
      ExternalQualificationsStr: '',
      ExternalResponsibilitiesStr: '',
    },
  ],
});
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
