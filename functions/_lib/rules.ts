// 规则存储：KV 键 r:<host>，值与 metadata 都是规则 JSON（metadata 让后台一次 list 拿全部）
import type { Env, Rule } from './types';

const PREFIX = 'r:';
const TTL_MS = 30_000;
const cache = new Map<string, { rule: Rule | null; at: number }>();

export const normHost = (h: string) => h.trim().toLowerCase().replace(/\.$/, '');

export async function getRule(env: Env, host: string): Promise<Rule | null> {
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rule;
  const rule = (await env.RULES.get<Rule>(PREFIX + host, { type: 'json', cacheTtl: 60 })) ?? null;
  cache.set(host, { rule, at: Date.now() });
  return rule;
}

export async function listRules(env: Env): Promise<Rule[]> {
  const out: Rule[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.RULES.list<Rule>({ prefix: PREFIX, cursor });
    for (const k of page.keys) {
      if (k.metadata) out.push(k.metadata);
      else { const r = await env.RULES.get<Rule>(k.name, 'json'); if (r) out.push(r); }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out.sort((a, b) => a.host.localeCompare(b.host));
}

export async function putRule(env: Env, rule: Rule) {
  const v = JSON.stringify(rule);
  await env.RULES.put(PREFIX + rule.host, v, { metadata: rule });
  cache.delete(rule.host);
}

export async function deleteRule(env: Env, host: string) {
  await env.RULES.delete(PREFIX + host);
  cache.delete(host);
}

/** 校验并规范化目标地址：只允许 https，不能指向本项目或接入域名自己 */
export function checkTarget(raw: string, host: string, adminHost: (h: string) => boolean): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error('目标地址格式不对，应类似 https://name.sub.workers.dev'); }
  if (u.protocol !== 'https:') throw new Error('目标地址必须是 https');
  if (u.search || u.hash) throw new Error('目标地址不能带 ? 或 #');
  const th = u.hostname.toLowerCase();
  if (th === host || adminHost(th)) throw new Error('目标地址不能指向本反代自己');
  return u.origin + u.pathname.replace(/\/+$/, '');
}
