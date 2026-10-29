// Phase 0 kiosk: shows the ILT page at true physical size using the tablet calibration.
// Capture, pairing and the block state machine come in Phase 1.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DTH_A116, type LanguageCode } from '@ilt/shared-types';
import { ILT_GRID_GEOMETRY, type CanvasGeometry } from '@ilt/template-schemas';
import { AppShell } from '@ilt/ui';
import { CanvasView } from './CanvasView';

/** px/mm from ?pxPerMm= (set during calibration), else the DTH-A116 value. */
const pxPerMm = Number(new URLSearchParams(location.search).get('pxPerMm')) || DTH_A116.CSS_PX_PER_MM;

export function App() {
  const { t, i18n } = useTranslation();
  const [geometry, setGeometry] = useState<CanvasGeometry>(ILT_GRID_GEOMETRY);

  // The child language decides the canvas; in Phase 0 it follows the interface language.
  useEffect(() => {
    const lang = i18n.language as LanguageCode;
    fetch(`/api/v1/canvases?language=${lang}&type=ILT_GRID`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: { geometry: CanvasGeometry }[]) => rows[0] && setGeometry(rows[0].geometry))
      .catch(() => setGeometry(ILT_GRID_GEOMETRY));
  }, [i18n.language]);

  return (
    <AppShell titleKey="app.kiosk">
      <p>{t('kiosk.waiting')}</p>
      <h2 style={{ fontSize: '1rem' }}>{t('kiosk.preview_title')}</h2>
      <p style={{ color: '#57606a', fontSize: '0.85rem' }}>{t('kiosk.calibration', { pxPerMm })}</p>
      <CanvasView geometry={geometry} pxPerMm={pxPerMm} />
    </AppShell>
  );
}
