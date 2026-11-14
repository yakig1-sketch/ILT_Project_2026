// Replay (FR-REP-1/2) of a block the evaluator or researcher may see (FR-REP-4); the player is shared
// with the analyst portal (@ilt/ui ReplayPlayer). When the attempt has a hand-video clip (Phase 5f,
// FR-REP-3), it is downloaded with the evaluator's sign-in and played in sync.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReplayPlayer, type ReplayData, type ReplayVideo } from '@ilt/ui';
import { ApiError, api, apiFile } from './api';
import { ui } from './styles';
import { LoadError } from './BackButton';

export function ReplayScreen({ attemptId, onBack }: { attemptId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const [data, setData] = useState<ReplayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [video, setVideo] = useState<ReplayVideo | undefined>(undefined);
  useEffect(() => {
    api<ReplayData>(`/attempts/${attemptId}/replay`).then(setData).catch((e: ApiError) => setError(e.messageKey));
  }, [attemptId]);
  useEffect(() => {
    const v = data?.video;
    if (!v) return;
    let url: string | null = null;
    let live = true;
    setVideo('LOADING');
    apiFile(`/media/clips/${v.id}`).then(({ blob }) => {
      if (!live) return;
      url = URL.createObjectURL(blob);
      setVideo({ url, offsetMs: v.sync_offset_ms });
    }).catch(() => live && setVideo('FAILED'));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [data]);
  if (!data) return error ? <LoadError message={t(error)} onBack={onBack} backLabel={t('common.back')} /> : <p style={ui.muted}>{t('common.checking')}</p>;
  return <ReplayPlayer data={data} onBack={onBack} video={video} />;
}
