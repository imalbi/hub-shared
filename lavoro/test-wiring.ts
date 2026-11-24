import type { Clock, Source } from './source.ts';
import type { createLlmGate } from '../../apps/server/src/core/llm-gate.ts';

// The one thing a test and the module it loads through discovery share: discovery imports a file by path, so a test
// cannot pass options to it. The test fills this in, and a one-line `server.ts` in a temporary root passes it to
// `createLavoroModule`. Never imported by the real module.
export const wiring: {
  sources: Source[];
  clock: Clock | undefined;
  lookup?: (hostname: string) => Promise<string[]> | string[];
  gate?: ReturnType<typeof createLlmGate>;
  skillsDir?: string;
} = { sources: [], clock: undefined };
