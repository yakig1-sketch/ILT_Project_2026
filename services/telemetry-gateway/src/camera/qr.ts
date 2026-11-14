// Reads the pairing QR code in a camera picture (Phase 5f). The tablet shows `ILT-CAM:<code>`.
import jpeg from 'jpeg-js';
import jsQR from 'jsqr';

export const QR_PREFIX = 'ILT-CAM:';

/** The pairing code in a JPEG picture, or null. Large pictures are halved first, which keeps it quick. */
export function readPairingCode(picture: Buffer): string | null {
  let img: { width: number; height: number; data: Uint8Array };
  try {
    img = jpeg.decode(picture, { useTArray: true, maxMemoryUsageInMB: 256 });
  } catch {
    return null;
  }
  const tries = img.width > 1600 ? [halve(img), img] : [img];
  for (const t of tries) {
    const found = jsQR(new Uint8ClampedArray(t.data.buffer, t.data.byteOffset, t.data.byteLength), t.width, t.height, { inversionAttempts: 'dontInvert' });
    if (found?.data.startsWith(QR_PREFIX)) return found.data.slice(QR_PREFIX.length);
  }
  return null;
}

/** Half the size (2×2 average), RGBA. */
function halve(img: { width: number; height: number; data: Uint8Array }) {
  const w = img.width >> 1;
  const h = img.height >> 1;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        const i = (yy: number, xx: number) => img.data[(yy * img.width + xx) * 4 + c]!;
        out[(y * w + x) * 4 + c] = (i(2 * y, 2 * x) + i(2 * y, 2 * x + 1) + i(2 * y + 1, 2 * x) + i(2 * y + 1, 2 * x + 1)) >> 2;
      }
    }
  }
  return { width: w, height: h, data: out };
}
