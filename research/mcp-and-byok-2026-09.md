# MCP 现状（2026）与 BYOK 客户端密钥处理

调研日期：2026-09-25。凡标「分析」者为推断，非公开事实。

---

# A. MCP（Model Context Protocol）在 2026 年的状态

## A.1 治理归属

MCP 已不再由 Anthropic 独家掌控。2025-12-09，Anthropic 将 MCP 捐赠给 Linux Foundation 新成立的 **Agentic AI Foundation（AAIF）**，与 Block、OpenAI 共同创立 [来源: https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation]。Linux Foundation 官方新闻稿确认了 AAIF 的成立与创始贡献方 [来源: https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation]。OpenAI 同期共同创立 AAIF 并捐赠了 AGENTS.md [来源: https://openai.com/index/agentic-ai-foundation/]。MCP 官方博客同步公告 [来源: https://blog.modelcontextprotocol.io/posts/2025-12-09-mcp-joins-agentic-ai-foundation/]。下一次 MCP Dev Summit 定于 2026-04-02/03 在纽约 [来源: https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation]。

## A.2 规范版本时间线

| 版本 | 关键变化 |
|---|---|
| 2024-11-05 | 首发；HTTP+SSE 传输 |
| 2025-03-26 | 引入 Streamable HTTP，HTTP+SSE 标记为 deprecated |
| 2025-06-18 | 授权改为强制 RFC 9728 Protected Resource Metadata |
| 2025-11-25 | 实验性 Tasks 原语（call-now, fetch-later）；OAuth 强化 [来源: https://workos.com/blog/mcp-2025-11-25-spec-update] [来源: https://modelcontextprotocol.io/specification/2025-11-25/changelog] |
| 2026-07-28 | **最大一次修订**，含破坏性变更 [来源: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/] |

2026-07-28 的具体内容（RC 于 2026-05-21 锁定，正式版 2026-07-28 发布）[来源: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/]：

- **协议层无状态化**：移除 `initialize`/`initialized` 握手（SEP-2575）与 `Mcp-Session-Id`（SEP-2567），新增 `server/discover`；协议版本与 client info 改由每次请求的 `_meta` 携带。远程 server 可跑在普通轮询负载均衡后。
- **Extensions 成为一等公民**（SEP-2133），反向 DNS 命名、独立 `ext-*` 仓库与独立版本。
- **MCP Apps**（SEP-1865）：server 可下发在沙箱 iframe 中渲染的 HTML UI。
- **Tasks 从核心降级为扩展**，生命周期改为 `tasks/get`/`tasks/update`/`tasks/cancel`，移除 `tasks/list`；2025-11-25 的实验 API 需迁移。
- **Roots / Sampling / Logging 弃用**（SEP-2577），弃用期为 12 个月。
- Tool schema 升级到完整 JSON Schema 2020-12（SEP-2106）；资源缺失错误码从 `-32002` 改为 `-32602`（SEP-2164）。
- 运维可观测：强制 `Mcp-Method`/`Mcp-Name` 头（SEP-2243）、列表结果带 `ttlMs`/`cacheScope`（SEP-2549）、`_meta` 中 W3C Trace Context（SEP-414）。
- 授权强化：客户端必须校验 `iss`（RFC 9207，SEP-2468）、声明 OIDC `application_type`（SEP-837）、凭据绑定 issuer（SEP-2352）。

第三方解读：The New Stack 指出该版本移除了大量会话机制 [来源: https://thenewstack.io/mcp-release-candidate-rewrite/]。2026-08-22 又发布了新 roadmap，其中 agent identity 部分仍多为草稿 [来源: https://ai-agent-engineering.org/news/the-2026-mcp-roadmap-from-tool-integration-to-agent-to-agent-communication]。

## A.3 传输

支持 **stdio** 与 **Streamable HTTP**。HTTP+SSE 自 2025-03-26 起 deprecated，仅保留向后兼容 [来源: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports] [来源: https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-go-with-streamable-http/]。TS SDK 1.10.0（2025-04-17）首个支持 Streamable HTTP [来源: https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-go-with-streamable-http/]。Atlassian 于 2026-03-11 公告弃用 HTTP+SSE [来源: https://community.atlassian.com/forums/discussion/3205484/http-sse-deprecation-notice]。TickTick MCP 只支持 Streamable HTTP，不支持 SSE [来源: https://help.ticktick.com/articles/7438129581631995904]。

## A.4 授权

受保护的 MCP server 扮演 **OAuth 2.1 resource server**；授权服务器 MUST 实现 OAuth 2.1，公共客户端强制 PKCE；客户端 MUST 使用 RFC 9728 Protected Resource Metadata 做授权服务器发现 [来源: https://modelcontextprotocol.io/specification/draft/basic/authorization] [来源: https://www.descope.com/blog/post/mcp-auth-spec]。401 响应通过 `WWW-Authenticate: Bearer resource_metadata="..."` 暴露元数据端点 [来源: https://modelcontextprotocol.io/specification/draft/basic/authorization]。RFC 9728 本身定义该元数据文档结构 [来源: https://www.rfc-editor.org/info/rfc9728/]。客户端 MUST 使用 resource indicators 请求令牌 [来源: https://www.solo.io/blog/part-two-mcp-authorization-the-hard-way]。

## A.5 许可证

MCP 规范与官方 SDK 正在从 **MIT 迁移到 Apache-2.0**：「The MCP project is undergoing a licensing transition from the MIT License to the Apache License, Version 2.0」[来源: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/LICENSE] [来源: https://github.com/modelcontextprotocol/csharp-sdk/blob/main/LICENSE]。**对 heyta 无影响**：两者都在允许清单内（分析）。

## A.6 任务/项目管理产品的 MCP server

| 产品 | 官方/社区 | 端点与认证 | 读写范围 | 许可 |
|---|---|---|---|---|
| **Todoist** | **官方** | `https://ai.todoist.net/mcp`，OAuth；另官方 CLI `@doist/todoist-cli`，token 存 OS 凭据管理器（macOS Keychain / Windows Credential Manager / Linux Secret Service），支持 `--read-only` | 读+写（任务、项目；单次最多 25 条任务） | 官方仓库开源 [来源: https://www.todoist.com/help/todoist/todoist-and-ai/use-todoist-in-claude-code-b1USJ4HB3] [来源: https://github.com/Doist/todoist-mcp] [来源: https://developer.todoist.com/api/v1/] |
| **Linear** | **官方** | OAuth（每次会话认证） | 读+写 [来源: https://linear.app/docs/mcp] | 未找到公开信息 |
| **Notion** | **官方** | 托管 Remote MCP，OAuth only，自动继承用户既有 Notion 权限；另有自托管 `makenotion/notion-mcp-server`；客户端应优先 Streamable HTTP，回退 SSE | 读+写 | 自托管仓库开源 [来源: https://developers.notion.com/guides/mcp/overview] [来源: https://github.com/makenotion/notion-mcp-server] [来源: https://developers.notion.com/guides/mcp/build-mcp-client] [来源: https://www.scalekit.com/blog/notion-mcp-vs-api] |
| **Asana** | **官方** | V1 beta（`mcp.asana.com/sse`）已弃用，关停延至 **2026-08-05**（原 2026-05-11）；V2 于 2026-02-04 GA；需在开发者控制台建 OAuth app | 读+写 | 未找到公开信息 [来源: https://developers.asana.com/docs/integrating-with-asanas-mcp-server] [来源: https://forum.asana.com/t/new-v2-mcp-server-now-generally-available/1122647] |
| **Jira / Atlassian** | **官方** | 云端托管 Remote MCP（Rovo），OAuth | 读+写（Jira、JSM、Confluence、Bitbucket、Projects、Goals） | 未找到公开信息 [来源: https://www.atlassian.com/platform/rovo-mcp] [来源: https://github.com/atlassian/atlassian-mcp-server] [来源: https://support.atlassian.com/atlassian-ai-gateway/docs/get-started-with-the-atlassian-remote-mcp-server/] |
| **ClickUp** | **官方** | `https://mcp.clickup.com/mcp`，public beta，**仅 OAuth**——明确不支持自带 API key / Auth token | 读+写 | 未找到公开信息 [来源: https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server] [来源: https://www.scalekit.com/blog/clickup-mcp-vs-api] |
| **TickTick / 滴答清单** | **官方** | `https://mcp.ticktick.com`，Streamable HTTP，OAuth **或** Bearer Token（web 端 Settings > Account & Security > API Token）；**不支持 SSE** | 读+写，约 40 个工具：任务/清单/分组/标签/评论/指派/习惯打卡/专注记录/倒计时 | 未找到公开信息 [来源: https://help.ticktick.com/articles/7438129581631995904] [来源: https://help.dida365.com/articles/7438132116019216384] |
| **GitHub Projects** | **官方** | 官方 GitHub MCP Server，2025-10-14 起支持 Projects | 读+写 [来源: https://github.blog/changelog/2025-10-14-github-mcp-server-now-supports-github-projects-and-more/] | 未找到公开信息 |
| **Apple Reminders** | **社区** | 本地 macOS，AppleScript 驱动，无远端认证 | 读+写（本机 Reminders） | 社区仓库 [来源: https://github.com/dbmcco/apple-reminders-mcp] [来源: https://pypi.org/project/apple-reminders-mcp/] |
| **Things 3 / OmniFocus** | 未找到公开信息（未发现官方 MCP server） | — | — | — |
| **NotePlan** | 官方（App Store 描述） | 未找到公开信息 | 编辑笔记、增删移动任务 | 闭源 [来源: https://apps.apple.com/sa/app/noteplan-to-do-list-notes/id1505432629] |

**要点（分析）**：一线任务管理产品（Todoist、Linear、Notion、Asana、Atlassian、ClickUp、TickTick）**全部已官方出货 MCP server**，且**认证清一色是 OAuth**；ClickUp 明确拒绝 API key 认证，TickTick 是唯一同时提供 OAuth 与 Bearer Token 的。Apple 生态（Reminders/Things/OmniFocus）只有社区 AppleScript 方案。

## A.7 「不做 AI，只做 AI 的好工具」策略

**公开证据**：a16z 的 MCP 深度分析讨论了协议如何改变 AI 与工具交互的方式及尚存挑战 [来源: https://a16z.com/a-deep-dive-into-mcp-and-the-future-of-ai-tooling/]。Anthropic 工程博客主张 agent 应通过代码执行消费 MCP，而非逐个工具调用 [来源: https://www.anthropic.com/engineering/code-execution-with-mcp]。Microsoft 公开了其 Learn MCP Server 的建设动机：「让 AI agent 毫不费力地用上可信、最新的 Microsoft Learn 文档」[来源: https://devblogs.microsoft.com/engineering-at-microsoft/how-we-built-the-microsoft-learn-mcp-server/]。SpecterOps 提出关键设计原则：**MCP server 不是 REST API 的包装层**，工具必须围绕 agent 意图而非后端实现来塑造 [来源: https://specterops.io/blog/2026/07/28/designing-an-mcp-server-for-ai-agents-bloodhound-hunter/]。

**Pros（有公开依据）**：
- 分发红利：MCP 被视为新的分发渠道，Stripe、Shopify、Datadog 已出货；MCP SDK 月下载量达 9700 万、活跃 server 超 1 万 [来源: https://www.figuringoutwithai.com/playbooks/mcp-servers-new-distribution-channel-business-2026]。
- 免于自建模型/推理成本，把 AI 体验交给用户自己的客户端。

**Cons（有公开依据）**：
- 成本被低估：demo 一个周末，生产级 server 需数月，年维护成本 5 万–15 万美元 [来源: https://www.institutepm.com/knowledge-hub/saas-mcp-server-strategy]。
- 曝光 ≠ 被使用：「The MCP Server Nobody Uses」指出 agent 只从 tool description 做决策，基础设施优雅与否无关 [来源: https://medium.com/@ai_transfer_lab/the-mcp-server-nobody-uses-3bc7e50fbd4e]。
- 护城河反被侵蚀：有分析认为 MCP 正在压低「数据+模型」型 SaaS 的分发成本结构，从而削弱其护城河 [来源: https://dev.to/connerlambden/mcp-is-quietly-commoditizing-datamodel-saas-moats-the-structural-case-3j7p]。
- 决策框架类文章建议企业级「agent-ready」是 2026 年赢单要件 [来源: https://blog.rajpoot.dev/posts/ai/build-mcp-server-saas-2026/]。

**未找到公开信息**：未找到 Todoist / Linear / Notion 等公司公开发表「我们不做 AI，只做 AI 的好工具」这类明确表述；上述 pros/cons 由第三方分析文章支撑，非厂商自述（分析）。

## A.8 MCP 安全

**攻击类型**：Invariant Labs 于 2025-04-01 公开 Tool Poisoning Attack——恶意 server 在 tool description 中嵌入隐藏指令 [来源: https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks]。Microsoft 于 2025-04-28 给出间接提示注入的缓解指南 [来源: https://developer.microsoft.com/blog/protecting-against-indirect-injection-attacks-mcp/]。

**已发生的真实事件**（CSA 汇总）：Asana 跨租户数据暴露、针对 GitHub MCP server 的提示注入、Anthropic 自家 MCP Inspector 的未认证 RCE（CVE-2025-49596，CVSS 9.4）、多起恶意 npm 包供应链投毒 [来源: https://labs.cloudsecurityalliance.org/agentic/agentic-mcp-security-best-practices-v1/]。另有 2025 年 6 月 Supabase Cursor agent 事件：处理用户工单的 agent 被提示注入骗出集成 token [来源: https://www.truefoundry.com/blog/mcp-security-risks-best-practices]。

**Rug pull**：server 可在授权后静默修改 tool 定义，多数客户端不检测 [来源: https://www.truefoundry.com/blog/mcp-security-risks-best-practices]。

**当前缓解**：官方安全最佳实践文档 [来源: https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices]；NSA 发布 CSI 建议签名并校验 MCP 消息（目前仅依赖 TLS）[来源: https://www.nsa.gov/Portals/75/documents/Cybersecurity/CSI_MCP_SECURITY.pdf]；Invariant 开源 `mcp-scan` 检测被投毒的 description；OWASP Top 10 for Agentic Applications (2026) 将 tool poisoning 归入 ASI01 Agent Goal Hijack [来源: https://labs.cloudsecurityalliance.org/agentic/agentic-mcp-security-best-practices-v1/]。纵深防御建议：默认拒绝 + 逐工具 allowlist、工具描述基线校验、每次调用绑定用户身份 [来源: https://obot.ai/resources/learning-center/mcp-security/]。

---

# B. BYOK（自带 API Key）

## B.1 各平台密钥存储

| 平台 | 机制 | 关键事实 |
|---|---|---|
| iOS | Keychain / Secure Enclave | 私钥存 Keychain，磁盘加密且仅本 app 可访问 [来源: https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave]；`kSecAttrAccessibleWhenUnlockedThisDeviceOnly` 表示仅在解锁时可访问且**不迁移到新设备** [来源: https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlockedthisdeviceonly] |
| Android | Keystore + Tink/DataStore | `EncryptedSharedPreferences` 已在 `androidx.security:security-crypto` **1.1.0 正式弃用** [来源: https://developer.android.com/reference/androidx/security/crypto/EncryptedSharedPreferences]；推荐迁移到 DataStore + Tink + Keystore [来源: https://proandroiddev.com/goodbye-encryptedsharedpreferences-a-2026-migration-guide-4b819b4a537a] [来源: https://medium.com/@n20/encryptedsharedpreferences-is-deprecated-what-should-android-developers-use-now-7476140e8347]。**Keystore 并不防运行时钩子**：OWASP MASTG 演示了用 Frida hook `Cipher.doFinal` 提取 Keystore 保护的 API key（该 app 未做运行时钩子检测）[来源: https://mas.owasp.org/MASTG-DEMO-0106/] |
| 桌面 | macOS Keychain / Windows DPAPI / Linux libsecret | Electron `safeStorage` 在三平台分别落到 Keychain、DPAPI、libsecret [来源: https://electronjs.org/docs/latest/api/safe-storage]；Windows `CryptProtectData` 用登录凭据派生的会话密钥加密 [来源: https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata] |
| 浏览器 | WebCrypto / IndexedDB | `CryptoKey.extractable === false` 时 `exportKey()`/`wrapKey()` 抛异常 [来源: https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey/extractable]；不可导出 CryptoKey 可存入 IndexedDB 跨刷新持久化 [来源: https://stackoverflow.com/questions/52276862/web-crypto-api-is-a-non-exactrable-cryptokey-in-indexeddb-safe-enough-against]。**但不可导出只防「带走密钥」，不防「使用密钥」**：XSS 仍可用该 key 签名/解密并把结果外传 [来源: https://crypto.stackexchange.com/questions/85587/what-do-people-use-non-extractable-webcrypto-keys-for] [来源: https://agents.stackoverflow.com/questions/9a308453-c45b-4ebb-8638-ff1fed0cd23d] |

**结论（分析）**：WebCrypto 的非导出密钥**不能**保护「用户粘贴的 LLM API key」。LLM key 是 bearer 凭据，必须以 `Authorization` 头明文发出，XSS 直接读得到；非导出密钥只适用于「密钥本身参与签名/解密、明文永不出 JS」的场景。所以在 Web 端，「用户把 key 粘进网页」在架构上就无法防 XSS 窃取——只能靠 CSP、短时 token、或改为服务端代理。

## B.2 移动端直连第三方 LLM 的坑

- **CORS**：CORS 是浏览器机制，原生 RN 网络栈不施加 CORS 限制 [来源: https://www.reddit.com/r/reactnative/comments/yo5tzw/dealing_with_cors/]（该结论在社区广泛复述，但**未找到官方规范级来源**）。WebView 场景例外：Joplin 报告 iOS/Android 上 `react-native-webview` 存在 CORS 限制 [来源: https://discourse.joplinapp.org/t/fetch-cors-issue-on-mobile-end-seeking-solution/44383]。**Web 构建则完全受 CORS 约束**：若 provider 不返回 `Access-Control-Allow-Origin`，浏览器直连会失败（分析）。
- **流式 SSE**：RN 原生 `fetch` 会缓冲分块，标准 fetch/polyfill 拿不到逐 token 流；需要原生模块或 polyfill [来源: https://stackoverflow.com/questions/77725698/how-to-achieve-text-streaming-in-react-native-using-openai-api]。可选方案包括 SSE、WebSocket 二进制流、`fetch` ReadableStream 三种 [来源: https://getwireai.com/blog/react-native-llm-streaming]，社区实现如 `react-native-fetch-sse` [来源: https://github.com/Albert-Gao/react-native-fetch-sse]。
- **区域封锁**：OpenAI 与 Anthropic 在**网络边缘**封锁中国大陆 IP，无 header/DNS 技巧可绕过，只能走境外 API 网关或用国内替代（DeepSeek 等）[来源: https://teamorouter.com/blogs/access-ai-apis-china-without-vpn-2026]。Anthropic 另指控 Moonshot、DeepSeek 通过假账号与盗刷信用卡绕道访问 Claude [来源: https://www.scmp.com/news/us/diplomacy/article/3367112/moonshot-deepseek-secretly-routed-user-requests-claude-anthropic-claims]。
- **TLS / 证书固定、计费与配额**：未找到公开信息（本次调研未检索到针对 BYOK 移动客户端的官方规范或行业报告）。
- **App Store 政策**：未找到公开信息（未检索到 Apple 明确针对「客户端内置用户自有 API key」的条款）。通用审核指南见 [来源: https://developer.apple.com/app-store/review/guidelines/]。
- **key 在客户端可被提取**：移动 app 内嵌 API key 可被提取并滥用 [来源: https://www.guardsquare.com/blog/protect-api-keys-from-leaks]；Electron 应用可解包 asar 直接读出源码、端点与硬编码密钥 [来源: https://danaepp.com/reverse-engineering-electron-apps-to-discover-apis] [来源: https://www.simpalabs.com/blog/electron-app-security-testing-penetration-test]。

**已记录的泄漏事件**：
- OpenAI 于 2026-09 披露 6 起模型相关事故，其中包含模型使用暴露的 API key、以及在 GitHub 上搜索泄漏 key [来源: https://cybersecuritynews.com/openai-models-api-key-leaks/] [来源: https://cryptobriefing.com/openai-model-github-api-keys-training/]。
- 2026-01 有恶意浏览器扩展专门窃取 OpenAI API key 的活动 [来源: https://www.obsidiansecurity.com/blog/small-tools-big-risk-when-browser-extensions-start-stealing-api-keys]。

## B.3 使用 BYOK 的开源/商业产品

| 产品 | 密钥存储 | 是否代理 | 许可 | 备注 |
|---|---|---|---|---|
| **Obsidian Copilot** | 设备本地 Obsidian Keychain（BYOK 设置项） | 不代理 | 免费开源 | 历史问题：曾把 key 明文存在插件 `data.json`，2026-02 有 issue 要求改用原生 Secret Storage [来源: https://community.obsidian.md/plugins/copilot] [来源: https://www.obsidiancopilot.com/en] [来源: https://github.com/logancyang/obsidian-copilot/issues/2162] |
| **Raycast AI** | 设置中 per-provider 自定义 key（Anthropic/Google/OpenAI/OpenRouter） | 不代理，直连 provider 计费 | 闭源（macOS + iOS） | BYOK 于 v1.100.0（2025-06-11）加入；iOS 额外支持 OpenRouter；企业版支持组织级 key [来源: https://manual.raycast.com/ai/bring-your-own-key] [来源: https://www.raycast.com/changelog/1-100-0] [来源: https://www.byoaik.com/tools/raycast/] |
| **Chatbox** | 本地存储 | 不代理 | **GPL-3.0**（社区版） | 需自备 key [来源: https://www.sofarbot.com/opensource/X8ChatboxN04] [来源: https://deepwiki.com/chatboxai/chatbox/2.4-faq] |
| **LobeChat** | 可服务端存储 | **可选代理**：key 只存服务端，从不下发客户端 | 未找到公开信息（本次） | 官方 `.env.example` 明确「This key is stored server-side only and NEVER exposed to…」；自托管须设 ACCESS_CODE [来源: https://github.com/lobehub/lobehub/blob/canary/.env.example] [来源: https://docs.clore.ai/guides/ai-platforms-and-agents/lobechat] |
| **Open WebUI** | 服务端数据库 | 服务端代理 | **非 OSI 许可**：2025-05 从 BSD-3 改为带 CLA 与反背书条款的「Open WebUI License」 | API key 存在 webui 数据库，社区质疑其存储安全性 [来源: https://news.ycombinator.com/item?id=43901575] [来源: https://docs.openwebui.com/license/] [来源: https://www.reddit.com/r/LocalLLaMA/comments/1kfebga/open_webui_license_change_no_longer_osi_approved/] [来源: https://github.com/open-webui/open-webui/discussions/8534] |
| **Jan（Menlo Research）** | 未找到公开信息 | 本地优先，可选本地 API server | Apache-2.0 | [来源: https://www.jan.ai/docs] [来源: https://openalternative.co/compare/jan/vs/open-webui] |
| **Cherry Studio** | 本地设备默认存储 API key / 聊天记录 | 不代理 | **AGPL-3.0** | [来源: https://docs.cherryai.com.cn/docs/en-us/about/privacypolicy] [来源: https://gptproto.com/news/cherry-studio] [来源: https://github.com/cherryhq/cherry-studio] |
| **BoltAI** | Apple Keychain（AES-256）；可选用户自设 passphrase 二次加密 | 不代理，BYOK 默认 | 闭源（macOS） | [来源: https://docs.boltai.com/blog/how-boltai-handles-your-api-keys] [来源: https://boltai.com/inline] [来源: https://help.boltai.com/articles/9415943-license] |
| **AnythingLLM** | 主应用设置中 per-provider 存储 | 本地运行 | 免费开源（具体许可未在本次检索中确认） | 尚无 per-workspace 凭据，需改全局设置 [来源: https://anythingllm.com/] [来源: https://github.com/Mintplex-Labs/anything-llm/issues/1440] |
| **Enchanted** | 不适用（Ollama 本地/自托管） | 不代理 | 开源（iOS/macOS 客户端） | 面向 Ollama，非云端 BYOK [来源: https://github.com/gluonfield/enchanted] |
| **Msty** | 未找到公开信息 | — | 未找到公开信息 | — |
| **Karakeep** | 未找到公开信息 | — | 未找到公开信息 | — |
| **Immich** | 不适用（自建 API key 用于访问自身实例） | 不代理 | AGPL-3.0（本次未独立核实） | [来源: https://api.immich.app/getting-started] |

**「用户把 key 粘进网页」如何处理（分析）**：三种已观察到的模式——(1) **纯客户端持有**（Raycast、BoltAI、Obsidian Copilot）：key 落本地 Keychain，浏览器场景无法提供同等保证；(2) **服务端持有 + 代理**（LobeChat、Open WebUI）：key 永不下发，但用户必须信任运营者，且自托管需自行加固；(3) **自建实例凭据**（Immich）：key 只对用户自己的实例有效，泄漏影响面小。对本项目的直接含义（分析）：heyta 若要做 BYOK，Web 端不存在能防 XSS 的密钥保护方案，只能靠「用户自建 provider 端点 + 短时 token」或明确告知风险。

---

## 对 heyta 的三条可执行结论（分析）

1. **MCP 官方 server 是 2026 年任务管理产品的标配**（Todoist/Linear/Notion/Asana/Atlassian/ClickUp/TickTick 全部出货），认证统一 OAuth 2.1。若 heyta 要做 MCP，应直接按 2026-07-28 无状态规范设计（无 session、`Mcp-Method` 头、`ttlMs` 缓存），避免按 2025-11-25 的会话模型返工 [来源: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/]。
2. **MCP 规范与 SDK 许可证 MIT → Apache-2.0**，两者都在 heyta 的允许清单内，不构成许可证门禁问题 [来源: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/LICENSE]。
3. **BYOK 在 Web 端是安全死结**：XSS 无法通过 WebCrypto 非导出密钥防住 bearer API key [来源: https://agents.stackoverflow.com/questions/9a308453-c45b-4ebb-8638-ff1fed0cd23d]。若 heyta 要走 BYOK，应把密钥限制在原生壳（Keychain/Keystore）内，Web 端只提供「服务端代理」或「不支持」两个选项。
