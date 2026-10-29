# 开工单：自动收集（inbound automation）还缺什么 —— 交给执行 AI

> **这份文件只回答三件事**：① 这一档要做成什么；② 现在到底缺哪几格（每条带可复跑的现量）；③ 按什么顺序做、每步的判据是什么。
> **裁决与进度不在这里**：唯一实施计划是 [`inbound-automation.md`](inbound-automation.md)（文末是逐格台账，4400+ 行），
> 那条线自己的证据台账交接书是 [`inbound-automation-handoff.md`](inbound-automation-handoff.md)，
> 逐条阻塞在 [`../../BLOCKED.md`](../../BLOCKED.md)，仓库纪律在 [`../agents/`](../agents/)。
> 本文件**不新立判据、不改任何判卷口径、不替代上面任何一份**。与它们冲突时，以它们为准，并把冲突回报给负责人。
> 写成于 2026-10-27，交付 tip 现量 `git rev-parse --short refs/heads/main`。

---

## 0. 接手第一件事：跑这五条，别信这份文件里的任何数字

```bash
date
git rev-parse --short refs/heads/main                       # 本仓 main 每小时被别人推
grep -cE '^- \[x\] \*\*AC-' docs/plans/inbound-automation.md # AC 已勾数（本文写作时：0）
grep -cE '^- \[ \] \*\*AC-' docs/plans/inbound-automation.md # AC 未勾数（本文写作时：8）
python3 research/tools/verify-inbound-ac-battery.py --root . --list | wc -l  # 在册 AC 腿枚数
```

🔴 **本文里凡"某处有一个/零个消费者"这类话，都给了现量命令**。共享工作树里别人在并行动代码，
按行号引会指错对象——落笔前先 `grep` 复现，复现不了就以现量为准并改本文，**不要按本文的说法去改代码**。

---

## 1. 这一档要做成什么（判据意义上的定义，不是"写了什么"）

用户在 **设置 → AI 与集成 → 自动收集** 里建一条规则（来源密钥、目标清单、时区、允许字段、条数上限、暂停开关），
系统给他一个**公网回调地址** + 一把发送方密钥。外部服务（监控告警、表单、工单、会议纪要、issue……）
往那个地址 POST **JSON 或文本**，服务端只做三件事：验签 → 加密暂存 → 回 `202 queued`。
然后用户**某一台已授权设备**上的 worker 领取事件、解开密文、用 AI 解析成待办（标题/日期/清单）、
按规则落库，再回执。**全程用户不需要动手粘贴。**

收费的是"**无人值守 + 服务器替你收**"：`hosted-ai-monthly`（¥12／$12）这一档授予的能力含 `automation`
（现量：`grep -n "hosted-ai-monthly" server/src/billing/price-book.ts`，那一行的 `SKU_GRANTS`）。

**首版边界（不许越）**：只收 JSON 与 UTF-8 文本；不收附件、不做 OCR、不抓网页、不直接收音频。
🔴 **"邮件转待办"不在首版里** —— 这是产品负责人要单独拍的一格（见 §6 第 5 格），别自作主张加。

一条硬判据贯穿全档：**接收成功 ≠ 任务已创建**。中间任何一环失败都必须有用户可见的确定终态与原因。

---

## 2. 缺口总表（四类；谁能让它消失）

| 类 | 缺什么 | 谁能消 |
|---|---|---|
| **A 代码** | 九格：客户端接线、界面文案、两处计量/清扫没接、env 表面缺口（§3） | **执行 AI 能做**（除 A2 的原生壳那部分要打包机） |
| **B 配置** | 生产上那 8 枚 env 一枚都没配，接收面等于关着（§4） | 执行 AI 可准备，**落地那一步要负责人点头**（对外可见） |
| **C 验收** | AC-1～AC-8 **一格没勾**（现量见 §0） | 证据由 AI 交，**勾由负责人点** |
| **D 对外口径** | 帮助中心/价格页/条款里"尚未上线"那批句子，上线时要逐处改（§5） | AI 改文，**发布前负责人过一遍** |

---

## 3. A 组：代码缺口（逐条给落点与判据）

那条线的交接书 §1 写着"**代码层是齐的，缺的全是证据 + 人 + 机器**"。
🔴 **这句按现量要收窄**：协议库层确实齐（`packages/inbound-core`、`packages/app-host` 那十几枚 `inbound-*.ts`），
但**客户端有几条腿是"库写完了、生产里一个调用者都没有"**，那是代码缺口，不是证据缺口。逐条：

### A1 权益票据与 session 心跳：三条腿零生产消费者

> ✅ **本单 §7 第 6 步按第二支落**（2026-10-27）：这一档本版本不支持，**代码一行没改**。现量 `grep -rn "selfhost-online" apps packages --include='*.ts' --include='*.tsx'` 去掉 dist 与测试只命中`packages/app-host/src/admin-client.ts` 一句注释 ⇒ 本节的"零生产消费者"仍成立，而"界面别露出"那一半本来就已成立；缺的那半（对运维说清配了也不会通）写进了 `docs/runbooks/self-host.md` §2.5 那张表。
- `createAutomationTicketSource`（取动作票）：`grep -rn createAutomationTicketSource --include='*.ts' packages apps server | grep -v /dist/`
  ⇒ 只命中定义、`index.ts` 的 re-export、`packages/app-host/tests/`。**没有宿主用它。**
- `startAutomationSessionKeepalive`（计划里那句"各宿主每 30 秒续票据"）：同样只被自己的 spec 引用。
- `createAutomationInstallationMetaStore` / `loadOrCreateAutomationInstallationId`（取票前提的安装身份）：同样只有测试。
- 后果：`AUTOMATION_ENTITLEMENT_MODE=selfhost-online` 那一档**在真机上拿不到放行**（各端只会 402）。
  `official` 模式不看票，所以官方托管实例不受这条影响。
- **判据形状**：接完至少要有"某宿主在 selfhost-online 下领到一条事件并落库"的一枚用例，
  且有一枚反向臂（摘掉票供给 ⇒ 那用例红）。**别只补代码不补臂**。

