// Apart from `schema.ts` so the web UI can use the list without pulling the database layer into its bundle.
export const applicationStatuses = ['pending', 'interviewing', 'offer', 'rejected', 'withdrawn', 'expired'] as const;
export type ApplicationStatus = (typeof applicationStatuses)[number];
