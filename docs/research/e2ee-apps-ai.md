# E2EE / 本地优先产品怎么做 AI —— 定向调研

> **调研目标**：填补 `ai-feature-landscape.md` §7.1 ❌ 本节是本次调研最大的缺口，必须明确标注
> 所指的那个缺口 —— "E2EE（或本地优先）产品怎么处理 AI"。
> 之前调研的样本（滴答清单、Todoist、Motion）**服务端都能看到明文**，
> 它们的数据路径对 heyta **完全不可用**。
> 本报告的样本全部是**约束与 heyta 相同**的产品。
>
> **调研时间**：2026 年 9 月。**所有结论以 2026-09 为现状核对。**

---

## 0. 方法与证据强度（先读这一节，它决定了下面每条结论的可信度）

### 0.1 工具实况（重要，影响证据强度）

| 工具 | 状态 | 后果 |
|---|---|---|
| `web_search` | 🔴 **不可用** —— Tavily 返回 `HTTP 432`（与上一阶段完全一致） | 无法做"发现式"检索 |
| `anysearch` skill | 🔴 **当日额度已耗尽** —— 首次调用自动注册了一个 key，随后 `search` 与 `extract` 都返回 `You've reached your API key's total free quota for today` | **无法做批量检索** |
| `web_fetch` | ✅ 可用 | 主力工具 |
| `curl` | ✅ 可用 | 抓取 + 本地 HTML→文本剥离，用于批量扫描关键词 |

**因此本次调研的方法论是**：**先猜官方 URL，再抓全文，再在本地 grep 关键词**。
这条路对**厂商官方文档 / blog / help center / GitHub** 极有效（全部拿到 ✅ 全文），
但对 **Reddit / G2 / Trustpilot / 论坛**基本无效 ——
这些站要么反爬、要么 JS 渲染，且没有搜索引擎帮我找 URL。

### 0.2 证据标记

- ✅ = 成功抓取页面全文并读到该内容
- ⚠️ = 只拿到片段 / 页面存在但读不到正文（JS 渲染）/ 二手转述
- ❌ = 未找到公开信息

**本报告刻意区分"厂商宣传"与"第三方证据"**。厂商自述一律标 `[厂商自述]`。
🔴 **本报告不含任何编造的引语、日期或数字**；所有引号内容均为抓取到的原文。
找不到的一律写 ❌ 并登记在 §11。

### 0.3 一个必须先说清的概念区分（后面反复用到）

调研中出现了三个被厂商混用的词，heyta 必须分清：

| 术语 | 含义 | 谁能读明文 |
|---|---|---|
| **E2EE（端到端加密）** | 密钥只在用户设备，服务端只有密文 | 只有用户 |
| **Zero-access / 零访问加密** | **静态存储**加密，密钥由用户口令派生，服务端不持有 | 只有用户（**针对存储**） |
| **U2L / 传输加密** | 客户端↔服务端加密，**服务端解密后处理** | **服务端可以读** |

🔴 **Proton 自己明确说：Lumo 用的是第 2+3 种，不是第 1 种。**（§2.8）

---

## 1. 一句话结论

**E2EE / 本地优先产品做 AI，只有 4 条真实存在的路线，且"厂商托管 AI + 维持 E2EE"这一条
在所有被调研的样本中都不存在。**

1. **不做 AI** —— Standard Notes、Logseq、Cryptomator、Signal（推断）
2. **只做本地接口 / MCP 出口，不自建 AI** —— **Bear**、**Anytype**、**Obsidian（官方）**
3. **BYOK / 自定义端点，且默认拒绝远程** —— **Joplin（官方）**、Obsidian Copilot（第三方插件）
4. **端侧本地模型** —— **Joplin 语义搜索**（140 MB 本地嵌入模型）、Joplin Dictate（本地 Whisper）
5. **厂商托管 AI，但明确承认该路径不是 E2EE** —— **Proton Lumo**、**Joplin Cloud AI**

> 🔴 **最关键的一问（C）的答案：没有找到任何 E2EE 产品在"厂商托管 AI"上维持了 E2EE 承诺。**
> 唯一正面回答这个问题的厂商是 **Proton**，它用一整篇架构文档解释了**为什么做不到**
> （同态加密实测"响应要一天以上"），并把这个东西**改名为 U2L 加密**以免误解。
> **这不是回避，这是这个行业目前最诚实、最可借鉴的一份取舍说明。**

**heyta 该学哪一种**：**路线 2 + 路线 3 + 路线 4 的组合**，具体照 **Joplin 的"双开关 + 默认拒绝远程"** 抄
（§6 给出可落地的建议）。**不要走路线 5。**

> 🔴 **勘误（2026-09-27 追加）——只作废"产品建议"，不改竞品事实：**
> 本节与 §9.1 的结论"**heyta 不要走 R4（厂商托管 AI）**"**已被推翻**。仓库已接受
> [ADR-0013](../adr/0013-cloud-ai-and-maas.md)（2026-09-26）：heyta **会**提供统一云端 AI 服务并按此收费，
> 后续提供 **MaaS**（配套 [ADR-0020](../adr/0020-ai-subscription-two-tiers.md) /
> [ADR-0021](../adr/0021-managed-ai-model-deepseek-flash.md) /
> [ADR-0023](../adr/0023-managed-ai-quota-not-implemented.md)）。
> **被更新的是"因此 heyta 不做"这个推论**；本报告 §5.3「没有任何一家 E2EE 产品在托管 AI 下维持 E2EE 承诺」
> 这个**事实**、以及 §2/§4/§6/§7 的竞品材料**全部仍然成立**，照旧可引用。
> §9.2 的三条硬约束里第 1、2 条仍适用；**第 3 条（不得声称"托管 AI 仍然 E2EE"）现在是必须遵守的红线，
> 而不是"如果哪天要做"的可选建议** —— 这正是 ADR-0013 要求照 Proton 分层承诺的原因。

---

## 2. 逐家详述

### 2.1 Standard Notes（E2EE 笔记，2024-04 起属 Proton）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 有没有 AI？ | 🔴 **没有。** |
| 2 | 推理跑在哪？ | **没有 AI** |
| 3 | E2EE 与 AI 冲突？ | **不适用 —— 没有 AI** |
| 4 | 公开威胁模型？ | ✅ **有，而且很扎实**（加密白皮书） |
| 5 | 用户反应？ | ❌ 未找到（无 AI 可反应） |
| 6 | BYOK UX？ | ❌ 不适用 |
| 7 | 本地 API / MCP / 插件？ | ✅ 有**插件系统**（主题/编辑器），**但不是 AI 接口** |

**"没有 AI"的证据强度很高**（这是"零命中"型证据，我做了交叉验证）：

- ✅ `standardnotes.com/features`、`standardnotes.com/plans`：AI 关键词命中 **0**
- ✅ `standardnotes.com/blog`（全部文章索引）：AI 关键词命中 **0**
- ✅ `/blog/2025-update`（**2025-12-11**，年度回顾 + 2026 展望）：AI 命中 **0**。
  这篇是**最有时效性的一篇** —— 如果 SN 要做 AI，年度路线图是必提的地方。
- ✅ `/blog/joining-forces-with-proton`（**2024-04-10**）：AI 命中 **0**
- ✅ 付费档位里**没有任何一档含 AI**（Free $0 / Productivity $90/年 / Professional $120/年）

> ⚠️ **注意一个反直觉点**：Standard Notes 现在**属于 Proton**，
> 而 Proton **有自己的 AI（Lumo）**。也就是说 ——
> **Proton 拿到一个 E2EE 笔记产品已经两年多，仍然没有把 AI 塞进去。**
> 这是"E2EE 笔记 ≠ 需要 AI"的一个强信号。（✅ 依据：SN 页面 logo 为 `sn-by-proton`，
> 页脚 Careers 指向 `proton.me/careers`；Lumo 页面产品矩阵中明确列出 `Standard Notes (new window)`）

**E2EE 模型（✅ 全文，加密白皮书 `help/security/encryption`）**：

- 服务端定位原话：「It treats the server as a **dumb data-store** that simply saves and returns values on demand.」
- 密钥分层：`rootKey = KDF(password)` 拆两半 → `masterKey`（**永不上传**）+ `serverPassword`（上传）；
  `itemsKey` 随机生成、用 `masterKey` 加密后同步；每个 item 再用一次性 `item_key` 加密。
- 🔴 **本地存储也是加密的**，且 master key 的落盘位置有明确规定：
  「the `rootKey` is stored in the **secure device keychain**… If no keychain is available (**web browsers**),
  the `rootKey` is stored in storage in **necessarily plain format**.」
- 浏览器无 keychain 的补救 = **root key wrapping**（应用 passcode 包裹 root key，密文存 storage）。
  白皮书解释了为什么密文不存 keychain：「Some keychains have **fixed payload size limit**」
- 密码学参数（✅ 表格）：KDF = **Argon2id**，memory 67108864 B（64 MiB）、iterations **5**、parallelism 1、
  salt 128 bit、output 512 bit；加密 = **XChaCha20+Poly1305**，key 256 bit、nonce 192 bit。
- 🔴 **威胁模型原话（可直接作为 heyta 的先例引用）**：
  「Our threat model is intended to **distrust the server as much as possible**.」

**自托管（✅ `help/47`）—— 对 heyta 直接相关**：

- 🆕 **Home Server**：「The **quickest and easiest** way to deploy a Standard Notes server in your own home
  **without any technical know-how**」—— 在桌面端 `Preferences → Home Server` **一个开关**即可，
  局域网内设备可用。
- 传统自托管：后端是 **zero-knowledge**（「Any user content received by the server is **always encrypted
  by the client beforehand**」）；客户端在 `Advanced options` 里填 **Custom sync server**。
- ⚠️ **一个必须知道的限制**：「you can connect to your server from the desktop and mobile applications,
  **but not using our production web app** at app.standardnotes.com.」
- ✅ **自托管服务器仍然可以订阅付费档**（另有 help 页 `help/48`）。

---

### 2.2 Obsidian（本地优先笔记 + 插件生态）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 有没有 AI？ | 🔴 **官方核心没有。AI 全部来自社区插件** |
| 2 | 推理跑在哪？ | **由用户选的插件决定**（云 / BYOK / 本地） |
| 3 | E2EE 与 AI 冲突？ | 官方未表态；插件层各自处理 |
| 4 | 公开威胁模型？ | ✅ **有 Sync 加密验证文档 + 4 份第三方审计** |
| 5 | 用户反应？ | ⚠️ 未核对（无搜索工具） |
| 6 | BYOK UX？ | ✅ **Obsidian Copilot 是最完整的 BYOK 实证**（见 §5） |
| 7 | 本地 API / MCP？ | ✅ 第三方插件（Local REST API、MCP 插件），**官方不提供** |

