# AI 出境路径与数据主体权利 —— 代码考古（C19–C23 / D24–D25）

> 元信息：**日期 2026-10-01**、**纯只读代码考古**（本轮未修改任何产品代码）。
> 范围：`packages/ai/`、`packages/app-host/src/ai-*.ts`、`packages/local-api/`、
> `apps/web/src/features/settings/AiSettings.tsx`、`apps/web/src/**/aiStore.ts`、
> `apps/web/src/features/`、`packages/app-host/src/`、`server/src/`。
> 用途：隐私政策「向第三方提供个人信息」与「你的权利」两节的**唯一事实依据**。
> 判据口径：每条结论带 `文件:行号`；查不到的写「❌ 无入口」或「未穷尽」，不写推测。

---

## C19 三道闸门与默认值

**结论：三道闸（实为四道）全部存在、全部默认关闭、全部 fail-closed，且实现与出厂默认值分两处各自钉住。**

### 19.1 闸门清单（变量名 / 默认值 / 判定方向）

| 闸 | 变量 | 声明与默认值 | 关掉时的行为 | 判定位置 |
|---|---|---|---|---|
| 1 总开关 | `AiRoutingConfig.enabled` | 类型声明 `packages/ai/src/routing.ts:186`（注释「默认必须是 false」）；**出厂默认 `false`** 在 `apps/web/src/features/settings/aiStore.ts:88` | `invokeRouted` 第一件事就是查它，返回 `not-configured`、**候选一个都不试**：`packages/ai/src/routing.ts:662-673` | `routing.ts:662` |
| 2 允许远程 | `AiRoutingConfig.allowRemote` | `routing.ts:187-188`；**出厂默认 `false`**：`aiStore.ts:89` | 远端端点**根本不进入候选链**（不是"进了再失败"），因此连授权询问都不产生：`routing.ts:554-558` | `routing.ts:555` |
| 3 逐功能出境授权 | `EgressConsent{feature,destination}` + `authorizeEgress()` | `packages/ai/src/egress.ts:64-69`（授权记录）、`egress.ts:155-173`（判定）；**出厂默认 `consents: []`**：`aiStore.ts:95` | 目的地 ≠ `none` 且找不到 `(功能,目的地)` **精确匹配** → `consent-missing` 拒绝：`egress.ts:168-172`。授权检查在**网络动作之前**（`routing.ts:712-745`，注释 712 行「第 3 道闸：出境授权。**必须在网络之前。**」） | `egress.ts:168` |
| 4 记忆偏好层 | `memoryEnabled` | `aiStore.ts:75` 声明、**出厂默认 `false`**：`aiStore.ts:98`（注释「第四道闸，同样默认关」） | 关掉即"零推断、零偏好进 prompt" | 详见 C23 |
| （并列）本机 API / MCP | `LocalApiConfig.enabled` | `aiStore.ts:94` 取自 `DEFAULT_LOCAL_API_CONFIG`； sanitize 时 `enabled: c.enabled === true`（`aiStore.ts:202`） | 详见 C22 |

**「三道闸」的说法在代码里就是 `routing.ts:28-39` 那张表**（文件头注释），且明确说明第 2 道与第 3 道**语义不同、不可合并**（粗粒度长期意愿 vs 细粒度逐功能、可撤销）。

### 19.2 默认值的加固：不是 `!!x`，是 `=== true`

`aiStore.ts:191-192` 从 `localStorage` 读回时：`enabled: c.enabled === true`、`allowRemote: c.allowRemote === true` ——
字符串 `"true"` / 数字 `1` / 缺字段一律判为**关闭**（`aiStore.ts:122-126` 同一条规则用在 `memoryEnabled` 上）。
更狠的一条：`aiStore.ts:203-206` —— 本机 API 的 `bindAddress` **从不从存储里读**，永远用默认回环地址，
理由写在注释里：存储被改成 `0.0.0.0` 后读回来 = 悄悄把服务暴露到局域网。

### 19.3 「回退不得跨越隐私边界」 —— ✅ 成立，且有能失败的测试

- 实现：`routing.ts:708-745` 的候选循环里，每个候选**各自**过第 3 道闸。
  若**首选**（`index === 0`）就没授权 → 直接返回 `egress-not-authorized`（带完整 disclosure，`routing.ts:719-735`）。
  若**回退位**（`index > 0`）的目的地未授权 → 记 `blockedByConsent` 并 `break`（`routing.ts:740-744`），
  收尾时返回**独立原因** `fallback-needs-consent`（`routing.ts:801-816`）。
- 关键设计：这个原因**不当作端点的失败**（`countsAsEndpointFailure` → false，`routing.ts:333`），
  也**不换下一个端点**（`shouldTryNextEndpoint` → false，`routing.ts:368-370`，注释原文
  「没授权 → 换下一个端点不是"重试"，是**换一个目的地偷发**」）。
- 测试：`packages/ai/tests/routing.spec.ts:499` 那条标题即
  「🔴 本机失败 → 云端备用未授权 → **一次请求都不发**，并报 fallback-needs-consent」，
  断言在 `routing.spec.ts:520`。套件文件头（`routing.spec.ts:8-12`）写明
  **判据是数网络请求数、不看返回值** —— 因为"报告说没发、其实发了"只看返回值抓不到。
- 反面案例登记：`docs/reference/ai-architecture.md:979` 把它列为第 4 条全局不变量。

### 19.4 `assertEnableable()` 与 `managed` 的有意失败 —— ✅ 成立，但**它不在生产出境路径上**

- 实现：`packages/ai/src/supply.ts:290-322`。`mode === 'managed'` 时查
  `retentionDisclosure('heyta-cloud').kind === 'undecided'` → 抛
  `AiConfigError(…, 'retention-undecided')`（`supply.ts:293-303`）。
  `retentionDisclosure` 对 `heyta-cloud` 恒返回 `{kind:'undecided'}`（`supply.ts:158-167`），
  `describeRetention` 对它**故意返回 `undefined`**（`supply.ts:229-242`，注释：「不许编一个听起来合理的数字」）。
- 测试：`packages/ai/tests/egress.spec.ts:162-178`（`managed` 必抛、理由必为 `retention-undecided`）。
- 门禁：`scripts/check-ai-coverage.mjs:410-425` —— **运行时真的调一次** `assertEnableable({mode:'managed'})`，
  不抛错就红（`check-ai-coverage.mjs:419`），抛了但理由不是 `retention-undecided` 也红（`422-425`）。
- 🔴 **必须如实记的一条边界**（`supply.ts:263-289` 的文件级注释自己承认）：
  生产出境入口 `invokeRouted` 走的是 `AiRoutingConfig`，那份配置**没有 `mode` 字段**，
  目的地由端点地址经 `classifyDestination({mode:'own',…})` 推导（`supply.ts:91-101`），
  **结构上推不出 `heyta-cloud`**。所以"托管云到不了"是**类型结构**保证的，
  `assertEnableable` 拦的是"把 `mode` 写成 `managed`"那条入口（`provider.ts` 的单端点/历史/测试路径）。
  → **政策口径**：托管 AI 目前**不是"关着的选项"，而是"根本不存在的选项"**。
  `AGENTS.md` / ADR-0013 的说法与代码一致（`docs/reference/ai-architecture.md:1022`：
  端点 / 计量 / 收银台**都不存在**）。

### 19.5 目的地判定（决定"要不要写出境条款"的分岔点）

- `classifyDestination`（`supply.ts:91-101`）：`off` → `none`；`managed` → `heyta-cloud`；
  `own` 且端点为空 → `none`；`own` 且回环 → `none`；**其余 → `user-endpoint`**。
- 回环判定 `isLoopbackEndpoint`（`supply.ts:73-88`）：只认**字面** `localhost` / `::1` / `127.0.0.0/8`；
  **不做 DNS 解析**，所以 `http://my-nas.local:11434` 这类 mDNS/局域网名**会被判成远端、要求出境授权**。
  取舍写在 `supply.ts:49-71`（引 Joplin 先例：`.local` 可以指向当前网络里任意一台主机，
  所以它证明不了"这是你这台机器"），代价写在 `supply.ts:67-71`。
- `requiresEgressConsent`（`supply.ts:104-106`）：**只有 `none` 免授权**。
- 授权失效：`retainValidConsents`（`egress.ts:187-194`）在切模式/切目的地时**删除**不匹配的授权，
  目的地切回本地时**一条都不留**（`egress.ts:191-192`）。
  → 政策可写："变更数据接收方后，此前的授权**不会被继承**。"


---

## C20 出境 payload 逐字段

**结论：出境面是「按功能白名单」的极窄切片，不是整库、不是实体序列化。用户内容（任务标题 / 任务备注正文 / 用户刚敲的那句话）确实以明文原文出境 —— 这点政策必须直写，不能写成"摘要"或"脱敏"。**

### 20.1 请求体的形状（唯一发送点）

生产出境执行点是 `packages/ai/src/routing.ts:865-893` 的 `attemptOnce()`：

```
POST  {endpoint}/chat/completions
body: { model, messages:[{role:'system'},{role:'user'}], tools?（可选）, tool_choice? }
```

- `routing.ts:871` 的注释是这条路径的判据原文：**「数据面恰好是 system + user（+ 可选 tools）。没有别的字段。」**
- 备用实现 `packages/ai/src/provider.ts:269-290` 形状相同（它不在生产路径上，见 C19.4），
  `provider.ts:266-268` 注释同样写明「**没有把整个 task 对象序列化进去** —— 出境的数据面必须恰好等于披露出去的那几个字段，不多一个」。
- 唯一携带明文的容器是 `AiInvocation.user`（`packages/ai/src/provider.ts:91-92`，注释原文：「用户内容 —— **这里装的就是要出境的数据**」）。
- `fields` 数组（`provider.ts:93-94`）**不是装饰**：它就是出境披露"将要送出这些字段"的读的数据源，
  且规则是「`user` 里出现的每一个数据字段，`fields` 里必须有同名项」（`ai-capture.ts:146-152`、`ai-breakdown.ts:77-83`）。
  双向都有测试钉住：`packages/app-host/tests/ai-capture.spec.ts:198`（fields 必须覆盖 user）
  与 `ai-capture.spec.ts:202`（**fields 不许有 user 里没有的字段 —— 披露不能虚报**）。

