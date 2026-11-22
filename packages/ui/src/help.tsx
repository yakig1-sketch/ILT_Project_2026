// User guides in the staff screens (2026-11-15). The guides are static HTML pages, one per role and
// language, served by each app at <base>help/<language>/<guide>.html. Each screen names its section of
// the guide (useHelpSection); the header's Help button and the small (?) links open that section in a
// side panel, in the language of the page, without leaving the screen. The sign-in pages link to the
// whole guides, opened in a new tab.
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

export type HelpGuide = 'evaluator' | 'researcher' | 'admin' | 'analyst';

/**
 * The sections of each guide (the ids of its headings). A screen asks for a section; the guide shown is
 * the user's own when it has that section, else the app's main guide (see configureHelp).
 */
export const GUIDE_SECTIONS: Record<HelpGuide, readonly string[]> = {
  evaluator: [
    'overview', 'sign-in', 'sessions', 'new-participant', 'new-session', 'participant-record', 'consent', 'paper-scores',
    'legacy-results', 'console', 'intervention', 'tablet', 'pairing', 'session', 'steps', 'telemetry', 'block-end',
    'controls', 'marks', 'camera', 'summary', 'replay', 'troubleshooting',
  ],
  researcher: [
    'overview', 'sign-in', 'sessions', 'new-participant', 'participant-record', 'consent', 'research-purpose', 'console',
    'intervention', 'summary', 'replay', 'director', 'portal', 'troubleshooting',
  ],
  admin: [
    'overview', 'sign-in', 'users', 'domains', 'regions', 'settings', 'canvases', 'canvas-detail', 'reference', 'cameras',
    'ethics', 'legacy', 'log', 'troubleshooting',
  ],
  analyst: [
    'overview', 'sign-in', 'privacy', 'portal-overview', 'portal-sessions', 'portal-filters', 'portal-cohort', 'portal-session',
    'portal-replay', 'portal-kinematics', 'portal-offline', 'portal-exports', 'troubleshooting',
  ],
};

interface HelpConfig {
  /** Where the guides are served, ending with a slash (the app's base + "help/"). */
  base: string;
  /** The app's main guide, used when the user's own guide has no such section. */
  main: HelpGuide;
  /** The signed-in user's guide, if any. */
  own?: HelpGuide | null;
}

let config: HelpConfig = { base: '/help/', main: 'evaluator' };
let section = 'overview';
let open: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The app tells the help where its guides are and which guide is the user's. */
export function configureHelp(next: Partial<HelpConfig>) {
  config = { ...config, ...next };
}

/** The guide that holds a section for this user. */
export function guideFor(target: string): HelpGuide {
  const own = config.own;
  if (own && GUIDE_SECTIONS[own].includes(target)) return own;
  return config.main;
}

/**
 * The guides' language: Hebrew screens open the Hebrew guides; English screens open the Japanese guides
 * for a reader who chose Japanese (on the landing page or in a guide, kept as ilt.help_language), else
 * the English ones. The staff screens themselves have no Japanese.
 */
export function guideLanguage(language: string): 'he' | 'en' | 'ja' {
  if (language === 'he') return 'he';
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('ilt.help_language') === 'ja') return 'ja';
  } catch {
    // Storage blocked: English.
  }
  return 'en';
}

/** The address of a guide (and a section of it) in a language. */
export function helpUrl(guide: HelpGuide, language: string, target?: string, embed = false): string {
  const lang = guideLanguage(language);
  const theme = typeof document === 'undefined' ? null : document.documentElement.dataset.theme;
  const q = new URLSearchParams();
  if (embed) q.set('embed', '1');
  if (theme) q.set('theme', theme);
  const query = q.toString();
  return `${config.base}${lang}/${guide}.html${query ? `?${query}` : ''}${target ? `#${target}` : ''}`;
}

/** A screen names its section of the guide while it is shown. */
export function useHelpSection(target: string) {
  useEffect(() => {
    section = target;
    emit();
  }, [target]);
}

/** Opens the help panel at a section (the screen's own section when none is given). */
export function openHelp(target?: string) {
  open = target ?? section;
  emit();
}

