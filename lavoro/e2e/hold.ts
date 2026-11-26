import { join } from 'node:path';
import { RUN_TMP } from '../../../apps/e2e/tests/hosts.ts';

/** While this file exists the fake sources wait, so a spec can press Annulla mid-collection under any load. */
export const holdFile = join(RUN_TMP, 'lavoro-hold-collection');