### A2 各宿主的 worker 生命周期：只有两端真的在跑，而且都是"前台才跑"

> ✅ **表里"只有两端"这句按当前树要读成三端**：`apps/node-host` 的 `worker run` 那条启动腿已闭合（回执第 4 项）。iOS / Android 那行的两件事**依旧成立**——后台无腿、且不建收件密钥。
| 端 | 现状（现量） | 缺什么 |
|---|---|---|
| 浏览器 `apps/web` | `grep -rn startInboundWorkerLoop apps` ⇒ 唯一生产调用点 `apps/web/src/features/settings/InboundAutomationSettings.tsx`（挂在设置节组件的 `useEffect` 上，`isRunnable` 读 `document.visibilityState`） | **离开设置视图即停、标签页不可见即停**；没有 ServiceWorker 那条腿（`grep -rn "inbound\|automation" apps/web/src/pwa` 回空，`e2e/playwright.inbound.config.ts` 还显式 `serviceWorkers: 'block'`） |
| iOS / Android（共享 RN JS） | `grep -rn startMobileInboundWorker apps/mobile/src` ⇒ `src/App.tsx` 启动、`src/inbound/lifecycle.ts` 里 `isRunnable` = `AppState==='active'` | **后台无腿**；且它不建收件密钥（没有就静默 return），必须先在一台别的设备上建过 |
| node 宿主 | `grep -rn "startInboundWorker\b" apps/node-host` ⇒ `src/host.ts` 有实现，**调用者只有 `tests/host.spec.ts`** | **那台"永远在线"的机器没人替它把循环打开**（CLI 无命令、local-api 无入口）——这是全表里性价比最高的一格 |
| Electron 桌面 `apps/desktop` | `grep -rni inbound apps/desktop/src` 回空 | 主进程零接线，壳里退化成浏览器那一档 |
| macOS / Windows / Linux 原生壳 | `grep -rli inbound apps/desktop-macos/Sources apps/desktop-windows` 回空 | 零接线（这三壳目前只是窗口/小组件壳） |

⚠️ **"页面开着才处理"这句话现在还没对外说过**。要么补腿，要么在 §5 的对外件里明写这条边界——
两者选一，不许两头都不做。

> ✅ **2026-10-27 负责人拍了"明写边界"这一头，两枚代码腿已入库**：web 那条循环从设置面板提到
> 应用级（离开设置视图不再停摆），移动壳那格"这台设备还没准备好接收"从静默 return 变成渲出原因。
> 界面句子与对外成稿都在 §5.1；表里 Electron 与三枚原生壳那两行**仍是零接线**，
> 而那不影响这句边界的真实性——它们本来就归"这台设备开着 heyta 时"那一档。
> 🔴 为什么不补后台腿，三条实测理由写在 §5.1，别在本节重推导。

### A3 `waiting-entitlement` 到界面是一条**空白文案**

> ✅ **整格闭合**：中英两档词条、web 的映射与那枚加严到钉句子的用例，以及下面那条"mobile 更彻底"的缺口（设置面里新增一行终态，testID 是 `inbound-cycle-state`）。本节引用的 `InboundAutomationSettings.tsx`现在住在 `apps/web/src/features/settings/`。
- 库层有这个状态（`packages/app-host/src/inbound-process.ts` 的 `InboundAutomationCycleState`）；
- 界面渲染处 `InboundAutomationSettings.tsx` 的 `PROCESS_COPY` 不含这一态 ⇒ 正文为空；
- 词条确实缺：`grep -n "process.waiting" packages/i18n/src/locales/zh-CN.ts` 回空。
- 现成证据：那条渲染用例只钉了"不崩、不回成处理失败"，**没钉文案** ⇒ 补文案时顺手把这枚判据加严。
- mobile 更彻底：`apps/mobile/src/inbound/lifecycle.ts` 把周期结果整个丢弃，用户什么都看不到。
- 🔴 改文案走 `packages/i18n` 唯一事实源，中英两档都要，界面里不许硬编码。

### A4 托管 AI 额度**疑似一次扣两下**（本文最该先证伪/证实的一格）

> ✅ **已修**（2026-10-29，提交 `9904fb671`）：修法取「预留那一侧为权威」——代理侧扣费前原子认领一枚
> `state='sent'` + `managed` + 未被认领 + 5 分钟内的尝试（`FOR UPDATE SKIP LOCKED`），领到即跳过；
> 认领标记 `automation_ai_attempts.proxy_billed`（可空、无默认、无索引）。用例从钉 +2 改成钉 +1，
> 并改正了它"先发请求后 CAS"的顺序错误；新增两臂（同一枚预留只认领一次 / 两趟周期 = +2）。
> 变异臂实测：摘认领 ⇒ 3 红，摘"只认领一次" ⇒ 1 红。本节原文保留作历史。

> 🔴 **"疑似"已升成"确证"**（真 PGlite + 真代理路由，逐字读数在回执第 2 项）：一次 managed 周期 `ai_usage_counters.requests` = **+2**，而上游只命中 1 次。摘哪一个扣点动的是计费口径 ⇒ 仍归 §6 第 3 格，本节原文一字未改。
- 预留那一次：`server/src/automation/ai-metering.ts` 里 `billingSource==='managed'` 时调 `consumeManagedAiRequest`；
- 真调用又一次：worker 走 `invokeRouted` ⇒ `packages/ai/src/wire.ts` 的 `managedChatUrl()` ⇒ `POST /api/ai/managed/chat` ⇒
  `server/src/ai/managed-proxy.routes.ts` 里再调一次 `consumeManagedAiRequest`；
- `grep -n automation server/src/ai/managed-proxy.routes.ts` ⇒ **没有任何"这条是自动化预留过的就别再扣"的特判**。
- **动手方式**：先写一枚**能红**的用例（同一事件 managed 一次完整周期 ⇒ 计数器 +1 还是 +2），
  再决定修哪一头（要么把 `inbound-automation` 从 managed-proxy 的扣费路径上摘出去，要么让 attempt 账本成为唯一权威）。
  ⚠️ 这动的是计费口径，属**判据口径**那一格 ⇒ **改法要报负责人拍，别代拍**（见 §6 第 3 格）。