### 20.2 逐功能、逐字段（🔴 这就是政策"向第三方提供个人信息"那节要抄的表）

| 功能 | 实际出境内容（逐字段） | 是否原文明文 | 字段声明行号 | user 内容拼装行号 | 封顶 |
|---|---|---|---|---|---|
| `capture` 一句话捕获 | `today`（**本机设备的本地日期 + 星期**）、`text`（用户敲的那句话原文）、可选 `preferences` | ✅ 全部原文 | `packages/app-host/src/ai-capture.ts:169`（`['today','text']`）、`:189`（`preferences`） | `ai-capture.ts:182`：`今天是：${day}（周${weekday}）` + `要捕获的一句话：${text}` | 输入 **500 字符，超出直接拒绝**（`ai-capture.ts:92`、拒绝在 `:530-538`） |
| `breakdown` 拆解任务 | `title`（任务标题原文）、可选 `note`（**任务备注正文原文**）、可选 `preferences` | ✅ 全部原文 | `packages/app-host/src/ai-breakdown.ts:103`（`['title']`）、`:106`（`note`）、`:115`（`preferences`） | `ai-breakdown.ts:104`、`:107`（`已有备注：\n${source.note}` —— **整段正文照发**） | 备注**无长度截断**（只有空白才不发，`ai-breakdown.ts:105`） |
| `prioritize` 优先级建议 | `tasks` = 至多 50 条任务的 `{id, title, dueDate?, priority?}` 的 **JSON 原文**、可选 `preferences` | ✅ 标题原文 + 实体 id | `packages/app-host/src/ai-prioritize.ts:205`、`:211` | `ai-prioritize.ts:206`（`JSON.stringify(tasks)`） | 50 条（`ai-prioritize.ts:74`）；**截断发生在构造调用层**（`ai-prioritize.ts:192-194`，注释：出境面必须在数据被写进 `user` 之前就收窄）；缺省字段**不出现**而不是写 `null`（`ai-prioritize.ts:197-200`） |
| `duration-estimate` 估时 | `title`、可选 `note`（正文原文）、可选 `history`（**最近至多 20 条专注记录**，每条 `plannedMs`/`actualMs` → 渲染成分钟数，无时间戳、无任务 id） | ✅ 标题与备注原文；历史是**时长数字**而非日期 | `packages/app-host/src/ai-duration.ts:215`、`:219`、`:228` | `ai-duration.ts:216`、`:220`、历史块 `:176-187` | 20 行（`ai-duration.ts:89`、选取逻辑 `:153-163`：先过滤再截尾部）；注释 `:30-32` 明确「那 500 条只在本机参与统计、**不出境**，而这里每一条都会出境」 |
| `tool-calling` 工具选择 | `text`（用户那句话原文）、**`tools`（已授权工具的名字 + 描述 + 参数 JSON Schema）** | ✅ 全部原文 | `packages/app-host/src/ai-tool-call.ts:73`：`TOOL_CALL_EGRESS_FIELDS = ['text','tools']` | `ai-tool-call.ts:104`（`用户这句话：${source.text}`）；工具目录进 `tools` 数组（`ai-tool-call.ts:116-122`，序列化在 `routing.ts:883-891`） | 500 字符（`ai-tool-call.ts:65`） |

**🔴 `tool-calling` 那条的第二项要单独写进政策**：出境的不只是用户内容，还包括
「这台设备上有哪些能力」—— 已授权工具名与其参数 schema。代码自己承认这点：
`ai-tool-call.ts:18-23`「工具名是"这台机器有什么能力"的信息……少写它 = 用户授权时看不到"能力范围也会被发出去"」。
且这条链路有一条**先本机后出境**的顺序：`ai-tool-call.ts:8-16` ——
纯规则选择器（`ai-tool-selection.ts`）先跑，命中就**一次都不出境**，只有 `no-match`/`ambiguous` 才发给模型。

### 20.3 明确**不**出境的东西（政策里可以放心写的部分）

1. **没有整库导出路径**。全仓 `invokeRouted` 的调用点只有 5 处：
   `ai-capture.ts:542`、`ai-breakdown.ts:310`、`ai-prioritize.ts:405`、`ai-duration.ts:438`、`ai-tool-call.ts:236`。
   每一个都只喂上面那张表里的字段，没有任何一处 `exportDump` / op-log 全量进 prompt。
2. **凭据不出境**。`AiEndpointConfig` **没有 `apiKey` 字段**，只有 `keyRef`（`routing.ts:70-77, 101`）；
   密钥经 `SecretStore` 端口取（`routing.ts:238-240`），且只作为 `Authorization: Bearer` 头发给**用户自己配的那个端点**（`routing.ts:869`）。
   URL 里带 userinfo 直接拒绝（`routing.ts:440-446`）。
3. **身份标识不出境**：五个 payload 里没有邮箱、userId、订阅信息、设备 id。
   `prioritize` 里的 `task.id` 是**实体 id**（`ai-prioritize.ts:195`），它是用户数据的一部分而非身份标识，
   但仍应如实写进政策（它是可关联的标识符）。
4. **便签（NOTE 实体）正文目前没有任何 AI 出境路径**：`packages/app-host/src/note-actions.ts` 不 import `@heyta/ai`，
   五个功能里也没有读便签集合的调用点。⚠️ 注意区分：`breakdown`/`duration` 的 `note` 字段是**任务的备注**（`ai-breakdown.ts:70-71`），
   不是"便签"这个实体。
5. **习惯打卡记录不出境**：出境的只有 `duration-estimate` 的 `history`（专注时长数字，`ai-duration.ts:228`）
   与偏好提示 `preferences`（见 C23）。没有"整张习惯表"这条路径。

### 20.4 提示词本身的语言与输出语言（顺带核实的一条）

系统提示词是**中文**（例：`ai-capture.ts:195-209`），而 `locale` 是**必填、无默认值**
（`ai-capture.ts:115-124`、`ai-breakdown.ts:63-69`）—— 理由是「英文界面用户点确认后，
模型回的中文标题会**写进数据并同步**，泄漏的不是文案而是存量数据」（`ai-capture.ts:117-120`）。
→ 政策上这不影响出境判定，但它说明：**AI 产物的默认路径是"进同步"**，
所以界面上的确认步骤（C20.5）是隐私面而非体验面。

### 20.5 出境之后：AI 只产出候选，写库要用户确认

- 类型层保证：`AiSuggestion` 没有任何形状能变成 op（`packages/ai/src/provider.ts:12-24, 106-122`）；
  `CaptureProposal`（`ai-capture.ts:456-465`）/ `BreakdownProposal`（`ai-breakdown.ts:227-233`）同理。
- 顺序是硬的：**先展示会发哪些字段 → 用户确认 → 才发请求 → 再显示结果**，
  常量 `EGRESS_ORDER_NOTE`（`packages/ai/src/provider.ts:435-437`，注释「不允许先发再问」）。
- 工具调用的写操作：**模型说的不算数**，写工具只产出"待确认提案"，`confirmAiToolProposal()` 才落库
  （`ai-tool-call.ts:25-37`，ADR-0035）。
- ⚠️ 诚实边界：`EGRESS_ORDER_NOTE` 当前**零调用点**（连测试都没有，`provider.ts:429-434` 自己写明），
  它的实际消费者是文档。真正在界面上执行"先授权再出境"的是 `invokeRouted` 里
  **授权检查在网络之前**（`routing.ts:712`）+ 四个 AI 面板各自组装 `buildDisclosure`。


---

## C21 provider 端点配置与 URL 校验

**结论：base URL 完全由用户自填，没有任何厂商 allowlist、没有地区/国别判定 —— 所以「能否指向境外」答案是「能，而且 heyta 不参与选择、也不知道它在哪」。这条直接决定了政策里"向第三方提供"那一节必须写成"由你自行指定，我们不加筛选"。AGENTS.md 声称的「URL 校验在保存与发送两个点执行」✅ 成立，且实际是**四个点**。**

### 21.1 谁能配、默认值

| 项 | 取值 | 位置 |
|---|---|---|
| 内置预设 | **只有两个，且都是回环地址**：本机 Ollama `http://localhost:11434/v1`（默认模型 `qwen3:8b`）、本机 LM Studio `http://127.0.0.1:1234/v1` | `packages/ai/src/presets.ts:58-84`（地址 `:67`、`:80`；模型 `:68`、`:81`） |
| 🔴 **刻意不内置任何云端预设** | 理由写在文件头：清单会过期，且「内置云端预设等于 heyta 在**推荐**某个目的地，而"数据发到哪"应该是用户自己的决定」 | `presets.ts:23-36`（`:28-31` 是那句理由） |
| 守门断言 | `presetDestinations()` 把"预设全是本机的"变成**可断言属性**，将来有人加云端预设测试会红 | `presets.ts:99-116` |
| 出厂配置 | `endpoints: []`、`routes: {}`（**不预置任何功能**，理由：预置会让"打开总开关"变成"好几个功能悄悄开始跑"） | `apps/web/src/features/settings/aiStore.ts:89-93` |
| 密钥 | 配置里**没有 `apiKey` 字段**，只有 `keyRef`（指向壳的 `SecretStore`／系统钥匙串） | `packages/ai/src/routing.ts:70-77`、`:101` |
| UI 写入口 | `addEndpoint()` 校验不过就**拒绝写入**并把 `reason` 交给词条表渲染；`removeEndpoint()` 删除 | `apps/web/src/features/settings/AiSettings.tsx:413-420`、`:493` |

