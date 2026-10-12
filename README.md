# cf-proxy-pages

部署在 Cloudflare Pages 上的多域名反代：每个接入域名对应一个目标 Worker（可以在别的 Cloudflare 账号），后台在本项目自带的 `<项目名>.pages.dev` 地址上，由 Cloudflare Access 保护。

```
访客 → api.a.com / b.com（都绑在这个 Pages 项目）
      → functions/_middleware.ts 看 Host
          ├─ <项目名>.pages.dev → 后台页面 public/index.html + /api/*（需 Access）
          └─ 其他域名 → KV 查规则 → fetch 目标 Worker → 原样返回
```

## 功能
- 后台列出本 Pages 项目已绑定的自定义域名和状态（active / pending…），可直接添加、解绑。
- 每个域名手动填目标地址（只允许 https，可带路径前缀），可停用、写备注、测试连通。
- 转发：路径、参数、方法、请求体原样转发；WebSocket 透传；带 `X-Forwarded-Host`、`X-Forwarded-Proto`、`X-Real-IP`。
- 响应：`Location` 里的目标域名换回接入域名；可选改写 `Set-Cookie` 的 Domain。
- 未配置的域名返回 404，已停用返回 503；检测到循环返回 508。
- 规则改动约 1 分钟内全球生效（KV 最终一致 + 边缘节点 30 秒内存缓存）。

## 部署
1. **KV**：Workers & Pages → KV → 新建命名空间（如 `proxy-rules`）。
2. **Pages 项目**：Workers & Pages → 创建 → Pages → 连接这个 GitHub 仓库。
   - 框架预设：无；构建命令：留空；输出目录：`public`。
3. **绑定与变量**（项目 → 设置）：
   | 名称 | 类型 | 值 |
   |---|---|---|
   | `RULES` | KV 绑定 | 第 1 步的命名空间 |
   | `PAGES_PROJECT` | 变量 | Pages 项目名（后台调 API 用；后台地址固定是本项目的 `*.pages.dev`） |
   | `CF_ACCOUNT_ID` | 变量 | 本账号 ID |
   | `CF_API_TOKEN` | 密钥 | API Token，权限：账户 → Cloudflare Pages → 编辑 |
   | `ACCESS_TEAM_DOMAIN` | 变量 | Zero Trust 团队域名，如 `myteam.cloudflareaccess.com` |
   | `ACCESS_AUD` | 变量 | Access 应用的「应用程序受众 (AUD) 标记」 |
   | `ADMIN_HOSTS` | 变量（可选） | 额外的后台域名，逗号分隔 |

   `CF_*` 三项不填也能用，只是后台不显示绑定状态，域名要去面板手动加。改完变量要重新部署一次。
4. **Access**：Zero Trust → Access → 应用程序 → 添加 → 自托管，域名填 `<项目名>.pages.dev`，再加一条 `*.<项目名>.pages.dev`（预览地址）。策略按需（如只允许你的邮箱）。复制 AUD 填到第 3 步。
   **只保护 pages.dev 地址，不要把接入域名加进 Access**，否则访客会被拦。没配好 Access 变量时，后台接口一律拒绝。
5. **接入域名**：后台填「接入域名 + 目标 Worker」→ 添加（会自动加进 Pages 自定义域名）→ 到域名所在账号的 DNS 加 `CNAME 接入域名 → 本项目的 pages.dev 地址`（以 Pages 面板显示的为准，重名时会带随机后缀，如 `cf-proxy-924.pages.dev`）→ 等状态变 active。

## 注意
- **根域名（如 `a.com`）只能接入和本 Pages 同一账号里的 zone**；别的账号只能接子域名（`www.a.com`、`api.a.com`），用 CNAME 接入。这是 Cloudflare Pages 的限制。
- 域名所在 zone 如果有 CAA 记录，需要放行 Cloudflare 用的证书机构，否则证书签不出来。
- 免费版每个 Pages 项目最多 100 个自定义域名。
- 每次请求会同时计入本账号 Pages Functions 和目标账号 Worker 的请求额度。
- 目标 Worker 看到的 Host 是它自己的域名；原始域名在 `X-Forwarded-Host`。
- 只用于反代你自己的 Worker。

## 本地开发
```bash
npm install
npm run dev     # http://127.0.0.1:8788 是后台（跳过 Access）；curl -H 'Host: a.test' 测反代
npm run check   # TypeScript 检查
```
