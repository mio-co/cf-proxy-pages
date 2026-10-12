// 反代：按访问的域名找规则，把请求原样转给目标 Worker
import type { Env, Rule } from './types';
import { getRule, normHost } from './rules';

const HOP = 'x-cfp-hop';
// 不往上游带的请求头：Cloudflare 自己的 cf-*、逐跳头，以及由我们重写的转发头
const DROP = /^(cf-|x-forwarded-|x-real-ip$|connection$|keep-alive$|proxy-|te$|trailer$|transfer-encoding$)/i;

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

export async function proxy(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const host = normHost(url.hostname);
  if (req.headers.get(HOP)) return text(508, '检测到反代循环');
  const rule = await getRule(env, host);
  if (!rule) return text(404, `${host} 尚未配置反代规则`);
  if (!rule.enabled) return text(503, `${host} 的反代已停用`);

  const target = new URL(rule.target);
  const upstream = new URL(target.origin);
  upstream.pathname = target.pathname.replace(/\/+$/, '') + url.pathname;
  upstream.search = url.search;

  const headers = new Headers();
  for (const [k, v] of req.headers) if (!DROP.test(k) && k !== 'host') headers.set(k, v);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
  const ip = req.headers.get('cf-connecting-ip');
  if (ip) { headers.set('x-real-ip', ip); headers.set('x-forwarded-for', ip); }
  headers.set(HOP, '1');
  // WebSocket 升级需要保留 Upgrade / Connection
  const isWs = req.headers.get('upgrade')?.toLowerCase() === 'websocket';
  if (isWs) { headers.set('upgrade', 'websocket'); headers.set('connection', 'Upgrade'); }

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  let resp: Response;
  try {
    resp = await fetch(upstream.toString(), { method: req.method, headers, body: hasBody ? req.body : undefined, redirect: 'manual' });
  } catch (e: any) {
    return text(502, `上游请求失败：${e?.message || e}`);
  }
  if (resp.status === 101 || (resp as any).webSocket) return resp;
  return rewriteResponse(resp, rule, target, url);
}

function rewriteResponse(resp: Response, rule: Rule, target: URL, url: URL): Response {
  const out = new Headers(resp.headers);
  // 跳转地址里的目标域名换回接入域名
  const loc = out.get('location');
  if (loc) {
    try {
      const l = new URL(loc, target);
      if (l.host === target.host) {
        const prefix = target.pathname.replace(/\/+$/, '');
        let p = l.pathname;
        if (prefix && p.startsWith(prefix)) p = p.slice(prefix.length) || '/';
        out.set('location', `${url.protocol}//${url.host}${p}${l.search}${l.hash}`);
      }
    } catch { /* 保持原样 */ }
  }
  if (rule.rewriteCookies) {
    const cookies = (resp.headers as any).getSetCookie?.() as string[] | undefined;
    if (cookies?.length) {
      out.delete('set-cookie');
      const re = new RegExp(`;\\s*domain=\\.?${target.hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      for (const c of cookies) out.append('set-cookie', c.replace(re, `; Domain=${url.hostname}`));
    }
  }
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: out });
}