⚠️ 界面**只有"新增 / 删除"，没有"就地编辑地址"**（`AiSettings.tsx` 里与端点写有关的函数是 `addEndpoint` 与 `removeEndpoint`），
所以改地址必然重新过一遍保存时校验 —— 这一点值得在政策里当成"配置变更需重新授权"的支撑（配合 C19.5 的 `retainValidConsents`）。

### 21.2 校验规则本身（`validateEndpointUrl`）

`packages/ai/src/routing.ts:419-463`，四条规则、四种 `reason`（`routing.ts:381-383`）：

1. `unparseable` —— 不是合法 URL（`:421-429`）
2. `bad-scheme` —— **协议必须是 http/https**（`:431-437`）
3. `credentials-in-url` —— **URL 里带用户名/密码直接拒**（`:439-446`，理由：密钥会进配置、日志、任何打印它的地方）
4. `plaintext-remote` —— 🔴 **远端端点必须是 https；本机允许 http**（`:448-460`）
   分岔表在 `routing.ts:409-417` 的文件头注释里，理由写在 `:415-417`：
   「远端明文 HTTP 意味着用户的提示内容会以明文经过网络，而 heyta 的同步通道是端到端加密的 ——
   在 AI 这条路上退化成明文 HTTP 会让整个产品的隐私承诺自相矛盾」。
   ⚠️ 这里**故意与 SSOS 反向**：SSOS 拒 localhost（防 SSRF），heyta 必须允许（`routing.ts:400-407`）。

**没有的东西（政策不要写）**：没有 host allowlist、没有私网/内网 IP 拒绝（除上面反向的 localhost 判定）、
**没有国别或地区判定**、没有"必须是我们认可的服务商"。所以：
- 用户填 `https://api.openai.com/v1` 之类的境外端点 → 校验**只判 https**，判定为 `user-endpoint`（需出境授权）后放行。
- 用户填 `http://192.168.1.20:11434/v1`（局域网另一台机器）→ 被 `isLoopbackEndpoint` 判成**远端**，
  需 https（明文 http 会被 `plaintext-remote` 拒），且需出境授权（见 C19.5 的副作用说明 `supply.ts:67-71`）。

### 21.3 「保存与发送两个点」 —— ✅ 成立，且实为四点

| # | 点 | 位置 | 作用 |
|---|---|---|---|
| 1 | **保存时** | `apps/web/src/features/settings/AiSettings.tsx:414`（在 `addEndpoint` 内，`:415-417` 不 ok 就 `setRejected` 并 `return`，不写进状态） | 挡住用户手填的坏地址 |
| 2 | **候选解析时** | `packages/ai/src/routing.ts:546-551`（注释「① URL 校验（第一次：解析候选时）」，不 ok → 排除原因 `endpoint-url-rejected`） | 挡住同步/迁移进来的坏端点 |
| 3 | 🔴 **真正发请求的那一刻** | `packages/ai/src/routing.ts:838-857`（注释「🔴🔴 第二次 URL 校验 —— 在真正要发的那一刻」；`:848-849`：「配置可能来自导入/同步/迁移/手工改文件，任何一条路径都可能绕过保存时的校验。而这里是**唯一的实际发送点**……**这不是重复代码，是纵深防御。删掉它，校验就退化成只防君子**」） | 执行点 |
| 4 | **从磁盘读回时** | `apps/web/src/features/settings/aiStore.ts:151-175`（`sanitizeRouting`：注释「🔴 它**强制**两件事，不信任存储里的值……每个端点必须通过 URL 校验；**不合法的端点直接被丢掉**」） | 挡住被篡改/过期的 `localStorage` |

判据来源是移植自 SSOS 的一句话，原文保留在注释里：
「Enforcement has to sit on the path that actually sends the request, not only on the path that stores it.」
（`routing.ts:390-394`）。

另外一条**独立于校验的加固**：`aiStore.ts:203-206` —— 本机 API 的 `bindAddress` 永不从存储读回，
永远用默认回环值（防止存储被改成 `0.0.0.0` 后悄悄暴露到局域网）。

### 21.4 与出境授权的关系（政策口径的关键一句）

因为**目的地由端点地址推导、不由模式声明**（`supply.ts:91-101, 37-45`），
"发给哪个第三方"这件事在代码里没有 heyta 的任何参与：
- 我们既不提供云端预设（`presets.ts:23-36`），
- 也不维护允许清单（21.2），
- 也不知道该端点的日志与保留策略（`supply.ts:210-211` 的披露文案原文：
  「该端点由你提供，heyta 不参与，也无法审计它的日志与保留策略」；
  `retentionDisclosure` 对 `user-endpoint` 返回 `{kind:'third-party-decides'}`，`supply.ts:158-167`）。

→ **政策上这是"受托处理"还是"用户自行向第三方提供"？** 代码给出的答案明确偏向后者：
用户在设置里自己填地址、自己拿 key、heyta 只在中间执行一次被逐功能授权的转发。
`routing.ts:728-729` 的拒绝消息也会把 `fields` 逐项列出来（`发送内容：${d.fields.join('、')}`）。


---

## C22 本机 API / MCP：默认关、回环、token、逐工具授权

**结论：四条声明（默认关 / 每工具单独默认关 / 只监听回环 / 显式 token）✅ 全部成立且有代码与测试。**
**但有一条必须在政策里如实写下来：`readable` 目前在两个真实壳里恒为 `true` —— 也就是"加密条目可列举、不可读"这条 Bear 范式底线**当前没有产品概念支撑**，一旦用户打开 `get_task`，本机程序能读到任务备注正文全文。**

### 22.1 四条声明逐条核对

| 声明 | 判定 | 证据 |
|---|---|---|
| **总开关默认关** | ✅ | `packages/local-api/src/tools.ts:255-259` `DEFAULT_LOCAL_API_CONFIG = { enabled:false, bindAddress:'127.0.0.1', port:47119 }`；关着时 `authorizeToolCall` 第一道就拒（`tools.ts:382-388`，reason `api-disabled`） |
| **每个工具单独默认关** | 🔴 这是 `LocalApiTool.defaultEnabled` 的**类型层面常量 `false`**（`tools.ts:51-64`，注释：「这不是"暂时没空写默认值"，是刻意的：本机工具访问一旦默认打开，任何本机程序都能读走全部任务」）；判据是 `isToolGranted`：**未列出 = 关闭**，`grants?.[toolName] === true`（`tools.ts:453-455`）。未授权时拒绝原因 `tool-not-granted`，消息原文「本机工具默认全部关闭，需要在设置里逐个打开」（`tools.ts:424-430`）。⚠️ 注意 `defaultEnabled` 这个字段本身**只是目录里的声明**，真正的判据是 `isToolGranted`（`tools.ts:438-447` 说明它被 MCP 与内置 AI **两个入口共用**，"同一个工具在两个入口被两套规则判定"这件事不会发生） |
| **只监听回环** | ✅ 校验：`validateLocalApiConfig` 在 `enabled===true` 时非回环直接拒（`tools.ts:300-309`，reason `not-loopback`，消息说明监听别的地址会把任务暴露给同一网络里的人）；`isLoopbackAddress` **显式拒绝 `0.0.0.0` / `::` / `*`**（`tools.ts:323-330`），接受 `localhost`/`::1`/整个 `127.0.0.0/8`（`:331-341`）。监听点：`apps/node-host/src/local-api-server.ts:159`（注释 `:157-158`：绑定地址来自配置、已校验为回环，**判断只该有一个地方**）。CLI 侧更硬：`apps/node-host/src/cli-mcp.ts:72-74` 与 `cli-local-api.ts:155-156` **绑地址写死 `127.0.0.1`、不从文件/命令行/环境读**。测试：`local-api-server.spec.ts:139`（`0.0.0.0` 拒）、`:146`（`::` 拒）、`mcp-stdio-e2e.spec.ts:242`（配置文件里写 `0.0.0.0` 也不生效） |
| **显式 token** | ✅ `enabled` 时 token 必须非空（`tools.ts:290-298`，消息原文：「没有 token 的话，这台机器上的任何程序都能读走你的全部任务」）。**token 比较是定长的**（`tools.ts:463-472`，理由在 `:373-375`：`===` 会在第一个不同字符处提前返回、理论上可被计时探测）。壳从 header 取：`packages/local-api/src/server.ts:19`（`x-heyta-token`）。**顺序加固**：token 校验排在"工具是否存在"**之前**（`tools.ts:361-371`），理由写在 `:368-371`：否则没带 token 的调用方能靠两种不同错误**枚举出 heyta 提供了哪些工具**；同样的顺序在 JSON-RPC 会话层再走一遍（`server.ts:140`、`:165-187`）。`token` 展示永远打码（`cli-local-api.ts:201-202`） |
| **未授权即不可见**（额外一条） | ✅ `listMcpTools` / `listAuthorizedTools` **只返回已授权工具**（`packages/local-api/src/mcp.ts:18-19`：「未授权的工具对 MCP 客户端**完全不可见** —— 不是"看得见但调不动"」）；`mcp.ts:146-148` 是实现。与 `authorizeToolCall` 的分工表在 `mcp.ts:22-33`（握手时不暴露 + 每次调用时拒绝，**两道都要有**） |

### 22.2 🔴 读工具能读到什么明文（这条决定政策要不要写"本机其他程序可访问多少数据"）

工具目录共 **6 个：3 读 + 3 写**（`packages/local-api/src/tools.ts:66-114`，刻意比 Joplin 的 11 个小，理由在 `:69-73`）。

| 工具 | 类型 | 返回字段（逐项） | 明文正文？ | 定义行号 |
|---|---|---|---|---|
| `list_tasks` | read | `id`、`title`、`dueDate`（本地日期串）、`priority`（none/low/medium/high）、`completed` | ❌ **不返回备注正文**（描述原文：「不返回备注正文 —— 备注要单独用 get_task 取」） | `tools.ts:76-83`；投影 `packages/app-host/src/local-api-host.ts:117-130`；默认 limit **50** 条（`local-api-host.ts:161-162`） |
| `get_task` | read | 上面全部 **+ `body`（任务备注正文全文）** | ✅ **是，正文全文** | `tools.ts:84-89`；`local-api-host.ts:128`（`if (readable && task.note !== undefined) item.body = task.note`） |
| `list_projects` | read | 清单个数（标题 + 任务数量） | ❌ 无正文 | `tools.ts:90-95`；`local-api-host.ts:171-176` |
| `create_task` | write | — | — | `tools.ts:96-101`（必须走 op-log） |
| `update_task` | write | 只改显式给定的字段 | — | `tools.ts:102-107` |
| `complete_task` | write | — | — | `tools.ts:108-113` |

