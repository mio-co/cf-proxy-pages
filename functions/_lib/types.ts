// 环境变量与绑定（在 Pages 项目 Settings 里配置，见 README）
export interface Env {
  RULES: KVNamespace;               // KV 绑定：反代规则
  PAGES_PROJECT?: string;           // 本 Pages 项目名，用于识别后台地址 <project>.pages.dev
  ADMIN_HOSTS?: string;             // 额外的后台域名，逗号分隔（可选）
  CF_ACCOUNT_ID?: string;           // 本 Pages 项目所在账号 ID（后台列出 / 添加自定义域名用）
  CF_API_TOKEN?: string;            // 权限：Account → Cloudflare Pages → Edit（加密变量）
  ACCESS_TEAM_DOMAIN?: string;      // Zero Trust 团队域名，如 myteam.cloudflareaccess.com
  ACCESS_AUD?: string;              // Access 应用的 AUD 标签
  ACCESS_DEV_BYPASS?: string;       // 仅本地开发：设为 1 时 localhost 跳过 Access 校验
}

export interface Rule {
  host: string;          // 接入域名（小写）
  target: string;        // 目标地址，如 https://name.sub.workers.dev 或带路径前缀
  enabled: boolean;
  note?: string;
  rewriteCookies?: boolean;  // 把 Set-Cookie 里的目标域名改成接入域名
  updatedAt?: string;
}
