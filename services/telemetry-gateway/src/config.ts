import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return v;
};

export interface Config {
  port: number;
  databaseUrl: string;
  s3Endpoint: string;
  s3AccessKey: string;
  s3SecretKey: string;
  jwtSecret: string;
  schoolHmacKey: string;
  logLevel: string;
  /** The analytics service, on the local interface (DDD §8.9). */
  analyticsUrl: string;
  /** The camera relay (go2rtc, Phase 5f), on the local interface. */
  go2rtcUrl: string;
  /** Encrypts camera passwords in the database; without it the camera features are off. */
  cameraSecretKey: string | null;
}

export const loadConfig = (): Config => ({
  port: Number(process.env.GATEWAY_PORT ?? 8080),
  databaseUrl: required('APP_DATABASE_URL'),
  s3Endpoint: required('S3_ENDPOINT'),
  s3AccessKey: required('S3_ACCESS_KEY'),
  s3SecretKey: required('S3_SECRET_KEY'),
  jwtSecret: required('JWT_SECRET'),
  schoolHmacKey: required('SCHOOL_CODE_HMAC_KEY'),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  analyticsUrl: process.env.ANALYTICS_URL ?? 'http://127.0.0.1:8090',
  go2rtcUrl: process.env.GO2RTC_URL ?? 'http://127.0.0.1:1984',
  cameraSecretKey: process.env.CAMERA_SECRET_KEY || null,
});