**明文面判定（政策要用的那句话）**：
- 只开 `list_tasks` → 外部程序拿到**全部任务标题 + 截止时间 + 优先级 + 完成状态**（一次最多 50 条，可反复翻页）。这本身已经是可观的个人信息面 —— 标题与截止时间能拼出一个人的日程。
- 开了 `get_task` → 再加上**任意单条任务的备注正文全文**。
- 写工具能创建/修改/完成用户任务（且**只**能经 `LocalApiWritePort.submit`，本包**类型上造不出 op**：`tools.ts:478-516`）。

**「加密条目可列举、不可读」这条底线的真实现状**（🔴 政策必须按现状写，不能按 ADR 写）：
- 契约存在且实现完整：`projectForTool` 用**白名单重建**剥掉正文（`tools.ts:174-188`，`:186` 注释「`body` 在这里故意不被复制 —— 这就是整件事的目的」；白名单而非黑名单的理由在 `:170-173`）；
  `readItemForTool` 对 `get_task` **明确报错而不是返回空**（`tools.ts:196-216`，理由：返回空会让调用方以为读成功了）。
- 但**判据 `isReadable` 在两个真实壳里都恒为 `true`**：
  `apps/node-host/src/cli-mcp.ts:123`（`isReadable: () => true`，注释 `:118-119`：「heyta 还没有"受保护条目"这个产品概念（ADR-0011 §6.1 列为唯一产品空白），所以本机也没有任何条目是读不出来的」）
  与 `apps/web/src/features/tasks/store.ts:214`（同样 `isReadable: () => true`）。
- ⚠️ 这条曾经坏得更隐蔽：`isReadable` 原来有默认值 `() => true`，导致"壳没传"和"壳传了 true"**无法区分**，
  整个 Bear 范式路径在生产里**从不执行且没有任何信号**。现在它是**必填、无默认值**
  （`packages/app-host/src/local-api-host.ts:48-67`，理由全在 `:52-65`；`options` 参数由可选改必填的说明在 `:135-147`，
  那句判据是「一个隐私相关的开关**不允许静默地失败在 open 那一侧**」）。

### 22.3 与内置 AI / 出站路径的耦合（政策上不能忽略的一点）

`packages/local-api` 的工具目录**同时被出站 AI 使用**：`apps/web`/`app-host` 的 AI 工具路径调
`listAuthorizedTools(grants)` 生成给模型的 `tools` 描述符（`packages/app-host/src/ai-tool-call.ts:116-122`），
执行走 `isToolGranted` / `runReadTool` / `toWriteIntent`（`tools.ts:438-447` 的两调用方表）。
→ **含义**：用户为"本机程序访问"打开的每一个工具，**同时也扩大了内置 AI 出境时的能力面**
（工具名与参数 schema 会进模型上下文，见 C20 的 `tool-calling` 行）。
政策里如果把"MCP/本机 API"和"AI 功能"写成两件互不相干的事，就会与代码不符。

### 22.4 边界（别读多）

- **真正的 HTTP 监听只在 `apps/node-host`**（`local-api-server.ts:70` 是唯一 `startLocalApiServer` 生产实现）；
  浏览器壳无法监听端口，`apps/web` 设置页里那段是**配置编辑面**，
  且界面自己写明配置文件是 `~/.heyta/local-api.json`、**两边不会自动同步**（`AiSettings.tsx:982`、`:985-990`）。
- web 侧的本机 API 校验只在保存/展示时执行（`AiSettings.tsx:384` 调 `validateLocalApiConfig`，错误文案 `:204-215`）。
- 未穷尽：`packages/local-api/src/server.ts` 的 JSON-RPC 方法面（`initialize`/`tools/list`/`tools/call`）与
  `mcp.ts` 的 285 行只做了定点抽查，没有逐行读完。


---

## C23 记忆偏好层（ADR-0014）

**结论：三条声明全部成立 —— ① `memoryEnabled` 必填且默认关闭（fail-closed）；② 推断结果**不落盘**、每次从 op-log 重算；③ 用户的"纠正"**确实进 op-log**，因此它是一条会被同步到服务端的实体（密文）。第三条是政策里最容易被写歪的一点，见 23.3。**

### 23.1 `memoryEnabled`：必填 + 默认关 + 读回时严格

| 面 | 证据 |
|---|---|
| 领域层**必填、无默认值** | `packages/domain/src/preferences.ts:27` 的文件头纪律原文：「**② 主开关 fail-closed。** `memoryEnabled` 是**必填**参数，不是可选」；类型 `preferences.ts:83`、`:181` |
| 关闭时**立刻返回空集** | `preferences.ts:722-727`：注释「🔴 `input.memoryEnabled === false` 时立即返回空集」，实现 `if (!input.memoryEnabled) return emptyPreferenceSet(false)` |
| 提示层再兜一次底 | `packages/domain/src/preference-hints.ts:144-148`：`renderPreferenceHints` 第一行 `if (!set.memoryEnabled) return []` |
| 持久化默认 `false` | `apps/web/src/features/settings/aiStore.ts:75`（声明 + 注释「默认 **false**。关闭时偏好层**零推断、零偏好进 prompt**」）、出厂值 `:98` |
| 读回时只认真布尔 | `aiStore.ts:122-126`：`memoryEnabled: candidate.memoryEnabled === true`，注释「存成字符串 "true"、数字 1、或字段缺失 —— 一律按关闭处理。隐私闸门不接受"看起来像真"的值」 |
| **它与"用不用 AI"是两个开关** | `aiStore.ts:71-73`：「与 `routing`/`localApi` 不同，它**不是**"AI 能不能用"的开关 —— AI 可以照常工作，只是不记得你」→ 政策里这两个同意**必须分开写**，不能合并成"AI 授权" |

### 23.2 推断结果不持久化 —— ✅ 成立，而且是纯派生

- 实现点：`apps/web/src/App.tsx:774-834` 的 `useMemo`。
  文件级理由写在 `:775-778`：「🔴 记忆层：**每次从 op-log 派生，不落盘**（ADR-0014 §3.3）。
  为什么在这里算而不是存起来：**存了就会漂移，而漂移的"用户画像"比没有更糟**」，
  依赖数组 `:834` = `[aiSettings.memoryEnabled, store.entities, opWindow]`（数据变了就重算，不缓存结论）。
- 更狠的一条：**关闭时连算都不算、连 op 事件流都不读** ——
  `App.tsx:791-795`（「关闭时连算都不算（隐私红线：不留"算了但没显示"的中间态）」）、
  `App.tsx:846-850`（`memoryEnabled !== true` → `setOpWindow(null)` 并 `return`，注释 `:840`「**只在记忆开启时读**」）。
  → 这就是 D24「撤回同意是否立即生效于当下行为」在记忆层的答案：**是，且是结构性的**（关掉之后连输入都不再被读取）。
- 每条偏好注入前还要过一层"该功能要不要它"的白名单：
  `preference-hints.ts:60-70` —— `'tool-calling': []`，注释原文
  「上面每加一条，就等于**允许该功能多送一条用户信息出境**」，且这个 key **必须存在**（缺了就把"想过、决定不要"变成"忘了想"）。

### 23.3 🔴 用户的「纠正」会进 op-log ⇒ 会被同步（政策必须如实写的一点）

- 写入：`packages/app-host/src/ai-feedback-actions.ts:94-107` —— `suppress(preferenceId)` 经
  `ctx.dispatch({ entityType: 'PREFERENCE_CORRECTION', opType: OpType.Create, payload: { preferenceId, kind: 'suppress' } })`。
  撤销：`:109-121` 发 `OpType.Delete`（走墓碑，不是硬删）。
  未知 id **拒绝记录**（`:96-98` 抛错，理由：「记下来也没人认得，只会变成永远清不掉的垃圾」）。
- 它是**真的被物化的实体**，不是摆设：
  `packages/domain/src/entities.ts:357-361`（`interface PreferenceCorrection`，字段只有 `preferenceId` + `kind`）、
  `:447`（进 `EntityModelMap`）、`:474`（进 `MODELED_ENTITY_TYPES`，编译期断言在 `:480+` 保证两处不许漂移）、
  `packages/op-log/src/state.ts:91`（`PREFERENCE_CORRECTION: 'preferenceCorrections'` 状态桶）、
  `packages/shared-schema/src/entity-types.ts:72`（线协议实体清单成员）。
- **含义（一句话）**：一条偏好纠正 = 一条 op = 会经端到端加密同步到服务端并留在 op-log 里。
  出境到**模型**的不是纠正本身，而是**纠正之后的偏好集合**（被抑制的那条不再进 prompt，
  判据 `packages/domain/src/preference-corrections.ts:47-60` `suppressedPreferenceIds`，墓碑不算抑制 = 删掉纠正即恢复该偏好）。
- 🔴 **政策要精确到这一层**：`PREFERENCE_CORRECTION` 的 payload 只有
  `{ preferenceId, kind }`（`entities.ts:357-361`）—— **不含任务标题、不含邮件、不含任何正文**，
  `preferenceId` 是封闭词表的机器名（`estimate-bias` / `deep-work-window` / `lead-time` / `granularity` / `title-style`，
  中文名表在 `packages/domain/src/preference-corrections.ts:74-80`）。
  所以"纠正会同步"这句话是真的，但它同步的是**一个偏好标识**，不是一份画像内容。
