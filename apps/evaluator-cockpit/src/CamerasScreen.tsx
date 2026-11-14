// Cameras (System Administrator, Phase 5f): the site camera account, and the desk cameras found on the
// network (ONVIF). Every camera at a site is set up with the site account, so evaluators never type a
// password; a camera can have its own. A picture shows which camera is which. Passwords are write-only.
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api, apiFile } from './api';
import { pill, ui } from './styles';

interface Camera {
  id: string;
  model: string;
  label: string | null;
  host: string;
  status: 'UNKNOWN' | 'OK' | 'NO_ACCOUNT' | 'AUTH_FAILED' | 'UNREACHABLE' | 'NOT_SUPPORTED';
  ptz: boolean;
  retired: boolean;
  own_account: boolean;
  own_username: string | null;
  has_sub_stream: boolean;
  last_seen_at: string | null;
}
interface Listing {
  account: { username: string; updated_at: string } | null;
  relay: boolean;
  cameras: Camera[];
}

const message = (err: unknown) => (err instanceof ApiError ? err.messageKey : 'error.500');
const s = {
  card: { ...ui.card, display: 'grid', gap: '0.75rem', marginBlockEnd: '1rem' },
  row: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'end' },
  field: { display: 'grid', gap: '0.25rem' },
  notice: { margin: 0, padding: '0.5rem 0.75rem', borderRadius: 6, background: 'var(--ilt-ok-bg)', color: 'var(--ilt-ok)' },
  picture: { maxInlineSize: '100%', inlineSize: '32rem', borderRadius: 6, border: '1px solid var(--ilt-border)', display: 'block' },
} satisfies Record<string, CSSProperties>;

const tone = (status: Camera['status']) => (status === 'OK' ? 'ok' : status === 'UNKNOWN' ? 'off' : 'warn');

