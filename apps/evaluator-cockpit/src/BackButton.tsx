// The back button now lives in @ilt/ui (also used by the analyst portal).
import { BackButton } from '@ilt/ui';
import { ui } from './styles';

export { BackButton };

/** A page whose item could not be loaded (for example deleted): the error, with the way back. */
export function LoadError({ message, onBack, backLabel }: { message: string; onBack: () => void; backLabel: string }) {
  return (
    <div style={{ display: 'grid', gap: '0.75rem', justifyItems: 'start' }}>
      <BackButton onClick={onBack} label={backLabel} />
      <p role="alert" style={{ ...ui.error, margin: 0 }}>{message}</p>
    </div>
  );
}