- ⚠️ 未穷尽：`ADR-0014` 声称两个新实体是"纯可加性、不需 bump `CURRENT_SCHEMA_VERSION`"——
  本轮只核到实体注册三处一致，没有去核 `shared-schema` 的 zod 线契约与 hydration 行为。

### 23.4 记忆内容出境的形态（接 C20）

真正进 prompt 的是 `renderHintBlock`（`preference-hints.ts:173-176`）：

```
关于这位用户的历史习惯（仅作参考，不要复述）：
- 实际用时约为自己估计的 1.32 倍（倾向低估），给子项估时请按此放大
- 高效时段是 09:00–12:00，重要或困难的事宜安排在此区间
```

即：**出境的是若干条中文自然语言画像陈述**（由 `toHint` 生成，`preference-hints.ts:107-137`），
不是原始记录集合。字段名在披露里统一叫 `preferences`（一个字段，不是每项一个，
理由见 `ai-breakdown.ts:110-113` / `ai-capture.ts:184-187` / `ai-prioritize.ts:208-209`）。
其中 `title-style` 那条会带 **CJK 占比、emoji 占比、标题平均字数**（`preference-hints.ts:128-134`）——
这是统计量、不是内容，但它确实揭示了用户的语言与表达习惯。


---

## D24 数据主体权利逐项核对

**总判：六项权利里，查阅/复制、更正（业务数据）、删除（三段式）、撤回同意 ✅ 有真实可用入口且"关掉即生效"有代码支撑；
注销账号 🔴 服务端有真·硬删端点但**应用内零入口**；账号身份（邮箱）更正 ❌ 无入口。**

| 权利 | 判定 | 一句话 |
|---|---|---|
| 查阅 / 复制（可携带） | ✅ 有入口，且导出的**是明文全量**（含 op-log 与墓碑） | Web + CLI + 移动端三端可导出；导入仅 Web + CLI |
| 更正（业务数据） | ✅ 覆盖面广 | 任务 12 类字段可改，走 op-log ⇒ 会同步到其他设备 |
| 更正（账号身份：邮箱） | ❌ 无入口 | 服务端只有 `PUT /account/locale` 与 `DELETE /account`，**没有改邮箱的路由** |
| 删除 | ✅ 有入口（三段），但 🔴 "彻底删除"**不删服务端已有密文** | `purgedAt` 只是一个加性标记 |
| 注销账号 | ⚠️ **服务端 ✅ 有端点 + 测试；用户侧 ❌ 无入口** | 见 24.4 |
| 撤回同意 | ✅ 立即可信（AI 出境 / 记忆层 / 推送订阅三处都拿到证据） | 见 24.5 |
| 拒绝非必要权限仍能用基本功能 | ✅ 结构成立 | 所有隐私开关出厂为 `false`，功能不依赖 AI |

### 24.1 查阅 / 复制（导出）

**入口位置（三端）**：
- Web：`apps/web/src/features/settings/ExportPanel.tsx`（构造器在 `packages/app-host/src/export-dump.ts`）。
- CLI：`apps/node-host/src/cli.ts:175` 帮助文本
  `export --out <路径> 导出全部数据到 JSON 文件（含已删除记录与完整操作日志）`，分派 `:385`（`case 'export':`）、执行 `:397`。
- 移动端：`apps/mobile/src/screens/ProfileScreen.tsx:19`（import）、`:43`、`:167`、`:275-277`、`:298`
  —— 测试 id `profile-entry-export`，文案 key `t('mobile.export.entry')`。

**导出文档到底含什么**（政策里"复制权"的范围要按这个写，`packages/app-host/src/export-dump.ts:92-113`）：

| 字段 | 内容 | 行号 |
|---|---|---|
| `entities` | **物化状态里的全部实体，按类型分组，含墓碑** | `:102-108` |
| `opLog` | **完整 op-log**，按 `(timestamp, id)` 确定性排序 | `:109-110` |
| `counts` | 实体数 / `totalDeleted` / `totalOps` / 按实体类型的 op 计数 | `:78-89` |
| 元数据 | `formatVersion`、`app.name`/`app.host`、`exportedAt`（ISO 8601）、`schemaVersion` | `:94-100` |

- 🔴 **导出的是解密后的明文 JSON**：数据源是 `MaterializedState` 与本地 op-log（`BuildExportOptions` `:116-125`），
  即 E2EE 在客户端解开之后的东西 —— 任务标题、备注正文、习惯与专注记录全在里面。
  政策里"你可以导出你的数据"要连带一句**导出文件本身不受加密保护**，落盘位置由用户自己负责。
- ⚠️ 诚实边界（代码自己写在 `:104-107`）：`entities` **只覆盖被 reducer 物化的实体类型**；
  `REMINDER` 等"合法但未物化"的实体只存在于 `opLog` 里 —— 所以"导全了"这句话对**整份文档**成立、
  对 `entities` 字段单独成立不了。政策别写"实体清单即全量数据"。
- 另有面向人读的 Markdown 导出：`export-dump.ts:245-325`（`buildTaskExportRows` / `renderTasksMarkdown`），
  文件名带导出时刻（`exportFileName` `:232-243`）。

**反向（导入 = 迁移/可携带权的另一半）**：
- Web：`apps/web/src/features/settings/ImportPanel.tsx` + `packages/app-host/src/import-dump.ts`。
- CLI：`apps/node-host/src/cli.ts`（与 `export` 同族命令）。
- 🔴 **移动端只有导出、没有导入入口**（`ProfileScreen.tsx` 里出现的入口 key 只有 `mobile.export.entry`）
  ⇒ AGENTS 声称的"导出三端 / 导入两端"**✅ 与代码一致**。
- 第三方迁入另有专用通道：`apps/ticktick2heyta/` 与 `packages/app-host/src/ticktick-import-actions.ts`（入站，不涉及出境）。

### 24.2 更正（哪些字段真能改）

**任务字段可改面**（接口声明 `packages/app-host/src/actions.ts:125-297`，实现在 `:408+`）：

| 可更正项 | 方法 | 声明行 |
|---|---|---|
| 标题 | `rename(entityId, title)`（空标题拒绝 `:424`） | `:127` / 实现 `:422` |
| 备注正文 | `setNote(entityId, note \| undefined)` | `:234` / 实现 `:534` |
| 截止时间 | `setDueDate(entityId, number \| undefined)` | `:204` / 实现 `:514` |
| 今天延期 | `postponeToToday(entityId)` | `:222` / 实现 `:519` |
| 优先级 | `setPriority(entityId, Priority)` | `:183` / 实现 `:493` |
| 重要标记 | `setImportant()`、`setQuadrantDrop(plan)`（可连带改 `dueDate`，`:508`） | `:185`、`:202` |
| 完成状态 | `setCompleted()` / `toggleCompleted()` | `:129`、`:131` |
| 归属 | `moveToProject()`、`setParent()`、`setTags()` | `:236`、`:250`、`:270` |
| 重复规则 | `setRepeat(rule \| undefined)` | `:285` |
| 删除/恢复/彻底删除 | `remove()` `:450`、`restore()` `:460`、`purge()` `:480` | `:133`、`:165`、`:182` |

其它实体域的更正：`project-actions.ts`、`note-actions.ts`、`habit-actions.ts`、`focus-actions.ts`、
`reminder-actions.ts`、`category-report.ts`、`timeline-plan.ts`（同一套 `ctx.dispatch` op-log 写入口，
`actions.ts:69` `dispatch(intent: OpIntent)`）。⚠️ 这些文件本轮**只核到存在与共用写入口，未逐行读完**。

**"更正"在架构上的真实含义（政策要写对的一点）**：
heyta 是 op-log / 事件溯源（`CLAUDE.md` 顶格那句），**更正 = 追加一条新 op，不是原地改写**。
所以：一条数据被改过几次，历史里就有几条 op；配合 D25 的 45 天保留期，
"更正"并不会把旧值立刻抹掉 —— 旧值仍以（服务端看不懂的）密文形式留在 op-log 里。

**账号身份**：❌ **无改邮箱入口**。服务端账号面只有两条路由 ——
`server/src/api.ts:512-513` `fastify.put('/account/locale', …)`（账号语言，属可更正的元数据）与
`server/src/api.ts:548-551` `fastify.delete('/account', …)`。
`grep "change-email|email-change"` 在 `server/src/**` **无匹配**；`packages/app-host/src/hosted-auth.ts:65-89`
的 `HOSTED_AUTH_PATHS` 里也没有任何改邮箱路径。

### 24.3 删除：三段式与 `purgedAt` 的真实语义

| 段 | 做什么 | 证据 |
|---|---|---|
| ① 软删（回收站） | `remove(entityId)` 写 `deletedAt` | `packages/app-host/src/actions.ts:450`；回收站列表 `listTrashed()` `:304`；UI `apps/web/src/features/trash/TrashView.tsx:13` |
| ② 恢复 | `restore(entityId)`：未删直接 return（`:471`），**已 `purgedAt` 的拒绝恢复**（`:465`） | `actions.ts:460-476` |
| ③ 彻底删除 | `purge(entityId)`：必须在回收站里（`:483`）、幂等（`:487`），实际动作是 `await update(entityId, { purgedAt: now() })` | `actions.ts:480-490`；契约说明 `:167-182` |

🔴 **`purge` 不删服务端数据，它只是加一条 op**：
- 契约原文是"加性 `UPD {purgedAt}`"，并**另外**发一条 `deletedAt` UPDATE + Create 墓碑给老客户端（`actions.ts:167-182`）。
- 语义文档：`packages/domain/src/entities.ts:38-51`（`purgedAt` = 已彻底删除、回收站不再显示；
  `:48-51` 明写"老客户端不认识它：读到一条带 `purgedAt` 的 op 只会当普通字段合并"）。
- 状态层证据：`packages/op-log/src/state.ts:209` —— 彻底删除**只是一个标记（UPD）**。

**政策后果（必须按这个写）**：
1. 用户点"彻底删除"后，**这台设备上"看不到"了**（客户端物化会隐藏 `purgedAt` 条目），
   但服务端仍持有含该数据的**历史 op（密文）**。
