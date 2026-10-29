// Seeds reference data and dev accounts (DDD §10). Idempotent: safe to run again.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { SETTING_DEFINITIONS } from '@ilt/shared-types';
import { DEFAULT_PROTOCOLS, SEED_CANVASES } from '@ilt/template-schemas';
import { REPO_ROOT, loadEnv, required } from './env.js';

loadEnv();
const client = new pg.Client({ connectionString: required('DATABASE_URL') });
export const BUCKET = 'ilt';

const REGIONS: [string, string, string][] = [
  ['CENTRAL', 'מחוז מרכז', 'Central District'],
  ['TEL_AVIV', 'מחוז תל אביב', 'Tel Aviv District'],
  ['HAIFA', 'מחוז חיפה', 'Haifa District'],
  ['JERUSALEM', 'מחוז ירושלים', 'Jerusalem District'],
  ['NORTH', 'מחוז צפון', 'Northern District'],
  ['SOUTH', 'מחוז דרום', 'Southern District'],
];

const VIDEOS = [
  {
    key: 'intro', lang: 'he', file: 'Documents/08_Presentations_and_Demos/ILT_Instruction_Demo_v6_No_Avatar_Hebrew_Female_VO.mp4',
    title_he: 'סרטון פתיחה והדרכה ל-ILT', title_en: 'ILT introduction and guidance',
  },
  {
    key: 'notebook_demo', lang: 'he', file: 'Documents/08_Presentations_and_Demos/ILT_in_Notebook_Demo.mp4',
    title_he: 'הדגמת כתיבה במחברת', title_en: 'Notebook demo',
  },
];

async function seedReferenceData(): Promise<void> {
  await client.query(`INSERT INTO languages (code, name_native, name_en, direction) VALUES
    ('he', 'עברית', 'Hebrew', 'rtl'), ('en', 'English', 'English', 'ltr') ON CONFLICT (code) DO NOTHING`);
  await client.query(`INSERT INTO domains (code, name_he, name_en, description_he, description_en)
    VALUES ('GENERAL', 'כללי', 'General', 'קבוצת ברירת מחדל', 'Default student grouping') ON CONFLICT (code) DO NOTHING`);
  for (const [code, he, en] of REGIONS) {
    await client.query('INSERT INTO regions (code, name_he, name_en) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING', [code, he, en]);
  }
  await client.query(`INSERT INTO devices (label, model, css_px_per_mm, device_pixel_ratio)
    VALUES ('TAB-01', 'DTH-A116', 5.195, 1.75) ON CONFLICT (label) DO NOTHING`);

  for (const d of SETTING_DEFINITIONS) {
    await client.query(
      `INSERT INTO setting_definitions (key, category, value_type, default_value, min_value, max_value, enum_values,
         unit, override_scope, requires_director_approval, description_he, description_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (key) DO UPDATE SET category = EXCLUDED.category, value_type = EXCLUDED.value_type,
         default_value = EXCLUDED.default_value, min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value,
         enum_values = EXCLUDED.enum_values, unit = EXCLUDED.unit, override_scope = EXCLUDED.override_scope,
         requires_director_approval = EXCLUDED.requires_director_approval,
         description_he = EXCLUDED.description_he, description_en = EXCLUDED.description_en`,
      [d.key, d.category, d.value_type, JSON.stringify(d.default_value), d.min_value ?? null, d.max_value ?? null,
        d.enum_values ? JSON.stringify(d.enum_values) : null, d.unit ?? null, d.override_scope,
        d.requires_director_approval, d.description_he, d.description_en],
    );
  }

  const { rowCount } = await client.query('SELECT 1 FROM ethics_approvals LIMIT 1');
  if (!rowCount) {
    await client.query(`INSERT INTO ethics_approvals (approval_type, authority, reference, notes) VALUES
      ('INTERVENTION_PROGRAM', 'Chief Scientist, Ministry of Education', NULL, 'Covers the intervention program, not research. Reference to be entered.'),
      ('PREVIOUS_IRB', 'IRB', '287/8918/2015', 'Previous study approval')`);
  }
}

