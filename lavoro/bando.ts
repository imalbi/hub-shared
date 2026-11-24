import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Run } from '../../apps/server/src/core/exec.ts';
import { z } from '../../apps/server/src/core/module.ts';
import { readBoundedJson } from './bounded-fetch.ts';

const limit = 10 * 1024 * 1024;
const detailSchema = z.object({
  allegati: z.array(z.object({ tipo: z.string(), sequence: z.number(), mediaId: z.string().regex(/^[\w-]+$/u) })),
});

export async function readBando(
  url: string,
  fetcher: typeof fetch,
  run: Run,
  signal?: AbortSignal,
): Promise<string | null> {
  let dir: string | undefined;
  try {
    const id = new URL(url).searchParams.get('concorso_id');
    if (!id || !/^[\w-]+$/u.test(id)) return null;
    const timeout = AbortSignal.timeout(20_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const detail = await fetcher(`https://portale.inpa.gov.it/concorsi-smart/api/concorso-public-area/${id}`, {
      redirect: 'manual',
      signal: requestSignal,
    });
    if (!detail.ok) {
      await detail.body?.cancel();
      return null;
    }
    const parsed = detailSchema.safeParse(await readBoundedJson(detail));
    if (!parsed.success) return null;
    const attachment = parsed.data.allegati
      .filter((item) => item.tipo === 'BANDO_CONCORSO')
      .toSorted((a, b) => a.sequence - b.sequence)[0];
    if (!attachment) return null;
    const pdf = await fetcher(`https://portale.inpa.gov.it/api/media/${attachment.mediaId}`, {
      redirect: 'manual',
      signal: requestSignal,
    });
    if (
      !pdf.ok ||
      !/^application\/pdf(?:\s*;|$)/iu.test(pdf.headers.get('content-type') ?? '') ||
      Number(pdf.headers.get('content-length')) > limit ||
      !pdf.body
    ) {
      await pdf.body?.cancel();
      return null;
    }
    const reader = pdf.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    dir = await mkdtemp(join(tmpdir(), 'hub-bando-'));
    const file = join(dir, 'bando.pdf');
    await writeFile(file, Buffer.concat(chunks));
    const result = await run('pdftotext', ['-enc', 'UTF-8', '-l', '40', file, '-'], { timeoutMs: 20_000 });
    return result.code === 0 ? result.stdout.slice(0, 20_000) || null : null;
  } catch {
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
