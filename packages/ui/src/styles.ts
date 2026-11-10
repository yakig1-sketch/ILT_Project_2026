// Shared inline styles for the cockpit and the analyst portal (logical properties only, so RTL and LTR both work).
// Colours are the theme variables in index.html, so light and dark mode share these styles.
import type { CSSProperties } from 'react';

export const ui = {
  card: { border: '1px solid var(--ilt-border)', borderRadius: 8, padding: '1rem', background: 'var(--ilt-surface)' },
  field: { display: 'grid', gap: '0.25rem', fontSize: '0.9rem' },
  row: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'end' },
  button: { paddingInline: '0.8rem', paddingBlock: '0.35rem', borderRadius: 6, border: '1px solid var(--ilt-border)', background: 'var(--ilt-surface-2)', color: 'var(--ilt-fg)', cursor: 'pointer' },
  primary: { paddingInline: '0.9rem', paddingBlock: '0.4rem', borderRadius: 6, border: '1px solid var(--ilt-accent)', background: 'var(--ilt-accent)', color: '#fff', cursor: 'pointer' },
  danger: { paddingInline: '0.8rem', paddingBlock: '0.35rem', borderRadius: 6, border: '1px solid var(--ilt-bad)', background: 'var(--ilt-surface)', color: 'var(--ilt-bad)', cursor: 'pointer' },
  // A control that is not available yet: lightened so it does not draw the eye.
  faded: { opacity: 0.4, cursor: 'default' },
  // A control that needs the evaluator now (Manual finish once available): amber, bold, blinking.
  attention: { background: '#bf8700', border: '1px solid #9a6700', color: '#fff', fontWeight: 600 },
  error: { color: 'var(--ilt-bad)', margin: 0 },
  muted: { color: 'var(--ilt-muted)', fontSize: '0.85rem' },
  table: { inlineSize: '100%', borderCollapse: 'collapse' },
  cell: { textAlign: 'start', paddingBlock: '0.4rem', paddingInline: '0.5rem', borderBlockEnd: '1px solid var(--ilt-border-soft)' },
} satisfies Record<string, CSSProperties>;

/** Text colours for result and status lines. */
export const tone = { ok: 'var(--ilt-ok)', warn: 'var(--ilt-warn)', bad: 'var(--ilt-bad)' } as const;

export const pill = (t: 'ok' | 'warn' | 'off'): CSSProperties => ({
  paddingInline: '0.6rem',
  paddingBlock: '0.15rem',
  borderRadius: 999,
  fontSize: '0.85rem',
  background: t === 'ok' ? 'var(--ilt-ok-bg)' : t === 'warn' ? 'var(--ilt-warn-bg)' : 'var(--ilt-off-bg)',
  color: t === 'ok' ? 'var(--ilt-ok)' : t === 'warn' ? 'var(--ilt-warn)' : 'var(--ilt-muted)',
});