**"官方无 AI"的证据**：✅ `obsidian.md/blog` AI 关键词命中 **0**；
✅ `obsidian.md/security` 全文无 AI；✅ `obsidian.md/sync` 全文无 AI。
Obsidian 的官方 AI 立场是**沉默** —— 不提供、不表态、把空间留给插件生态。
⚠️ **我没有找到 Obsidian 官方关于"要不要做 AI"的任何直接表态**（登记在 §11）。

#### Obsidian Sync 到底是不是 E2EE？—— ✅ 是，但有一个被审计点名的坑

**加密模型（✅ 官方 blog `verify-obsidian-sync-encryption`，2023-06-05，作者 Licat）**：

- Vault 密码**独立于账号密码**，只用于建立 remote vault
- 每个 vault 一个随机 salt；`base key = scrypt(password + salt)`；
  `encryption key = HKDF(base key)`（v3；老版本直接用 base key）
- 数据用 **AES-256-GCM** 加解密
- 官方给出**可自行验证**的步骤（DevTools Console 取 salt、抓 WebSocket 帧、本地解密），
  scrypt 参数明确写出：`N=32768, r=8, p=1`
- 这个"教你亲手验"的做法**本身就是可借鉴的信任建构手段**

🔴 **但 Cure53 审计点名了一个关键的密钥管理混淆**（✅ `obsidian.md/blog/cure53-tob-sync-audits`，**2026-05-13**，作者 kepano）：

> Cure53 identified **DYL-04-005** described as "**Key mgmt. confusion in managed vault encryption mode**".
> It found that the app and documentation **did not clearly describe the risks of not choosing
> Sync's default end-to-end encryption option**.
>
> Since launch Obsidian Sync has always provided **two encryption options**: end-to-end encryption (**default**)
> and "**managed encryption**" (optional) which was **renamed to "standard encryption"**.
>
> As a result of this audit the app and Help site were updated to reflect the risks of choosing standard
> encryption in **October 2024**, via commit `d18640c`.

**这直接回答了你的 A 问的一半**：Obsidian Sync **默认 E2EE，但存在一个"托管密钥"模式**；
而 `verify-obsidian-sync-encryption` 里那句
「You provide a vault password, **or let our managed server generate one for you**」
就是那个模式的入口 —— **服务端生成密码 = 服务端知道密钥 = 不是 E2EE**。
Cure53 认为**文档没有把这个风险讲清楚**，Obsidian 随后改了文案。

**其他审计与时效性（✅ 同一篇）**：

- 审计节奏：Cure53 **2023-12**（客户端）、Cure53 **2024-12**（客户端）、
  Cure53 **2024-10**（Sync API/服务端/密码学）、**Trail of Bits 2025-12**（Sync）；**2026-05-13 汇总发布**
- Sync 加密在 **2025-08-22**（Obsidian **1.9.11**）有过一次小升级
- 🔴 **Sync 的已知限制（官方在 2025-11 新增 Limitations 章节，commit `ec32a5c`）**：
  - `TOB-OBSYNC-9` **确定性文件哈希加密**：相同内容+相同密钥+相同 salt → 服务端得到相同密文哈希，
    用于去重省流量。**代价**：若攻击者攻破 Sync 服务端，且能诱导用户上传指定文件，
    就能判定"该用户是否曾上传过某文件"
  - `TOB-OBSYNC-10` **路径与内容之间没有密码学绑定**
  - `TOB-OBSYNC-2` 登出客户端可触发"订阅过期 vault"的删除
- ⚠️ 官方 Sync security 页面（含 Limitations 正文）我**没能读到全文** ——
  `help.obsidian.md/sync/security` 会跨域重定向到 `obsidian.md`，
  且 Obsidian help 站是 JS SPA，`curl` 只拿到应用外壳。
  **上面三条限制的表述来自审计 blog（✅ 全文），不是来自那个页面本身。**

**自建同步的立场**：❌ **没有找到 Obsidian 官方"我们支持/不支持自建 Sync"的直接表态。**
**事实层面**：Obsidian Sync 是官方唯一托管同步，**产品内没有自托管选项**；
第三方替代（Self-hosted LiveSync、remotely-save 等社区插件）不在官方支持范围内。
⚠️ 这个"事实"我没有抓到官方原话，登记在 §11。

---

### 2.3 Bear（Shiny Frog，E2EE 笔记）—— 🔴 **本次最贴近 heyta 的先例**

| # | 问题 | 结论 |
|---|---|---|
| 1 | 有没有 AI？ | ✅ **有，但是"AI 接口"不是"AI 功能"**（**2026-04-29**，Bear 2.8） |
| 2 | 推理跑在哪？ | ✅ **完全在用户自己的 AI 客户端**（Claude / Claude Code / 任何 MCP 客户端） |
| 3 | E2EE 与 AI 冲突？ | ✅ **官方明确写进文档：加密笔记对 AI 不可见** |
| 4 | 公开威胁模型？ | ✅ **有，且写得非常好**（CLI 页的 Privacy 小节） |
| 5 | 用户反应？ | ❌ 未找到 |
| 6 | BYOK UX？ | **不适用 —— Bear 不接 API Key，它接的是你已有的 AI 客户端** |
| 7 | 本地 API / MCP？ | ✅ **CLI + Claude Connector + MCP Server 三件套** |

**时间线与原话（✅ `blog.bear.app/2026/04/bear-2-8-...`，**2026-04-29**，作者 Zowie Huang）**：

> AI has become a genuinely useful part of how a lot of people work, and we've spent a good while thinking
> about what that means for Bear. **We didn't want to bolt something on, hand your notes to a third party.**
> Instead, we built something that gets out of the way and **lets you decide what connects to Bear and how.**

**三个组件（✅ `bear.app/faq/command-line-interface/`）**：

1. **bearcli** —— 命令行工具，暴露 search/read/create/append/tag/pin/attach/archive/trash 全部操作。
   位置 `/Applications/Bear.app/Contents/MacOS/bearcli`
2. **Claude Connector** —— Bear 内 `Help → Advanced → Install Claude Connector` 一键装
3. **MCP Server** —— `bearcli mcp-server`，给 Claude Code / Cursor / 任何 MCP 客户端用

🔴 **官方隐私声明全文（这是 heyta 最该抄的一段，✅ 原文）**：

> **Privacy**
> - **Everything runs locally.** bearcli reads and writes your **local Bear database** on your Mac
> - **Nothing connects unless you opt in.** The Connector and MCP Server only run after you install and enable them
> - **No bulk upload.** Connecting a tool does not share anything by itself.
>   **The assistant only sees the notes a specific query returns.**
> - **Encrypted notes stay encrypted.** They can be **listed, but never read or modified** by any of these tools

**作用域控制（✅ 原文）**：Claude 的 Settings → Extensions 里可设
**Only tags**（只允许看带特定标签的笔记）与 **Exclude tags**（例如加 `private` 的笔记 Claude 永远看不到）。

**限制（✅ 原文）**：需要 Bear **2.8+**；**三个工具都是 macOS-only**；Claude Connector 需要 Claude 桌面端。

**🔴 Bear 的 E2EE 有一个"非加密元数据"面 —— 这正是你问的"只对非加密元数据做 AI"的真实案例**（✅ `bear.app/faq/syncing-privacy/`）：

- Bear 同步走 **Apple CloudKit**（不是自建）。原文：
  「Every piece of information stored within CloudKit is encrypted with **Apple's private keys**,
  and we don't have access to users credentials or any sensitive data.」
  → **这是 Apple 托管密钥，严格说不是 E2EE**（Shiny Frog 读不到，但 Apple 能）。
- 开启 **Advanced Data Protection (ADP)** 后才是真 E2EE：
  「ensuring **only you**, as the possessor of your iCloud credentials, can decrypt your data」
- 🔴 **但即使开了 ADP，仍有明文残留**：
  「Mind **notes' titles and tags' names remain unencrypted** to guarantee all the functionalities
  provided by Bear Pro work as expected.」
  → **标题与标签名永远明文。** 这是"E2EE 产品必然有非加密元数据"的一个硬证据。

**单篇笔记加密（✅ `bear.app/faq/how-to-encrypt-lock-notes-with-bear/`）**：Bear Pro 功能；
Note Password「known only to you— **we cannot see or reset it**」；
加密笔记在列表里**只显示标题**，预览被打码。

**自建同步**：❌ Bear 只支持 CloudKit，**没有自托管选项**。

---

### 2.4 Anytype（本地优先 + 去中心化）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 有没有 AI？ | 🔴 **没有内置 AI 助手**；有**官方 Agent Skill**（= AI 接口） |
| 2 | 推理跑在哪？ | ✅ **用户自己的 agent**（Claude Code / Cursor / Gemini CLI / Copilot） |
| 3 | E2EE 与 AI 冲突？ | ✅ 官方**警告 API key = 授予 vault 访问权** |
| 4 | 公开威胁模型？ | ✅ **有**（Privacy & Encryption，含"本地索引不加密"的自曝） |
| 5 | 用户反应？ | ❌ 未找到 |
| 6 | BYOK UX？ | ⚠️ **有坑**：官方 Skill 把 token 放**明文 `.env`**（见 §5） |
| 7 | 本地 API / MCP？ | ✅ **Local API + 官方 Agents' Skill**（含 MCP server） |

**Local API（✅ `doc.anytype.io/.../local-api.md`）**：

- **Release 0.46.X** 首次推出；「running entirely on **localhost**」「operates **fully offline**…
  even while flying」
- 认证：**4 位挑战码**在桌面端确认一次 → 生成 API key → 之后作为 **bearer token**
- 可在 `Vault Settings → Data Management → API Keys` **生成任意多个 key 并吊销**
- 🔴 **官方 danger 警告原文**：
  > **By providing an API key or using extensions, you grant limited access to your Anytype vault**,
  > enabling operations such as editing or deleting objects. Ensure you **use only trusted extensions**.
- 生态：Python / Go 客户端、**MCP server**、Raycast 扩展

**官方 Agents' Skill（✅ `.../anytype-agents-skill.md` + GitHub README）**：

- 仓库：`github.com/anyproto/anytype-agents-skill`，开源
- 原理：给 agent 一个**隔离的轻量 JS 运行时**，agent 写脚本调用 ~30 个高层方法，
  脚本经 **Local API** 读写数据
