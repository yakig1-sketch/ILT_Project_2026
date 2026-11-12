// Replay (FR-REP-1/2) of a block the evaluator or researcher may see (FR-REP-4); the player is shared
// with the analyst portal (@ilt/ui ReplayPlayer).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReplayPlayer, type ReplayData } from '@ilt/ui';
import { ApiError, api } from './api';
import { ui } from './styles';
import { LoadError } from './BackButton';

export function ReplayScreen({ attemptId, onBack }: { attemptId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const [data, setData] = useState<ReplayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<ReplayData>(`/attempts/${attemptId}/replay`).then(setData).catch((e: ApiError) => setError(e.messageKey));
  }, [attemptId]);
  if (!data) return error ? <LoadError message={t(error)} onBack={onBack} backLabel={t('common.back')} /> : <p style={ui.muted}>{t('common.checking')}</p>;
  return <ReplayPlayer data={data} onBack={onBack} />;
}

