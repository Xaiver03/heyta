# 代码库实测评估（v1.0）

> 方法：实际 clone 四个仓库到 `research/upstream/`，逐项扫描依赖许可证、统计代码量、核查模块结构。
> 核实时间：2026-09-25。**以下所有数字均为本机实测，非引用。**

---

## 0. 三个改变决策的发现

### 发现 1：⚠️ Super Productivity 的产物里含 AGPL 代码

| 项 | 值 |
|---|---|
| 包名 | `@nextcloud/cdav-library` |
| 版本 | 1.5.3 |
| License | **AGPL-3.0-or-later** |
| 声明位置 | 在 `package.json` 的 **devDependencies** 里 |
| **实际使用** | **被生产代码直接 import** |

证据链：
```
src/app/features/issue/providers/caldav/caldav-client.service.ts:4
    import DavClient, { namespaces as NS } from '@nextcloud/cdav-library';
```
该文件被 `caldav-sync-adapter.service.ts` → `issue.service.ts` 引用，**是应用主链路上的服务，不是测试代码**。
且未找到任何 externalize 或懒加载配置。

**含义**：
- Super Productivity 仓库 LICENSE 是 MIT，但**分发产物中极可能打包了 AGPL-3.0-or-later 组件**
- 这是**上游项目自身的许可证不一致**（仓库里没有任何说明或例外声明）
- **后果**：你 fork 全部代码并闭源分发，会继承这个 AGPL 义务。**"MIT = 可以随便闭源"这个假设，被一个依赖击穿了**

✅ **好消息**：这个包**只在 Angular app 层**，`packages/` 里完全没有它。

### 发现 2：✅ Super Productivity 的底层已经被拆成干净的独立包

`packages/` 目录是一套**完整的、模块化的、MIT 的本地优先同步栈**：

| 包 | 文件数 | 运行时依赖 | 说明 |
|---|---|---|---|
| `sync-core` | 42 | **2**（`@noble/ciphers`, `hash-wasm`） | **框架无关**：op-log 类型、向量时钟、冲突解决、gzip、**E2E 加密**（Argon2id + AES-256-GCM）。README 明确写 "no Angular/Electron/Capacitor dependencies" |
| `shared-schema` | 18 | 1（`zod`） | 共享数据 schema |
| `sync-providers` | 72 | 1（`hash-wasm`） | 同步provider（WebDAV / Dropbox / SuperSync） |
| `super-sync-server` | 148 | 17（全宽松） | **生产级同步服务端**：Fastify + Prisma + PostgreSQL、append-on-write 操作日志（事件溯源）、per-user `server_seq`、WebAuthn、Helm chart、Docker、监控 |
| `plugin-api` | 3 | 0 | MIT |

**依赖全部宽松许可，零 copyleft。**

→ **这就是你想要的那个"干净底层"，而且它已经写好了、跑在生产里了。**

### 发现 3：✅ Tududi 的依赖树比 Super Productivity 还干净

| | Super Productivity | Tududi |
|---|---|---|
| 包总数 | 1,993 | 1,742 |
| AGPL/GPL | **1 个（AGPL，且进了产物）** | **0 个** |
| 运行时 copyleft | — | 仅 3 个 **MPL-2.0**（`dompurify` 可选 Apache、`ical.js`、`web-push`） |
| MPL 风险 | — | ✅ 安全。MPL 是文件级 copyleft，只要不修改这些库的源文件就无义务 |

**Tududi 无任何 AGPL/GPL 污染。**

⚠️ 但注意：Tududi 后端已有 `billing/`（含 `stripeClient.js`、`subscriptionMapper.js`、`webhookRoutes.js`）、`feature-flags/`、`ai-assistant/`、`admin-ai-usage/`——**它本身就是一个正在做商业化的 open-core 项目**（README 里在卖 hosted subscription）。

---

## 1. 体量对比（实测）

| 项目 | 代码量 | 架构形态 |
|---|---|---|
| **Super Productivity** | `src/` 641,720 行 + `packages/` 128,095 行 + `electron/` 10,695 行 ≈ **78 万行** | 干净的分层包 + 庞大的 Angular 单体 App |
| **Tududi** | `backend/` 130,885 行 + `frontend/` 106,834 行 ≈ **23.7 万行** | 单体 Express（40 个平铺模块）+ React SPA |
| Vikunja | ~1,800 文件（Go 994 + Vue 806） | Go 后端 + Vue 前端，API 设计标杆 |
| Nextcloud Tasks | PHP，仅 19 个 php 文件 | 极薄，强绑定 Nextcloud |

**关键量化**：Super Productivity 的**干净底层只有约 280 个 TS 文件**，而"不好改的部分"是那 64 万行的 Angular App。
——**这正是"干净"与"快速"可以同时拿到的原因。**

