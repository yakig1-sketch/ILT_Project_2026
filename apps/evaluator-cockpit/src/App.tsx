// Phase 0 cockpit: page frame and the clinical telemetry panel layout (FRS FR-COCK-1/2).
// Live data, session planning and administration screens come in later phases.
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@ilt/ui';

const TELEMETRY_KEYS = [
  'active_box', 'block_time', 'inactivity', 'pen_lifts', 'internal_lifts',
  'width_outside', 'dot_b', 'skipped', 'avg_speed',
] as const;

const layout: Record<string, CSSProperties> = {
  grid: { display: 'grid', gridTemplateColumns: '4fr 1fr', gap: '1rem', minBlockSize: '60vh' },
  mirror: { border: '1px dashed #d0d7de', borderRadius: 8, display: 'grid', placeItems: 'center', color: '#57606a' },
  panel: { background: '#24292f', color: '#f6f8fa', borderRadius: 8, padding: '1rem' },
  row: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', paddingBlock: '0.35rem', borderBlockEnd: '1px solid #444c56' },
};

export function App() {
  const { t } = useTranslation();
  return (
    <AppShell titleKey="app.cockpit">
      <div style={layout.grid}>
        <section style={layout.mirror} aria-label="mirror">
          {t('kiosk.waiting')}
        </section>
        <aside style={layout.panel}>
          <h2 style={{ marginBlockStart: 0, fontSize: '1rem' }}>{t('cockpit.telemetry.title')}</h2>
          {TELEMETRY_KEYS.map((k) => (
            <div key={k} style={layout.row}>
              <span>{t(`cockpit.telemetry.${k}`)}</span>
              <bdi>—</bdi>
            </div>
          ))}
        </aside>
      </div>
    </AppShell>
  );
}
