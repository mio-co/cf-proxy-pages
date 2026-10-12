// 全站入口：后台域名 → 后台页面与 /api/*；其他域名 → 按规则反代
import type { Env } from './_lib/types';
import { handleAdmin } from './_lib/admin';
import { proxy } from './_lib/proxy';

function adminHostMatcher(env: Env) {
  const extra = (env.ADMIN_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return (h: string) => {
    h = h.toLowerCase();
    // 任何 *.pages.dev（生产地址与预览地址）都是后台：接入的自定义域名不可能是 pages.dev，不再依赖 PAGES_PROJECT 填对
    return h === 'localhost' || h === '127.0.0.1' || extra.includes(h) || h.endsWith('.pages.dev');
  };
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const isAdminHost = adminHostMatcher(ctx.env);
  if (isAdminHost(url.hostname)) {
    if (url.pathname.startsWith('/api/')) return handleAdmin(ctx.request, ctx.env, isAdminHost);
    const res = await ctx.next();   // 后台静态页面（public/）
    const h = new Headers(res.headers);
    h.set('x-robots-tag', 'noindex');
    h.set('x-frame-options', 'DENY');
    return new Response(res.body, { status: res.status, headers: h });
  }
  return proxy(ctx.request, ctx.env);
};
