import { fileURLToPath } from 'node:url';

export default {
  dialect: 'sqlite',
  schema: fileURLToPath(new URL('./schema.ts', import.meta.url)),
  out: fileURLToPath(new URL('./drizzle', import.meta.url)),
};
