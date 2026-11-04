# ADR-0078：管理后台页独立启动，不初始化本地 op-log

> 状态：**已接受**（D4 由产品负责人 2026-10-30 拍板；D1–D3 工程裁决）
> 日期：2026-10-30
> 相关：[ADR-0038](0038-admin-console-scope.md)（后台是主应用里的受保护子树）、
> [ADR-0027](0027-unified-client-storage-sqlite-everywhere.md) /
> [ADR-0028](0028-web-sqlite-must-run-in-worker.md)（web 的 SQLite 在 Worker 里跑 OPFS SAH Pool）
> 落地计划：[`../plans/admin-console.md`](../plans/admin-console.md) §10

---

## 1. 背景

### 1.1 现场（2026-10-30，产品负责人报）

浏览器里打开 `/admin` → 提示未登录 → 返回主应用后看到
「无法初始化本地存储 / 被其它标签页挡住了」，技术详情：

```
Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle':
Access Handles cannot be created if there is another open Access Handle
or Writable stream associated with the same file.
```

### 1.2 根因

1. `createSyncAccessHandle` 对文件是**排他锁**：同一 OPFS 文件的 `readwrite` 句柄
   整个 origin 只能有一个（MDN；SQLite wasm 文档明说同一 OPFS 库不能有两个连接）。
   只有 `mode: 'read-only'` 允许多开 —— 而 heyta 走写路径。
2. `apps/web/src/main.tsx` 在**任何**渲染之前无条件 `initOpLog()`；
   `initOpLog` 一进去就开库（`apps/web/src/lib/oplog.ts`），
   storage worker 模块顶层装池（`apps/web/src/worker/storage.worker.ts`）。
   抢锁发生在启动那一次，不是推迟到第一条读写。
3. `/admin` 与 `/app/` 同源、同 bundle ⇒ 另一张标签页开着应用时，`/admin`
   必然拿不到锁 ⇒ 崩溃屏。

### 1.3 为什么这是缺陷，不是环境噪声

后台页的数据 **100% 走服务端**：`features/admin/store.ts` 只 import
`@heyta/app-host` 的 `fetchAdmin*`，`admin-client.ts` 只用 `fetch`，
凭据在 `localStorage`（`features/sync/credential-storage.ts`）。
**它一行都不需要本地库。**

⇒ `/admin` 被一件自己不需要的资源挡住了：操作者在另一个标签页看着自己的任务清单，
就打不开管理后台。提示文案「关掉这个应用的其它窗口或标签页」对主应用是对的，
对后台页是把产品缺陷说成用户操作问题。

---

## 2. 决策

### D1 启动路径：`/admin` 不初始化 op-log

`main.tsx` 按地址分四种启动模式（`shell` / `slice` / `console` / `app`）。
`console` 模式**不调用 `initOpLog()`**，也不跑依赖引擎的四步
（`startWidgetLifecycle` / `startPublicFacts` / `armWebShareSession` / `holdPendingLogin`）。
渲染树 = `StrictMode > LocaleHost > AdminConsolePage`。

⚠️ 这与今天的**有效**树一致：`App.tsx` 的后台早退发生在 `HeytaUiProvider` 等 Provider
之前，后台页从来没有被那些 Provider 包过。本决策只是不再为它启动引擎。

### D2 首启隐私同意：提取成共享入口

「这台设备从没作过决定就问一次」这条判断从 `App.tsx` 的 mount effect 提成
`features/privacy/first-launch.ts`，两条启动路径都调。
否则后台页在未同意时永远停在「正在加载…」（`AdminConsolePage` 的 `!networkAllowed` 分支）。

### D3 登录入口：就地挂 `AuthPanel`

`access === 'unavailable'` 且原因是 `no-token` / `unauthorized` 时，状态块给「登录」按钮；
点开就地挂 `AuthPanel`（它自带 CSS 与 `HeytaUiProvider`），`onSignedIn` 之后重新 `probe()`。
403 不给登录按钮 —— 已经登录了，那是权限问题。

**不选**「跳回主应用 `?signin`」：那条路由同样要 `initOpLog()`，
正好会在本缺陷的场景里再撞一次锁。

### D4 导航可见性：非管理员（含匿名）不画分区导航

左侧 11 个分区导航只在 `access === 'admin'` 时渲染。
依据：产品负责人 2026-10-30 拍板。代价是「敲错地址的人看不到这页是干什么的」——
由状态块那句「这一页只对管理员账号开放…」承担说明职责。

这**部分收窄** ADR-0038 §2 里"非管理员看到的不是空白"那条：不再是空白，
但也不再是完整的分区导航。§4.3「服务端是唯一裁决者」不变。

#### D4 追记（2026-11-04，同一位产品负责人再收窄一次）