### A5 实例退役清扫没接进每日任务

> ✅ **已接**进 `server/src/sync/cleanup.ts`，并配了会红的判据（`server/tests/cleanup-automation-sweeps.spec.ts`）。本节末那条"搁置令要不要问负责人"**当场判掉了**：它约束的是 2026-10-12 那场会话自己的地界 ⇒ §6 第 4 格不再是待拍的事。
- 函数有：`purgeRetiredAutomationEntitlementClocks`（`server/src/automation/entitlement-ticket.ts`）；
- 调用者：`grep -rn purgeRetiredAutomationEntitlementClocks server/src` ⇒ **只有定义那一行**；
  `server/tests/automation-clock-retirement.pglite.spec.ts` 测的是函数本身，不测它被不被调。
- 落点在同文件邻居：`server/src/sync/cleanup.ts` 已经把 `purgeExpiredAutomationEvents` 与
  `purgeExpiredAutomationEntitlementTicketUses` 接进去了，照那一格的形状接第三枚。
- ⚠️ 计划里登记过"`cleanup.ts` 在本线白名单之外 ⇒ 只登记需求，不代改"。**那条搁置令是否仍生效要问负责人**；
  他没解就说，别自己扩地界。

### A6 "正文保留 7 天"这句话没有一把对账尺

> ✅ 尺已加进 `scripts/check-retention-window-parity.mjs`：`--self-test` 的臂数由脚本自己打印、两种不等分开报错，并已挂在 `pnpm check` 链里。加尺前按本仓规矩 grep 过，**没有明文否掉它**。
- `scripts/check-retention-window-parity.mjs` 现在只对齐两枚 45 天窗口，不含 inbound 那枚 7 天常量
  （现量：`grep -n "inbound\|automation\|7" scripts/check-retention-window-parity.mjs`）。
- 承诺写在 `docs/reference/inbound-automation-protocol.md`。**加尺前先 grep 仓内有没有明文否掉它**（本仓规矩）。

### A7 env 表面缺口：八枚里只登记了两枚

> ✅ `server/env.example` 现在**八枚全在**（现量 `grep -c "^AUTOMATION" server/env.example`），运维件 `docs/runbooks/deployment.md` §3.5.1 与 `self-host.md` 各增一节。**helm 那一格没做**，理由在回执末段。
- 读取点：`grep -rn "process.env.AUTOMATION" server/src`（模式/钥匙环/签发三件套/HMAC keyring/发送 KEK/提交回执 keyring 等）；
- `server/env.example` 里只有 `AUTOMATION_COMMIT_KEYS` 与 `AUTOMATION_WEBHOOK_KEYS`（现量 `grep -n AUTOMATION server/env.example`）；
- `server/helm/`、`server/deploy/`、`docs/runbooks/deployment.md` 对 `AUTOMATION` **零提及**（现量 `grep -rl AUTOMATION server/helm server/deploy docs/runbooks`）。
- ✅ 一条以前会骗人的形状**已经改掉了**（2026-10-28 负责人拍「3-B」）：`AUTOMATION_ENTITLEMENT_MODE` **写错值现在就是启动红** ——
  端口绑定之前退出、`rc=1`、日志点名；**未配置/留空仍合法**（各端拿 402 带 `reason=ENTITLEMENT_MODE_UNCONFIGURED` 那一档）。
  三条现量与守它的尺（`server/tests/automation-boot-gate.spec.ts`）记在计划文末③那一节；运维件两份同批改口径。

### A8 一份类型定义住两处

> ✅ 已收到一处：定义只在 `packages/app-host/src/inbound-host-options.ts`，`host.ts` 只剩一行 `import type`。
`InboundAutomationHostOptions` 在 `packages/app-host/src/inbound-host-options.ts` 与 `host.ts` 里各有一份逐字副本
（`index.ts` 只导出前一份）。纯清理，改完 `pnpm --dir packages/app-host typecheck` 即判据。

### A9 界面上还缺的四件小事
事件列表无分页且上限处无提示、事件的 `reasonCode` 不展示给用户、发送方 secret 只在签发那一刻留在内存里
（关掉面板就不能再试发同一条凭据）、mobile/原生端没有规则 UI（连"看规则"都没有）。

> ✅ **四件全做**（2026-10-29，提交 `28a96ab8a`）：
> ① 到顶渲一行"只显示最近 {limit} 条"，`limit` 与服务端取数共用 `INBOUND_EVENT_LIST_LIMIT`（分页没做：
> 服务端没有游标，造假分页就是第二个事实源）；
> ② `REASON_COPY` 按服务端真会写的五档翻人话，表外码不编句；
> ③ 试发那句常驻说明（secret 只活在签发那一次，要再试发必须重新签发 —— 这是凭据契约，不是缺陷）；
> ④ 手机新增 `inbound/rules-store.ts`，前台按绑定拉一次规则清单、只留展示四样；设置面读 store、仍不发请求。
> 判据：`apps/web/tests/inbound-events-reason-cap.spec.tsx`（3 枚，两枚变异臂各红 2 条）＋
> `apps/mobile/tests/inbound-cycle-display.spec.ts` 扩 3 枚（18 枚绿）。

---

## 4. B 组：生产上开起来要配什么（顺序即风险）

> ✅ **2026-10-29 已开（env 级，未换镜像）**：生产 `docker-compose.yml` 的白名单原比仓库旧（8 个键一个都没有）；
> 备份两份文件后补上白名单，`.env` 写入 `AUTOMATION_ENTITLEMENT_MODE=official` + `AUTOMATION_SENDER_KEK` +
> `AUTOMATION_COMMIT_KEYS`（密钥只在远端生成、不回显），用**现有镜像**重启 ⇒ 容器内 8 枚、模式 official、健康；
> 公网匿名戳 `/api/automation/v1/hooks/<uuid>` 从 402 变成 **400 INVALID_REQUEST**（模式闸门不再是第一道）。
> 原件 `~/.heyta-evidence/inbound-bgroup-20261029/evidence.md`。
> ⚠️ 新代码（A4/A9）不在线上镜像里，随下一次正常发布；下面那条"开完必须有人真走一遍"仍归负责人。

