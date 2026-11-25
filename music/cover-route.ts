import type { FastifyInstance } from '../../apps/server/src/core/module.ts';
export type CoverImage = {
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  bytes: Buffer;
};

const trackIdPattern = /^[A-Za-z0-9_-]{11}$/;

/** Relative route: the module scope enforces Host, Origin and paired-device authentication. */
export function registerMusicCoverRoute(app: FastifyInstance, readCover: (id: string) => Promise<CoverImage | null>) {
  app.get<{ Params: { id: string } }>('/cover/:id', async (req, reply) => {
    if (!trackIdPattern.test(req.params.id)) return reply.code(400).send({ error: 'Invalid track id' });
    const image = await readCover(req.params.id);
    if (!image) return reply.code(404).header('cache-control', 'no-store').send({ error: 'Cover unavailable' });
    return reply
      .header('cache-control', 'private, max-age=86400')
      .header('x-content-type-options', 'nosniff')
      .header('cross-origin-resource-policy', 'same-origin')
      .type(image.mime)
      .send(image.bytes);
  });
}
