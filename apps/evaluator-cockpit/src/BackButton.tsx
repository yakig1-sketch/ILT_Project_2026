// A "back" button whose arrow points to the start of the line: left in English, right in Hebrew.
import { useTranslation } from 'react-i18next';
import { ui } from './styles';

export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  const { i18n } = useTranslation();
  return (
    <button style={ui.button} onClick={onClick}>
      <span aria-hidden="true">{i18n.dir() === 'rtl' ? '→' : '←'}</span> {label}
    </button>
  );
}
