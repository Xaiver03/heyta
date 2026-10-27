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
- `createAutomationTicketSource`（取动作票）：`grep -rn createAutomationTicketSource --include='*.ts' packages apps server | grep -v /dist/`
  ⇒ 只命中定义、`index.ts` 的 re-export、`packages/app-host/tests/`。**没有宿主用它。**
- `startAutomationSessionKeepalive`（计划里那句"各宿主每 30 秒续票据"）：同样只被自己的 spec 引用。
- `createAutomationInstallationMetaStore` / `loadOrCreateAutomationInstallationId`（取票前提的安装身份）：同样只有测试。
- 后果：`AUTOMATION_ENTITLEMENT_MODE=selfhost-online` 那一档**在真机上拿不到放行**（各端只会 402）。
  `official` 模式不看票，所以官方托管实例不受这条影响。
- **判据形状**：接完至少要有"某宿主在 selfhost-online 下领到一条事件并落库"的一枚用例，
  且有一枚反向臂（摘掉票供给 ⇒ 那用例红）。**别只补代码不补臂**。

### A2 各宿主的 worker 生命周期：只有两端真的在跑，而且都是"前台才跑"
| 端 | 现状（现量） | 缺什么 |
|---|---|---|
| 浏览器 `apps/web` | `grep -rn startInboundWorkerLoop apps` ⇒ 唯一生产调用点 `apps/web/src/features/settings/InboundAutomationSettings.tsx`（挂在设置节组件的 `useEffect` 上，`isRunnable` 读 `document.visibilityState`） | **离开设置视图即停、标签页不可见即停**；没有 ServiceWorker 那条腿（`grep -rn "inbound\|automation" apps/web/src/pwa` 回空，`e2e/playwright.inbound.config.ts` 还显式 `serviceWorkers: 'block'`） |
| iOS / Android（共享 RN JS） | `grep -rn startMobileInboundWorker apps/mobile/src` ⇒ `src/App.tsx` 启动、`src/inbound/lifecycle.ts` 里 `isRunnable` = `AppState==='active'` | **后台无腿**；且它不建收件密钥（没有就静默 return），必须先在一台别的设备上建过 |
| node 宿主 | `grep -rn "startInboundWorker\b" apps/node-host` ⇒ `src/host.ts` 有实现，**调用者只有 `tests/host.spec.ts`** | **那台"永远在线"的机器没人替它把循环打开**（CLI 无命令、local-api 无入口）——这是全表里性价比最高的一格 |
| Electron 桌面 `apps/desktop` | `grep -rni inbound apps/desktop/src` 回空 | 主进程零接线，壳里退化成浏览器那一档 |
| macOS / Windows / Linux 原生壳 | `grep -rli inbound apps/desktop-macos/Sources apps/desktop-windows` 回空 | 零接线（这三壳目前只是窗口/小组件壳） |

⚠️ **"页面开着才处理"这句话现在还没对外说过**。要么补腿，要么在 §5 的对外件里明写这条边界——
两者选一，不许两头都不做。

### A3 `waiting-entitlement` 到界面是一条**空白文案**
- 库层有这个状态（`packages/app-host/src/inbound-process.ts` 的 `InboundAutomationCycleState`）；
- 界面渲染处 `InboundAutomationSettings.tsx` 的 `PROCESS_COPY` 不含这一态 ⇒ 正文为空；
- 词条确实缺：`grep -n "process.waiting" packages/i18n/src/locales/zh-CN.ts` 回空。
- 现成证据：那条渲染用例只钉了"不崩、不回成处理失败"，**没钉文案** ⇒ 补文案时顺手把这枚判据加严。
- mobile 更彻底：`apps/mobile/src/inbound/lifecycle.ts` 把周期结果整个丢弃，用户什么都看不到。
- 🔴 改文案走 `packages/i18n` 唯一事实源，中英两档都要，界面里不许硬编码。

### A4 托管 AI 额度**疑似一次扣两下**（本文最该先证伪/证实的一格）
- 预留那一次：`server/src/automation/ai-metering.ts` 里 `billingSource==='managed'` 时调 `consumeManagedAiRequest`；
- 真调用又一次：worker 走 `invokeRouted` ⇒ `packages/ai/src/wire.ts` 的 `managedChatUrl()` ⇒ `POST /api/ai/managed/chat` ⇒
  `server/src/ai/managed-proxy.routes.ts` 里再调一次 `consumeManagedAiRequest`；
- `grep -n automation server/src/ai/managed-proxy.routes.ts` ⇒ **没有任何"这条是自动化预留过的就别再扣"的特判**。
- **动手方式**：先写一枚**能红**的用例（同一事件 managed 一次完整周期 ⇒ 计数器 +1 还是 +2），
  再决定修哪一头（要么把 `inbound-automation` 从 managed-proxy 的扣费路径上摘出去，要么让 attempt 账本成为唯一权威）。
  ⚠️ 这动的是计费口径，属**判据口径**那一格 ⇒ **改法要报负责人拍，别代拍**（见 §6 第 3 格）。

### A5 实例退役清扫没接进每日任务
- 函数有：`purgeRetiredAutomationEntitlementClocks`（`server/src/automation/entitlement-ticket.ts`）；
- 调用者：`grep -rn purgeRetiredAutomationEntitlementClocks server/src` ⇒ **只有定义那一行**；
  `server/tests/automation-clock-retirement.pglite.spec.ts` 测的是函数本身，不测它被不被调。
