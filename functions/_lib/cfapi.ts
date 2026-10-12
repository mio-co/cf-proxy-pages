// Cloudflare API：列出 / 添加 / 删除本 Pages 项目的自定义域名
import type { Env } from './types';

export const cfConfigured = (env: Env) => !!(env.CF_API_TOKEN && env.CF_ACCOUNT_ID && env.PAGES_PROJECT);

async function cf<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${env.PAGES_PROJECT}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'application/json' },
  });
  const data = (await r.json().catch(() => ({}))) as any;
  if (!r.ok || data.success === false) throw new Error(`Cloudflare API：${data?.errors?.[0]?.message || r.status}`);
  return data.result as T;
}

export interface PagesDomain { name: string; status: string; verification_data?: { status?: string; error_message?: string }; validation_data?: { status?: string; error_message?: string }; created_on?: string }

export const listDomains = (env: Env) => cf<PagesDomain[]>(env, '/domains');
export const addDomain = (env: Env, name: string) => cf<PagesDomain>(env, '/domains', { method: 'POST', body: JSON.stringify({ name }) });
export const removeDomain = (env: Env, name: string) => cf<unknown>(env, `/domains/${encodeURIComponent(name)}`, { method: 'DELETE' });
