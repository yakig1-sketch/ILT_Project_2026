// Shared inline styles for the cockpit (logical properties only, so RTL and LTR both work).
import type { CSSProperties } from 'react';

export const ui = {
  card: { border: '1px solid #d0d7de', borderRadius: 8, padding: '1rem', background: '#fff' },
  field: { display: 'grid', gap: '0.25rem', fontSize: '0.9rem' },
  row: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'end' },
  button: { paddingInline: '0.8rem', paddingBlock: '0.35rem', borderRadius: 6, border: '1px solid #d0d7de', background: '#f6f8fa', cursor: 'pointer' },
  primary: { paddingInline: '0.9rem', paddingBlock: '0.4rem', borderRadius: 6, border: '1px solid #1f6feb', background: '#1f6feb', color: '#fff', cursor: 'pointer' },
  danger: { paddingInline: '0.8rem', paddingBlock: '0.35rem', borderRadius: 6, border: '1px solid #cf222e', background: '#fff', color: '#cf222e', cursor: 'pointer' },
  error: { color: '#cf222e', margin: 0 },
  muted: { color: '#57606a', fontSize: '0.85rem' },
  table: { inlineSize: '100%', borderCollapse: 'collapse' },
  cell: { textAlign: 'start', paddingBlock: '0.4rem', paddingInline: '0.5rem', borderBlockEnd: '1px solid #eaeef2' },
} satisfies Record<string, CSSProperties>;

export const pill = (tone: 'ok' | 'warn' | 'off'): CSSProperties => ({
  paddingInline: '0.6rem',
  paddingBlock: '0.15rem',
  borderRadius: 999,
  fontSize: '0.85rem',
  background: tone === 'ok' ? '#dafbe1' : tone === 'warn' ? '#fff8c5' : '#eaeef2',
  color: tone === 'ok' ? '#1a7f37' : tone === 'warn' ? '#9a6700' : '#57606a',
});