export function CamerasScreen() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [account, setAccount] = useState({ username: '', password: '' });
  const [picture, setPicture] = useState<{ id: string; url: string } | null>(null);
  const [own, setOwn] = useState<{ id: string; username: string; password: string } | null>(null);
  const [naming, setNaming] = useState<{ id: string; label: string } | null>(null);
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });

  const load = () => api<Listing>('/cameras').then((d) => {
    setData(d);
    setAccount((a) => (a.username ? a : { username: d.account?.username ?? '', password: '' }));
  }).catch((e) => setError(message(e)));
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => () => {
    if (picture) URL.revokeObjectURL(picture.url);
  }, [picture]);

  async function run(what: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(what);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await load();
      if (done) setNotice(done);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  const saveAccount = (e: FormEvent) => {
    e.preventDefault();
    void run('account', () => api('/cameras/account', { method: 'PUT', body: account }), t('admin.cameras.account_saved')).then(() => setAccount((a) => ({ ...a, password: '' })));
  };
  const showPicture = (cam: Camera) => run(`pic:${cam.id}`, async () => {
    const { blob } = await apiFile(`/cameras/${cam.id}/snapshot`);
    setPicture({ id: cam.id, url: URL.createObjectURL(blob) });
  });
  const saveName = (e: FormEvent) => {
    e.preventDefault();
    if (!naming) return;
    void run(`label:${naming.id}`, () => api(`/cameras/${naming.id}`, { method: 'PATCH', body: { label: naming.label.trim() || null } })).then(() => setNaming(null));
  };
  const saveOwn = (e: FormEvent) => {
    e.preventDefault();
    if (!own) return;
    void run(`own:${own.id}`, () => api(`/cameras/${own.id}`, { method: 'PATCH', body: { own_account: { username: own.username, password: own.password } } })).then(() => setOwn(null));
  };

  if (!data) return error ? <p role="alert" style={ui.error}>{t(error)}</p> : <p style={ui.muted}>{t('common.checking')}</p>;

  return (
    <div data-testid="cameras">
      <p style={{ ...ui.muted, marginBlockStart: 0, maxInlineSize: '60rem' }}>{t('admin.cameras.intro')}</p>
      {!data.relay && <p role="alert" style={ui.error} data-testid="relay-down">{t('admin.cameras.relay_down')}</p>}
      {error && <p role="alert" style={ui.error}>{t(error)}</p>}
      {notice && <p role="status" style={s.notice}>{notice}</p>}

      <form style={s.card} onSubmit={saveAccount} data-testid="camera-account">
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{t('admin.cameras.account')}</h2>
        <p style={{ ...ui.muted, margin: 0 }}>
          {data.account ? t('admin.cameras.account_set', { user: data.account.username, date: when.format(new Date(data.account.updated_at)) }) : t('admin.cameras.account_none')}
        </p>
        <div style={s.row}>
          <label style={s.field}>
            <span>{t('admin.cameras.username')}</span>
            <input value={account.username} autoComplete="off" onChange={(e) => setAccount({ ...account, username: e.target.value })} required maxLength={64} data-testid="camera-username" />
          </label>
          <label style={s.field}>
            <span>{t('admin.cameras.password')}</span>
            <input type="password" value={account.password} autoComplete="new-password" onChange={(e) => setAccount({ ...account, password: e.target.value })} required maxLength={128} data-testid="camera-password" />
          </label>
          <button style={ui.primary} disabled={busy !== null} data-testid="camera-account-save">{busy === 'account' ? t('admin.cameras.checking') : t('admin.cameras.save')}</button>
        </div>
        <p style={{ ...ui.muted, margin: 0, fontSize: '0.85rem' }}>{t('admin.cameras.account_help')}</p>
      </form>

      <section style={s.card}>
        <div style={{ ...s.row, justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{t('admin.cameras.found', { count: data.cameras.length })}</h2>
          <button style={ui.button} disabled={busy !== null} onClick={() => void run('discover', () => api('/cameras/discover', { method: 'POST' }))} data-testid="camera-discover">
            {busy === 'discover' ? t('admin.cameras.searching') : t('admin.cameras.search')}
          </button>
        </div>
        {data.cameras.length === 0 ? (
          <p style={{ ...ui.muted, margin: 0 }}>{t('admin.cameras.none')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={ui.table} data-testid="camera-list">
              <thead>
                <tr>
                  <th style={ui.cell}>{t('admin.cameras.col.name')}</th>
                  <th style={ui.cell}>{t('admin.cameras.col.address')}</th>
                  <th style={ui.cell}>{t('admin.cameras.col.status')}</th>
                  <th style={ui.cell}>{t('admin.cameras.col.ptz')}</th>
                  <th style={ui.cell}>{t('admin.cameras.col.account')}</th>
                  <th style={ui.cell}>{t('admin.cameras.col.seen')}</th>
                  <th style={ui.cell} />
                </tr>
              </thead>
              <tbody>
                {data.cameras.map((c) => (
                  <tr key={c.id} style={c.retired ? { opacity: 0.6 } : undefined} data-testid={`camera-${c.id}`}>
                    <td style={ui.cell}>
                      {naming?.id === c.id ? (
                        <form onSubmit={saveName} style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center' }} data-testid="camera-name-form">
                          <input value={naming.label} maxLength={50} autoFocus aria-label={t('admin.cameras.label_prompt')} placeholder={t('admin.cameras.label_hint')}
                            onChange={(e) => setNaming({ ...naming, label: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(null); }} data-testid="camera-name-input" />
                          <button style={ui.primary} disabled={busy !== null}>{t('admin.cameras.save')}</button>
                          <button type="button" style={ui.button} onClick={() => setNaming(null)}>{t('common.cancel')}</button>
                        </form>
                      ) : (
                        <>
                          <div style={{ fontWeight: 600 }}>{c.label ?? c.model}</div>
                          {c.label && <div style={ui.muted}>{c.model}</div>}
                        </>
                      )}
                    </td>
                    <td style={ui.cell}><bdi dir="ltr">{c.host}</bdi></td>
                    <td style={ui.cell}>
                      <span style={pill(c.retired ? 'off' : tone(c.status))}>{c.retired ? t('admin.cameras.retired') : t(`admin.cameras.status.${c.status}`)}</span>
                    </td>
                    <td style={ui.cell}>{c.ptz ? t('admin.cameras.yes') : t('admin.cameras.no')}</td>
                    <td style={ui.cell}>{c.own_account ? t('admin.cameras.own', { user: c.own_username }) : t('admin.cameras.site')}</td>
                    <td style={{ ...ui.cell, whiteSpace: 'nowrap' }}>{c.last_seen_at ? when.format(new Date(c.last_seen_at)) : '—'}</td>
                    <td style={{ ...ui.cell, whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <button style={ui.button} disabled={busy !== null || c.status !== 'OK'} onClick={() => void showPicture(c)} data-testid="camera-picture">
                          {busy === `pic:${c.id}` ? t('admin.cameras.checking') : t('admin.cameras.picture')}
                        </button>
                        <button style={ui.button} disabled={busy !== null} onClick={() => setNaming({ id: c.id, label: c.label ?? '' })} data-testid="camera-rename">{t('admin.cameras.rename')}</button>
                        <button style={ui.button} disabled={busy !== null} onClick={() => setOwn({ id: c.id, username: c.own_username ?? '', password: '' })}>{t('admin.cameras.own_account')}</button>
                        {c.own_account && (
                          <button style={ui.button} disabled={busy !== null} onClick={() => void run(`own:${c.id}`, () => api(`/cameras/${c.id}`, { method: 'PATCH', body: { own_account: null } }))}>
                            {t('admin.cameras.use_site')}
                          </button>
                        )}
                        <button style={ui.button} disabled={busy !== null} onClick={() => void run(`ret:${c.id}`, () => api(`/cameras/${c.id}`, { method: 'PATCH', body: { retired: !c.retired } }))}>
                          {c.retired ? t('admin.cameras.restore') : t('admin.cameras.retire')}
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ ...ui.muted, margin: 0, fontSize: '0.85rem' }}>{t('admin.cameras.status_help')}</p>
      </section>

      {own && (
        <form style={s.card} onSubmit={saveOwn} data-testid="camera-own-form">
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{t('admin.cameras.own_title', { name: data.cameras.find((c) => c.id === own.id)?.label ?? data.cameras.find((c) => c.id === own.id)?.model })}</h2>
          <div style={s.row}>
            <label style={s.field}>
              <span>{t('admin.cameras.username')}</span>
              <input value={own.username} autoComplete="off" onChange={(e) => setOwn({ ...own, username: e.target.value })} required maxLength={64} />
            </label>
            <label style={s.field}>
              <span>{t('admin.cameras.password')}</span>
              <input type="password" value={own.password} autoComplete="new-password" onChange={(e) => setOwn({ ...own, password: e.target.value })} required maxLength={128} />
            </label>
            <button style={ui.primary} disabled={busy !== null}>{t('admin.cameras.save')}</button>
            <button type="button" style={ui.button} onClick={() => setOwn(null)}>{t('common.cancel')}</button>
          </div>
        </form>
      )}

      {picture && (
        <section style={s.card} data-testid="camera-snapshot">
          <div style={{ ...s.row, justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{data.cameras.find((c) => c.id === picture.id)?.label ?? data.cameras.find((c) => c.id === picture.id)?.model}</h2>
            <button style={ui.button} onClick={() => setPicture(null)}>{t('admin.cameras.close')}</button>
          </div>
          <img src={picture.url} alt={t('admin.cameras.picture')} style={s.picture} />
        </section>
      )}
    </div>
  );
}