**本文写作时（2026-10-27）线上那台容器的现量**：`MANAGED_AI_*` 四枚已配；
`AUTOMATION_ENTITLEMENT_MODE` / `ENTITLEMENT_GATE_ENABLED` / 任何 `AUTOMATION_WEBHOOK_KEYS` **都没配**；
匿名戳接收端点 `POST /api/automation/v1/hooks/<ruleId>` ⇒ **401 `invalid_webhook_signature`**（零写入）。
⇒ 前端产物里那节「自动收集规则」用户看得见、点得动，**后面什么都不会发生**。这是当前最尖锐的错位。

官方实例（`official` 模式）最小集是三枚，**不是两枚**：

| env | 缺了会怎样 | 形状 |
|---|---|---|
| `AUTOMATION_ENTITLEMENT_MODE=official` | 一切自动收集请求 402 + `reason=ENTITLEMENT_MODE_UNCONFIGURED` | 只接受 `official`/`selfhost-online`；**写错 ⇒ 请求期 500** |
| `AUTOMATION_SENDER_KEK` | 签发发送方凭据 409；接收路径解密失败被吞成 401 | 必须 64 位小写 hex |
| `AUTOMATION_COMMIT_KEYS` | 第一次提交许可就抛 ⇒ 403，**任务永远落不了库** | JSON keyring |

`AUTOMATION_WEBHOOK_KEYS` 只在"用部署级 legacy 密钥"时才需要；**走托管凭据（界面上签发那条）就不用配它**。
selfhost-online 另需 `AUTOMATION_OFFICIAL_KEYS`，官方签发端另需 `AUTOMATION_OFFICIAL_PRIVATE_KEY` +
`AUTOMATION_OFFICIAL_ISSUER` + `AUTOMATION_OFFICIAL_KEY_ID`（三缺一 ⇒ 签发面六条路由全 403）。

🔴 **落地这四条纪律**：
1. **顺序不许反**：照 [`../runbooks/deployment.md`](../runbooks/deployment.md) —— 备份在前 → 迁移 → 服务端换容器 → web → 边缘 → 线上验收。
   迁移只走 `cd server && sh scripts/migrate-deploy.sh`，**不用 `prisma migrate deploy`，永不改已应用的迁移**。
2. **密钥不在仓里出现**：不进 git、不进台账、不进日志、不进邮件；文档里只写"键名 + 形状"。
   生成规程写在运维件，取证文件里只留"已配 = true"这种布尔对账（本仓那条脱敏纪律）。
3. **开之前先量影响面**：`ENTITLEMENT_GATE_ENABLED` 与 automation 无关（automation 永远要求付费 grant，
   见 `server/src/entitlement.ts` 里那句注释），**不要顺手打开它** ——
   本文写作时线上 `users=11、subscriptions=0、checkout_orders=0`，一开就把在册全部账号（含负责人自己）的同步断掉。
4. **开完必须有人真走一遍**：建规则 → 试发 → 事件进队列 → 某台设备领到 → 待办出现 → 回执可见。
   截图归负责人看（"人打开看过"那一格不许 AI 代看）。

---

## 5. D 组：对外口径要逐处改的地方（上线那天才动）

> ✅ **2026-10-29 六格已按 §5.2 定稿落进源码（提交 `06798bf3a`），一处未发**：三份法务件 × 中英六处换成同一份
> 逐类列举（八组）并新增"当场抽取"与"7 天"两句；《AI 与数据流转》出站点 5→6 并加自动收集那一行；
> 《第三方清单》加"同一枚供应商、不新增接收方"；帮助中心 `s3*` 从"规划中"改成现值；五份件版本行/日期/变更记录同批。
> 门禁：legal-copy-parity（登记 0 / 问题 0）、i18n-vars、gen-site-copy --check 全绿。
> 🔴 **发布仍归负责人**（站点点发布那一步没做）；价格页那格是条件格，本轮**没写**。

| 件 | 现在写的是什么 | 上线时要改成 |
|---|---|---|
| 帮助中心那篇（`apps/landing/src/site/docs.ts` 的 `site.docs.automation.*` 一组词条） | 「付费自动收集（规划中）」「此功能尚未上线，目前没有可用回调地址」「回调接入均待上线」 | 逐段换成真实端点、真实凭据流程、真实错误/重试指引；未做的那部分**继续留"不在首版"** |
| 价格页（`landing.pricing.hostedAi.feature1..3`） | 三条卖点里**没有**自动收集 | 拍：要不要写进去；写就得同时写"由谁处理按规则定"这条边界——**成稿见下面 §5.1**（那句已按两条腿重述过），别再手写第二份；抽取那一档的披露见 §5.2 |
| `docs/reference/inbound-automation-protocol.md` | 已写 7 天保留、票据、密钥轮换 | 补 §3 A7 那条真实症状（模式写错 ⇒ 500），别写成"启动红" |
| 部署面 | 三处零提及（见 A7 现量） | `server/env.example` 补齐键名与非敏感形状、发布手册加一节 |
| 后台（`/admin` 用户详情） | 会打「自动收集 ✕ 这台实例没配自动收集的权益来源」——**这句是活的、对的** | 开完模式后自己会翻绿，不用改代码；别为了好看去改读数 |

🔴 **改完必过这几道**：`pnpm check:docs`、`pnpm check:ui-language`、i18n 两档对称、
`python3 research/tools/verify-inbound-doc-endpoints.py`（端点少前缀/方法写错会红）、
`python3 research/tools/verify-inbound-doc-tables.py`。

### 5.1 那句边界已成真，这是成稿（上线那天直接取，别再手写第二份）

**裁决（负责人 2026-10-27）**：不补手机/浏览器的后台腿，改由界面与对外件明写边界。
理由三条，都是这仓里量出来的，不是推测：

1. 浏览器那条腿补不圆。`apps/web/src/pwa/sw.ts` 文件头逐字写着 Chromium 周期同步下限
   `kMinPeriodicSyncEventsInterval = base::Hours(12)`，实际间隔还要乘互动度系数（12/24/36 小时，或者永不）。
