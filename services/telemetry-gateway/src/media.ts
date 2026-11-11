// Object storage for instruction videos (DDD §9 instruction_videos, §14 media). The tablet downloads
// a video with its session token and plays it from memory, so no token appears in a URL.
import type { Readable } from 'node:stream';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { TokenClaims } from './auth.js';
import { one } from './db.js';

export const BUCKET = 'ilt';

export interface MediaObject {
  body: Uint8Array;
  contentType: string;
}

export interface MediaStore {
  get(objectKey: string): Promise<MediaObject | null>;
}

export function s3MediaStore(endpoint: string, accessKeyId: string, secretAccessKey: string): MediaStore {
  const s3 = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
  return {
    async get(objectKey) {
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: objectKey }));
        if (!res.Body) return null;
        return { body: await res.Body.transformToByteArray(), contentType: res.ContentType ?? 'application/octet-stream' };
      } catch (err) {
        if ((err as { name?: string }).name === 'NoSuchKey') return null;
        throw err;
      }
    },
  };
}

/** The private exports bucket written by the analytics service (Phase 4c). */
export const EXPORTS_BUCKET = 'ilt-exports';

export function s3ExportFiles(endpoint: string, accessKeyId: string, secretAccessKey: string) {
  const s3 = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
  return {
    async open(objectKey: string): Promise<{ stream: Readable; size: number | undefined } | null> {
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket: EXPORTS_BUCKET, Key: objectKey }));
        return res.Body ? { stream: res.Body as Readable, size: res.ContentLength } : null;
      } catch (err) {
        if ((err as { name?: string }).name === 'NoSuchKey') return null;
        throw err;
      }
    },
  };
}

export const mediaRoutes: FastifyPluginAsync = async (app) => {
  /** An instruction video: for the paired tablet (session token) and signed-in staff. */
  app.get<{ Params: { id: string } }>('/media/videos/:id', async (req, reply) => {
    let claims: TokenClaims;
    try {
      claims = await req.jwtVerify<TokenClaims>();
    } catch {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message_key: 'error.401', details: {} } });
    }
    if (claims.typ === 'refresh') return reply.status(403).send({ error: { code: 'FORBIDDEN', message_key: 'error.403', details: {} } });
    const notFound = { error: { code: 'NOT_FOUND', message_key: 'error.404', details: {} } };
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.status(404).send(notFound);
    const video = await one<{ object_key: string }>(app.deps.db, "SELECT object_key FROM instruction_videos WHERE id = $1 AND status <> 'DRAFT'", [req.params.id]);
    const media = app.deps.media;
    if (!video || !media) return reply.status(404).send(notFound);
    const obj = await media.get(video.object_key);
    if (!obj) return reply.status(404).send(notFound);
    return reply.header('content-type', obj.contentType).header('cache-control', 'private, max-age=3600').send(Buffer.from(obj.body));
  });
};