async function seedCanvases(): Promise<void> {
  const sets = new Map<string, string>();
  for (const c of SEED_CANVASES) {
    const setKey = `${c.language}:${c.set_type}`;
    if (!sets.has(setKey)) {
      const r = await client.query<{ id: string }>(
        `INSERT INTO canvas_sets (language_code, set_type, name_he, name_en) VALUES ($1, $2, $3, $4)
         ON CONFLICT (language_code, set_type, name_en) DO UPDATE SET name_he = EXCLUDED.name_he RETURNING id`,
        [c.language, c.set_type, c.set_name_he, c.set_name_en],
      );
      sets.set(setKey, r.rows[0]!.id);
    }
    await client.query(
      `INSERT INTO canvases (canvas_set_id, code, version, status, canvas_type, name_he, name_en, geometry,
         default_scoring_profile, activated_at)
       VALUES ($1, $2, 1, 'ACTIVE', $3, $4, $5, $6, $7, now()) ON CONFLICT (code, version) DO NOTHING`,
      [sets.get(setKey), c.code, c.geometry.canvas_type, c.name_he, c.name_en, JSON.stringify(c.geometry),
        c.profile ? JSON.stringify(c.profile) : null],
    );
  }
  // Hebrew intervention letters: empty set until the letter sheets are measured and checked.
  await client.query(`INSERT INTO canvas_sets (language_code, set_type, name_he, name_en)
    VALUES ('he', 'INTERVENTION_LETTERS', 'אותיות עבריות - תוכנית התערבות', 'Hebrew letters - intervention program')
    ON CONFLICT (language_code, set_type, name_en) DO NOTHING`);

  for (const t of DEFAULT_PROTOCOLS) {
    await client.query(
      `INSERT INTO protocol_templates (code, version, session_type, name_he, name_en, steps)
       VALUES ($1, 1, $2, $3, $4, $5) ON CONFLICT (code, version) DO NOTHING`,
      [t.code, t.session_type, t.name_he, t.name_en, JSON.stringify(t.steps)],
    );
  }
}

async function seedVideos(): Promise<void> {
  const s3 = new S3Client({
    endpoint: required('S3_ENDPOINT'),
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: required('S3_ACCESS_KEY'), secretAccessKey: required('S3_SECRET_KEY') },
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  }
  for (const v of VIDEOS) {
    const exists = await client.query('SELECT 1 FROM instruction_videos WHERE video_key = $1 AND language_code = $2 AND version = 1', [v.key, v.lang]);
    if (exists.rowCount) continue;
    const body = readFileSync(`${REPO_ROOT}${v.file}`);
    if (body.subarray(0, 40).toString('utf8').startsWith('version https://git-lfs')) {
      throw new Error(`${v.file} is a Git LFS pointer; run "git lfs pull" first`);
    }
    const objectKey = `videos/${v.key}/${v.lang}/v1.mp4`;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: objectKey, Body: body, ContentType: 'video/mp4' }));
    await client.query(
      `INSERT INTO instruction_videos (video_key, language_code, version, status, title_he, title_en, object_key, source_name, sha256)
       VALUES ($1, $2, 1, 'ACTIVE', $3, $4, $5, $6, $7)`,
      [v.key, v.lang, v.title_he, v.title_en, objectKey, v.file.split('/').pop(), createHash('sha256').update(body).digest('hex')],
    );
    console.log(`Uploaded ${v.key}/${v.lang} (${(body.length / 1e6).toFixed(1)} MB)`);
  }
}

async function seedDevUsers(): Promise<void> {
  if (process.env.NODE_ENV === 'production') return;
  const password = await hash(required('SEED_DEV_PASSWORD'));
  const pin = await hash(required('SEED_DIRECTOR_PIN'));
  const users: [string, string, string, string | null][] = [
    ['dev-admin@ilt.local', 'Dev Admin', 'ADMIN', null],
    ['dev-director@ilt.local', 'Dev Research Director', 'RESEARCHER', pin],
    ['dev-evaluator@ilt.local', 'Dev Evaluator', 'EVALUATOR', null],
    ['dev-analyst@ilt.local', 'Dev Analyst', 'ANALYST', null],
  ];
  for (const [email, name, role, pinHash] of users) {
    await client.query(
      `INSERT INTO users (email, password_hash, full_name, role, director_pin_hash, domain_id)
       VALUES ($1, $2, $3, $4, $5, (SELECT id FROM domains WHERE code = 'GENERAL'))
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, director_pin_hash = EXCLUDED.director_pin_hash`,
      [email, password, name, role, pinHash],
    );
  }
}

async function main(): Promise<void> {
  await client.connect();
  await seedReferenceData();
  await seedCanvases();
  await seedDevUsers();
  await seedVideos();
  const counts = await client.query(`SELECT
    (SELECT count(*) FROM setting_definitions) AS settings, (SELECT count(*) FROM canvases) AS canvases,
    (SELECT count(*) FROM protocol_templates) AS templates, (SELECT count(*) FROM users) AS users,
    (SELECT count(*) FROM instruction_videos) AS videos, (SELECT count(*) FROM regions) AS regions`);
  console.log('Seeded:', counts.rows[0]);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
