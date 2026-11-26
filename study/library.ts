import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import type { Files } from '../../apps/server/src/core/files.ts';
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

async function resolveMaterial(dirs: string[], path: string, folder?: number) {
  if (isAbsolute(path) || path.split(/[\\/]/).some((part) => part === '..') || !path.toLowerCase().endsWith('.pdf'))
    throw new TRPCError({ code: 'BAD_REQUEST' });
  for (const [index, dir] of dirs.entries()) {
    if (folder !== undefined && folder !== index) continue;
    try {
      const root = await realpath(dir);
      const file = await realpath(join(root, path));
      if (!within(root, file)) continue;
      const info = await stat(file);
      if (!info.isFile()) continue;
      if (info.size > MAX_MATERIAL_BYTES) throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE' });
      return { path: file, signature: `${info.size}:${info.mtimeMs}:${info.ctimeMs}` };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      // Try the next configured folder.
    }
  }
  throw new TRPCError({ code: 'NOT_FOUND' });
}

const MAX_MATERIAL_BYTES = 100 * 1024 * 1024;

export function createMaterialOpener(dirs: string[]) {
  type Entry = { signature: string; file: Promise<Awaited<ReturnType<Files['put']>>> };
  const cache = new Map<string, Entry>();
  async function open(files: Files, path: string, folder?: number): Promise<Awaited<ReturnType<Files['put']>>> {
    const source = await resolveMaterial(dirs, path, folder);
    const previous = cache.get(source.path);
    if (previous?.signature === source.signature) {
      const file = await previous.file;
      try {
        await files.get(file.fileId);
        return file;
      } catch {
        if (cache.get(source.path) === previous) cache.delete(source.path);
        return open(files, path, folder);
      }
    }
    async function copy() {
      const bytes = await readFile(source.path);
      if (bytes.byteLength > MAX_MATERIAL_BYTES) throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE' });
      return files.put(bytes, { name: basename(source.path), mime: 'application/pdf' });
    }
    const entry = { signature: source.signature, file: copy() };
    cache.set(source.path, entry);
    if (cache.size > 50) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    try {
      return await entry.file;
    } catch (error) {
      if (cache.get(source.path) === entry) cache.delete(source.path);
      throw error;
    }
  }
  return open;
}