---

## 2. 你那个矛盾的真正解法

你说："希望架构干净、底层优化好做，但又想快点跑起来"。

**这不是矛盾，是维度搞错了。** 干净和快不能全局同时成立，但**可以分层成立**：

| 层 | 该不该干净 | 为什么 | 用什么 |
|---|---|---|---|
| **同步协议 / 数据 schema** | 🔴 **必须干净** | 改一次要兼容所有历史客户端，**几乎不可逆**。这是整个产品最难改的东西 | ✅ 直接用 SP 的 `sync-core` + `shared-schema`（已验证干净、MIT、框架无关） |
| **服务端** | 🔴 **必须干净** | 要自建、要托管、要扛住多用户，架构错了要重写 | ✅ 直接用 `super-sync-server`（Fastify + Prisma + Postgres，生产验证过） |
| **领域逻辑**（重复规则、四象限归类、习惯 streak 语义） | 🟠 尽量干净 | 语义错了会渗透到 UI 和数据 | 自研 or 参考 |
| **UI 组件 / 主题** | 🟢 **可以脏** | 丑了以后再换，成本低 | 借 SP / Tududi，先用起来 |
| **平台壳**（Electron/Capacitor） | 🟢 可以脏 | 一次性适配 | 借现成的 |
| **第三方集成**（日历/通知） | 🟢 可以脏 | 可替换 | 借现成的 |

**结论：把"干净"投资在不可逆的地方（同步 + 数据 + 服务端），把"快"用在可替换的地方（UI + 壳）。**

而恰好——**不可逆的那一层，Super Productivity 已经写好并且是干净的。**

---

## 3. 修正后的路线建议

### ⭐ 推荐：取 `packages/` 当底层，UI 自己定

```
你的产品
├── 底层（直接复用，MIT，干净）
│   ├── @sp/sync-core        ← 冲突解决 + 向量时钟 + E2E 加密
│   ├── @sp/shared-schema    ← 数据模型
│   └── super-sync-server    ← 自建同步服务端（Fastify + Postgres）
├── 领域层（自研，参考 SP/Tududi）
│   ├── 重复规则 RRULE
│   ├── 四象限归类
│   └── 习惯 streak
└── UI 层（自研，或先借 SP 跑起来）
```

**为什么这是最优解**：
1. 拿到"干净底层"——而且不用自己写
2. 绕开 AGPL 地雷——`packages/` 里没有 `cdav-library`
3. 保留技术栈自由——`sync-core` 框架无关，你甚至可以用 Flutter 写 UI 去调它（或移植）
4. 可自建——`super-sync-server` 自带 Docker + Helm，正好是你"托管收费"的基础设施

### 备选 A：fork Super Productivity 全量

- ✅ 最快跑起来（全平台 App 已上架）
- ❌ 背 78 万行 Angular
- ❌ **继承 AGPL 污染**（必须自己重写 CalDAV provider）
- ❌ 改造 UI 的成本可能高于自研

### 备选 B：fork Tududi

- ✅ 依赖最干净（零 AGPL/GPL）
- ✅ 代码量最小，架构直白
- ⚠️ 但它是单体（40 个模块平铺），"架构干净"这条不太满足
- ⚠️ 原作者自己已在做商业化和 billing，你和他是同一条路上的竞争者
- ❌ 无原生 App

---

## 4. 立即可执行的下一步

- [ ] **精读 `packages/sync-core` 的冲突解决实现**（约 42 文件，一天可读完）——判断它是否真的适合当你的底层
- [ ] **评估 `sync-core` 与 Flutter/非 JS 前端的集成方式**（它是 TS 包；跨语言要么移植、要么做成 sidecar/本地服务）
- [ ] **实测 `super-sync-server` 能否独立 Docker 跑起来**
- [ ] 确认 `@nextcloud/cdav-library` 的 AGPL 是否真的进入发布产物（跑一次 `npm ci && build`，然后对产物做许可证扫描）
- [ ] 自研 CalDAV provider 时，改用宽松许可的客户端实现（不要用 `@nextcloud/cdav-library`）

---

## 5. 局限

- 依赖扫描基于 `package-lock.json` 的 license 字段，**未递归核对每个包的 LICENCE 原文**，也未包含非 npm 依赖（如 Gemfile、系统库）
- "AGPL 进入产物"是基于**源码 import 关系**推断，未做实际构建产物的扫描确认
- 未评估代码质量、测试覆盖度、可维护性（需要实际读代码）
- 未扫描 Go/PHP 项目（Vikunja / Tasks）的依赖许可证

---

*本报告结论基于本机实测。`research/upstream/` 已加入 `.gitignore`，不纳入版本控制。*
