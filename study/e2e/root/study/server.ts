import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defineModule, z } from '../../../../../apps/server/src/core/module.ts';
import base from '../../../server.ts';
const runDir = process.env.HUB_E2E_TMP ?? tmpdir();
const studyDir = join(runDir, 'study');
mkdirSync(join(studyDir, 'in-arrivo'), { recursive: true });
const studyMaterials = join(studyDir, 'materiali');
mkdirSync(studyMaterials, { recursive: true });
writeFileSync(
  join(studyMaterials, 'dispensa.pdf'),
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000202 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n251\n%%EOF\n',
);

export default defineModule({
  name: base.name,
  zones: base.zones,
  migrations: base.migrations,
  config: z.unknown(),
  settingsSchema: base.config,
  create(deps) {
    return base.create({
      ...deps,
      config: deps.config ?? { plansDir: studyDir, materialDirs: [studyMaterials] },
    });
  },
});
