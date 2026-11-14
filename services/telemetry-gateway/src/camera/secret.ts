// Camera passwords at rest (Phase 5f): AES-256-GCM with a key derived from CAMERA_SECRET_KEY.
// Stored as base64 of iv (12 bytes) + tag (16 bytes) + ciphertext. Never sent to a client.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export interface SecretBox {
  seal(plain: string): string;
  open(sealed: string): string;
}

export function secretBox(key: string): SecretBox {
  const k = createHash('sha256').update(`ilt-camera:${key}`).digest();
  return {
    seal(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', k, iv);
      const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
    },
    open(sealed) {
      const raw = Buffer.from(sealed, 'base64');
      const d = createDecipheriv('aes-256-gcm', k, raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
    },
  };
}