- 落点在同文件邻居：`server/src/sync/cleanup.ts` 已经把 `purgeExpiredAutomationEvents` 与
  `purgeExpiredAutomationEntitlementTicketUses` 接进去了，照那一格的形状接第三枚。
- ⚠️ 计划里登记过"`cleanup.ts` 在本线白名单之外 ⇒ 只登记需求，不代改"。**那条搁置令是否仍生效要问负责人**；
  他没解就说，别自己扩地界。

### A6 "正文保留 7 天"这句话没有一把对账尺
- `scripts/check-retention-window-parity.mjs` 现在只对齐两枚 45 天窗口，不含 inbound 那枚 7 天常量
  （现量：`grep -n "inbound\|automation\|7" scripts/check-retention-window-parity.mjs`）。
- 承诺写在 `docs/reference/inbound-automation-protocol.md`。**加尺前先 grep 仓内有没有明文否掉它**（本仓规矩）。

### A7 env 表面缺口：八枚里只登记了两枚
- 读取点：`grep -rn "process.env.AUTOMATION" server/src`（模式/钥匙环/签发三件套/HMAC keyring/发送 KEK/提交回执 keyring 等）；
- `server/env.example` 里只有 `AUTOMATION_COMMIT_KEYS` 与 `AUTOMATION_WEBHOOK_KEYS`（现量 `grep -n AUTOMATION server/env.example`）；
- `server/helm/`、`server/deploy/`、`docs/runbooks/deployment.md` 对 `AUTOMATION` **零提及**（现量 `grep -rl AUTOMATION server/helm server/deploy docs/runbooks`）。
- ⚠️ 一条会骗人的形状：`AUTOMATION_ENTITLEMENT_MODE` **写错值不在启动时报错**，是**请求处理时抛 ⇒ 用户看到 500**。
  判据要不要改成启动即红（与 `ENTITLEMENT_GATE_ENABLED` 同形）属**判据口径**，要拍；先把它如实写进 §5 的运维件。

### A8 一份类型定义住两处
`InboundAutomationHostOptions` 在 `packages/app-host/src/inbound-host-options.ts` 与 `host.ts` 里各有一份逐字副本
（`index.ts` 只导出前一份）。纯清理，改完 `pnpm --dir packages/app-host typecheck` 即判据。

### A9 界面上还缺的四件小事
事件列表无分页且上限处无提示、事件的 `reasonCode` 不展示给用户、发送方 secret 只在签发那一刻留在内存里
（关掉面板就不能再试发同一条凭据）、mobile/原生端没有规则 UI（连"看规则"都没有）。

---

## 4. B 组：生产上开起来要配什么（顺序即风险）

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

| 件 | 现在写的是什么 | 上线时要改成 |
|---|---|---|
| 帮助中心那篇（`apps/landing/src/site/docs.ts` 的 `site.docs.automation.*` 一组词条） | 「付费自动收集（规划中）」「此功能尚未上线，目前没有可用回调地址」「回调接入均待上线」 | 逐段换成真实端点、真实凭据流程、真实错误/重试指引；未做的那部分**继续留"不在首版"** |
| 价格页（`landing.pricing.hostedAi.feature1..3`） | 三条卖点里**没有**自动收集 | 拍：要不要写进去；写就得同时写"哪台设备得开着"这条边界 |
| `docs/reference/inbound-automation-protocol.md` | 已写 7 天保留、票据、密钥轮换 | 补 §3 A7 那条真实症状（模式写错 ⇒ 500），别写成"启动红" |
| 部署面 | 三处零提及（见 A7 现量） | `server/env.example` 补齐键名与非敏感形状、发布手册加一节 |
| 后台（`/admin` 用户详情） | 会打「自动收集 ✕ 这台实例没配自动收集的权益来源」——**这句是活的、对的** | 开完模式后自己会翻绿，不用改代码；别为了好看去改读数 |

🔴 **改完必过这几道**：`pnpm check:docs`、`pnpm check:ui-language`、i18n 两档对称、
`python3 research/tools/verify-inbound-doc-endpoints.py`（端点少前缀/方法写错会红）、
`python3 research/tools/verify-inbound-doc-tables.py`。

---

## 6. 归负责人、不许执行 AI 拍的格子

1. **AC 的勾**——一格都不许替他勾（现量见 §0）。交"命令 + 逐字输出 + 原件路径"就停。
2. **上线那一步**（配 env、换容器、push、发布对外文档）——可逆但对外可见，先说一声。
3. **A4 的修法**——动计费口径：摘 managed-proxy 那一次扣，还是让 attempt 账本成为唯一权威。
4. **A5 的地界**——`server/src/sync/cleanup.ts` 那句"本线白名单之外"的搁置令还在不在。
5. **"邮件转待办"要不要做**——用户口语里的"自动收集"九成指邮件；首版没有。这决定这条线做不做得成。
6. **`AUTOMATION_ENTITLEMENT_MODE` 写错 ⇒ 500 要不要改成启动即红**。
7. **A2 那两条边界**——补 ServiceWorker/后台腿，还是对外明写"设备开着才处理"。
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
