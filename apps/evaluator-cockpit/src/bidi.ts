// Bidirectional text helpers for Hebrew screens.

/** Keeps sizes such as "3×5" or "35×25" left to right inside a Hebrew name, so they don't read reversed. */
export function isolateSizes(text: string): string {
  return text.replace(/\d[\d.,]*(?:\s*×\s*\d[\d.,]*)+/g, (m) => `⁦${m}⁩`);
}
