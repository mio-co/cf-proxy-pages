// 后台接口的 Cloudflare Access 校验：验证 Cf-Access-Jwt-Assertion（RS256，签名、aud、iss、过期时间）
import type { Env } from './types';

let keyCache: { keys: Record<string, CryptoKey>; at: number; team: string } | null = null;

const b64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

async function keys(team: string) {
  if (keyCache && keyCache.team === team && Date.now() - keyCache.at < 3600_000) return keyCache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error('读取 Access 公钥失败');
  const { keys: jwks } = (await r.json()) as { keys: (JsonWebKey & { kid: string })[] };
  const out: Record<string, CryptoKey> = {};
  for (const k of jwks) out[k.kid] = await crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  keyCache = { keys: out, at: Date.now(), team };
  return out;
}

/** 通过返回登录邮箱；不通过抛错 */
export async function verifyAccess(req: Request, env: Env): Promise<string> {
  const host = new URL(req.url).hostname;
  if (env.ACCESS_DEV_BYPASS === '1' && (host === 'localhost' || host === '127.0.0.1')) return 'dev@localhost';
  const team = env.ACCESS_TEAM_DOMAIN?.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const aud = env.ACCESS_AUD;
  if (!team || !aud) throw new Error('未配置 ACCESS_TEAM_DOMAIN / ACCESS_AUD，后台接口已锁定');
  const jwt = req.headers.get('cf-access-jwt-assertion');
  if (!jwt) throw new Error('缺少 Access 登录凭证');
  const [h, p, s] = jwt.split('.');
  const header = JSON.parse(new TextDecoder().decode(b64u(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64u(p)));
  const key = (await keys(team))[header.kid];
  if (!key) { keyCache = null; throw new Error('Access 公钥不匹配'); }
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('Access 签名无效');
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error('Access AUD 不匹配');
  if (payload.iss !== `https://${team}`) throw new Error('Access 签发方不匹配');
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) throw new Error('Access 登录已过期');
  return payload.email || payload.sub || 'unknown';
}