- 安全边界（官方原话）：**不能**访问文件系统、**不能**在 Local API 之外发网络请求、
  只能操作 API key 覆盖的 Channel、不能绕过 Channel 权限
- 官方建议：**给 agent 单独一把 key**（便于随时吊销）；**先在小范围试**；
  **跑之前自己读一遍脚本**

**隐私与加密（✅ `.../privacy-and-encryption.md`）—— 有一段对 heyta 极其重要**：

- 本地生成 Key，从不上传；**无主密钥恢复**（丢 key = 永久丢数据）
- 同步是 **blind data sync**：「Anytype only ever acts as a **blind messenger**」
- 技术细节：每个 object 的每次变更**两层加密**；第一层标识归属，第二层加密内容（**AES-CFB**）；
  **备份节点只拿第一层 key** → 能打包变更，**读不到内容**
- 🔴 **自曝的取舍（原文，heyta 必须注意）**：
  > **Indexes stay local and unencrypted.** In order to search your documents efficiently, Anytype builds
  > local indexes from your encrypted objects, decrypting them on the fly with your keys. These indexes are
  > stored separately from the encrypted data itself and **aren't encrypted — this assumes your local device
  > hasn't been compromised.**
  >
  > **Indexes never sync.**
- 总体假设：「Anytype… **ultimately assumes the device you're using is safe**.」
- Telemetry：收集**匿名**使用数据；「**Content is never part of telemetry**」；不卖数据

> 🔴 **这条对 heyta 的 AI 计划是直接的：任何"本地语义索引"都会在磁盘上留下明文派生物。**
> Anytype 选择**明说**，而不是假装索引也是加密的。heyta 做端侧语义搜索时必须照抄这个披露。

**本地优先 vs 纯本地（✅ `.../local-only.md`）**：
Local-First（Anytype Network）通过 **E2EE** 多设备同步、可经**加密备份节点**恢复；
Local-Only 模式**完全关闭备份节点**，官方标 **experimental**，
并警告「manual backup management carries a **high risk of accidental data loss**」
「Anytype has **no ability to help you** with recovering data loss from local-only mode」。

**自托管（✅ `.../self-host.md`）**：可跑自己的 any-sync 网络
（`anyproto/any-sync-dockercompose` 官方维护）；桌面/移动端在 onboarding 齿轮里选
`Self-hosted` 并上传 `.yml` 网络配置；官方强烈建议**每个网络用独立身份**。

---

### 2.5 Joplin（本地优先 + E2EE + **官方 AI**）—— 🔴 **本次信息量最大的一家**

| # | 问题 | 结论 |
|---|---|---|
| 1 | 有没有 AI？ | ✅ **有，官方内置**（AI chat / chat panel / MCP server / 语义搜索） |
| 2 | 推理跑在哪？ | ✅ **三种：厂商托管（Joplin Cloud AI）/ BYOK / 本地**，**默认本地优先** |
| 3 | E2EE 与 AI 冲突？ | ✅ **官方明确：加密笔记不能用 AI 面板** |
| 4 | 公开威胁模型？ | ✅ **有，而且是分场景写得最细的** |
| 5 | 用户反应？ | ❌ 未找到 |
| 6 | BYOK UX？ | ✅ **有完整的双开关设计**（见 §5） |
| 7 | 本地 API / MCP？ | ✅ **官方 MCP server**（11 个工具，默认全关） |

> **Joplin 是本次唯一一家"核心应用自带 AI、同时是 E2EE 产品、并且把取舍写成文档"的样本。**
> heyta 的可执行细节几乎全部来自它。

#### (a) AI chat —— 🔴 **双开关 + 默认拒绝远程**

✅ `joplinapp.org/help/apps/ai_chat` 原文要点：

- **「AI is off by default.」** —— 主开关 `Enable AI features`
- **只有桌面端有 AI**：「AI features are only available on the desktop app.」
- 三类 provider：

| Provider | 是什么 | 配置 |
|---|---|---|
| **Joplin Cloud AI** | Joplin Cloud 托管的模型 | **零配置**，复用你的同步凭据；Cloud 用户首次开启时**自动选中** |
| **OpenAI-compatible** | 任何说 OpenAI API 的服务：OpenAI 本身、**Ollama**、**LM Studio**、OpenRouter、vLLM | base URL + key + model 名 |
| **Anthropic** | Claude 直连 | key + model id |

- 🔴 **第二个开关（这是整个调研里最值得抄的一个设计）**：
  > To protect against **accidentally** sending your notes to a cloud service, Joplin keeps a **second,
  > separate switch: Allow remote AI providers**. **By default it is off.** Private-network providers work
  > with this switch off — **your notes never leave your own network.**
- **"私有网络"的判定白名单（官方列举）**：`localhost`、`127.0.0.1`、`::1`；
  `10.x.x.x`、`172.16–31.x.x`、`192.168.x.x`、`169.254.x.x`；IPv6 unique-local `fc00::/7`、
  link-local `fe80::/10`；主机名后缀 `.localhost` / `.internal` / `.home.arpa`
- 🔴 **一个极精彩的推理**（安全设计上很讲究）：
  > Note that **`.local` hostnames are treated as remote.** Unlike the names above, `.local` is resolved via
  > **mDNS/Bonjour** and **can point at any machine on the network you happen to be joined to**,
  > which isn't a safe assumption on public Wi-Fi. Use the machine's LAN IP address instead.
- **私有网络 provider 不需要 API key**：「these servers usually have no authentication」
- **Token 用量计数**：按当前 provider 累计 input/output token，可 Reset，换 provider 自动清零
- **测试按钮**：发一句 `"Reply with the single word OK."` 验证链路
- **插件机制**：插件调 `joplin.ai.chat()`，**不能自选 provider/model** ——
  「a plugin written against OpenAI will also work against Ollama or Joplin Cloud AI with no changes」
- 官方明确提示：**「if you're using a remote provider, that note content goes to the provider.」**
- 关掉主开关后：「**no AI call from any plugin or built-in feature succeeds**, regardless of provider
  settings or the remote-allow switch」

#### (b) AI chat panel —— 🔴 **加密笔记直接拒绝**

✅ `joplinapp.org/help/apps/ai_chat_panel`：

- 「The whole note is sent as context.」—— 但**有选区时只发选区**：
  「When you have a selection, the model **only sees that selection** — the rest of the note is not sent.
  This is the **recommended** way to work on long notes.」
- **Privacy 小节原文**：
  > The panel **only ever sends the currently open note** (or your selection within it).
  > It **never reads or sends any other note.**
  >
  > The first time you send a message to a remote provider (anything other than Joplin Cloud AI),
  > the panel shows a **one-time notice telling you which provider your note is about to be sent to**.
  >
  > 🔴 **Encrypted notes can't be used with the panel — it tells you so when you try.**
- 已知限制：仅 Markdown 编辑器（富文本不支持自动改稿）；**无流式输出**；**重启不保留会话**；
  **无跨笔记上下文**（跨笔记语义查找请用语义搜索）

#### (c) 语义搜索 —— 🔴 **纯端侧，模型 140 MB**

✅ `joplinapp.org/help/apps/ai_semantic_search`：

- 「Joplin downloads a small language model (**around 140 MB**) onto your computer…
  **All of this runs entirely on your device. The model is local; no note content is sent to a cloud service.**
  The index is also **local — it is not synced** — so each device builds its own.」
- 节流：**每 5 分钟处理 100 条笔记**；「A **10 000-note vault takes roughly 8 hours** of background work」
- 换嵌入模型 → **清空索引重建**（不同模型的指纹不可比）
- **平台支持（✅ 表格）**：macOS **Apple Silicon ✅** / macOS **Intel ❌**（运行时未为该架构发布，
  但 AI chat 仍可用）/ Windows x64+ARM64 ✅ / Linux x64+ARM64 ✅ / **移动端与 CLI ❌**
- 需要 **Joplin ≥ v3.7**
- 不支持的平台上「the indexer stays paused and any plugin or MCP tool that needs it shows a
  **clear error rather than silently returning nothing**」（**这条防"静默失败"的原则值得抄**）
- 官方坦承语义搜索的弱点：**单词/ID/错误码这类精确查询会返回不相关结果**，
  「sometimes with **high scores**」→ 建议与关键词搜索组合使用

#### (d) MCP server —— 🔴 **默认全关 + 只监听 127.0.0.1**

✅ `joplinapp.org/help/apps/ai_mcp`：

- 🔴 **核心定位原话**：「**Joplin itself is never the one talking to a model** —
  it just answers questions from whichever AI app you've connected.」
- **11 个工具，每一个都可以单独开关，默认全部 OFF**：
  Search notes / Semantic search / Read note / List notebooks / List tags / Create note / Update note /
  Trash note / Edit tags on a note / Create notebook
- 建在 **Web Clipper 服务**之上（复用端口 + 授权 token）
- 连接方式示例（Claude Desktop 走 `mcp-remote` 桥）：
  `"args": ["-y","mcp-remote","http://127.0.0.1:PORT/mcp?token=YOUR_TOKEN"]`
- 🔴 **Privacy 小节原文（heyta 威胁模型的直接范本）**：
  > **An AI app connected via MCP can read your notes.** Whichever model that app uses (Claude, GPT-4, etc.)
  > **may include note content in the prompts it sends to its own cloud provider** — that's how it answers
  > your question. **This is independent of Joplin's own AI chat provider.**
  > Joplin's chat settings have **no effect** on what an external AI app does.
  >
  > The MCP server **only listens on 127.0.0.1**, so other machines on your network can't reach it.
  > The **authorisation token guards against other applications on your own machine** connecting
  > without your knowledge.
  >
  > Turning on the write tools allows the AI app to create, modify, or trash notes.
  > **Joplin will not ask you to confirm each write — the AI app may or may not.**
  > **Leave write tools off unless you trust both the app and the model behind it.**

#### (e) Joplin 的 E2EE 与同步（✅）

- **E2EE（`.../sync/e2ee`）**：需在**一台设备**上手动开启，生成由密码保护的 **Master Key**，
  再同步到其他设备；「prevents potential eavesdroppers — including telecom providers, internet providers,
  and **even the developers of Joplin**」；**密码不可恢复**
- **同步后端（`.../sync/`）—— 多后端是它的设计原则**：
  > One of the goals of Joplin is to **avoid being tied to any particular company or service**…
  > the synchronisation is designed **without any hard dependency** to any particular service.
  > Most of the synchronisation process is done at an abstract level and access to external services…
  > is done via **lightweight drivers**.
  - 支持：**Joplin Cloud、Nextcloud、S3、WebDAV、Dropbox、OneDrive、本地文件系统**
  - **Joplin Server Business**：自托管替代品（商业许可，14 天试用）
