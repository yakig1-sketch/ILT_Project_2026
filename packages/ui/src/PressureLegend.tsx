// Legend for ink coloured by pressure and the yellow hover path (cockpit mirror and replay).
import { useTranslation } from 'react-i18next';
import { HOVER_COLOUR, PRESSURE_BANDS } from './ink.js';

const swatch = (background: string) => ({ inlineSize: '1.1rem', blockSize: '0.7rem', borderRadius: 3, background, display: 'inline-block' });

export function PressureLegend() {
  const { t } = useTranslation();
  const items = [...PRESSURE_BANDS.map((b) => ({ key: b.key, colour: b.colour })), { key: 'hover', colour: HOVER_COLOUR }];
  return (
    <div
      data-testid="pressure-legend"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem 1rem', fontSize: '0.85rem', paddingBlock: '0.4rem', paddingInline: '0.25rem' }}
    >
      <strong>{t('ink.legend')}:</strong>
      {items.map((i) => (
        <span key={i.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          <span aria-hidden style={swatch(i.colour)} />
          {t(`ink.${i.key}`)}
        </span>
      ))}
    </div>
  );
}