2. 服务端那批 op 的实际消失，只有两条路径：**D25 的 45 天保留期清扫**，或 **注销账号的级联硬删**。
3. 因此政策里"彻底删除"不能写成"立即从服务器销毁"，只能写成
   "从你的所有设备与界面中移除；服务器上承载它的加密历史记录会在保留期（当前 45 天）届满后被清除"。

### 24.4 注销账号 —— 🔴 全仓最大的一处不对称：**服务端能做，用户做不到**

**服务端：✅ 真·硬删，不是标记，且有测试。** `server/src/api.ts:548-594`：

| 细节 | 证据 |
|---|---|
| 路由与鉴权 | `fastify.delete('/account', { preHandler: authenticate, config: { rateLimit: { max: 3, timeWindow: '15 minutes' } } }, …)` `:549-551` —— 归属只来自 Bearer token，body 不参与授权 |
| 审计 | `logger.info(...)` `:561-566`；`Logger.audit({ event:'USER_ACCOUNT_DELETED', userId })` `:583` |
| 🔴 真删 | `await prisma.user.delete({ where: { id: userId } })` `:571` —— **不是** `deletedAt` 标记，**没有冷静期/保留期**（代码里找不到任何 grace window 字段） |
| 级联 | `server/prisma/schema.prisma` 里 `onDelete: Cascade` 共 18 处（`:83, 103, 136, 161-172, 187, 242, 317, 509, 590, 595, 660, 685, 701, 727, 749, 750, 771, 790`）⇒ op-log、设备、推送订阅、配额账本随之消失 |
| 令牌与缓存 | 删之前 `authCache.invalidate(userId)` `:568`，删之后**再** invalidate `:573` —— 旧 JWT 不再可能命中缓存复活 |
| WebSocket | `getWsConnectionService().closeForUser(userId)` `:581`；`:575-580` 的注释说明这一步是**必需的**：`user_id` 外键会让服务端触发的补发 INSERT 把账号行原样重新插回（同一 id），靠唯一索引会撞出 500 |
| 测试 | `server/tests/delete-account.routes.spec.ts:24-37`（socket 拆除路径的用例） |

**用户侧：❌ 无入口（Web / 移动 / CLI 全都没有）。**
- 客户端常量表里根本没有这条路径：`packages/app-host/src/hosted-auth.ts:75-90`
  `HOSTED_AUTH_PATHS` 只有 `passkey*` / `passkeys` / `accountLocale: '/api/account/locale'`。
- 账号菜单没有它：`apps/web/src/features/shell/AccountMenu.tsx:324-339` 只有 设置 / 成长 / 退出登录（`danger` 那条是**退出登录**，不是删号）。
- i18n 里**没有**"注销账号 / 删除账号"文案 key（全仓 `注销` 的命中只有两类无关项：
  推送订阅注销 `server/src/push/subscriptions.ts:8, 76`、`server/src/push/push.routes.ts:11, 203-204, 218`、
  `apps/web/src/pwa/push-subscribe.ts:292`（`method: 'DELETE'`）；以及管理员强制下线
  `packages/app-host/src/admin-client.ts:330`、`server/src/admin/admin.routes.ts:479`）。
- CLI 也没有（`apps/node-host/src/cli.ts` 的命令面里无 account 删除项）。
- ⚠️ 未穷尽：有没有对外公布的**人工渠道**（support@ 邮件 / 表单）承接删除请求，属文案与运营事实，本轮未核。

### 24.5 撤回同意：关掉之后是否**立刻**改变当下行为

AGENTS.md 那条纪律"隐私开关关不掉当下的行为是不可接受的"—— 逐条核到的证据：

| 同意面 | 关掉后的即时效果 | 证据 |
|---|---|---|
| AI 总开关 `enabled` | 下一次调用第一件事就是查它 → 返回 `not-configured`，**候选一个都不试、一次请求都不发** | `packages/ai/src/routing.ts:662-673` |
| 允许远程 `allowRemote` | 远端端点**根本不进候选链**（不是"进了再失败"），因此连授权弹窗都不产生 | `routing.ts:554-558` |
| 逐功能出境授权 | 每次调用都在**网络动作之前**重过一遍；首选未授权 → `egress-not-authorized`，回退位未授权 → `fallback-needs-consent` 且**不再往下换端点** | `routing.ts:712-745`、`:801-816`；测试 `packages/ai/tests/routing.spec.ts:499, 520`（判据是数网络请求数） |
| 授权记录的继承 | 切换目的地/模式时**删除**不匹配的授权；切回本地时 `consents` 清空 | `packages/ai/src/egress.ts:187-194`（`:191-192`） |
| 记忆层 `memoryEnabled` | 🔴 **最干净的一条**：关掉后连"输入"都不再被读取 —— effect 提前 return 并把 `opWindow` 置 `null`，`useMemo` 里也**连算都不算** | `apps/web/src/App.tsx:846-850`（`:840` 注释「只在记忆开启时读」）、`:791-795`（「不留『算了但没显示』的中间态」）、`:834` 依赖数组含 `aiSettings.memoryEnabled` |
| 推送 / 小组件后台刷新 | 开关点下去走的是**真正的注销**（`DELETE` 服务端订阅 + 退掉浏览器侧 subscription），不是"只是不再显示提示" | `apps/web/src/features/settings/WidgetPushPanel.tsx:153-166`（`toggle` → `unsubscribeFromWidgetPush()`）、`:212-233`（权限被拒就**收回开关**，不留永远失败的开关）；`apps/web/src/pwa/push-subscribe.ts:269-275`（注释：**先告诉服务端再退浏览器订阅**，否则会留下"永远删不掉的死行"）、`:292`（`method:'DELETE'`） |

⚠️ 未穷尽的部分（政策先别承诺）：
1. **服务端对已删订阅是否还会补发一次**（`server/src/push/*` 的投递重试路径本轮未逐行读）；
   撤回的"生效点"在订阅表，不在投递器。
2. `apps/web/src/features/reminders/ReminderNotifyPanel.tsx:42` 只是**读** `permission === 'granted'` 来展示状态；
   系统级通知权限的撤销发生在浏览器/OS，不在 heyta 代码里。
3. AI 请求的**在途撤回**：一个已经发出去的 `/chat/completions` 请求无法被"关掉开关"追回（`routing.ts:838-893`），
   且 `AbortSignal` 只能中止本地等待。政策里"随时撤回"应与"撤回不溯及已发送的请求"同时写。
4. `EgressConsent.grantedAt` 存在但**不用于到期判定**（`egress.ts:64-69`），所以授权不会自动过期，只能被用户撤回或被 `retainValidConsents` 删除。

### 24.6 拒绝非必要权限仍能用基本功能

- **所有隐私开关出厂都是 `false`**（`aiStore.ts:88, 89, 95, 98`；本机 API `tools.ts:255-259`；
  每个本机工具 `defaultEnabled: false` 的类型层常量 `tools.ts:51-64`），
  而任务 CRUD 只依赖本地 op-log（`actions.ts:408+`），**没有任何一处功能要求 AI 或同步先开启**。
- **不预置任何路由**：`routes: {}`（`aiStore.ts:92-93`，理由：预置会把"打开总开关"变成"好几个功能悄悄开始跑"）。
- **不内置任何云端端点**：`presets.ts:23-36` —— 所以不存在"要连 AI 就必须给 heyta 一个目的地"的诱导。
- **界面上不留死开关**：AI 路由矩阵那几行是 `role="presentation"` + 空 `onToggle`（见 AGENTS.md 的
  「UI 文案一致性」条与 `docs/reference/ai-architecture.md:150, 676`），
  这是"不诱导授权"在 UI 层的实现证据（开关只放在真正能生效的总闸上）。
- **偏好注入默认对 `tool-calling` 全关**：`packages/domain/src/preference-hints.ts:60-70`。
- ⚠️ 唯一发现的**注册期同意项**：`packages/app-host/src/hosted-auth.ts:505`
  `input: { email; termsAccepted?: boolean; inviteCode? }` —— `termsAccepted` 是**可选参数**，
  即客户端没有强制勾选就能注册，条款/隐私同意的强制点（若有）在服务端或发信流程，本轮未核。
- ⚠️ 未穷尽：`apps/landing/src/site/docs.ts:126` 有 `id: 'works-without-account'` 这条文档条目，
  但那是**官网文案**、不是代码证据；"无账号可用"的边界是否真成立需另核（离线模式与注册门禁的耦合点）。

---

## D25 保留与备份

**结论：同步数据的保留期是 **45 天、硬编码、不可配置**；清理任务每天跑一次、共 7 步；
备份确实存在（每日 `pg_dump` + 可选加密与异地上传），但**备份文件里含邮箱明文与口令散列**，
而用户业务数据在备份里是**密文**（因为服务端本来就只存密文 op）。
一处需要如实登记的口径冲突：文档示例写"保留 3 天"、脚本默认 `RETENTION_DAYS=14`。**

### 25.1 `startCleanupJobs` 到底删什么、多久删

调度：`server/src/sync/cleanup.ts:150-169` ——
首次延迟 `INITIAL_CLEANUP_DELAY_MS = 10_000`（10 秒后跑一遍，不等整点），
之后 `setInterval(…, MS_PER_DAY)` ⇒ **每 24 小时一次**；两个 timer 都 `.unref()`（不阻止进程退出）；
`stopCleanupJobs` 在 `:171-183`。

