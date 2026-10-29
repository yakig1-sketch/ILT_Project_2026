// Phase 0 analyst portal: page frame. Research replay, cohort views and exports come later.
import { useTranslation } from 'react-i18next';
import { AppShell } from '@ilt/ui';

export function App() {
  const { t } = useTranslation();
  return (
    <AppShell titleKey="app.analyst">
      <p>{t('analyst.research_only')}</p>
    </AppShell>
  );
}