2. 事件是端到端加密的：收件密钥与 Vault 解锁态都在页面里。后台要么醒来解不开，
   要么得把解密钥常驻浏览器——那是自己拆"服务端看不到明文"这条卖点。
3. 手机那条腿是一个新子系统：`apps/mobile/package.json` 里没有任何推送库（现量），
   iOS 那枚 `HeytaReminderModule` 只能排本地提醒，跑不了"解密 → 落库 → 提交许可"整条链；
   要做就得引 APNs/FCM：新第三方 + 一套对外基础设施 + 合规登记。

**所以产品承诺改成这一句**（常驻处理归用户自己那台常年开着的机器，手机与浏览器开着时顺手补一趟）：

- 中文（已进 `packages/i18n`，键 `web.ai.inbound.boundary.foregroundOnly`）：
  「每条规则自己决定由谁来处理：没有勾选"由我们的服务器在内容到达时抽取"的规则，
  只在这台设备开着 heyta 时处理 —— 应用退到后台、浏览器关掉页面都不领新内容。」
- 同键英文档：`Each rule decides who processes it: a rule without "extract on our server when
  content arrives" is processed only while heyta is open on this device — nothing is claimed
  after the app goes to the background or the page closes.`
- 🔴 **这一句在 2026-10-28 被重述过一次**，因为它当时说的是整条线，而现在线里有两条腿：
  [ADR-0077](../adr/0077-inbound-hosted-extraction-at-ingest.md) 那条"服务端当场抽"的档一开，
  "必须开着设备"就不再对所有规则成立。**裁决本身没变**（还是不补手机/浏览器的后台常驻腿、
  默认那档仍然归设备），变的是那句的范围——所以句子改成按规则说，而不是按功能说。
  取上面这两句现值，别再抄本节早先那版（那一版已经会说出与实现不符的话）。
- 两壳对账：这一族 key 已登记进常驻对账尺 `apps/mobile/tests/ai-copy-parity.spec.ts`
  的 `inbound.boundary.*` 那一臂——**任何一端改措辞或加例外都会红**，所以价格页与帮助中心
  要写的就是界面里那一句，不需要另行起草。

**让这句成真而写的两枚代码腿**（本轮已入库）：

| 腿 | 入库前那句是真的吗 | 现在 |
|---|---|---|
| web 那条循环挂在设置面板的 effect 上 | ❌ 离开设置视图就随组件卸载停掉，等于"得守着那一屏" | 提到应用级：`apps/web/src/features/settings/inbound-lifecycle.ts` 由 `App.tsx` 挂载，标签页可见即跑 |
| 手机没建收件密钥时直接 return | ❌ 界面只是安静着，用户分不清"还没准备好"与"没新内容" | 新增一格 `InboundReadiness`，把那台设备的原因渲出来（键 `web.ai.inbound.status.noKeyOnThisDevice`） |

⚠️ 帮助中心那篇（`site.docs.automation.*`）与价格页那三条卖点**本轮一字未改**——
它们是对外发布件，改动落在源码里就会随下一次站点构建公开。上线那天按上面那句取用，
发布那一步仍归负责人。

### 5.2 「接收即抽取」那一档的披露句子（**逐处草出，一处未发**）

[ADR-0077](../adr/0077-inbound-hosted-extraction-at-ingest.md) 让服务端第一次**在册地**读到用户明文
（只在接收那一次请求的内存里，抽完立刻丢弃）。这句话如果不上对外件，就是对外不实陈述；
如果上得比实现多，就是承诺做不到的事。所以下面每一格都写"**能说的**"与"**不许说的**"。

🔴 **这条危险已经变成一把尺，并且当场判出一处分歧**（2026-10-28 20:3x）：那段"自动收集元数据与注册挑战"的正文
**手抄在三枚文件里**（`privacy.ts`、`data-rights.ts`、`personal-info-list.ts` 各自的 `id: "automation-metadata"` 那一节，中英共六处）。
对账尺已建：`scripts/check-inbound-legal-copy-parity.mjs`（已接进 `pnpm check` 链与 AC 电池的 `AC7-legal-copy-parity` 那一腿；分母自动派生，以后新加一枚共享小节不用改名单）。
它第一趟的现量是：**中文三份逐字同一份**，而**英文不是** —— `privacy.ts` 与 `personal-info-list.ts` 同文（1231 字节），`data-rights.ts`（1327 字节）从第 431 个码点起多列
`automation entitlement activation / link / subjects` 三项。代码侧现量：这三张表在 `server/prisma/schema.prisma` 里真存在、在
`server/src/automation/entitlement-issuer.ts` 里真被写（列是 `userId`／`subject`／`installationId`／`localAccountUuid`／`codeHash`／时间戳／`resendCount`，明文标识）。
⇒ **"三处口径一致"这句话现在就不成立**（不是将来才会），而且不一致的那一侧更接近代码。
改哪一侧是对外法律表征，**归负责人**；本线一个字未改，只把这处分歧钉进尺的登记表并让输出逐枚点名（`⚪ 已登记漂移` 那一行）。
要改这六处时：**同批改齐、跑一遍这把尺**，别再留出手抄不一致。