| # | 步骤 | 删的对象 | 行号 |
|---|---|---|---|
| 1 | 🔴 **旧 op 清扫** | `deleteOldSyncedOpsForAllUsers(cutoffTime)`（cutoff = `now - retentionMs`） | `cleanup.ts:31-32`；受影响用户排入 deferred reconcile `:46` |
| 2 | 陈旧设备 | `deleteStaleDevices` | `:53` |
| 2b | 检查点闸门 | `summarizeCheckpointGate` —— **只读**，不删 | `:65` |
| 3 | 限流计数 | `cleanupExpiredRateLimitCounters` | `:77` |
| 4 | 请求去重表 | `cleanupExpiredRequestDedupEntries` | `:87` |
| 5 | 过期 passkey 注册挂起项 | `deleteExpiredPendingPasskeyRegistrations` | `:98` |
| 6 | 🔴 **弃管的未验证账号** | `deleteAbandonedUnverifiedUsers(Date.now() - UNVERIFIED_USER_GRACE_MS)` —— 注册后从未验证邮箱的账号会被**整行删掉** | `:111-113` |
| 7 | 计费对账 | `runBillingReconciliation`（只报警不删，逐单 warn `:136-143`） | `:130` |

值得留一条给政策的细节：第 1 步的信息日志**故意在删除数为 0 时也打**
（`cleanup.ts:33-39`，理由写在注释里：2026-08 曾发生一次全量保留期停摆，
因为日志被 `totalDeleted > 0` 门控，**只能以"缺失"的形式被诊断**）。
→ 这是"我们可证明保留期真的执行过"的证据链，政策上可以支撑"定期自动删除"这句。

补时参数：`RECONCILE_INTERVAL_MS = 5_000`、`RECONCILE_BUDGET_MS = 1h`（`cleanup.ts:14-15`，超预算告警 `:197-202`）。

### 25.2 保留期：45 天，**写死在代码里**

| 项 | 值 | 位置 |
|---|---|---|
| `RETENTION_DAYS` | **45** | `server/src/sync/sync.types.ts:529-530`（同时导出 `RETENTION_MS`） |
| `SyncConfig.retentionMs` | "Unified retention period for stored ops and devices" | `sync.types.ts:519` |
| `DEFAULT_SYNC_CONFIG` | `retentionMs: RETENTION_MS`（另有 `maxPayloadSizeBytes` 20MB、`uploadRateLimit` 100/min、`maxClockDriftMs` 60s） | `sync.types.ts:547-552` |
| 未验证账号宽限窗口 | **复用同一个旋钮** | `cleanup.ts:17-19` |
| 🔴 **是否可用环境变量配** | **不能**。`server/src/config.ts` 里 grep `RETENTION\|retention\|OLD_OPS_CLEANUP` **无匹配** ⇒ 改保留期 = 改代码 + 发版 | — |

⇒ **政策写法**：45 天是产品当前设定，不是用户可自选的选项；也不存在"更短保留期"的自助开关。

### 25.3 唯一那个能改保留行为的旋钮，以及它的危险面

- `getOldOpsCleanupMaxDeletedPerRun()`：`server/src/sync/services/storage-quota.service.ts:403-416`
  —— 每次运行最多删多少条 op 的上限（**删除预算**，不是保留期）。
- 🔴 该注释自己写明：**设为 `0` 会直接关掉清扫**
  （"no operations were pruned and old ops will accumulate until it is re-enabled"）。
  ⇒ "45 天后自动删除"这句承诺的**真实边界是运维配置**：一旦有人把它设成 0，
  超期 op 就**不再被删**。政策要么把这写成设计意图（"我们按 45 天设计并每日执行"），
  要么在内部把它列成需要告警的运维红线，**不要写成绝对承诺**。
- 删除的**因果边界**（防"删掉还没被任何客户端确认的最新全量点"）：
  `storage-quota.service.ts:417-440` —— 删除授权来自**最新的 CAUSAL 全量 op**
  （`SYNC_IMPORT` / `BACKUP_IMPORT` / causal `REPAIR`）；
  🔑 **不再要求 snapshot cursor（#9688）**，理由是强制 E2EE 下服务端**从不缓存明文**；
  `latestFullStateSeq` **故意不查**（对约 90% 用户它是陈旧的，#8973）；
  `serverSeq: { gt: 1 }` 跳过初始导入边界；
  依赖部分索引 `operations_user_id_full_state_server_seq_idx`（原生迁移 #9192；
  ⚠️ `prisma db push` 出来的库不会创建它，清扫会退化成 seq-scan）。

### 25.4 备份：✅ 真实存在，且**范围要写清**

| 面 | 事实 | 位置 |
|---|---|---|
| 全量备份 | `pg_dump` 整库 → gzip，写 `.tmp` 后**只在成功时改名**（失败的夜晚不留"看起来像备份"的文件） | `server/scripts/backup.sh:49-52`（`run_pg_dump`，含 `PGAPPNAME=supersync-backup` 会话标记 `:39-45`）、`:82-85`、`:98`、`:107` |
| 账号面单独一份 | 🔴 `run_pg_dump --table=users --table=passkeys` —— **这文件里有邮箱明文、口令散列、passkey 凭据** | `backup.sh:98`；风险与缓解写在 `:25-28`（root cron 默认 umask 022 ⇒ 不加 `umask 077` 就会 0644，本机所有账号可读），备份目录 `chmod 700` `:68` |
| 保留 | `RETENTION_DAYS="${RETENTION_DAYS:-14}"` ⇒ **默认 14 天**（可环境变量覆盖） | `backup.sh:34`；⚠️ 文档示例写的是 "daily cron at 3 AM with **3-day retention**"（`server/docs/backup-and-recovery.md:31-34`）—— **两处口径不一致，政策先按脚本默认 14 天写，或先不写具体天数** |
| 残片清理 | 6 小时没被写过的 `.tmp` 直接删（`find … -mmin +360 -delete`） | `backup.sh:70-74` |
| 异地 | `--upload` 经 **rclone** 上传远端存储（`RCLONE_REMOTE`，如 `b2:`/`s3:`） | `backup.sh:5`、`:10-14`、`:19-23`、`:36-37` |
| 加密变体 | `PostgreSQL → gzip → OpenSSL` 流式加密，`.sql.gz.enc`；**不落未加密临时文件**；口令从 `/run/secrets/backup_passphrase` 读，缺了就直接失败 | `server/tools/backup-encrypted.sh:1-4`、`:11-14`、`:34-40` |
| 运维告警侧 | 长查询豁免只认这个 `PGAPPNAME`，豁免 6 小时到期后**卡死的 dump 仍会告警** | `backup.sh:39-44`、`server/scripts/health-alert.sh:341` |
| 脚本有测试 | 转储失败不留全量文件、账号 dump 仍在 | `server/tests/backup-script.spec.ts:20`、`:88` |
| 恢复侧 | **E2EE 决定了服务端帮不上忙**：`backup-and-recovery.md:150-153` 明写应用内"从历史恢复"对端到端加密账号**不起作用，服务端无法解密 op**；`scripts/recover-user.ts` 能带用户密钥回放 op-log 到指定 `serverSeq`，但 🔴 文档自己标注 **"Status: unverified against real encrypted data"**（`:213-220`），且其产物是**用户完整明文**、必须当明文用户数据保护（`:245-250`）。⚠️ **2026-10-04 更正（并写明这段会漂）**：那两处行号已随本轮改动移到 `:218-235` 与 `:262-264`；那句 "unverified" 也已改写 —— 解密 + 重放那一段现在有常驻判据（`server/tests/recover-replay-roundtrip.spec.ts`，真 `encryptBatch`/`decryptBatch` + 真 `replayOpsToState`），**"没对着真实账号端到端跑过"仍然成立**，所以"先对一个已知账号试"留着。把真代码跑起来之后照出两个当时无人知晓的缺陷（脚本自己抄的那份列集合少了 `entityIds` 与 `repairBaseServerSeq`：前者让批量删除在还原文件里复活，后者让用过 REPAIR 的账号根本恢复不了） | 同左 |
| 用户侧备份 | 真正的"用户可控备份"只有 D24.1 的**导出 dump**（无自动备份、无定时导出）。`backup-and-recovery.md:191` 在事故流程里也正是这么要求操作者的："Export a full backup from that client and protect it as plaintext user data." | 同左 |

⚠️ 顺带一条事实登记（会影响政策文本里的主体名称）：备份脚本与文档里的产品名**仍是 `SuperSync`**
（`backup.sh:2`、`:45`、`:87`；`backup-encrypted.sh:11-13` 的输出目录 `/var/backups/supersync`、默认库名 `supersync_db`）。
备份产物命名与 heyta 不一致，法律文本引用"备份"时不要引用文件名。

### 25.5 政策可直接采用的保留面小结

1. **服务端存的是密文 op**（强制 E2EE，`storage-quota.service.ts:417-440` 的因果边界论证正以此为前提）
   + 账号元数据（邮箱、passkey、口令散列、设备记录、限流/去重行）。
2. **业务数据在服务端的寿命**：≤ 45 天（旧 op 每日清扫），或直到用户注销账号（级联硬删，D24.4），
   或直到未验证邮箱的宽限窗口到期被清（`cleanup.ts:111-113`）。
3. **"彻底删除"不缩短这个寿命**（`purgedAt` 只是标记，D24.3）。
4. **备份里有这些东西**：整库快照（含密文 op）与账号表快照（含邮箱/口令散列），
   本地保留 14 天，可选加密与异地上传 ⇒ 政策上"删除账号"是否要连带承诺删除备份，
   是需要**产品决定**而不是代码决定的事（代码层没有任何"备份内定点删除"能力 —— `pg_dump` 是整库快照，
   `MONITORING-README.md:235` 也写明 `pg_dump` 只写活行、收缩不会立即生效）。
5. ⚠️ 未穷尽：`server/src/sync/services/*.ts` 的 `deleteOldSyncedOps` / `deleteStaleDevices` 实现细节、
   配额账本（`entitlement-reconciliation.ts`、`billing_*` 表）的保留期、
   以及日志（`Logger.audit` 落地位置与轮转）都**没有逐项核**。

---

## 政策撰写提示（AI 与权利）

### 一、「向第三方提供个人信息」这一节怎么写

**总原则：如实写"发的是原文"，但把"什么时候才发"写足。** 用户被吓到的通常不是"发正文"，
而是"我不知道什么时候会发、能不能停"。代码恰好在这两点上很强，所以这两点要放在段落最前面。