- **Joplin Cloud 档位（`joplinapp.org/plans/`）**：Basic / Pro / Pro 100GB / Teams；
  Joplin Server Business 按用户计（2–10 人 3.33 €/用户/月 → 51+ 人 2.50 €）
- ⚠️ **Joplin Cloud AI 归属哪个档位**：AI chat 文档只说
  「Available to **Joplin Cloud users on supported plans**」，
  但我抓到的 `plans` 页功能对比表里**没有出现 AI 字样** → 具体档位 **❌ 未找到**

#### (f) Joplin 插件生态里的 AI（✅ `joplinapp.org/plugins/` 全文扫描）

核心无 AI 也能有 AI —— Joplin 的插件目录里有 **20+ 个 AI 插件**，且**大量走本地/自托管**：

| 插件 | 说明 | 供给模式 |
|---|---|---|
| **Jarvis** | GPT / Claude / Gemini / **Ollama** / HuggingFace；语义搜索、prompt 模板、自动标签 | 云 + 本地 |
| **Joplin AI Agent** | 持久 AI 对话，**opt-in 笔记检索**，可控的笔记/文本编辑 | — |
| **AI Chatbot Assistant** | **对接自托管 AI 平台如 Open WebUI** | 自托管 |
| **Dictate** | 录音 + **本地 Whisper** 转写 → 建笔记/待办 | 端侧 |
| **Note AI** | 「支援任何 OpenAI-compatible API（**DeepSeek、OpenAI、Ollama、LM Studio** 等）」 | BYOK |
| **Joplin Aide** | 走**本地 Claude Code / GitHub Copilot / OpenAI Codex / Google Antigravity CLI** 或 Kimi API；**写操作需确认** | 本地 CLI |
| **Joplin Markdown Mirror** | 「Mirror Joplin notes to a local Markdown directory for **personal RAG workflows**」 | 本地 |
| **Joplin GPT Assistant** | OpenAI / 9Router / 任何 OpenAI 兼容 chat completions API | BYOK |
| **Note Categorization / AI Tag Suggester / Semantically Similar Notes / Note Graph** | 语义聚类、标签建议、语义相似度 | — |
| **Joplin Command Server** | 文件 IPC 远程控制，「useful for advanced keyboard shortcuts, **AI agents**, or voice control」 | 本地 |

> 🔴 **反直觉发现**：**Joplin 官方 AI 与社区 AI 插件是两套独立的供给。**
> 官方 MCP 文档明确说「Joplin's chat settings have **no effect** on what an external AI app does」。
> 也就是说 —— **用户在插件里配了本地 Ollama，不代表 MCP 进来的 Claude 会用本地模型。**
> heyta 如果同时做两条路，必须把这个"两套供给不互通"讲清楚，否则用户会误以为安全。

---

### 2.6 Logseq（补充）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 有没有 AI？ | 🔴 **官方没有** |
| 2 | 推理跑在哪？ | **没有 AI** |
| 3–6 | — | **不适用** |
| 7 | 插件接口？ | ✅ **有 Plugin API**（README 有专门章节） |

- ✅ `github.com/logseq/logseq` README 全文：AI / LLM / GPT / assistant / copilot 关键词命中 **0**
- ⚠️ `logseq.com` 与 `logseq.com/blog` 是 **JS 渲染**，`curl` 只拿到 53 字节外壳 → **未能读正文**
- ✅ README 提到新同步方案 **RTC（Real Time Collaboration）**，处于 **alpha**，需填表参与
- DB version 处于 **beta**，官方警告「**data loss is possible**」
- ⚠️ 社区有 AI 插件，但**我无法用现有工具核实**（无搜索）→ ❌

---

### 2.7 Cryptomator（补充）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 有没有 AI？ | 🔴 **没有**（✅ 官网全文 AI 关键词命中 **0**） |
| 2 | 推理跑在哪？ | **没有 AI** |
| 7 | 本地 API？ | ❌ 未找到 |

- ✅ `cryptomator.org`：纯客户端加密工具，「encrypts **both files and filenames** with AES and 256 bit key length」；
  给云盘里的文件夹设密码 = vault；**无需注册、无需配置**
- **它没有自己的同步服务** —— 它加密你**已有的**云盘。这是"不碰同步"的极端形态。
- 🔴 **对 heyta 的意义**：Cryptomator 证明了一个 E2EE 产品可以**完全不做 AI 也不做同步**，
  只做"加密层"，且活得很好。**"不做"是一个被市场接受的选择。**

---

### 2.8 Proton（Proton Pass / Proton Drive / **Lumo**）—— 🔴 **唯一正面回答 C 问的厂商**

| # | 问题 | 结论 |
|---|---|---|
| 1 | 有没有 AI？ | ✅ **有：Lumo**（独立产品，2025 年上线） |
| 2 | 推理跑在哪？ | 🔴 **厂商云**（Proton 自己的 LLM 服务器） |
| 3 | E2EE 与 AI 冲突？ | 🔴 **官方承认做不到 E2EE，改名为 U2L，并解释原因** |
| 4 | 公开威胁模型？ | ✅ **有一整篇架构文档**（本次最有价值的先例） |
| 5 | 用户反应？ | ⚠️ 官网摘录了两条正面社媒评价（**厂商挑选**，不作为独立证据） |
| 6 | BYOK UX？ | ❌ **Lumo 不支持 BYOK**（厂商托管是唯一模式） |
| 7 | 本地 API / MCP？ | ❌ 未找到 |

**先分清产品线**：
- ✅ **Proton Pass（密码管理器）：没有 AI 功能**（`proton.me/pass` 正文无 AI，只有导航里指向 Lumo 的链接）
- ✅ **Standard Notes 属 Proton**（`proton.me` 产品矩阵明确列出），**但 SN 仍无 AI**（§2.1）
- ✅ **Proton 的 AI = Lumo**，是一个独立产品，不是嵌进 Mail/Drive/Pass 的功能

#### 🔴 Lumo 的加密真相（这是本次调研最重要的一段）

**产品页（✅ `proton.me/lumo`）说**：
> All conversations with Lumo are stored with **zero-access encryption**, so no one (not even Proton)
> can access them.

**安全页（✅ `proton.me/lumo/security`）说了实话**：
> When you send a message to Lumo, it's **encrypted in transit** while traveling between your device and
> Proton's servers. **The server decrypts the message temporarily to process it through the language model**,
> generates a response, encrypts it again, and sends it back.

**FAQ（✅ 同一页）**：
> Messages are **processed by the LLM to generate responses**, but they aren't stored indefinitely in
> plaintext. When you continue a conversation, the full conversation history is sent to the server
> (encrypted in transit) so the LLM has context. After processing, the conversation is stored with
> **zero-access encryption at rest**. The server doesn't retain plainte[xt]…

**架构文档（✅ `proton.me/blog/lumo-security-model`，作者 Marc Dupont，**2025-08-04**）——
这是 heyta 最该读的一篇。原文关键段落**逐字**如下**：

> ### Challenges of full E2EE for AI systems
>
> Achieving full end-to-end encryption for AI systems presents unique challenges. Ideally, messages should
> be encrypted in a way that even the LLM cannot read them. The most promising technique for this is
> **homomorphic encryption (HE)**, also sometimes discussed under the fully Homomorphic Encryption (FHE)
> variant. However, **HE is very, very resource-intensive and extremely slow**. While regular AI like ChatGPT
> responds to queries in a few seconds, **experiments with HE have shown responses taking more than a day**.
> While the technical achievement is impressive, **waiting so long for a reply is impractical.**
>
> Clearly, we can't sit and wait for HE to be ready. We need to find practical solutions for the AI privacy
> problem — today.

> ### User-to-Lumo (U2L) encryption: Securing the pathway to the LLM
>
> …Usually with end-to-end encryption, both "ends" are human, but here the other end would be **the language
> model itself**. As noted above, **true E2EE that bypasses the LLM server would be far too slow using
> homomorphic encryption or something else. So we need to provide the LLM with cleartext messages.**
>
> Short of E2EE, we can still build a tightly secured pathway between the user and Lumo. In one sense, you
> could define this setup as a form of end-to-end encryption where the user is one "end" and Lumo is the
> other "end." That said, **we acknowledge this is not the regular definition of end-to-end encryption,
> which is why we prefer to call it user-to-Lumo (U2L) encryption to avoid any misunderstanding.**

**U2L 的完整流程（✅ 原文逐步）**：

1. LLM 服务器**预先发布一把静态 PGP 公钥**
2. 用户设备为**本次请求**生成一把对称 **AES** key
3. AES key 用 **LLM 的公钥加密**，随请求一起发
4. 附带 **Request ID**，用 **AEAD** 认证请求的完整性与来源
5. 消息用 AES key 加密；外层再套 **TLS**
6. **内部路由**：Proton 内部的负载均衡、应用服务器、消息队列
   「**no intermediate system inside Proton can read the message content**: They merely forward
   **opaque payloads** to the LLM server」
7. 🔴 **LLM 服务器解密并处理**：
   「the LLM gets to see the **decrypted user message** and process it directly.
   **The user's cleartext message never leaves the server**, and the request is **not logged or retained**
   by the LLM server after completing that request.」
8. 响应 token 用**同一把 AES key** 加密 + AEAD 认证，原路返回

**静态历史（at-rest）—— 这一段是真 E2EE（✅ 原文）**：

> Unlike the User-to-Lumo setup… in which the other "end" was the LLM server, in this case **both "ends"
> are the user, which meets the traditional definition of E2EE**. In other words,
> **no system at Proton can ever read a Lumo conversational history.**
>
> 密钥层级：`Conversation Keys`（对称）→ `Master Key`（对称，每用户唯一）→ 用**用户 PGP 密钥对**非对称加密，
> 需要用户口令解锁。与 Proton Mail/Drive/Calendar 同一套做法。

**其他（✅ 产品页 `[厂商自述]`）**：
- Lumo 由**开源语言模型**驱动；客户端代码开源
- 与 ChatGPT/Gemini/Copilot/Claude 的对比表宣称：不训练、不记录聊天、不能分享数据、无广告商业模式
- **免费档 + Lumo Plus + Lumo for Business**
- 可经 **Tor 以访客身份使用，无需登录**

