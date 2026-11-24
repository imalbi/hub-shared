// Run from the server package so its drizzle-kit is used:
//   pnpm --filter @hub/server exec drizzle-kit generate --config ../../modules.local/lavoro/drizzle.config.ts // guard-private: allow Repository-local module path
// drizzle-kit resolves `schema` and `out` against the working directory, not this file, hence the absolute paths.
import { fileURLToPath } from 'node:url';

export default {
  dialect: 'sqlite',
  schema: fileURLToPath(new URL('./schema.ts', import.meta.url)),
  out: fileURLToPath(new URL('./drizzle', import.meta.url)),
};