| # | 落点 | 草稿（中文，英文要同批） | 🔴 这一格不许说成 |
|---|---|---|---|
| 1 | `packages/legal/src/documents/privacy.ts` 的 `automation-metadata` 那一节（中英两处）——**7 天那半句要「新增」，不是重述**：现量 `grep -rn "七日\|七天\|seven days" packages/legal/src/documents/*.ts` 只命中 `privacy.ts:394/395`（中）与 `:1002/1003`（英），而那四处讲的是**权益撤销未确认**，与入站事件行无关；**没有任何法务件写明入站事件行 / 失败批的保留期**（代码里是 `RETENTION_MS = 7 天`） | 「你开启'由我们当场抽取'这一档时，服务端在收到那条数据的**同一次请求内**读取它、由 AI 抽出任务字段，请求结束就把原文丢弃；库里只留下抽取结果用你自己的收件公钥重新封存的那一份，我们看不到它的内容。默认不开这一档，不开就由你自己的设备处理。」 | 不许写"我们不接触你的内容"（这一档就是接触了）；也不许写"我们保留原文 7 天"（抽取成功后是**当场丢**，7 天只是失败/未抽取那批的上限） |
| 2 | `packages/legal/src/documents/data-rights.ts` 与 `personal-info-list.ts` 的**同名那一节** | 与第 1 格**逐字同一句**，两处类别表的"用途"列同步改 | 不许只改隐私政策那一份——那正是上面那条危险 |
| 3 | `packages/legal/src/documents/ai-and-transfer.ts`（AI 与数据流转） | 「开启这一档后，进入的**字段子集**（你在规则里勾的那几项）会在接收当场发送到我们配置的境内模型供应商，只用于抽取任务字段；供应商侧的处理与保留见第三方清单那一节。」 | 不许说"仅在本机/仅在我们的服务器内完成"；不许暗示**全文**送去（投影在发送**之前**，A5 那把尺钉的就是这个） |
| 4 | `packages/legal/src/documents/third-parties.ts` | 在既有"托管 AI 供应商"那一行里加一句：自动收集抽取走的**是同一枚供应商、同一份流转说明**，不新增接收方 | 不许新立一个"自动收集处理方"——现在没有第二个接收方 |
| 5 | `apps/landing/src/site/docs.ts` 的 **`site.docs.automation.s3*`**（帮助中心那篇里**「付费自动收集（规划中）」那一节**；同篇 `s1` 是应用内 AI、`s2` 是 JSON 接入与 MCP、`s4` 是适用场景 —— **别改错节**） | 「自动收集有两种处理位置：默认由你自己的设备抽取；也可以在规则上开启'由我们当场抽取'，那时内容进我们服务端的那一瞬间会被我们的 AI 读取并抽取任务字段，抽取后原文不保留。**开启后，这条内容就不能再重抽第二遍**（原文已经不在我们手上）。」 | 不许写"随时可以重新解析"（ADR-0077 §4.3：抽取成功后物理上不可能）；也不许写"这一档是端到端加密的" |
| 6 | 价格页 `landing.pricing.hostedAi.feature*` | 如果要写进去，必须同时写第 5 格那两句（读一次 + 不能重抽），并与界面那一族的措辞按同一把对账尺 | 不许只写"云端自动抽取，无需设备在线"半句——那是把边界藏起来 |

**每一句草稿的事实依据（发布前逐句核对，别凭"我们说过"）** —— 这六格里的每一句都必须能在代码/判据里找到落点；找不到的句子就不许写：

| 草稿里那句 | 落在哪（代码） | 谁钉着它会红（判据/臂） |
|---|---|---|
| 「收到那条数据的**同一次请求内**读取它」 | `hosted-extraction.ts::extractInboundAtIngest` 在入站请求里同步调用（`inbound.routes.ts:219`） | §4.1 标记串断言（正文不在任何写参数、也不在任何一条日志里）＋ A11 |
| 「抽完**请求结束就丢弃原文**」 | 抽取成功后把 `payloadCiphertext` 写成 `null` | **A1**（不抹就红 3 条）＋ A13（集成面同一句） |
| 「库里只留**重新封好**的那一份、我们看不到内容」 | §3.2：结果重新封给同一枚收件人公钥，AAD 换 `purpose: 'result'` | **A12**（AAD 写错就解不开 ⇒ 红）；`openInbound` 需设备私钥，服务端零命中（A19–A21） |
| 「**默认不开**这一档」 | `inbound.routes.ts:212` 只有 `rule.hostedExtraction === true` 才走托管腿 | **A4**（把判定写成"不是 false 就当同意" ⇒ 红 8 条） |
| 「**7 天**只是失败/未抽取那批的上限」 | `RETENTION_MS = 7*24*60*60*1000`（`inbound.routes.ts:19`）、`expiresAt = now + RETENTION_MS`（`:153`）——成功那批当场 `null`，只有没抽成/没抽的那批会挂到 7 天 | A1 与那两句常量同址；**别把它写成"我们保留 7 天"**（§5.2 第 1 格右列已禁） ；⚠️ 另：**这句目前不在任何法务件里**（现量见第 1 格）⇒ 它是**新增陈述**，不是把旧句改措辞 |
| 「进入的**字段子集**在接收当场发往境内模型供应商」 | 投影在发送**之前**：`buildInboundModelInput(raw, rule.allowedFields)` | **A5**（跳过投影 ⇒ 红）；发送点唯一且走境内白名单判据（**A6** 改名即红） |
| 「不新增接收方：同一枚供应商、同一份流转说明」 | 全仓只有一处 `/chat/completions` 拼接（现量 `managed-completion.ts:306`） | `grep -rn "chat/completions" server/src` 的读数＋A6/A9 |
| 「开启后这条内容**不能再重抽第二遍**」 | 抽取成功后正文已不在 ⇒ 重试守卫 `payloadCiphertext === null` 直接拒 | **A23/A24/A25** + `tests/automation-events.spec.ts` 四条 |
| 「服务端不写 op、任务仍由设备写回」 | 服务端这条腿不碰 op-log 写入面 | **A18**（集成面：这一趟 op 差必须 0）＋ A16/A17 |

🔴 上表任何一行**找不到落点**，那一句就不许进对外件 —— 这正是 §5.2 每格右列"不许说成"的底：不是措辞偏好，是事实只在有落点的那一侧。

**版本行**：这些件都有各自的变更记录（如 `privacy.ts` 里 `['1.8', ...]` 那一族）。
真要改的时候**版本号、中英两份、变更记录三件事同批**，别只改正文。

**这一节的状态**：草稿，六格**一处未改、一处未发**；措辞与法律表征归负责人（§6 第 2 格）。
执行 AI 不许把上面任何一句写进 `packages/legal/**` 或 `apps/landing/**` 后自行发布。


---

## 6. 归负责人、不许执行 AI 拍的格子