> 🔴 **对 heyta 的结论**：**Proton 是"隐私公司做厂商托管 AI"的标杆，
> 而它的答案恰恰是"承认这不是 E2EE"。** 它没有用 TEE / 机密计算 / 同态加密来"保住 E2EE 承诺"，
> 而是把承诺**降级并改名**，同时把"静态历史"这一层做成真 E2EE。
> **这条"分层承诺"的思路是 heyta 可以学的；"声称托管 AI 仍然 E2EE"则不可学 —— 因为没人做到。**

---

### 2.9 Signal（补充，作为"坚决不做 AI"的参照）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 有没有 AI？ | 🔴 **未找到任何 AI 功能** |
| 2 | 推理跑在哪？ | **没有 AI** |
| 3 | 明确拒绝？ | ⚠️ **未找到官方原话**（见下） |
| 4–7 | — | ❌ 未找到 |

- ✅ `signal.org/blog/` 全文：枚举全部 `/blog/` 链接、去掉尾斜杠重复后共 **155 篇**，
  **没有任何一篇的标题是关于 AI 的**
  （用 `ai|agent|model|llm|intelligen|chatbot` 过滤，命中的 6 条经逐条核对**全部是子串误报** ——
  如 `clickb**ai**t`、`sust**ai**ner`、`mount**ai**n`、`constra**i**nts`、`Kau**ai**`、`first **ai**d`，
  没有一条与 AI 相关）
- ✅ 全站唯一的 AI 相关表述是反对"用你的通信训练 AI 模型"：
  「You also shouldn't have to… [have] every gossip tidbit, meme, or joke you share and who you share it with
  **get churned up into fodder for targeted ads or used to train an AI model**.」
- ❌ **未找到 Signal 官方"我们不做 AI / 不做 AI agent"的正式声明。**
  这类表态据我所知主要出现在**媒体采访与公开演讲**中（如 Signal 总裁 Meredith Whittaker 的发言），
  但**本次工具链无法核实**（无搜索、无 Reddit/媒体站抓取能力）。
  🔴 **按硬性规定，我不写任何未经核实的引语。登记为 ❌。**
- ⚠️ 仓库内既有文档 `docs/research/ai-competitive-and-architecture.md` §3.5 不做 AI，只做接口（MCP / 本地 API）—— 最硬的一条路
  曾引用
  「Signal 总裁公开称 AI agent…」与「RealTyme 的立场…」——
  **这两条我在本次调研中无法独立复核，报告不依赖它们。**

---

## 3. 横向归纳：可枚举的路线

### 3.1 五条路线与各自在走的人

| 路线 | 定义 | 谁在走 | 证据 |
|---|---|---|---|
| **R0 不做 AI** | 官方完全不提供 AI，也不提供 AI 接口 | **Standard Notes**、**Logseq**、**Cryptomator**、**Signal**（推断）、**Proton Pass** | ✅ |
| **R1 只做本地接口 / MCP 出口** | 不做模型、不接 Key，只把数据以本地 API/MCP 暴露给用户自己的 AI 客户端 | **Bear**、**Anytype**、**Obsidian（官方核心）** | ✅ |
| **R2 BYOK / 自定义端点** | 应用内接第三方或本地模型，用户自填 Key / base URL | **Joplin（官方 AI chat）**、**Obsidian Copilot**（第三方插件）、大量 Joplin 社区插件 | ✅ |
| **R3 端侧本地模型** | 模型下到设备上跑，数据不出设备 | **Joplin 语义搜索**（140 MB 嵌入）、**Joplin Dictate**（本地 Whisper）、Joplin 的 Ollama/LM Studio 路径 | ✅ |
| **R4 厂商托管 AI** | 厂商自己的云跑推理 | **Proton Lumo**、**Joplin Cloud AI**、Obsidian Copilot 的 Copilot-hosted | ✅ |

### 3.2 关键观察

1. 🔴 **R4 与 E2EE 不可兼得 —— 这是本次最硬的结论。**
   走 R4 的两家（Proton、Joplin）**都明确写出"服务端/提供方能读到明文"**：
   - Proton：「The server decrypts the message temporarily to process it through the language model」
   - Joplin：「if you're using a remote provider, that note content goes to the provider」
     + 「An AI app connected via MCP can read your notes」
   **没有任何一家声称 R4 下仍保持 E2EE。**

2. **R0 不是失败者的选择。** Cryptomator、Standard Notes、Signal 都在 R0 且用户规模很大。
   **Proton 收购 Standard Notes 已两年多，仍没给它加 AI** —— 说明"E2EE 笔记产品不做 AI"是可接受的商业选择。

3. **R1 是 E2EE 产品最"安全"的 AI 路线，也是最新的一波（2026）。**
   Bear 2.8（**2026-04-29**）和 Anytype Agents' Skill 都是**近半年**的事。
   **这是一个正在成型的行业共识：把 AI 放在产品外面。**

4. **R2 + R3 的组合是"既想给 AI，又不想破坏承诺"的最优解 —— Joplin 在做。**
   它的做法是：**默认本地/私有网络，远程要单独开第二个开关，加密笔记直接排除。**

5. 🔴 **一个贯穿全场的模式：默认关闭 + 显式同意。**
   - Joplin：AI 主开关默认关、远程 provider 开关默认关、MCP 11 个工具默认全关
   - Bear：「Nothing connects unless you opt in」
   - Anytype：Local API 需 4 位挑战码确认
   - Obsidian Copilot：Agent 权限由用户控制
   **没有一家默认开启 AI。**

6. 🔴 **第二个贯穿全场的模式：本地索引/缓存是明文的。**
   Anytype 自曝「Indexes stay local and unencrypted」；
   Joplin 语义索引「local — it is not synced」但未声称加密；
   Bear 标题与标签名「remain unencrypted」。
   **端侧 AI 必然产生明文派生物，这个必须写进 heyta 的威胁模型。**

7. **"只对非加密元数据做 AI"这条路 —— 没有人在走。**
   Bear 确实有非加密元数据（标题、标签），但它**没有对它们做 AI**，
   反而用它们做**作用域控制**（Only tags / Exclude tags）。
   🔴 **这是一个空白，也是一个陷阱**：heyta 若想"只对非加密字段做 AI"，
   **没有先例可抄，且很可能低估了元数据的敏感性**（任务标题本身往往就是最敏感的信息）。

---

## 4. 专题 A：同步 —— 谁能自备，谁只能用厂商的

| 产品 | 自建同步 | 厂商托管同步 | 关键证据 |
|---|---|---|---|
| **Standard Notes** | ✅ **可以**。🆕 **Home Server**（桌面端一个开关）；传统 Docker 自托管；客户端 `Custom sync server` 字段 | ✅ 官方后端 | ✅ `help/47`。⚠️ **自托管服务器不能用官方 Web App**；✅ **自托管仍可订阅付费档** |
| **Obsidian** | ❌ **产品内无自托管选项**（第三方插件可做，但非官方） | ✅ **Obsidian Sync**（$4/月） | ✅ `obsidian.md/sync`。⚠️ **未找到官方对第三方/自建同步的表态**（§11） |
| **Bear** | ❌ **没有**（只能 CloudKit） | ✅ **Apple CloudKit** | ✅ `bear.app/faq/syncing-privacy/` |
| **Anytype** | ✅ **可以**。官方 `any-sync-dockercompose`；客户端上传 `.yml` 网络配置 | ✅ **Anytype Network**（含加密备份节点） | ✅ `.../self-host.md`。另有 **Local-only** 模式（关闭备份节点，标 experimental） |
| **Joplin** | ✅ **可以**，且是设计原则。**Joplin Server Business**（自托管，商业许可）；另支持 **Nextcloud / S3 / WebDAV / Dropbox / OneDrive / 本地文件系统** | ✅ **Joplin Cloud** | ✅ `.../sync/` 原文：「avoid being tied to any particular company or service」 |
| **Logseq** | ⚠️ 新方案 **RTC** 在 alpha（未核实是否可自建） | ⚠️ RTC | ✅ README；⚠️ 正文未读到 |
| **Cryptomator** | **不适用** —— 它没有自己的同步，只加密你已有的云盘 | — | ✅ `cryptomator.org` |
| **Proton** | ❌ 未找到（Proton Drive 为厂商托管） | ✅ Proton Drive | ⚠️ |

### 4.1 Obsidian Sync 到底是不是 E2EE —— 结论

**是（默认模式），但有两个必须写清的限定**：

1. ✅ **默认 E2EE**：用户自设 vault 密码 → `scrypt` → `HKDF` → **AES-256-GCM**；
   密钥不上服务器；官方提供**可自行验证**的完整步骤。
2. 🔴 **存在一个"托管密钥"模式**：官方原话是
   「You provide a vault password, **or let our managed server generate one for you**」。
   这个模式原名 "**managed encryption**"，**2024-10 因 Cure53 审计 DYL-04-005
   （"Key mgmt. confusion in managed vault encryption mode"）改名为 "standard encryption"**，
   并更新了文档说明其风险。
   → **服务端生成密码 = 服务端掌握密钥 = 该模式不是 E2EE。**
   这是本次调研里**唯一一个"厂商托管加密 + E2EE 可选"并存的 Sync 产品**，也是唯一一个
   **被第三方审计点名"文档没讲清风险"**的产品。**heyta 若做"托管同步"，这是必须避开的前车之鉴。**

3. 🔴 **官方公开的 Sync 限制**（2025-11 新增 Limitations 章节）：
   确定性文件哈希加密（可被用于"确认用户是否上传过某文件"）、路径与内容无密码学绑定、
   订阅过期 vault 可被登出客户端触发删除。

### 4.2 一个可枚举的分层

把同步的"自备程度"排序：

```
最自备 ── Joplin（多后端 + 抽象驱动 + 自托管 Server，设计原则级）
      ├─ Standard Notes（Home Server 一键 / Docker；但自托管不能用官方 Web App）
      ├─ Anytype（自托管网络；但需手动改每台设备）
      ├─ Logseq（RTC alpha，未核实）
      ├─ Obsidian（❌ 无自托管，第三方插件兜底）
      ├─ Bear（❌ 只能 CloudKit）
最托管 ── Cryptomator（不提供同步，只加密别人的云）
```

---

## 5. 专题 B + C：AI 的供给模式，以及"有没有既托管又保持 E2EE 的"

### 5.1 AI 供给模式对照表

