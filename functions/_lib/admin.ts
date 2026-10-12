// 后台接口 /api/*（只在后台域名上响应，并且要求通过 Cloudflare Access）
import type { Env, Rule } from './types';
import { verifyAccess } from './access';
import { listRules, putRule, deleteRule, normHost, checkTarget } from './rules';
import { cfConfigured, listDomains, addDomain, removeDomain } from './cfapi';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export async function handleAdmin(req: Request, env: Env, isAdminHost: (h: string) => boolean): Promise<Response> {
  let email: string;
  try { email = await verifyAccess(req, env); } catch (e: any) { return json({ error: e.message }, 401); }
  if (!env.RULES) return json({ error: '未绑定 KV（变量名 RULES）' }, 500);

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [res, id] = parts;
  try {
    if (res === 'me' && req.method === 'GET') {
      return json({ email, project: env.PAGES_PROJECT || null, cname: env.PAGES_PROJECT ? `${env.PAGES_PROJECT}.pages.dev` : null, cfApi: cfConfigured(env) });
    }

    // 总览：Pages 已绑域名 + 规则，合并成一张表
    if (res === 'overview' && req.method === 'GET') {
      const [rules, domains] = await Promise.all([listRules(env), cfConfigured(env) ? listDomains(env) : Promise.resolve(null)]);
      const map = new Map<string, any>();
      for (const d of domains ?? []) map.set(d.name, { host: d.name, domain: d, rule: null });
      for (const r of rules) map.set(r.host, { ...(map.get(r.host) ?? { host: r.host, domain: null }), rule: r });
      return json({ items: [...map.values()].filter((x) => !isAdminHost(x.host)).sort((a, b) => a.host.localeCompare(b.host)), cfApi: domains !== null });
    }

    if (res === 'rules' && id) {
      const host = normHost(id);
      if (!HOST_RE.test(host)) return json({ error: '域名格式不对' }, 400);
      if (isAdminHost(host)) return json({ error: '后台域名不能设置反代' }, 400);
      if (req.method === 'PUT') {
        const body = (await req.json()) as Partial<Rule>;
        const rule: Rule = {
          host,
          target: checkTarget(String(body.target ?? ''), host, isAdminHost),
          enabled: body.enabled !== false,
          note: String(body.note ?? '').slice(0, 200),
          rewriteCookies: !!body.rewriteCookies,
          updatedAt: new Date().toISOString(),
        };
        await putRule(env, rule);
        return json({ ok: true, rule });
      }
      if (req.method === 'DELETE') { await deleteRule(env, host); return json({ ok: true }); }
    }

    if (res === 'domains' && cfConfigured(env)) {
      if (req.method === 'POST' && !id) {
        const { name } = (await req.json()) as { name?: string };
        const host = normHost(String(name ?? ''));
        if (!HOST_RE.test(host)) return json({ error: '域名格式不对' }, 400);
        return json({ ok: true, domain: await addDomain(env, host) });
      }
      if (req.method === 'DELETE' && id) { await removeDomain(env, normHost(id)); return json({ ok: true }); }
    }

    // 测试目标是否可达
    if (res === 'test' && req.method === 'POST') {
      const { target } = (await req.json()) as { target?: string };
      const t = checkTarget(String(target ?? ''), '', isAdminHost);
      const started = Date.now();
      const r = await fetch(t + '/', { method: 'GET', redirect: 'manual', headers: { 'x-cfp-hop': '1' } });
      return json({ status: r.status, ms: Date.now() - started });
    }
    return json({ error: '接口不存在' }, 404);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 400);
  }
}
