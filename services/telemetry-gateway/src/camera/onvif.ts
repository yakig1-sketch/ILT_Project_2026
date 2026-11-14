// ONVIF for the desk cameras (Phase 5f): WS-Discovery on the site network, and the few calls the
// system needs (stream addresses, pan/tilt). Only Profile S calls; responses are read with small
// patterns, since only a handful of fields matter.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';

export interface DiscoveredCamera {
  /** ONVIF endpoint reference (urn:uuid:…): stays the same when the camera changes address. */
  urn: string;
  deviceUrl: string;
  host: string;
  model: string;
}

export interface CameraAccount {
  username: string;
  password: string;
}

export interface CameraInfo {
  rtspUrl: string;
  rtspSubUrl: string | null;
  profileToken: string;
  ptz: boolean;
  ptzUrl: string | null;
}

export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

/** A failed ONVIF call: AUTH (wrong account), UNREACHABLE (no answer), NOT_SUPPORTED (no stream), or FAULT. */
export class OnvifError extends Error {
  constructor(readonly code: 'AUTH' | 'UNREACHABLE' | 'NOT_SUPPORTED' | 'FAULT', message: string) {
    super(message);
  }
}

const PROBE = (id: string) => `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
 xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
<e:Header><w:MessageID>uuid:${id}</w:MessageID><w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
<w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header>
<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>`;