| 产品 | 厂商托管 AI | BYOK / 自定义端点 | 本地模型 | 用户自己的 AI 客户端（MCP/CLI） |
|---|---|---|---|---|
| **Standard Notes** | ❌ | ❌ | ❌ | ❌ |
| **Obsidian（官方）** | ❌ | ❌ | ❌ | ❌（核心无；靠插件） |
| **Obsidian Copilot**（第三方） | ✅ **Copilot-hosted**（Brevilabs，闭源后端） | ✅ **BYOK** | ✅ **Ollama / LM Studio** | ✅ Claude Code / Codex / opencode |
| **Bear** | ❌ | ❌ | ❌ | ✅ **Claude Connector + MCP + CLI** |
| **Anytype** | ❌ | ❌ | ❌ | ✅ **Local API + Agents' Skill（含 MCP）** |
| **Joplin（官方）** | ✅ **Joplin Cloud AI** | ✅ **OpenAI-compatible / Anthropic** | ✅ **Ollama / LM Studio + 140MB 嵌入模型** | ✅ **官方 MCP server** |
| **Logseq** | ❌ | ❌ | ❌ | ❌（社区插件，未核实） |
| **Cryptomator** | ❌ | ❌ | ❌ | ❌ |
| **Proton** | ✅ **Lumo（唯一模式）** | ❌ | ❌ | ❌ |
| **Signal** | ❌ | ❌ | ❌ | ❌ |

### 5.2 厂商托管 AI 时，E2EE 怎么处理？—— 三家三种做法

| 产品 | 处理方式 | 原话 |
|---|---|---|
| **Proton Lumo** | 🔴 **明确承认不是 E2EE，降级并改名** | 「we acknowledge this is **not the regular definition of end-to-end encryption**, which is why we prefer to call it **user-to-Lumo (U2L)** encryption」；「**The server decrypts the message temporarily to process it through the language model**」 |
| **Joplin Cloud AI** | 🔴 **默认关闭 + 单独开关 + 一次性告知 + 加密笔记排除** | 「**AI is off by default**」；「**Allow remote AI providers**… By default it is off」；「shows a **one-time notice telling you which provider your note is about to be sent to**」；「**Encrypted notes can't be used with the panel**」 |
| **Obsidian Copilot（托管模式）** | 🔴 **显式披露数据出境 + 闭源后端** | 「Copilot-hosted models are **cloud services, not local models**. **Brevilabs's backend** and its vetted enterprise model providers **process the full request**」；「The backend services that support hosted features are **closed source and proprietary**」 |

**三家都没有声称托管 AI 下保持 E2EE。三种做法的共同点是：把取舍说出来。**

### 5.3 🔴 最关键的一问（C）的正式回答

> **有没有任何一个 E2EE 产品，既提供厂商托管 AI、又维持了 E2EE 的承诺？**

### 结论：**没有找到。**

在被调研的全部样本中：

- **Proton Lumo** 是**唯一**一家既有厂商托管 AI、又系统性解释加密取舍的公司。
  它**明确说做不到**，并给出技术原因（**FHE 太慢**：官方称 HE 实验「responses taking **more than a day**」），
  然后把该路径**改名为 U2L**，同时把**静态历史**做成真 E2EE。
- **Joplin Cloud AI** 提供托管 AI，但文档明确写"note content goes to the provider"，
  且**加密笔记被排除在 AI 面板之外** —— 即**用"不覆盖"来回避冲突，而不是"解决了冲突"**。
- **没有任何一家**用以下手段来解释"托管 AI + E2EE 共存"：
  - ❌ **同态加密 / FHE** —— 无人声称已商用；Proton 明确说太慢
  - ❌ **机密计算 / TEE / Secure Enclave** —— **未找到任何 E2EE 笔记/任务产品使用**
  - ❌ **"客户端解密后仅本地调用"** —— 这是 **R1/R3**（Bear/Anytype/Joplin 本地），
    **不是"厂商托管"**，所以不构成对 C 问的肯定回答

> 🔴 **这个"没有"直接决定 heyta 的架构：**
> **如果 heyta 想维持 E2EE 承诺，就不能做厂商托管 AI。**
> 想做 AI，只有 **R1（MCP/本地接口）、R2（BYOK + 默认拒绝远程）、R3（端侧模型）** 三条路可选。
> 如果哪天要做 R4，唯一诚实的做法是**照 Proton 的方式**：改名、分层承诺、写清哪一层是 E2EE。

---

## 6. 专题 D：计费与商业模式 —— "自备免费 / 托管收费"怎么划线

| 产品 | 免费档给了什么 | 付费档买的是什么 | 关键划线 |
|---|---|---|---|
| **Standard Notes** | $0：**E2EE**、无限设备同步、纯文本笔记、离线、标签、单篇笔记密码、加密导出、2FA | Productivity **$90/年**：Markdown/富文本/Super note/表格/日记本/文件夹/Web Clipper/1 年历史；Professional **$120/年**：100 GB 加密存储、家庭共享 5 席、最大历史、硬件密钥 | 🔴 **E2EE 在免费档，不卖安全。付费买的是编辑能力与存储。AI 不在任何档。** ✅ |
| **Obsidian** | 应用免费（本地优先、无账号、无遥测） | **Obsidian Sync $4/月**；Publish；Enterprise | 同步是托管服务 → 收费；**AI 完全不在官方收费项内** ✅ |
| **Bear** | 应用基础功能免费 | **Bear Pro**（单篇加密、主题等） | ⚠️ **CLI/Claude Connector/MCP 是否需 Pro：官方 CLI 页只写"需要 Bear 2.8+"，未提 Pro** ✅ |
| **Anytype** | Free：100 MB 远程存储、10 个共享 channel、无限私有 channel | Plus **$4/月**（1 GB）、Pro **$8/月**（10 GB）、Ultra **$16/月**（100 GB）；**Business**（SSO、admin、self-hosting） | 🔴 **按"远程存储量 + ANY ID 长度"分档，不按 AI 分档**（ID 越短档越高：9+/7+/5+）✅ |
| **Joplin** | 应用完全免费开源；**自带同步免费**（WebDAV/Nextcloud/S3/OneDrive/Dropbox/本地） | **Joplin Cloud**（Basic/Pro/Pro 100GB/Teams）；**Joplin Server Business**（自托管商业许可） | 🔴 **"自带后端免费、托管后端收费"的教科书式划线。AI chat 里的本地 provider（Ollama/LM Studio）在免费档就能用。** ✅ |
| **Proton** | Lumo **免费档**（有限额度） | Lumo Plus / **Lumo for Business** | 🔴 **AI 本身按用量收费；免费档存在** ✅ |
| **Obsidian Copilot** | 插件开源；**用自己的 agent 账号 / BYOK / 本地模型 → 无需 Copilot 许可** | Copilot 许可（托管模型 + 云工具）；**Multi-agent 需 Plus** | 🔴 **"接口免费、托管模型收费"** ✅ |

### 6.1 归纳出的划线模式

1. 🔴 **"自带供给免费，托管供给收费"是压倒性的共识。**
   Joplin 最纯粹：同步自带免费、Joplin Cloud 收费；AI 用 Ollama 免费、用 Joplin Cloud AI 收费。
   Obsidian Copilot 同样：BYOK/本地免费，Copilot-hosted 收费。

2. 🔴 **没有任何一家对"安全性"收费。**
   E2EE 在 Standard Notes 免费档；Joplin 的 E2EE 完全免费；Anytype 的 E2EE 免费。
   **heyta 应把 E2EE 放在免费档 —— 这是这个品类的入场券，不是增值项。**

3. 🔴 **没有任何一家把"AI 开关"做成付费墙。**
   免费档能开 AI（用你自己的后端）；付费买的是**厂商算力**，不是**功能权限**。
   → **heyta 如果做 BYOK/本地 AI，应当免费开放。**

4. **按"存储/算力"分档，不按"功能"分档**（Anytype、Proton 最明显）。

---

## 7. BYOK 的 UX 实证（具体到可照着实现）

### 7.1 Key 存在哪里 —— 三个真实样本

| 产品 | Key/凭据存放位置 | 证据 |
|---|---|---|
| **Obsidian Copilot** | ✅ 🔴 **系统 Keychain**（「Keys are stored in this device's **Obsidian Keychain**, not in the vault's `data.json`」） | ✅ README |
| **Anytype Agents' Skill** | ⚠️ 🔴 **明文 `.env` 文件**（「An `.env` in the skill directory with your Anytype API token」） | ✅ GitHub README |
| **Standard Notes**（非 AI，但同构） | ✅ **设备 secure keychain**；无 keychain（浏览器）时用 **root key wrapping** 把密文存 storage（因为 keychain 有**载荷长度上限**） | ✅ 加密白皮书 |
| **Joplin** | ⚠️ 具体存储位置**未在文档中说明** | ❌ 未找到 |
| **Bear** | **不适用** —— 不存 Key，用你已有的 Claude/CLI 登录态 | ✅ CLI 页 |

> 🔴 **对 E2EE 应用的正确做法（heyta 应采纳）**：
> **Key 必须放系统 Keychain / Keystore，绝不能放会被同步的数据文件里。**
> Obsidian Copilot 的「not in the vault's `data.json`」是**明确正确的**——
> 如果 Key 进了 vault，它会**跟着同步的密文一起走**，等于把 Key 复制到每一台设备和每一个备份。
> ⚠️ **反例警告**：Anytype 官方 Skill 用明文 `.env` —— 这是一个**已知的坏味道**，
> 尤其对"本地优先 + 多设备"的产品，`.env` 很容易被误提交或被备份工具带走。

### 7.2 怎么让用户填 —— Joplin 的流程（最完整，✅ 原文）

```
Settings → AI
  1. 勾选 "Enable AI features"                    ← 主开关，默认关
  2. 选 Chat provider：
       · Joplin Cloud AI   （零配置，复用同步凭据）
       · OpenAI-compatible （base URL + API key + model 名）
       · Anthropic         （API key + model id）
  3. 填 base URL：
       · 云： https://api.openai.com/v1
       · 本地：http://localhost:11434/v1   (Ollama)
  4. （远程 provider 必须）打开第二个开关 "Allow remote AI providers"  ← 默认关
  5. 点 "Test AI configuration"
       → 实际发一句 "Reply with the single word OK." 并内联显示响应
  6. Token 用量计数器（input/output），可 Reset，换 provider 自动清零
```

**已记录的踩坑与报错（✅ 官方原文列出，这是"踩坑记录"的直接证据）**：

| 报错 | 原因 | 修法 |
|---|---|---|
| `Joplin Cloud AI requires Joplin Cloud sync` | 选了 Cloud AI 但没在用 Joplin Cloud 同步 | 恢复 Cloud 同步或换 provider |
| `Remote AI providers are not allowed` | 第二个开关没开 | 打开 `Allow remote AI providers` |
| `No choices in response — check that the base URL includes /v1` | 本地 Ollama / LM Studio 少了 `/v1` 后缀 | base URL 补 `/v1` |