原话：「为什么现在没有登录也能进去看到面板？我不允许没登录还能进去看到面板。
就是进去之后应该是个登录界面，它应该被拦截的。」

结论的**方向不变**（导航只对管理员画、服务端仍是唯一裁决），变的是**出路的位置**：

| | 追记前 | 追记后 |
|---|---|---|
| 匿名 / 会话过期进来 | 标题 + 一句原因 + 一枚「登录」按钮，要他自己点 | **登录界面默认就在场**（同一份 `AuthPanel`，不是第二套实现） |
| 他主动把登录面关掉 | —— | 退回「一句原因 + 一条出路」，出路还是**同一条**，再点得开 |
| 已登录但不是管理员（403） | 只给原因，不给登录入口 | **不变**（`canSignInFrom` 那张表决定）——问题在权限，不是会话 |
| 还没同意联网 | 只说"正在加载"，同意面板在上层 | **不变**：这一格不摆登录面，因为 `fetch` 还被闸门挡着，摆出来就是一张点不通的表单 |

⚠️ 这一条仍然是**呈现**，不是安全措施：它挡不住手工构造的请求，那一直由 `requireAdmin` 管。

同一次收窄里还带了一句「做得跟用户登录界面差不多，加上管理后台几个字就行了」。
落地形状是**一枚标签，不是第二套登录**：`AuthPanel` 多一个可选 `brandLabel`，后台那面把本页标题
那枚现成词条（`web.admin.console.title`＝「heyta 管理后台」）递进去，挂在两支的标题层
（官方地址那一支是中央面板的 `h2`，自带端点那一支是共享表单的标题与对话框的 `aria-label`）。
🔴 eyebrow 那句「heyta 官方服务」**不被品牌顶掉** —— 它答的是"这次认证发去哪台服务端"。
判据另立一枚文件 `apps/web/tests/admin-login-brand.spec.tsx`（两支各一条正向 + 一条反向对照：
主应用那面不传 `brandLabel` 时标题逐字照旧，界面上也不许出现"管理后台"）。
判据在 `apps/web/tests/admin-console-route.spec.tsx`（快的一侧，含"关掉之后还剩出路"那一臂）
与 `e2e/tests/admin-console-route.spec.ts` 的未登录那条（真浏览器 + 两张截图）。

### D5 多标签并发：不做

让两个标签页同时使用同一份本地库需要 SharedWorker / leader 代理 /
SQLite 3.50 的 `pauseVfs` 协作移交，成本与风险远大于本目标。
本 ADR 只把**不需要本地库的那一页**从锁里摘出来；主应用"同一浏览器开两个标签页"
仍不支持（环境陷阱 #111 已登记）。

---

## 3. 后果

- `/admin` 不再受本地库锁影响；主应用那张标签页开着也能进后台。
- 后台页不再跑依赖引擎的启动步骤。**将来若后台要用本地数据，先改本 ADR**，
  不要在 `console` 分支里悄悄把 `initOpLog()` 加回来。
- 崩溃屏与「关掉其它标签页」那条提示仍然保留给主应用 —— 那里它是真话。
- 非管理员看不到分区名；状态块必须始终能说清"为什么看不到"。
- 🔴 **绕过 `App()` 的启动路径要逐条清点 `App()` 里的全局副作用。** 本轮真跑撞到
  第一件：主题写在 `App()` 的 effect 里（`<html data-theme>`），后台页绕开它之后
  暗色设置失效 —— 由 e2e 的暗色用例当场抓住，现已在 `console` 分支里自己应用一次。
  语言由 `LocaleHost` 承担（两条路径共用），不在这个清单里。
- 2026-10-30 把这份清单**扫到底**（`grep -nE "document\.(title|body|documentElement)" apps/web/src/App.tsx`）：
  只有两处对 `document.body` 的**读**（焦点归还判断），**没有** title、没有 body class、
  没有 `documentElement.style`。也就是说 `App()` 真正写进 document 的只有主题一条。
  以后新增全局副作用（字号、语言方向、body class……）时，问一句"`/admin` 要不要它"，
  并把这一扫重跑一遍。

---

## 4. 判据

1. `apps/web/tests/startup-mode.spec.ts`：四种地址形状与优先级；把 `console`
   分支挪到 `app` 之后必须红。
2. `apps/web/tests/admin-console-route.spec.tsx`：403 与匿名都 ⇒ 导航 0 项；
   匿名 ⇒ 有「登录」按钮；点开 ⇒ `AuthPanel` 出现；403 ⇒ 没有登录按钮。
3. `e2e/tests/admin-console.spec.ts`：主应用标签页占着本地库时，`/admin`
   仍渲染后台壳、不落崩溃屏 —— 删掉 `console` 启动分支必须红。