1. **AC 的勾**——一格都不许替他勾（现量见 §0）。交"命令 + 逐字输出 + 原件路径"就停。
2. **上线那一步**（配 env、换容器、push、发布对外文档）——可逆但对外可见，先说一声。
3. **A4 的修法**——动计费口径：摘 managed-proxy 那一次扣，还是让 attempt 账本成为唯一权威。
4. **A5 的地界**——`server/src/sync/cleanup.ts` 那句"本线白名单之外"的搁置令还在不在。
5. **"邮件转待办"要不要做**——用户口语里的"自动收集"九成指邮件；首版没有。这决定这条线做不做得成。
   ✅ **2026-10-27 负责人拍了：另开一条线**，不塞进本八格。首版仍不含邮件，工单见
   [`email-to-task-brief.md`](email-to-task-brief.md)；对外那篇帮助中心不许写成"什么来源都能自动收"。
6. **运行形态那一格已定并落地**（2026-10-28 负责人拍「3-B」）：`AUTOMATION_ENTITLEMENT_MODE` 写错 ⇒
   端口绑定之前就退（`rc=1`）；**未配置仍然合法**，走各端 402 带 `reason=ENTITLEMENT_MODE_UNCONFIGURED` 那一档。
7. **A2 那两条边界**——补 ServiceWorker/后台腿，还是对外明写"设备开着才处理"。
   ✅ **2026-10-27 负责人拍了：不补后台腿，明写边界**，并要求先把这句做成真话再动文案。
   两枚代码腿（web 循环提到应用级、手机那格渲出原因）已入库，成稿在 §5.1；
   🔴 剩下的只有"上线那天把 §5.1 那句取用出去"，那一格仍归负责人（对外发布）。
8. `BLOCKED.md` 里挂在别人名下的那几格（B109 签发端 URL、B205 范围尺口径、B239 等）——本单不动。

---

## 7. 建议执行顺序（每步自带判据与失败形状）

1. **先证 A4**（半天内能出结论，结论决定要不要改计费）。失败形状：写不出能红的用例 ⇒ 说明扣费点判断错，回来改本文。
2. **node 宿主那条腿**（A2 表里第三行）：给 `apps/node-host` 一个真实的启动者（CLI 子命令或 local-api 入口），
   判据 = 一条真库真 HTTP 的"起宿主 → 投一条 → 落库 → 回执"用例；反向臂 = 摘掉启动点 ⇒ 用例红。
3. **A3 文案 + mobile 状态**（用户可见的第一件假绿）。
4. **A7 表面补全 + A8 清理**（纯文档/纯结构，不与行为变更混提交）。
5. **A5 接第三枚清扫**（前提：§6 第 4 格他点头）。
6. **A1 票据腿**（只在决定支持 selfhost-online 时才做；否则把它写成"这一模式本版本不可用"并让界面别露出）。
7. **B 组上线**（要授权）→ 再动 §5 那批对外件 → 最后交 AC 证据。

⚠️ **串行跑验证**（本仓那条"一次只跑一条重验证"的规矩）；本机内存门会排队，**别 kill 别人的进程/载体**。
⚠️ 取证件不落 `/tmp`（会被第二天扫走），落 `~/.heyta-evidence/<线>-<日期>-<戳>/`，文件名**带端名与时刻**
——同名覆盖这件事这条线已经栽过一次（计划文末 2026-10-20 那一节第 10 条）。

---

## 8. 什么叫做完（交付定义，别用"代码写了"顶）

四条同时成立才算：

1. 一条真实的外部 POST（用界面上签发的凭据）从公网进来，**在一台负责人看得见设备上变成一条待办**，
   界面上那条事件的状态一路走到底并且**每个中间态都有用户读得懂的文案**；
2. 中途拔掉电（SIGKILL）不留半批、不重复建、额度不多扣 —— 即 AC-3 那 13 个窗口在新代码上复跑；
3. 生产上那三/四枚 env 的键名与形状进了 `server/env.example` 与发布手册，且**文档里的端点与方法全部可达**（过 §5 那四道尺）；
4. AC-1～AC-8 每一格都摆出"命令 + 逐字输出 + 原件路径"，**由负责人自己勾**。

---

## 9. 执行回执（2026-10-27 · 负责人授权"按本单做完这些东西"之后由执行 AI 填）

读数与逐格边界写在 [`inbound-automation.md`](inbound-automation.md) 文末 2026-10-27 那一节。这里登记
**与本单原文不一致的那些件**（§3 每格头上另有一枚 ✅/🔴 标记；两处说法不一致时，以标记加本单正文里那几条现量命令为准），因为下一位读这份文件时会照本单的说法去动手：

1. **§7 第 2 步（node 宿主那条腿）不是"缺一行调用"**。`startInboundWorker` 的入参要 `routing` 与
   `consents`，而这台宿主**两个来源都没有**（现量：`grep -rn "consent\|routing" apps/node-host/src/*.ts`
   只命中 `cli-auth.ts:168` 一句错误文案与 `keychain-secret-store.ts:5` 一行注释；`packages/ai` 里没有跨壳
   共用的 settings store）。所以本单把它写成"全表里性价比最高的一格"这句**要收窄**：它缺的是
   "一台无头机器怎么被授权把用户内容发往某个端点"的设计 —— 出境同意属对外法律表征，没代拍。
   另有一条机械前置，**当天下午被自己否证**：`env | grep -c DATABASE_URL` = 0 是真的，但我据此写了"取不到"——
   本机 `127.0.0.1:5432` 那台 Postgres 一直活着，缺的只是没人导出那枚键；`createdb` 一枚独立库 + 导出
   `DATABASE_URL` 之后，判据就在真库 + 真 HTTP + 真 CLI 子进程上取到了（本单 §7 第 2 步由此闭合，读数在
   [`inbound-automation.md`](inbound-automation.md) 文末 15:0x–15:3x 那一戳）。
2. **§3 A4 从"疑似"升成"确证"**，载体与逐字读数见那一节第 1 项。修法仍归 §6 第 3 格，本单一句话没改：
   新用例现在**绿**着钉住现状（一次 managed 周期 = `requests` +2），拍定修法后那行改 `1`。
