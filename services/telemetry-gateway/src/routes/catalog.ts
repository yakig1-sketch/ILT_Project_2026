// Read-only catalogue endpoints used by the apps in Phase 0: languages and active canvases.
import type { FastifyPluginAsync } from 'fastify';
import { mirrorCanvas, type CanvasGeometry } from '@ilt/template-schemas';

interface Rows<T> {
  rows: T[];
}

export const catalogRoutes: FastifyPluginAsync = async (app) => {
  app.get('/languages', async () => {
    const r = (await app.deps.db.query(
      'SELECT code, name_native, name_en, direction FROM languages WHERE is_enabled ORDER BY code DESC',
    )) as Rows<{ code: string; name_native: string; name_en: string; direction: string }>;
    return r.rows;
  });

  /** Active canvases for a language. ?mirrored=true applies the language mirroring (DDD §7.1). */
  app.get<{ Querystring: { language?: string; type?: string; mirrored?: string } }>('/canvases', async (req) => {
    const { language = 'he', type, mirrored } = req.query;
    const r = (await app.deps.db.query(
      `SELECT c.id, c.code, c.version, c.canvas_type, c.name_he, c.name_en, c.geometry, c.default_scoring_profile
         FROM canvases c JOIN canvas_sets s ON s.id = c.canvas_set_id
        WHERE c.status = 'ACTIVE' AND s.language_code = $1 AND ($2::text IS NULL OR c.canvas_type = $2)
        ORDER BY c.sort_order, c.code`,
      [language, type ?? null],
    )) as Rows<{ geometry: CanvasGeometry } & Record<string, unknown>>;
    return r.rows.map((c) => (mirrored === 'true' ? { ...c, geometry: mirrorCanvas(c.geometry) } : c));
  });
};