**其他设计细节**：
- **私有网络 provider 不需要填 API key**（官方理由：这些服务通常无认证）→ **Key 输入框应是可选的**
- **换 provider 时用量计数自动清零**（避免把不同服务的账混在一起）
- **配置界面不预先校验**：官方明说「the configuration screen **does not validate provider details until you
  actually call the model**」→ **必须有一个真实的 Test 按钮**
- **插件不能自选 provider/model**（`joplin.ai.chat()`）→ **单一配置源，避免每个插件各要一把 Key**

### 7.3 已知被用户骂 / 被审计点名的设计

| 问题 | 产品 | 证据 |
|---|---|---|
| 🔴 **"托管加密"模式的密钥管理让用户困惑，文档没讲清风险** —— 被 Cure53 列为 `DYL-04-005` | Obsidian Sync | ✅ 审计 blog。**后果：改名 + 改文档** |
| 🔴 **免费 opencode Zen 模型可能记录或训练你的 prompt** —— 官方给出警告 | Obsidian Copilot | ✅ README：「Free opencode Zen models **show a warning because that provider may log or train on prompts**」 |
| ⚠️ **官方 AI 与 MCP 进来的外部 AI 是两套供给，设置互不影响** —— 用户极易误判 | Joplin | ✅ MCP 文档：「Joplin's chat settings have **no effect** on what an external AI app does」 |
| ⚠️ **MCP 写操作 Joplin 不做逐次确认** | Joplin | ✅ MCP 文档：「Joplin **will not ask you to confirm each write** — the AI app may or may not」 |
| ⚠️ **API token 存明文 `.env`** | Anytype Agents' Skill | ✅ GitHub README |
| ⚠️ **Agent 模式是桌面专属**（后端要跑本地进程） | Obsidian Copilot | ✅ README：「Agent is a **desktop feature** because its backends run local processes」 |
| ⚠️ **语义搜索在 macOS Intel 上不可用** | Joplin | ✅ 官方平台表 |
| ⚠️ **加密笔记不能用 AI 面板**（能力缺失，但是有意的） | Joplin | ✅ AI panel 文档 |

### 7.4 给 heyta 的 BYOK 清单（可直接实现）

1. **Key 存系统 Keychain / Android Keystore，绝不放 vault / 同步文件 / `.env`**
   （先例：Obsidian Copilot ✅；反例：Anytype Skill ⚠️）
2. **两个独立开关**：`启用 AI` + `允许远程 AI 提供方`，**都默认关闭**
   （先例：Joplin ✅）
3. **默认只允许私有网络端点**，白名单照抄 Joplin 的判定表；
   🔴 **把 `.local` / `.internal` 之类 mDNS 名字按"远程"处理**（理由：mDNS 可指向当前网络里任意主机）
4. **提供 Test 按钮并真实调用模型**（配置界面本身不校验）
5. **按 provider 分别统计 token 用量，可重置**
6. **首次使用远程 provider 时弹一次性告知**，说明"这条笔记将发往哪个 provider"
7. **加密笔记直接排除出 AI 功能**，并给出明确提示（不要静默跳过）
8. **MCP / 本地 API 的每个工具单独开关，默认全关**；写操作默认关；
   只监听 `127.0.0.1`；用 token 防止本机其他程序静默接入
9. **不要在文档里把 MCP 说成"和内置 AI 一样安全"** —— 必须像 Joplin 一样写清两套供给互不影响
10. **本地索引/嵌入是明文派生物** —— 必须像 Anytype 一样显式披露

---

## 8. 威胁模型 / 隐私说明的公开先例

**这是 heyta 明确需要的先例。结论：先例是有的，而且够用。**

| 先例 | 类型 | 写了什么 | 可借鉴度 |
|---|---|---|---|
| 🔴 **Proton《Lumo privacy and security model》**（2025-08-04） | **AI × E2EE 的取舍说明** | 完整解释**为什么做不到 E2EE**（FHE 太慢）；定义 U2L；给出逐步架构；区分"传输层"与"静态层" | ⭐⭐⭐⭐⭐ **最该读的一篇** |
| 🔴 **Joplin AI chat / AI panel / MCP 三篇的 Privacy 小节** | **分场景威胁模型** | 分别说明：远程 provider 会收到笔记内容；面板只发当前笔记/选区；MCP 进来的 AI 可能把内容发给它自己的云；MCP 只监听本地；token 防本机程序 | ⭐⭐⭐⭐⭐ **heyta 的直接模板** |
| **Bear CLI 页 Privacy 四句** | **一句话式承诺** | 全本地 / 不 opt-in 不连接 / 不批量上传 / 加密笔记只可列举不可读写 | ⭐⭐⭐⭐⭐ 简洁有力，适合做产品页 |
| **Anytype Privacy & Encryption** | **含自曝的取舍** | 本地索引**不加密**、假设设备安全、备份节点只有第一层 key | ⭐⭐⭐⭐ **"自曝短板"反而增加可信度** |
| **Standard Notes 加密白皮书** | **纯 E2EE 威胁模型** | 「Our threat model is intended to **distrust the server as much as possible**」；存储场景 A–D 矩阵；keychain 无时的明文存储说明 | ⭐⭐⭐⭐ 作为基础层范本 |
| **Obsidian Sync 验证文档 + 审计 blog** | **可验证性 + 已知限制** | 教用户亲手解密验证；公开 Limitations（确定性哈希、路径/内容无绑定） | ⭐⭐⭐⭐ **"教用户验证"很值得抄** |
| **Cure53 / Trail of Bits 审计报告** | 第三方背书 | Obsidian 有 4 份；Standard Notes 有审计（`help/2`） | ⭐⭐⭐ 成本高，后期做 |

### 8.1 写法上的共性（可直接套用）

1. **分层说清哪一层是 E2EE、哪一层不是。** Proton 是最好的示范：
   "传输层 = U2L（不是 E2EE）" + "静态层 = 真 E2EE"。
2. **给"为什么做不到"的技术理由，而不是只给结论。** Proton 用了 FHE 太慢这个具体、可检验的理由。
3. **自曝短板。** Anytype 的"本地索引不加密"、Obsidian 的"确定性哈希可被利用"都属此类，
   反而比"我们全都很安全"更可信。
4. **按场景分别写，不要写一篇笼统的。** Joplin 拆成 chat / panel / MCP 三篇。
5. **把"用户要自己承担什么"写清。** Joplin：MCP 写操作不逐次确认；
   Anytype：跑脚本前自己读一遍。
6. **给出可验证手段。** Obsidian 教你自己解密；Standard Notes 公开协议规范。

> 🔴 **heyta 的缺口确认**：仓库内既有文档
> `ai-competitive-and-architecture.md` §3.5 不做 AI，只做接口（MCP / 本地 API）—— 最硬的一条路
> 与 §7 来源清单 都指出
> 「"E2EE + 客户端本地明文 API"的完整公开威胁模型文档**未找到**」。
> **本次调研把这个缺口补上了**：**Joplin 的 MCP/本地 API 文档 + Bear 的 CLI 隐私声明
> + Anytype 的 Local API 警告，三份合起来就是"本地明文 API"的完整公开威胁模型。**
> 上一阶段的"未找到"结论**需要更新**。

---

## 9. 对 heyta 的产品建议

> 前提：heyta = 本地优先 + E2EE + 可自建 + 任务管理（op-log 同步，非 CRDT）。

### 9.1 结论：走 **R1 + R2 + R3**，**不要走 R4**

| 建议 | 理由 |
|---|---|
| 🔴 **不做厂商托管 AI** | C 问的答案是"没有找到任何先例"。做了就必须像 Proton 一样承认不是 E2EE，而 heyta 的品牌承诺是"服务端永远看不到明文" |

> 🔴 **勘误（2026-09-27）**：上表第 1 行**已作废** —— heyta 已接受 ADR-0013 并**会**做托管 AI
> （见 §1 末尾的勘误）。第 2–4 行（R1 本地接口 / R2 BYOK 默认拒绝远程 / R3 端侧模型）仍然成立，
> 且现在**是**托管 AI 的补充而不是替代。§9.2 的 P0（威胁模型文档）与 P1（MCP / BYOK）优先级不变。
| ✅ **优先做 R1：本地 API / MCP 出口** | Bear（2026-04）与 Anytype 都在 2026 年走这条路，是正在成型的共识；**实现成本最低，且完全不动 E2EE 边界** |
| ✅ **做 R2：BYOK + 自定义端点，默认拒绝远程** | Joplin 的"双开关"设计可直接照抄；覆盖"我就要用 GPT"的用户 |
| ✅ **做 R3：端侧模型，但只做小而确定的活** | 语义搜索/嵌入（Joplin 140 MB 模型）比"生成式 AI"安全得多；⚠️ **注意 AGENTS.md §7 #26：Hermes 无 `WebAssembly`，移动端端侧推理 = 原生工程量** |

### 9.2 具体落地建议（按优先级）

**P0 —— 威胁模型文档（先写文档，再写代码）**
照 §8 的结构写 `docs/reference/ai-threat-model.md`：
- 分层：传输层 / 静态层 / 本地派生层（索引、缓存）
- 明确写：**接入本地 API 的 AI 客户端会把内容发给它自己的云**（抄 Joplin 的 MCP Privacy 段）
- 明确写：**端侧索引是磁盘上的明文派生物**（抄 Anytype）
- 明确写：**加密/敏感实体对 AI 不可见**（抄 Bear 的"Encrypted notes stay encrypted"）

**P1 —— MCP server（R1）**
- 工具集从 heyta 的**读取类操作**开始：`search_tasks` / `read_task` / `list_projects` / `list_tags`
- **每个工具单独开关，默认全关**
- **写工具（create/update/delete）默认关，且明确告知不做逐次确认**
- 只监听 `127.0.0.1`；用 token 防本机其他程序
- **作用域控制**：照 Bear 做 `Only tags` / `Exclude tags`

**P1 —— BYOK（R2）**
- Key 存 Keychain / Keystore（**不进 op-log、不进同步、不进 vault**）
- 双开关：`启用 AI` + `允许远程提供方`，**默认都关**
- 私有网络白名单照抄 Joplin（含 `.local` 视为远程）
- Test 按钮 + token 用量计数 + 首次远程一次性告知

