import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { TRPCError } from '../../apps/server/src/core/module.ts';

function within(root: string, path: string) {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export async function listMaterials(dirs: string[]) {
  const results: { folder: number; folderName: string; path: string }[] = [];
  for (const [folder, dir] of dirs.entries()) {
    try {
      const root = await realpath(dir);
      async function visit(path: string) {
        for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
          const name = join(path, entry.name);
          if (entry.isDirectory()) await visit(name);
          else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
            results.push({ folder, folderName: basename(root), path: name });
        }
      }
      await visit('');
    } catch {
      // An unavailable material folder leaves the other folders usable.
    }
  }
  return results.toSorted((a, b) => a.folder - b.folder || a.path.localeCompare(b.path));
}

export async function readMaterial(dirs: string[], path: string, folder?: number) {
  if (isAbsolute(path) || path.split(/[\\/]/).some((part) => part === '..') || !path.toLowerCase().endsWith('.pdf'))
    throw new TRPCError({ code: 'BAD_REQUEST' });
  for (const [index, dir] of dirs.entries()) {
    if (folder !== undefined && folder !== index) continue;
    try {
      const root = await realpath(dir);
      const file = await realpath(join(root, path));
      if (!within(root, file) || !(await stat(file)).isFile()) continue;
      return { bytes: await readFile(file), name: basename(file) };
    } catch {
      // Try the next configured folder.
    }
  }
  throw new TRPCError({ code: 'NOT_FOUND' });
}