const s = {
  button: {
    display: 'inline-flex', alignItems: 'center', gap: '0.35rem', paddingInline: '0.7rem', paddingBlock: '0.3rem', borderRadius: 6,
    border: '1px solid var(--ilt-border, #d0d7de)', background: 'var(--ilt-surface-2, #f6f8fa)', color: 'var(--ilt-fg, #1f2328)', cursor: 'pointer', font: 'inherit',
  },
  mark: {
    display: 'inline-grid', placeItems: 'center', inlineSize: '1.2rem', blockSize: '1.2rem', borderRadius: '50%',
    background: 'var(--ilt-accent, #1f6feb)', color: '#fff', fontSize: '0.8rem', fontWeight: 700, lineHeight: 1,
  },
  link: {
    display: 'inline-grid', placeItems: 'center', inlineSize: '1.35rem', blockSize: '1.35rem', padding: 0, borderRadius: '50%',
    border: '1px solid var(--ilt-border, #d0d7de)', background: 'var(--ilt-surface, #fff)', color: 'var(--ilt-link, #0969da)',
    cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, lineHeight: 1, verticalAlign: 'middle', flex: 'none',
  },
  panel: {
    position: 'fixed', insetBlock: 0, insetInlineEnd: 0, inlineSize: 'min(34rem, 100vw)', zIndex: 1000, display: 'grid',
    gridTemplateRows: 'auto 1fr', background: 'var(--ilt-surface, #fff)', borderInlineStart: '1px solid var(--ilt-border, #d0d7de)',
    boxShadow: '0 0 24px rgba(0, 0, 0, 0.25)',
  },
  bar: {
    display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', paddingBlock: '0.6rem', paddingInline: '0.9rem',
    borderBlockEnd: '1px solid var(--ilt-border, #d0d7de)', background: 'var(--ilt-header, #f6f8fa)',
  },
  frame: { inlineSize: '100%', blockSize: '100%', border: 0, background: 'var(--ilt-surface, #fff)' },
  guides: { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.25rem 0.75rem', fontSize: '0.9rem' },
} satisfies Record<string, CSSProperties>;

/** The header's Help button; it also holds the help panel. */
export function HelpButton() {
  const { t } = useTranslation();
  return (
    <>
      <button type="button" style={s.button} onClick={() => openHelp()} data-testid="help" aria-haspopup="dialog">
        <span style={s.mark} aria-hidden>?</span>
        {t('help.button')}
      </button>
      <HelpPanel />
    </>
  );
}

/** A small (?) next to a panel's title: opens the guide at that panel's section. */
export function HelpLink({ section: target, label }: { section: string; label?: string }) {
  const { t } = useTranslation();
  const name = label ?? t('help.about');
  return (
    <button type="button" style={s.link} onClick={() => openHelp(target)} aria-label={name} title={name} data-testid={`help-${target}`}>
      ?
    </button>
  );
}

function HelpPanel() {
  const { t, i18n } = useTranslation();
  const target = useSyncExternalStore(subscribe, () => open);
  const [, rerender] = useState(0);
  // Follow the theme while the panel is open (the guide is reloaded in the new theme).
  useEffect(() => {
    if (!target) return;
    const mo = new MutationObserver(() => rerender((n) => n + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        open = null;
        emit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      mo.disconnect();
      window.removeEventListener('keydown', onKey);
    };
  }, [target]);
  if (!target) return null;
  const guide = guideFor(target);
  const close = () => {
    open = null;
    emit();
  };
  return (
    <aside style={s.panel} role="dialog" aria-label={t('help.title')} data-testid="help-panel">
      <div style={s.bar}>
        <strong style={{ marginInlineEnd: 'auto' }}>{t('help.title')} · {t(`help.guide.${guide}`)}</strong>
        <a href={helpUrl(guide, i18n.language, target)} target="_blank" rel="noopener" data-testid="help-full">{t('help.open_full')}</a>
        <button type="button" style={s.button} onClick={close} aria-label={t('help.close')} data-testid="help-close">✕</button>
      </div>
      <iframe key={`${guide}-${i18n.language}`} title={t(`help.guide.${guide}`)} src={helpUrl(guide, i18n.language, target, true)} style={s.frame} />
    </aside>
  );
}

/** Links to whole guides, for a sign-in page; each opens in a new tab in the page's language. */
export function GuideLinks({ guides }: { guides: HelpGuide[] }) {
  const { t, i18n } = useTranslation();
  return (
    <nav style={s.guides} aria-label={t('help.guides')} data-testid="guide-links">
      <span style={{ color: 'var(--ilt-muted, #57606a)', flexBasis: '100%', textAlign: 'center' }}>{t('help.guides')}</span>
      {guides.map((g, i) => (
        <span key={g} style={{ whiteSpace: 'nowrap' }}>
          {i > 0 && <span aria-hidden style={{ color: 'var(--ilt-muted, #57606a)', marginInlineEnd: '0.75rem' }}>·</span>}
          <a href={helpUrl(g, i18n.language)} target="_blank" rel="noopener" data-testid={`guide-${g}`}>{t(`help.guide.${g}`)}</a>
        </span>
      ))}
    </nav>
  );
}