const field = (xml: string, tag: string) => new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([^<]*)</(?:[\\w-]+:)?${tag}>`).exec(xml)?.[1]?.trim();
const xmlEscape = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

/** Parses one WS-Discovery ProbeMatch (exported for tests). */
export function parseProbeMatch(xml: string): DiscoveredCamera | null {
  const urn = field(xml, 'Address');
  const xaddrs = (field(xml, 'XAddrs') ?? '').split(/\s+/).filter((x) => /^https?:\/\/\d+\.\d+\.\d+\.\d+/.test(x));
  if (!urn || !xaddrs[0]) return null;
  const scopes = (field(xml, 'Scopes') ?? '').split(/\s+/);
  const scope = (kind: string) => scopes.find((s) => s.includes(`onvif.org/${kind}/`))?.split(`/${kind}/`)[1];
  const model = decodeURIComponent(scope('hardware') ?? scope('name') ?? 'ONVIF camera').slice(0, 100);
  return { urn: urn.slice(0, 200), deviceUrl: xaddrs[0], host: new URL(xaddrs[0]).hostname, model };
}

/** Sends an ONVIF WS-Discovery probe from every local IPv4 interface and collects the answers. */
export async function discover(timeoutMs = 3000): Promise<DiscoveredCamera[]> {
  const found = new Map<string, DiscoveredCamera>();
  const local = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i!.address);
  const sockets = await Promise.all(local.map((address) => new Promise<dgram.Socket | null>((resolve) => {
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    s.on('error', () => resolve(null));
    s.on('message', (msg) => {
      const cam = parseProbeMatch(msg.toString('utf8'));
      if (cam) found.set(cam.urn, cam);
    });
    s.bind(0, address, () => {
      try {
        s.setMulticastInterface(address);
        s.send(PROBE(randomUUID()), 3702, '239.255.255.250');
        resolve(s);
      } catch {
        resolve(null);
      }
    });
  })));
  await new Promise((r) => setTimeout(r, timeoutMs));
  for (const s of sockets) s?.close();
  return [...found.values()];
}

/** The ONVIF client for one camera. The camera's clock is read first, so the signed requests match it. */
export class OnvifCamera {
  private clockOffsetMs = 0;

  constructor(private readonly deviceUrl: string, private readonly account: CameraAccount) {}

  private security(): string {
    const nonce = randomBytes(16);
    const created = new Date(Date.now() + this.clockOffsetMs).toISOString().replace(/\.\d+Z$/, 'Z');
    const digest = createHash('sha1').update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(this.account.password)])).digest('base64');
    return `<Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><UsernameToken>`
      + `<Username>${xmlEscape(this.account.username)}</Username>`
      + `<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password>`
      + `<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</Nonce>`
      + `<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${created}</Created>`
      + `</UsernameToken></Security>`;
  }

  private async call(url: string, body: string, signed = true): Promise<string> {
    const envelope = `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">`
      + `<s:Header>${signed ? this.security() : ''}</s:Header><s:Body>${body}</s:Body></s:Envelope>`;
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/soap+xml; charset=utf-8' }, body: envelope, signal: AbortSignal.timeout(5000) });
    } catch (err) {
      throw new OnvifError('UNREACHABLE', `No answer from ${new URL(url).host}: ${(err as Error).message}`);
    }
    const text = await res.text();
    if (res.status === 401 || /NotAuthorized|FailedAuthentication|Sender not Authorized/i.test(text)) throw new OnvifError('AUTH', 'The camera refused the account');
    if (!res.ok || /<(?:\w+:)?Fault>/.test(text)) throw new OnvifError('FAULT', field(text, 'Text') ?? `HTTP ${res.status}`);
    return text;
  }

  private async syncClock() {
    try {
      const xml = await this.call(this.deviceUrl, '<GetSystemDateAndTime xmlns="http://www.onvif.org/ver10/device/wsdl"/>', false);
      const utc = /UTCDateTime>([\s\S]*?)<\/(?:\w+:)?UTCDateTime/.exec(xml)?.[1] ?? '';
      const n = (tag: string) => Number(field(utc, tag));
      const t = Date.UTC(n('Year'), n('Month') - 1, n('Day'), n('Hour'), n('Minute'), n('Second'));
      if (Number.isFinite(t)) this.clockOffsetMs = t - Date.now();
    } catch (err) {
      if (err instanceof OnvifError && err.code === 'UNREACHABLE') throw err;
    }
  }

  /** The main and second streams, the profile, and whether the camera can pan and tilt. */
  async inspect(): Promise<CameraInfo> {
    await this.syncClock();
    const caps = await this.call(this.deviceUrl, '<GetCapabilities xmlns="http://www.onvif.org/ver10/device/wsdl"><Category>All</Category></GetCapabilities>');
    const section = (name: string) => new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(caps)?.[1] ?? '';
    const mediaUrl = field(section('Media'), 'XAddr');
    const ptzUrl = field(section('PTZ'), 'XAddr') ?? null;
    if (!mediaUrl) throw new OnvifError('NOT_SUPPORTED', 'The camera has no ONVIF media service');
    const profilesXml = await this.call(mediaUrl, '<GetProfiles xmlns="http://www.onvif.org/ver10/media/wsdl"/>');
    const profiles = [...profilesXml.matchAll(/<(?:\w+:)?Profiles\b[^>]*token="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?Profiles>/g)].map((m) => ({
      token: m[1]!,
      width: Number(field(m[2]!, 'Width') ?? 0),
      ptz: /PTZConfiguration/.test(m[2]!),
      h264: /<(?:\w+:)?Encoding>H264</.test(m[2]!),
    }));
    // H.264 only: browsers play it in clips and the live view (a camera's small stream can be MJPEG, as on the Tapo C211).
    const usable = profiles.filter((p) => p.h264);
    if (usable.length === 0) throw new OnvifError('NOT_SUPPORTED', 'The camera has no H.264 video profile');
    profiles.splice(0, profiles.length, ...usable);
    const bySize = [...profiles].sort((a, b) => b.width - a.width);
    const main = bySize[0]!;
    const sub = bySize.length > 1 ? bySize[bySize.length - 1]! : null;
    const uri = async (token: string) => {
      const xml = await this.call(mediaUrl, `<GetStreamUri xmlns="http://www.onvif.org/ver10/media/wsdl"><StreamSetup><Stream xmlns="http://www.onvif.org/ver10/schema">RTP-Unicast</Stream>`
        + `<Transport xmlns="http://www.onvif.org/ver10/schema"><Protocol>RTSP</Protocol></Transport></StreamSetup><ProfileToken>${xmlEscape(token)}</ProfileToken></GetStreamUri>`);
      const u = field(xml, 'Uri');
      if (!u) throw new OnvifError('NOT_SUPPORTED', 'The camera gave no stream address');
      return u.replace(/&amp;/g, '&');
    };
    return {
      rtspUrl: await uri(main.token),
      rtspSubUrl: sub ? await uri(sub.token) : null,
      profileToken: main.token,
      ptz: !!ptzUrl && profiles.some((p) => p.ptz),
      ptzUrl,
    };
  }

  /** Turns the camera a small step (RelativeMove; cameras without it get a short ContinuousMove). */
  async move(ptzUrl: string, profileToken: string, direction: Direction, step = 0.05): Promise<void> {
    await this.syncClock();
    const [x, y] = ({ LEFT: [-step, 0], RIGHT: [step, 0], UP: [0, step], DOWN: [0, -step] } as const satisfies Record<Direction, readonly [number, number]>)[direction];
    const token = xmlEscape(profileToken);
    try {
      await this.call(ptzUrl, `<RelativeMove xmlns="http://www.onvif.org/ver20/ptz/wsdl"><ProfileToken>${token}</ProfileToken>`
        + `<Translation><PanTilt xmlns="http://www.onvif.org/ver10/schema" x="${x}" y="${y}"/></Translation></RelativeMove>`);
    } catch (err) {
      if (!(err instanceof OnvifError) || err.code !== 'FAULT') throw err;
      const [vx, vy] = [Math.sign(x) * 0.5, Math.sign(y) * 0.5];
      await this.call(ptzUrl, `<ContinuousMove xmlns="http://www.onvif.org/ver20/ptz/wsdl"><ProfileToken>${token}</ProfileToken>`
        + `<Velocity><PanTilt xmlns="http://www.onvif.org/ver10/schema" x="${vx}" y="${vy}"/></Velocity></ContinuousMove>`);
      await new Promise((r) => setTimeout(r, 300));
      await this.call(ptzUrl, `<Stop xmlns="http://www.onvif.org/ver20/ptz/wsdl"><ProfileToken>${token}</ProfileToken><PanTilt>true</PanTilt><Zoom>false</Zoom></Stop>`);
    }
  }
}

/** The stream address with the account in it, for the relay only (never stored or logged). */
export function withAccount(rtspUrl: string, account: CameraAccount): string {
  const u = new URL(rtspUrl);
  u.username = encodeURIComponent(account.username);
  u.password = encodeURIComponent(account.password);
  return u.toString();
}
