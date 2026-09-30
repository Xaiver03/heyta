# PROGRESS — AI 审计 + 域名迁移到 waytofuture.cn + 管理后台

> 上一轮（补隐私闸门缺口）的记录在 git 历史里，已被本轮取代。

## 理解的目标／顺序／最大风险（≤10 行）

1. **三件事**（产品负责人原话）：① 检查 AI 功能是否做完整了；② 项目是不是需要管理后台
   （「SSOS 那个是不是可以直接照抄」）；③ 后端域名都改成 `waytofuture.cn` 的子域名并上线。
2. 顺序：先给 AI 结论（只读）→ 再迁域名（ICP 备案等着它）→ 最后做管理后台
   （它要动 schema，风险最高，放最后）。
3. 最大风险：**域名迁移会换掉 `WEBAUTHN_RP_ID`** —— 旧域名上已注册的 passkey 全部失效，
   不可两边兼容（与 2026-09-27 那次同一代价，已当面确认）。
4. 第二大风险：管理后台要**动 `users` 表**（加一列）且要**开一个新的攻击面**
   （能读全站用户与订单）。前者走迁移纪律，后者 fail-closed 默认关闭。
5. 只改：`server/**`、`packages/{i18n,app-host,ui}`、`apps/web/**`、`apps/landing/**`、
   `e2e/**`、`docs/**`。**不碰** `packages/ui/src` 那批别的会话正在改的未跟踪文件。
6. 算得对 > 改得少 > 做得快；拿不准进 `BLOCKED.md`，不停下等。

## 任务 0 基线（2026-09-30 实测）

| 命令 | 要求 | 实测 | 结论 |
|---|---|---|---|
| `pnpm --filter @heyta/sync-server test` | 全绿 | **1789 passed** / 1 skipped | ✅ |
| `pnpm --filter @heyta/web test` | 全绿 | **987 passed** / 12 skipped | ✅ |
| `pnpm --filter @heyta/app-host test` | 全绿 | **739 passed** | ✅ |
| `pnpm --filter @heyta/i18n test` | 全绿 | **10 passed** | ✅ |
| `pnpm check` | exit 0 | 🔴 **e2e `motivation.spec.ts` 2 红** —— 已用对照实验证明**与本次改动无关**，见 `BLOCKED.md` | ⚠️ 非本次造成 |

## 改动

### ① AI 功能完整度审计（只读）

- 新增 `docs/research/ai-feature-completeness-audit.md`。
- 结论：**本地自带端点（BYO-key）模式完整**；**托管/云 AI 是刻意受阻**，且受阻点
  （`retention-undecided` 运行时门禁、"300 次/月"配额未实现 + 禁售）全部仍在代码里。
- 真正的缺口 3 个：受保护条目 `readable:false` 没有产品机制（最严重，压在入站 AI
  的隐私承诺上）、"发特征不发原文"从未实现（文档债）、工具调用 P3/P4 未开始。

### ② 域名迁移 → `https://heyta.waytofuture.cn`（**已上线**）

- DNS（tccli `waytofuture` profile）→ nginx 新站点 → certbot（有效期至 2026-12-29）
  → 服务端 `.env` 五项 → 落地页 `VITE_*` 构建参数 → 应用重建。
- 动因是**备案倒逼**：腾讯云 ICP APP 备案三平台填报的就是这个域名，而备案要求
  填报的域名真的指向那台服务器。见 `docs/runbooks/deployment.md` §3.7.2。
- 顺带修掉一条**错误纪律**：`DEFAULT_SITE_ORIGIN` 说"换域名不要改这个常量"——
  那是错的，`check:entries` 会用默认值重生成再与提交物逐字节比对，必须一起改。

### ③ PWA 子路径缺陷（迁移验收时抓到的**预存在**缺陷）

- 应用挂在 `/app/` 下，但 `SW_URL` 写死 `/sw.js`、manifest 的 `start_url`/`scope`/`icons`
  也是根绝对路径 ⇒ 线上 `/sw.js` 与 `/icons/*.png` 返回**落地页 HTML**，
  SW 注册报 `SecurityError`、**PWA 装出来的入口是落地页**。
- 修法：`SW_URL` 由 `import.meta.env.BASE_URL` 派生；manifest 全部改**相对地址**
  （相对 manifest 自己解析 ⇒ 根路径与子路径同一份产物都对）。
- 变异验证：两处各自改回旧写法 ⇒ 对应测试转红。线上复验：SW 真的注册在 `/app/sw.js`，
  控制台从 2 条（含 SecurityError）变成 **0 条**。

### ④ 运营管理后台（**已上线**）

- 决策 `docs/adr/0038-admin-console-scope.md`：**抄 SSOS 的模式、不抄它的页面**。
  SSOS 那 42 个页面服务的是租户/税务/合规/Mailu，heyta 一个对应模型都没有。
- 权限：`users.is_admin BOOLEAN NOT NULL DEFAULT false`（迁移 `20261003000000_add_admin_flag`）。
  **没有人生来是管理员**；授权只能由 CLI 显式做。
- 范围：概览 / 用户 / 订阅 / 订单 / 优惠码 / 邀请 + **三个不碰钱的动作**
  （解锁、调配额、强制登出）。明确不做改订阅/退款/发券/群发通知。
- 闸门：插件级 `addHook('preHandler', requireAdmin)` ⇒ **新增路由忘了鉴权不可能**。

### ⑤ 新增的验收套件

- `e2e/playwright.live-site.config.ts` + `e2e/live-site/live-domain.spec.ts`：
  **线上**真浏览器验收 5 条（域名迁移、中英入口、凭据页同源、管理端点 401、PWA 子路径）。
  域名用 `--host-resolver-rules` 钉到真实 IP 并加 `--no-proxy-server` ——
  否则在这台开发机上验的是**本地代理**，代理一关就变成假绿。

## 进度

- [x] ① AI 审计报告落盘
- [x] ② 域名迁移上线 + 文档 §3.7.2
- [x] ③ PWA 缺陷修复 + 变异验证 + 线上复验
- [x] ④ 管理后台：ADR / 计划 / 迁移 / CLI / 后端 / 客户端 / 前端 / 测试
- [x] ④ 部署上线：迁移已应用、`/api/admin/overview` → 401、前端已上（均在容器里核实）
- [x] ⑤ 线上验收 5/5 绿；五道结构性门禁全绿
- [ ] ⚠️ **交还用户**：授权第一个管理员（需要用户指定账号邮箱）
- [ ] ⚠️ `pnpm check` 的 e2e 段 2 红 —— **预存在，非本次造成**，见 `BLOCKED.md`

## 交还用户的两件事

1. **授权第一个管理员**（后台现在是"锁着"的，这是设计）：
   ```bash
   ssh ubuntu-jcli 'sudo docker exec supersync-server node dist/scripts/admin.js list'
   ssh ubuntu-jcli 'sudo docker exec supersync-server node dist/scripts/admin.js grant <你的邮箱>'
   ```
   那个人必须**已经注册过**。⚠️ 服务器上**不要**用 `pnpm admin:grant`（镜像里是编译产物，
   生产装依赖带 `--omit=dev`，没有 `ts-node`）。
2. **ICP 备案的「提交审核」**：仍然只差用户本人那一下（三个同意项 + 视频核身），
   域名现在真的通了 —— 见 `docs/runbooks/icp-app-filing.md` §一。