3. **§3 A2 表里 mobile 那一格的"把周期结果露出来"已做完**，而这一项此前在本单里写下过**两句假话**，都留在这儿挡住下一位重犯：
   ① "移动壳里没有任何自动收集界面，要先把那面造出来，属产品取向"——**错**：`apps/mobile/src/ai/AiSettingsSection.tsx`
   早就承载 `inbound-automation` 那枚特性，缺的只是把周期结果渲成一行，是一格四处置的小代码；
   ② 更早那句"这台机器上取不到真库"也已被否证（同一枚 Postgres 一直活着，缺的只是没人导出那枚键）。
   落地的四处与判据见 §3 A3 头上那枚 ✅；过程账（含我自己那枚判据被"两处同改"的施变臂骗过一次）在计划文末 17:5x 那一节。
   web 那一半（词条 + 映射 + 把用例加严到钉句子）与 B110 同格闭合。

4. **§3 A2 表里 node 宿主那一格已闭合**（本单那句"性价比最高的一格"收窄成的那一难，由命令行上的操作者答）：
   `worker run` 现在把那枚循环真的打开，出境授权取 `--approve-egress`，而**该填哪一个不由本壳判** ——
   目的地由 `@heyta/ai` 按端点地址算出来，算出来要出境却没写那个词就拒绝启动、一个请求都不发。
   那几句拒动与披露文案是我起草的，措辞归负责人复看；AC 一格没代勾（现量 `verify-inbound-ac-ticks.py` ⇒ 已勾 0）。
   ⚠️ 顺带抓到一条**开工单没有的**服务端缺陷：租约判活那几句裸列比较在非 UTC 会话上恒读成"已过期"，
   症状正是"worker 永远领不到许可"，修法与判据见环境陷阱 #599。

§3 A5 那句"搁置令是否仍生效要问负责人"当场判掉了：它约束的是 2026-10-12 那场会话自己的地界，
而本单 §7 第 5 步把这格排进执行范围 ⇒ 已接线并配了会红的判据，B175 闭合。
§3 A7 的 helm 那一格**没做**，理由写在 `docs/runbooks/deployment.md` §3.5.1 末尾（本机没有 helm，
不去交一份渲染不了的 YAML）。

5. **本单 §1/§5.1 那句"必须开着设备"的范围在 2026-10-28 被改小了一次**：负责人把
   "数据进我们服务端时本来就可读"那句交回来做，落地成 [ADR-0077](../adr/0077-inbound-hosted-extraction-at-ingest.md)
   那条窄档「接收即抽取」（规则级开关、只在那一次请求内读、抽完丢弃、结果重封给同一枚收件人公钥、
   任务写回仍归设备）。**§5.1 那两条引用句已按现值重述**（键没变，句子按"两条腿"说）；
   本单其余地方凡是把"开着 heyta"写成**全体规则**的条件句，都按那一句现值理解。
6. **新增 §5.2：那一档的对外披露六格草稿，一处未发**。其中那条危险的处理方式已经变了，别再按原句理解：
   那段 `automation-metadata` 正文手抄在三枚法务文件里、原先**没有任何尺**看着它们一致 ——
   现在有了（`scripts/check-inbound-legal-copy-parity.mjs`，已进 `pnpm check` 链与电池 `AC7-legal-copy-parity` 那一腿），
   而它第一趟就量出**英文那三份已经不逐字相同**（`data-rights.ts` 多列三项权益相关的留存表；中文三份仍逐字相同）。
   逐条读数、代码侧证据与"改哪一侧归负责人"都写在 §5.2 上面那段。
7. **`docs/plans/email-to-task-brief.md` 已重指向这条窄档**（新增 §0a 与 §3 的 P0.5）：
   邮件那条入口**复用**抽取这条腿，不再造第三条；但归属那一格（一封信凭什么算这个账号的）
   没答案之前不许接，复用抽取 ≠ 复用归属。

⚠️ 顺手记一条**方法论**（不是本线的缺口，是执行 AI 自己那把尺的缺口）：本轮新写的门槛里有两把
**当场恒绿**——一枚是数 ANSI 包裹的失败字形、一枚是被自己文件的注释喂饱。
两者都只有跑变异臂才暴露，且对照臂（一棵没动的树必须绿）是发现它的前提。
细节与跑法在计划文末 2026-10-28 那一节第 2 项。

## 10. 执行回执（2026-10-29 · 负责人授权"全部做完"之后）

| 格 | 结果 | 提交 / 原件 |
|---|---|---|
| A4 双扣 | ✅ 已修（代理侧原子认领预留；迁移 `..._proxy_billed` 可空无索引；钉 +1 的用例 + 两枚新臂；变异臂各红） | `9904fb671` |
| A9 四件 | ✅ 全做（上限提示 / reasonCode 人话 / 试发说明 / 手机规则清单）；其中前三项另有一条**真浏览器**用例（`e2e/tests/inbound-automation.spec.ts`，变异臂实测会红） | `28a96ab8a`、`54bf5e9d2` |
| ④ 六格 | ✅ 已改未发（六处同文 + 当场抽取 + 7 天；版本行/日期/变更同批） | `06798bf3a` |
| B 组上线 | ✅ env 级已开（mode=official + SENDER_KEK + COMMIT_KEYS；公网接收端点从 402→400）；开完当场抓到并修掉一枚"空串被当成配了"的 500（撤销面 403/400/200 复查）；镜像未换 | 取证 `~/.heyta-evidence/inbound-bgroup-20261029/`、`54bf5e9d2` |
| C 组 AC 证据 | ✅ 电池整串跑 + 沙箱发布验证；**AC 一格未代勾** | `~/.heyta-evidence/inbound-ac-battery-20261029/`、`.run-logs/deploy-sandbox-1029.log` |

**仍归负责人的三件（本轮刻意没做）**：
1. **对外发布**：站点点发布 / 帮助中心上线那一步（源码已定稿，发布动作没做）。
2. **换镜像发布**：A4 与 A9 的新代码要随下一次正常发布才进线上；沙箱已证明这一版可建可迁可起（`VCS_REF` 对账通过）。
3. **AC-1～AC-8 的勾**，含 AC-6"人真打开看过截图"。机器证据都在上面两条路径里。