**P2 —— 端侧语义搜索（R3）**
- 模型选小嵌入模型；索引**不同步**、**每设备自建**
- ⚠️ 移动端要单独评估（Hermes 无 WASM；Joplin 在 macOS Intel 上直接放弃）
- **索引不加密这件事必须写进威胁模型**，并给"删除索引数据"的入口

**🔴 三条硬约束（写进 ADR）**
1. **任何 AI 路径都不得让服务端看到明文。** 服务端在架构上保持"dumb data-store"。
2. **AI 默认关闭，远程默认关闭。** 所有 AI 能力必须显式 opt-in。
3. **不得声称"托管 AI 仍然 E2EE"。** 如果未来要做托管，必须照 Proton 的方式改名并分层承诺。

### 9.3 一个反直觉但重要的建议

🔴 **不要把"AI"当成必须有的功能。**

Cryptomator、Standard Notes、Signal 都在 R0，都活得很好；
**Proton 收购 Standard Notes 两年多，仍没给它加 AI。**
heyta 的差异化优势是**"服务端永远看不到明文"**，而 AI 是唯一会侵蚀这条承诺的功能。
**如果要在"有 AI"和"承诺干净"之间选，这个品类的先例全部选了后者。**

---

## 10. 来源清单

### 10.1 Standard Notes
- ✅ https://standardnotes.com/help/security/encryption —— 加密白皮书（协议 004 全文、Argon2id/XChaCha20 参数、威胁模型原话）
- ✅ https://standardnotes.com/help/47/can-i-self-host-standard-notes —— Home Server + 传统自托管 + Custom sync server
- ✅ https://standardnotes.com/features —— AI 关键词命中 0
- ✅ https://standardnotes.com/plans —— 三档定价，无 AI
- ✅ https://standardnotes.com/blog —— 全部文章索引，AI 命中 0
- ✅ https://standardnotes.com/blog/joining-forces-with-proton —— 2024-04-10
- ✅ https://standardnotes.com/blog/2025-update —— 2025-12-11，AI 命中 0
- ✅ https://standardnotes.com/help/ —— help 索引（含插件系统、审计、隐私条目）

### 10.2 Obsidian
- ✅ https://obsidian.md/blog/verify-obsidian-sync-encryption/ —— Sync 加密模型 + 自验证步骤（2023-06-05）
- ✅ https://obsidian.md/blog/cure53-tob-sync-audits/ —— 4 份审计 + managed→standard encryption 改名 + Limitations（2026-05-13）
- ✅ https://obsidian.md/security —— 审计列表、Cure53 报告 PDF
- ✅ https://obsidian.md/sync —— Sync 功能与定价（$4/月）
- ✅ https://obsidian.md/blog/ —— AI 命中 0
- ✅ https://github.com/logancyang/obsidian-copilot（README）—— Keychain 存放、BYOK、三种模型来源、隐私披露
- ✅ https://raw.githubusercontent.com/logancyang/obsidian-copilot/master/docs/llm-providers.md —— BYOK 完整流程
- ✅ https://raw.githubusercontent.com/logancyang/obsidian-copilot/master/docs/copilot-plus-and-self-host.md —— 已抓取（未逐字引用）

### 10.3 Bear
- ✅ https://bear.app/faq/command-line-interface/ —— CLI + Claude Connector + MCP + **Privacy 四句**
- ✅ https://blog.bear.app/2026/04/bear-2-8-bearcli-claude-connector-and-mcp-server/ —— **2026-04-29**，立场原话
- ✅ https://bear.app/faq/syncing-privacy/ —— CloudKit / ADP / **标题与标签明文**
- ✅ https://bear.app/faq/how-to-encrypt-lock-notes-with-bear/ —— 单篇笔记加密
- ✅ https://bear.app/faq/ —— FAQ 索引（发现 "CLI for AI and Scripting" 的入口）

### 10.4 Anytype
- ✅ https://doc.anytype.io/anytype/features/integrations/local-api.md —— Local API、0.46.X、4 位挑战码、danger 警告
- ✅ https://doc.anytype.io/anytype/features/integrations/anytype-agents-skill.md —— Agents' Skill、隔离运行时、安全边界
- ✅ https://doc.anytype.io/anytype/data/privacy-and-encryption.md —— 双层加密、备份节点、**本地索引不加密**
- ✅ https://doc.anytype.io/anytype/data/sync-and-backup/local-only.md —— Local-only 模式
- ✅ https://doc.anytype.io/anytype/data/sync-and-backup/self-host.md —— 自托管网络
- ✅ https://doc.anytype.io/llms.txt —— 完整文档索引
- ✅ https://github.com/anyproto/anytype-agents-skill（README）—— **token 存明文 `.env`**
- ✅ https://anytype.io/pricing/ —— Free/Plus/Pro/Ultra/Business

### 10.5 Joplin
- ✅ https://joplinapp.org/help/apps/ai_chat —— 双开关、provider 表、私有网络白名单、`.local` 推理、报错表
- ✅ https://joplinapp.org/help/apps/ai_chat_panel —— 只发当前笔记/选区、一次性告知、**加密笔记被拒**
- ✅ https://joplinapp.org/help/apps/ai_mcp —— 11 工具默认全关、127.0.0.1、Privacy 段
- ✅ https://joplinapp.org/help/apps/ai_semantic_search —— 140 MB 本地模型、平台支持表、性能数字
- ✅ https://joplinapp.org/help/apps/sync/e2ee —— E2EE 模型
- ✅ https://joplinapp.org/help/apps/sync/ —— 多后端 + 抽象驱动设计原则
- ✅ https://joplinapp.org/help/apps/sync/joplin_cloud —— Joplin Cloud + Joplin Server Business
- ✅ https://joplinapp.org/plugins/ —— 20+ AI 插件清单
- ✅ https://joplinapp.org/plans/ —— Cloud 档位与价格

### 10.6 其他
- ✅ https://proton.me/lumo —— Lumo 产品页、对比表、免费/Plus/Business
- ✅ https://proton.me/lumo/security —— **"server decrypts the message temporarily"**
- ✅ https://proton.me/blog/lumo-security-model —— **U2L 架构全文、FHE 太慢**（2025-08-04）
- ✅ https://proton.me/pass —— Proton Pass 正文无 AI
- ✅ https://signal.org/blog/ —— 169 篇文章枚举，无 AI 主题
- ✅ https://cryptomator.org/ —— AI 命中 0
- ✅ https://raw.githubusercontent.com/logseq/logseq/master/README.md —— AI 命中 0、RTC alpha
- ⚠️ https://logseq.com/ 、https://logseq.com/blog —— JS 渲染，仅拿到外壳

---

## 11. 未找到公开信息的清单（诚实登记）

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| 1 | **Signal 官方"我们不做 AI"的正式声明** | ❌ | 169 篇 blog 无 AI 主题；这类表态据信在媒体采访/演讲中，但**本次工具链无法核实**。不写未经核实的引语 |
| 2 | **Obsidian 官方对"自建/第三方同步"的立场** | ❌ | 未找到官方原话。事实层面 Sync 是唯一官方托管同步，产品内无自托管选项 |
| 3 | **Obsidian Sync security 页的 Limitations 正文** | ⚠️ | 页面跨域重定向 + JS SPA，`curl` 只拿到外壳。三条限制的表述来自审计 blog（✅） |
| 4 | **Standard Notes 官方对 AI 的任何表态** | ❌ | 只有"零命中"这个反向证据 |
| 5 | **Anytype 官方对"要不要做内置 AI 助手"的表态** | ❌ | 只有 Local API + Agents' Skill 这类"接口"证据 |
| 6 | **Logseq 是否有官方 AI 计划** | ❌ | 官网 JS 渲染读不到；README 零命中 |
| 7 | **Joplin Cloud AI 具体归属哪个付费档** | ⚠️ | 文档只说 "supported plans"，`plans` 页功能对比表未出现 AI 字样 |
| 8 | **Joplin 的 API Key 具体存在哪里** | ❌ | 官方文档未说明 |
| 9 | **Obsidian Copilot 的许可证是否可被 heyta 使用** | ⚠️ | 仓库内既有文档称其在 heyta 黑名单上（许可证不合规）。**本次未复核**，只学做法不引代码 |
| 10 | **Reddit / G2 / Trustpilot / 论坛的用户反应** | ❌ | 无搜索工具 + 反爬 + JS 渲染。§2 中"用户反应"一栏全部为 ❌ |
| 11 | **Bear CLI/Claude Connector 是否需 Bear Pro** | ⚠️ | 官方 CLI 页只写"需要 Bear 2.8+"，未提 Pro |
| 12 | **任何 E2EE 产品用 TEE / 机密计算 / 同态加密实现"托管 AI + E2EE"** | ❌ | **明确未找到**。Proton 反而明确说 FHE 太慢（>1 天） |
| 13 | **"只对非加密元数据做 AI"的真实产品** | ❌ | **未找到任何先例**。Bear 有非加密元数据但只用于作用域控制 |
| 14 | **滴答清单/Todoist 之外的第三方用户口碑** | ❌ | 同 #10 |

### 11.1 与仓库既有文档的差异（需要同步更新）

> ✅ **勘误（2026-09-27）：下面 3 条都已经在目标文档里落实了，不必再做。**
> 证据：`ai-competitive-and-architecture.md:691` / `:709`（"四家零材料"被划为历史记录、注明勿再引用）、
> `:734`（威胁模型缺口已补，列出 Joplin / Bear / Anytype 三份）、
> `ai-feature-landscape.md:9`（同一条勘误）。本节留作过程记录，**不要照它去改别的文件**。

🔴 **上一阶段的两条"未找到"结论，本次已被补上或需要修正**：

1. `ai-competitive-and-architecture.md` §7 来源清单
   第 7 项说
   「**Standard Notes / Obsidian / Bear / Anytype —— 四家零材料**」
   → **本次四家全部拿到官方全文**，本报告即为补齐。

2. 同一文档 §3.5 / §7 说
   「**"E2EE + 客户端本地明文 API"的完整公开威胁模型文档未找到**」
   → **本次找到三份**：Joplin 的 MCP + 本地 AI 文档、Bear 的 CLI Privacy 声明、
   Anytype 的 Local API 安全警告。**该结论应更新为"已有先例，可直接借鉴"。**

3. 该文档 §3.2 提到的
   「Obsidian Copilot 把 Key 存在系统 Keychain 而不是 vault 的 `data.json`」
   → **本次已抓到原文证实**（✅），可以去掉"子任务核实"的待办标记。

---

*报告完。所有引号内容均为抓取到的原文；证据标记见 §0.2；未找到项见 §11。*