**建议结构（4 段，顺序本身就是安抚）**：

1. **默认不发生。** "AI 功能默认全部关闭，且需要你在设置里逐功能开启；关闭状态下不会向任何外部服务发送你的数据。"
   依据：`enabled`/`allowRemote`/出境授权/`memoryEnabled` 出厂全 `false`（`aiStore.ts:88, 89, 95, 98`），
   且读取时按 `=== true` 严格判定（`aiStore.ts:122-126, 191-192`）——"默认关"不是文案，是可验证实现。
2. **发什么，逐项列。** 直接抄 C20.2 那张表的字段名（`today` / `text` / `title` / `note` / `tasks` / `history` / `preferences` / `tools`），
   并明确一句：**任务标题与备注正文以原文发送，不做摘要或脱敏**。
   🔴 **不要写"匿名化/脱敏/摘要后发送"** —— 代码里没有任何脱敏步骤（`ai-breakdown.ts:107` 整段正文照发；
   `ai-prioritize.ts:206` 是 `JSON.stringify`）。写了就是虚假陈述，而这条路径有 5 个可查的调用点，一查就穿。
3. **发给谁，由你指定，我们不筛。** "模型服务地址由你在设置中自行填写，heyta 不内置任何云端服务商、不维护服务商清单、
   也不判断该服务商所在地或隐私政策；该端点由你提供，heyta 无法审计其日志与保留策略。"
   依据：`presets.ts:23-36`（刻意只有两个本机预设）、`supply.ts:210-211`（披露文案原文）、C21.2（无 host allowlist、无国别判定）。
   🔑 **同时写清一个让人安心且成立的事实**：请求由**你的设备直接发往你自己配置的端点**（`routing.ts:865-893` 的 `doFetch`），
   **heyta 服务器不是这条链路的中转**（`server/src` 里没有任何 `chat/completions` 代理路由），
   API 密钥也只以 `keyRef` 形式存在、不进配置存储（`routing.ts:70-77`）。
   → 措辞上这是"**你自行向第三方提供**"，不是"heyta 向第三方提供"。但**必须补一句**：heyta 会记录必要的运行日志/审计，
   而"发出去的内容 heyta 不留副本"这句**要单独核实**（本轮未核 `invokeRouted` 是否有请求体日志），别急着写。
4. **能停，也能撤。** "你可以随时关闭任一功能的出境授权，关闭后不再发起新的请求；变更接收方后此前授权不会被继承。"
   依据：每次调用都在网络之前重过闸（`routing.ts:712-745`）、`retainValidConsents` 删除不匹配授权（`egress.ts:187-194`）。
   ⚠️ 必须加限定：**"撤回不溯及已经发出的请求"**（`routing.ts:838-893` 一旦发出就无法追回）。

**另外两条不能漏的面**：
- **`tool-calling` 会把"这台机器有什么能力"发出去**（已授权工具名 + 参数 schema，`ai-tool-call.ts:18-23, 73`）——
  这是"设备信息"类条款的天然落点，很多人会漏写。
- **托管 AI（heyta 云端处理）不存在。** 不要写"我们可能使用自有 AI 服务"预留空间 ——
  `managed` 在类型结构上不可达（C19.4：`AiRoutingConfig` 没有 `mode`），写了就是描述一个不存在的功能。
  如果将来要上，得先解决 `retention-undecided`（`supply.ts:229-242` 拒绝编造保留期）。

**关于本机 API / MCP（建议单列一条，而不是塞进"第三方"）**：
它不是出境，但确实是"你的数据被别的东西读到"。措辞按现状写：
"你可以在设置中开启本机接口，允许同一台设备上的其他程序（如 MCP 客户端）读写你的任务。
默认关闭，**每个工具都要单独打开**，服务只监听本机回环地址且必须携带令牌；
开启'读取任务详情'后，该程序可读取任务备注正文全文。"
依据：C22 的四条 ✅ + 那张读工具表。
🔴 **反面禁写**：不要写"加密/受保护的条目即使开启也无法被读取" —— 协议层实现了，但两个壳都传 `isReadable: () => true`
（`cli-mcp.ts:123`、`store.ts:214`），产品里**还没有"受保护条目"这个概念**（ADR-0011 §6.1）。

### 二、权利一节：现在**还没有入口**的那些，该怎么办

**判断原则：只承诺代码里能走通的动作；对"能力已就绪、入口未接"的，承诺渠道而不是承诺自助。**
逐条给结论：

| 权利 | 现状 | **建议** | 理由 |
|---|---|---|---|
| 查阅 / 复制 | ✅ 三端导出 | **正常写**，并加一句"导出文件为明文，请自行保管" | 导出面（`entities` + 完整 `opLog` + 墓碑，`export-dump.ts:102-112`）比多数竞品宽，这是加分项，如实写反而更可信 |
| 更正（任务等业务数据） | ✅ 12 类字段 | **正常写** | `actions.ts:125-297` |
| 更正（邮箱） | ❌ 无路由 | **先不写**，或写"邮箱作为登录凭据不可更改" | 服务端根本没有改邮箱端点；写"可更正账号信息"是虚假承诺，且会引出"那我写错了怎么办"的客服成本 |
| 删除（单条） | ✅ 但 `purgedAt` 只是标记 | **精确写**："从你的设备与界面中移除；服务器上承载它的加密历史记录在保留期（当前 45 天）届满后自动清除。" **不要写"立即彻底删除"** | `actions.ts:480-490` + `state.ts:209`。这是最容易写出虚假承诺的一条；照实写反而把 E2EE + 保留期讲成卖点 |
| **注销账号** | 服务端 ✅（硬删 + ~~18 处级联~~ 🔴 2026-10-03 更正：**引用 `users` 且 CASCADE 的外键 16 条 / 15 张表** + 测试）、应用内 ❌ 无入口；🔴 且**服务端删完不等于设备上的数据消失** —— 各端本地明文库今天没有任何清除路径（`DbAdapter` 连 `destroy` 都没声明，IndexedDB 那份 `destroy()` 零调用方） | **过渡期写"联系我们删除账号"并给处理时限；同时在路线图上把入口补上，补上后改为自助表述。不建议现在就写"你可随时在设置中注销账号"。** | 三条理由：① 事实层面用户点不到（`HOSTED_AUTH_PATHS:75-90` 无此项、`AccountMenu.tsx:324-339` 无此项、i18n 无文案），承诺自助属虚假；② 端点、鉴权、限流、级联、socket 拆除、审计都已完成，**缺的只是 UI 一行 + 两个词条**，工程量属"最后一公里"，不值得为此长期降级政策表述；③ 🔴 **补入口时必须自带二次确认 + 先导出提示** —— `prisma.user.delete`（`api.ts:571`）**没有冷静期、没有回收站**，一旦做成一键无确认，不可逆数据丢失会直接变成投诉与责任事故，比"没有入口"更糟。所以正确顺序是"入口 + 确认 + 导出提示"一起上线，政策同步改写。 |
| 撤回同意（AI / 记忆 / 推送） | ✅ 结构性立即生效 | **写，并且写明"不溯及已发出的请求"** | `routing.ts:712-745`、`App.tsx:846-850`、`WidgetPushPanel.tsx:153-166`+`push-subscribe.ts:269-275`。"关掉之后连输入都不再被读取"这种写法（记忆层）比"你可以撤回"强得多，值得抄进政策 |
| 拒绝非必要权限仍能用 | ✅ | **写** | 出厂全关 + `routes: {}` + 无云端预设 + 界面无死开关（C24.6） |
| 保留期 | 45 天硬编码 | **写"当前为 45 天"并说明可变** | `sync.types.ts:529-530`；`config.ts` 无旋钮 ⇒ 改它要发版，别写成用户可选 |
| 备份 | 每日 `pg_dump`，本地 14 天（文档示例 3 天），可选 rclone 异地 | **暂时只写"我们会对服务器数据做定期备份"**，具体天数**先不写** | 两处口径不一致（`backup.sh:34` vs `backup-and-recovery.md:31-34`）；更要紧的是代码里**没有"从既有备份中定点删除某用户数据"的能力**（整库快照，`MONITORING-README.md:235`），一旦承诺"注销后备份也会删除"就是承诺做不到的事。需产品先决定：是否在政策里承认"已删除账号的数据可能仍存在于 14 天内的备份中，随备份保留期自然过期" —— **这句是诚实且合法的写法，建议采用** |

### 三、给法务的三条红线（写在政策文本之前的检查清单）

1. **禁止出现"脱敏/匿名化/摘要后发送"** —— 无任何代码支撑（C20）。
2. **禁止出现"heyta 云端 AI / 托管模型 / 我们替你调用模型"** —— 目的地结构上到不了 `heyta-cloud`（C19.4），
   且请求是设备直发（`routing.ts:865-893`）。
3. **禁止把 `purgedAt` / 注销描述成"立即从服务器销毁"** —— 一个只是标记（D24.3），另一个是硬删但**用户够不着**（D24.4）。

### 四、本轮未穷尽、下轮要补的（政策发布前应关闭的缺口）

1. `invokeRouted` / `doFetch` 是否把请求体或响应体写进日志（决定"我们不保留你的 AI 请求内容"这句能不能写）。
2. 服务端 push 投递器对**已注销订阅**是否仍可能补发一次（`server/src/push/*` 未逐行读）。
3. `apps/landing/src/site/docs.ts:126` `works-without-account` 与离线/注册门禁的实际耦合（决定"不注册也能用"这句）。
4. `REMINDER` 等**未物化实体**在删除权上的表现（它们只活在 `opLog` 里，`export-dump.ts:104-107`）。
5. `shared-schema` 的 zod 线契约与 hydration 是否真的按 ADR-0014 声称的"纯可加、无需 bump `CURRENT_SCHEMA_VERSION`"（C23.3 的未核项）。
6. 人工删除/注销渠道（support 邮箱、表单、SLA）—— 属运营事实，代码考古给不出答案，需产品/运营确认。
