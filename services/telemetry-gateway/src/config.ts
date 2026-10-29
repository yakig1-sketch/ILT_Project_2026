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
  jwtSecret: string;
  logLevel: string;
}

export const loadConfig = (): Config => ({
  port: Number(process.env.GATEWAY_PORT ?? 8080),
  databaseUrl: required('APP_DATABASE_URL'),
  s3Endpoint: required('S3_ENDPOINT'),
  jwtSecret: required('JWT_SECRET'),
  logLevel: process.env.LOG_LEVEL ?? 'info',
});
