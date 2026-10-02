# 自研滴答清单替代品 · 商业化事实调研报告

> 调研时间：2026-09-25（UTC）
> 方法：使用 `web_search` 检索并交叉比对公开来源。
> **重要局限**：本机 `web_fetch` 对几乎所有域名返回 `URL hostname resolves to a non-public IP address`（本机 DNS 将这些域名解析到 `198.18.0.x` 段，属代理/分流软件的 fake-IP 段），因此**无法直接抓取原站全文**，本文事实均来自搜索引擎返回的原文摘录与多来源交叉验证。个别数字（如 SaaS 定价）在不同来源间存在冲突，已在文中标注。
> **免责声明**：本文中的"法律结论"均是对公开资料的转述，**不构成法律意见**。凡属推断、行业惯例或经验判断的内容，均显式标注为【一般性建议】。

---

## 1. 开源许可证对商业化的实际约束

### 1.1 结论总表

| 许可证 | 闭源商用 | SaaS 商用（不发布二进制） | 二次开发后是否必须开源 | 关键触发条件与注意点 |
|---|---|---|---|---|
| **MIT** | ✅ 允许 | ✅ 允许 | ❌ 不需要 | 只需保留版权与许可声明。**未明示专利授权**。[来源](https://safeguard.sh/resources/blog/what-is-the-apache-2-0-license) |
| **BSD-2/3-Clause** | ✅ 允许 | ✅ 允许 | ❌ 不需要 | 保留版权声明；3-Clause 额外禁止用作者名背书。BSD-4-Clause（广告条款）已废弃且与 GPL 不兼容。[来源](https://safeguard.sh/resources/blog/open-source-license-comparison) |
| **Apache-2.0** | ✅ 允许 | ✅ 允许 | ❌ 不需要 | 必须带 NOTICE 文件、声明修改过的文件、保留全部声明；含**明示专利授权 + 专利报复终止条款**；**不授予商标权**。[来源](https://www.apache.org/licenses/LICENSE-2.0) |
| **GPL-2.0** | ❌ 不可闭源分发 | ✅ 可以（GPL 无网络条款，即"ASP 漏洞"） | ✅ 分发衍生作品时须以 GPL 提供完整对应源代码 | 触发点是"分发"（conveying），纯服务器端运行不触发。[来源](https://fossa.com/blog/open-source-software-licenses-101-agpl-license) |
| **GPL-3.0** | ❌ 不可闭源分发 | ✅ 可以（同上） | ✅ 同 GPL-2.0 | 额外含：反 Tivoization（须提供"安装信息"）、专利授权与报复条款、与 Apache-2.0 兼容（GPLv2 不兼容 Apache-2.0）。[来源](https://bearingpoint.services/foss/en/newsblogs/dont-be-afraid-of-gplv3) |
| **AGPL-3.0** | ❌ 不可闭源分发 | ⚠️ **有条件的可以**：若你**修改**了程序并通过网络让用户远程交互，必须向这些用户提供你版本的对应源代码 | ✅ 修改版一旦对外提供网络服务即须开源（第 13 条）；未修改运行是否触发存在争议 | 见 1.2。[来源](https://www.openatom.org/journalism/detail/3N0zX9I7fX4u) |
| **LGPL-2.1/3.0** | ✅ 允许（弱 copyleft） | ✅ 允许 | ⚠️ 只对**库本身**：修改库代码须以 LGPL/GPL 开源；**链接它的自有程序可闭源** | 动态链接是"安全港"，静态链接合规成本高（须提供能重建程序的信息）。[来源](https://fossa.com/blog/open-source-software-licenses-101-lgpl-license) |
| **MPL-2.0** | ✅ 允许 | ✅ 允许 | ⚠️ **文件级**：被修改的 MPL 源文件须以 MPL 开源，其余文件可专有 | 可与专有代码组合；须保持 MPL 代码与非 MPL 代码在**不同文件**中。[来源](https://opensource.stackexchange.com/questions/13674/altering-of-mpl2-0-based-code) |
| **BUSL-1.1**（Business Source License） | ❌ 默认不允许"生产性使用"，除非许可方给出 Additional Use Grant | ⚠️ 通常被限制：默认禁止与许可方竞争的托管/生产用途 | ❌ 不是 copyleft；到期后自动转为 Change License | **OSI 不认证、FSF 不认为是开源**，属"源码可见（source-available）"。[来源](https://fossa.com/blog/business-source-license-requirements-provisions-history) |
| **Elastic License 2.0（ELv2）** | ✅ 允许修改与分发 | ❌ **明文禁止**：不得将软件作为 hosted/managed service 提供给第三方 | ❌ 不是 copyleft | 另禁止移除/绕过 license key 功能、禁止移除许可与版权声明。[来源（SPDX 全文）](https://spdx.org/licenses/Elastic-2.0.html) |
| **SSPL-1.0** | ✅ 基本允许 | ❌ 把 SSPL 程序的功能作为服务提供，须开源**整个服务栈**（含管理、监控、备份、存储 API 等） | ❌ 非 copyleft，但网络义务极端宽泛 | OSI 未认证（MongoDB 2019-03 撤回申请），Debian/Fedora 拒绝纳入，Red Hat 将 MongoDB 移出 RHEL。[来源](https://ipkitten.blogspot.com/2019/02/closing-agpl-cloud-services-loop-hole.html) |

### 1.2 AGPL 的"网络服务条款"（第 13 条）到底是什么意思

【事实】AGPL-3.0 = GPL-3.0 + 第 13 条，条款原文（中译）：

> "尽管本许可证有任何其他规定，**如果你修改了程序，则你的修改版必须醒目地向所有通过计算机网络与其进行远程交互的用户提供获取你版本对应源代码的机会**（如果你的版本支持此类交互），具体方式是通过网络服务器免费提供对应源代码的访问……"

要点：

1. **它关闭的是"ASP 漏洞"**：普通 GPL 只把"分发"（把软件副本交给别人）当作触发点，所以"只在服务器上跑、用户隔着网络用"不触发开源义务。AGPL 把"远程网络交互"也算作触发点。[来源](https://safeguard.sh/resources/blog/agpl-3-0-license-explained)
2. **触发前提是"修改了程序"**。若原样部署未修改的 AGPL 软件对外提供服务，多数解读认为不触发第 13 条的开源义务；一旦有修改（包括功能改动，通常也包括实质性定制），就必须向所有远程用户提供修改版对应源代码。中文法律实务文章亦持此立场："AGPL 开源组件处于服务器端用于为客户提供服务时，若该组件被修改了，则需要公开源代码……但若不存在修改，则不触发开源义务。"[来源](https://www.lexology.com/library/detail.aspx?g=34e521c4-63a8-4185-9175-e43b7f09d25c)
3. **"提供"要醒目、可获取**：只在 GitHub 上放了个 fork、网站上完全没提，不符合第 13 条 "prominently offer" 的要求；通常做法是在产品界面放"源代码"链接，指向运行版本的对应源代码。[来源](https://quant67.com/post/opensource/03-license-taxonomy/license-taxonomy.html)
4. **AGPL 不等于禁止商用**：AGPL 明确允许商业使用和收费，你只是必须履行开源义务。[来源](https://fossa.com/blog/open-source-software-licenses-101-agpl-license)

### 1.3 BUSL 的"变更日期（Change Date）"机制

【事实】

- BUSL-1.1 由 MariaDB 于 2017 年发布（v1.0 为 2016 年）。它是**"定时 copyleft / 弹簧许可（springing license）"**：每个版本在 **Change Date** 当天自动转为 **Change License**（真正的开源许可证）。[来源](https://fossa.com/blog/business-source-license-requirements-provisions-history)
- 1.1 版对 Change Date 和 Change License 有硬性约束：
  - **Change Date 最迟不得晚于该版本公开发布后 4 年**；许可证里若不写日期，默认 4 年后自动转换。
  - **Change License 必须是 GPLv2 或更新版本，或与 GPL 兼容的许可证**（实践中常见 Apache-2.0、MPL-2.0）。v1.0 无此约束。[来源](https://fossa.com/blog/business-source-license-requirements-provisions-history)
- **默认只允许非生产用途**（试用、开发、非商业），许可方可通过 **Additional Use Grant** 逐条给出额外授权（例如 MariaDB 允许免费用于自身非 DBaaS 用途）。[来源](https://www.goodwinlaw.com/en/insights/publications/2024/09/insights-practices-moving-away-from-open-source-trends-in-licensing)
- **实际效果**：HashiCorp 于 2023-08-10 把 Terraform 等全部产品从 MPL-2.0 切到 BUSL-1.1，禁止"competitive offering"（用 Terraform 做与 HashiCorp Cloud 竞争的托管服务），并约定 4 年后转为 MPL-2.0；社区随即分叉出 OpenTofu。[来源](https://quant67.com/post/opensource/03-license-taxonomy/license-taxonomy.html)
- **重要定性**：BUSL、ELv2、SSPL 都**不是 OSI 认可的开源许可证**，而是"源码可见（source-available / fair-code）"。SSPL 至今未获 OSI 批准。[来源](https://www.goodwinlaw.com/en/insights/publications/2024/09/insights-practices-moving-away-from-open-source-trends-in-licensing)

### 1.4 许可证之外的三个常被忽略的坑（【事实】）

1. **许可证不授予商标权**。Apache-2.0 第 6 条明文："本许可证不授予使用许可方商号、商标、服务标记或产品名称的权限"，仅允许为描述作品来源而作的合理惯常使用。[来源](https://www.apache.org/licenses/LICENSE-2.0)
2. **"传染范围"有司法边界**。中国法院在多起案件中确立：GPL 的传染性只覆盖"基于开源软件的衍生程序或修订版本"，**不包括与其联合的独立程序**；前端代码与后端代码可分别独立打包部署，因此可被认定为相互独立。这直接影响"开源核心 + 闭源模块"的边界设计。[来源（金杜）](https://www.kingandwood.com/cn/zh/insights/latest-thinking/examining-the-use-of-open-source-software-in-compliance-with-from-the-perspective-of-rights-protection.html)
3. **强制开源的救济在实践中很难拿到**。有律所分析指出，即使权利人在违约/侵权之诉中胜诉，法院也**难以判令"强制公开源代码"**（涉作者发表权、且著作权法无此责任方式），更现实的救济是**终止许可 + 赔偿损失**。[来源（金杜）](https://www.kingandwood.com/cn/zh/insights/latest-thinking/examining-the-use-of-open-source-software-in-compliance-with-from-the-perspective-of-rights-protection.html)

---

## 2. Fork 一个 AGPL 项目（以 Vikunja 为例）做 SaaS 收费，法律上会发生什么

### 2.1 Vikunja 的事实基线

- Vikunja 使用 **AGPL-3.0**（仓库根目录即 AGPL 全文）。[来源（LICENSE）](https://github.com/go-vikunja/vikunja/blob/main/LICENSE)
- 官方自述（Vikunja 博客《Vikunja stays open》）：**"Vikunja ships under AGPL-3……如果你修改了 Vikunja 并把它作为服务提供给别人，你必须以同一许可证公开你的修改。一个闭源 fork 作为 SaaS 运行，会违反其中每一位贡献者的条款。"** 同一文章明确：**"There is no CLA"**（项目没有贡献者许可协议）。[来源](https://vikunja.io/changelog/vikunja-stays-open)
- Vikunja 自营云服务定价：自托管免费（AGPL-3.0，无用户数限制）；Cloud Personal **€4/月（年付 €40）**；Cloud Organization **€5/月/用户**。[来源（定价）](https://vikunja.io/pricing)

### 2.2 法律上会发生什么（逐条）

【事实】

1. **你可以收费，AGPL 不禁止商用。** AGPL 授予商业使用权，收费本身合法。
2. **如果你做了修改并对外提供网络服务**，必须向通过网络交互的用户提供你修改版的**完整对应源代码**，且通过服务器免费提供访问。Vikunja 官方表述正是这一点。
3. **"fork 但不改代码"存在解释空间。** 按第 13 条字面，未修改的运行多数解读不触发提供源代码义务；但一旦你改了 UI、改了后端逻辑、加了功能，就触发。而实务上 SaaS 产品几乎必然要做定制，所以**默认应按"会触发"来设计合规**。这是许可证解释问题，不是绝对结论，须由律师判断。
4. **你仍然可以闭源你自己的"独立程序"**，前提是它与 AGPL 组件在法律与工程上都被认定为独立作品。中国法院已认可"前端/后端可分别独立打包部署、不因交互而认定为一体"的判断方法。但把专有代码和 AGPL 核心交织在一起，会被认为发生 "license contamination"。【一般性建议】边界必须由律师 + 架构共同设计，不能靠"放在同一个 repo 里但不同文件夹"糊过去。[来源](https://www.kingandwood.com/cn/zh/insights/latest-thinking/examining-the-use-of-open-source-software-in-compliance-with-from-the-perspective-of-rights-protection.html)
5. **你不能用 Vikunja 的名字和 logo 做自己的品牌。** 许可证不授予商标权（见 1.4）；Vikunja 官网、品牌仍受保护。
6. **你无法从 Vikunja 官方买到"商业许可证"来做双许可。** 双许可（dual licensing）只能由**拥有全部版权**的主体提供；Vikunja **没有 CLA**，代码版权分散在众多贡献者手中，上游自己也说"很难关闭"。这意味着：**对 Vikunja 这条路径，"买一份商业授权绕开 AGPL"实际上不可行。** 若你想自己做双许可，必须从第一天就要求贡献者签 CLA 或 DCO/版权转让。
7. **违约后果**：开源许可证在中国被法院认定为"附条件的许可合同/合同性质的法律关系"，违约可导致许可自动终止，从而使继续复制、修改、发布行为**转为著作权侵权**（"罗盒案 / Digital Paradise"是中国首例 GPL 相关判决中的标志性认定）。美国方面，Neo4j, Inc. v. PureThink, LLC 中第九巡回上诉法院维持了关于下游不得剥离附加商业限制的临时禁令认定。[来源（中国）](https://blog.mickeyzzc.tech/en/posts/architecture/source-available-ai-license)、[来源（Neo4j）](https://ossscan.com/blog/what-happens-after-open-source-license-breach.html)
   - 另有公开讨论提到 Truth Social 被指未遵守 Mastodon 的 AGPL 义务，但【未核实】该事件是否形成生效裁判，本文不将其作为判例引用。[来源](https://auth0365.talentheromedia.com/talentheromedia-news/truth-social-vs-mastodon-the-lawsuit-explained-1764805514)
8. **行业现实**：多数权利人不会立刻起诉，而是先发合规函、给整改窗口；诉讼往往是最后手段。[来源](http://cardozolawreview.com/wp-content/uploads/2018/08/GREENBAUM.37.4.pdf)

### 2.3 常见做法（事实归类 + 建议）

| 模式 | 事实依据 | 要点 |
|---|---|---|
| **托管服务收费（Hosted service）** | Vikunja 自己在做：核心 AGPL 免费自托管，官方云 €4/月 | 最直接的合法路径：**公开修改版源代码 + 靠运维/托管/支持收费**。前提是持续维护开源发布的合规成本可接受。[来源](https://vikunja.io/pricing) |
| **开源核心 + 商业插件（Open core）** | [TermsFeed 分析](https://www.termsfeed.com/blog/dual-licensing-vs-open-core) | 核心 AGPL，增值功能做成独立闭源插件/服务，两套许可证并行。法律基础是"边界型"而非"选择型"，**边界必须架构级隔离**以避免 copyleft 传染。 |
| **双许可（Dual licensing）** | 只有版权人能做；MongoDB、SugarCRM、Mautic 用过 AGPL + 商业许可证 | **对 fork Vikunja 不适用**（无 CLA）。若你要自己做，必须从项目第一天起要求 CLA，或确保自己是唯一作者。[来源](https://opencoreventures.com/insights/agpl-license-is-a-non-starter-for-most-companies) |
| **买商业授权** | 大公司普遍有 "AGPL 黑名单" | 这是 AGPL 双许可模式成立的根本原因：企业要么开源、要么付费。[来源](https://www.cnblogs.com/itech/p/20045835) |
| **改用宽松许可证重写** | 常见规避手段 | 【一般性建议】若商业模式明确要闭源，选 MIT/Apache-2.0 的自研或 fork 起点，成本最低、风险最小。 |

### 2.4 【一般性建议，非法律意见】

- 若目标只是"自研一个替代品并收费"：**不要 fork AGPL 项目**，用 MIT/Apache-2.0 的项目或完全自研，能省掉整条合规链。
- 若一定要基于 Vikunja/AGPL fork 做 SaaS：默认按"修改版必须开源"运作；在产品内醒目放置源码链接；保留全部版权与许可声明；不用上游商标；保存 SBOM 与修改记录；在上线前请熟悉开源合规的律师出具意见。
- **开源 ≠ 免费，也 ≠ 不能收费**；AGPL 的约束是"必须开源"，而不是"不能赚钱"。

---

## 3. 滴答清单 / TickTick 是否提供公开 API

### 3.1 结论：**有官方 Open API，但能力范围很窄，且不适合做第三方客户端**

【事实】

- **存在官方开发者平台**：`developer.ticktick.com`（国际版 TickTick）与中国版滴答清单开放平台，均提供 OAuth 2.0 授权与 REST API。官方站描述："With TickTick Open API, developers can integrate TickTick's powerful task management features into their own applications." [来源](https://developer.ticktick.com)
  - 中国版可通过把 TickTick API 文档域名替换为 `dida365` 看到对应文档。[来源](https://juejin.cn/post/7376484708547870731)
- **认证方式**：OAuth 2.0 授权码流程（获取 Client ID / Client Secret → 授权拿 code → 换 token）。Access Token 有效期约 2 小时，可 refresh。[来源](https://juejin.cn/post/7376484708547870731)
- **权限范围（scopes）只有两个**：`tasks:read`、`tasks:write`。"Two scopes only — that's the entire permission model." [来源](https://www.usecarly.com/blog/ticktick-mcp)
- **能力范围（官方端点，中国版对齐 `/open/v1`）**：
  - 项目/清单：`GET/POST/DELETE /open/v1/project`
  - 任务：`POST /open/v1/task`、`POST /open/v1/task/{taskId}`、`POST /open/v1/project/{projectId}/task/{taskId}/complete`、`DELETE /open/v1/project/{projectId}/task/{taskId}`
  - 项目聚合数据：`GET /open/v1/project/{projectId}/data`
  - 已完成任务：`GET /open/v1/project/{projectId}/task/completed`
  - **没有全局任务列表接口**，也没有标签写接口。
  [来源](https://github.com/GalaxyXieyu/didatodolist-mcp/blob/main/README.md)
- **明确不支持的能力**：
  - **无 Webhook**——TickTick 无法在任务创建/完成/到期时主动推送，任何事件驱动只能轮询。这是官方与社区 MCP 的关键差距。[来源](https://www.usecarly.com/blog/ticktick-mcp)
  - 习惯（habits）、专注记录（focus records）、倒数日（countdowns）**不在 Open API 中**；部分社区实现需借助**非官方 `/api/v2/` 接口**，并自述"可能随时变更"。[来源](https://www.usecarly.com/blog/ticktick-mcp)、[来源](https://lobehub.com/mcp/oymy-dida365-ai-tools)
  - 单个项目最多 500 个任务（第三方技能文档描述，[来源](https://openclaw.army/ja/skills/manuelhettich/ticktick)）；官方未公开 API 速率限制。[来源](https://rollout.com/integration-guides/tick-tick/api-essentials)

### 3.2 是否允许第三方客户端 / 数据同步？——ToS 层面的关键条款

【事实】TickTick 服务条款（Appest Inc.）原文要点：

- 授予用户的仅是**"personal, worldwide, royalty-free, non-assignable and non-exclusive license"**，且仅用于"按这些条款允许的方式使用和享受服务"；
- **"You may not copy, modify, distribute, sell, or lease any part of our Services or included software, nor may you reverse engineer or attempt to extract the source code"**；
- **"Don't misuse our Services. For example, don't interfere with our Services or try to access them using a method other than the interface and the instructions that we provide."**
  [来源](https://ticktick.com/tos?language=en_us)

【事实 + 推论】第三方集成指南亦指出：使用非官方方式访问 TickTick 数据**可能违反其服务条款**；同时该指南本身对"是否存在官方公共 API"给出了矛盾描述，说明第三方生态中存在混淆。[来源](https://rollout.com/integration-guides/tick-tick/api-essentials)

【一般性建议】从 ToS 文义看：

- **用官方 Open API 做"集成类"应用**（在你自己的产品里帮用户创建/读取任务，用户 OAuth 授权）是被平台明示支持的场景。
- **做"替代品/第三方客户端 + 数据全量同步"**，尤其是依赖非官方 `/api/v2/` 或直接读取私有接口，风险较高：可能落入"以我们提供方式之外的手段访问服务"以及"复制/修改/反向工程"的禁止范围，且平台可随时停用或限流。
- 如确有此需求，正确做法是**先向平台申请书面授权/商务合作**，而不是先做后补。

> 未能核实项：本次调研未能打开 `developer.ticktick.com` 的开发者协议/应用审核条款全文（web_fetch 被本机网络限制阻断）。**建议由可正常访问该站的同事补齐：应用是否需要人工审核、是否有商用限制、是否禁止与 TickTick 自有客户端竞争的用途。**

---

## 4. 类似产品被大厂/原厂发起法律行动的真实案例

### 4.1 国外：可核实的具体行动

| 案例 | 时间 | 性质与结果 | 来源 |
|---|---|---|---|
| **NYT 对 Wordle 克隆发起 DMCA 下架** | 2022 | 纽约时报对 Wordle 克隆及分享其代码的 GitHub 用户发起多起 DMCA takedown，主张对"5×6 网格、绿块"等元素的版权；NYT 声明"不反对个人创作不侵权的类似文字游戏"。**注意：这是版权下架通知，不是法院判决。** | [AP](https://apnews.com/article/new-york-times-wordle-clones-takedown-dmca-35d32b7548f7312ea74a2065b2cd31a6)、[Scripps](https://www.scrippsnews.com/business/new-york-times-files-copyright-takedown-requests-against-wordle-clones) |
| **Pomodone 因商标主张关停** | 2024 | Pomodone（Todoist 生态的番茄钟应用）公告：因 Francesco Cirillo（番茄工作法商标持有人）提起商标侵权主张而停止运营。**说明：围绕生产力工具的方法论/名称商标，主张方可以是很小的权利人，且实际后果可能是产品直接关停。** | [Reddit r/todoist](https://www.reddit.com/r/todoist/comments/1gehe1y/pomodone_is_done) |
| **OpenAI 诉 Open Artificial Intelligence（商标）** | 2025 | 法院认定被告商标侵权与欺诈，含 5 项商标侵权与欺诈请求；法官认定被告"明知且故意"欺骗 USPTO。 | [Courthouse News](https://www.courthousenews.com/openai-wins-trademark-lawsuit-against-doppelganger-company) |
| **Slack/Salesforce 诉 Microsoft（Teams 捆绑）** | 2026-04 | 在伦敦高等法院提起，指控搭售/捆绑损害竞争；**这是反垄断诉讼，不是"克隆"诉讼**，用于说明"大厂之间会用反垄断而非版权解决相似产品竞争"。 | [Reuters](https://www.reuters.com/5f374b32b07b/sustainability/boards-policy-regulation/microsoft-facing-uk-antitrust-lawsuit-from-slack-over-teams-bundling-2026-04-27) |

**关于 Todoist / Any.do / Notion 的"模仿者诉讼"：**
【事实】本次检索**未发现** Doist（Todoist）就"模仿者 App"提起的公开诉讼、也未发现 Any.do 的相关诉讼。检索到的是：
- Doist 持有 TODOIST 注册商标（美国注册号 5042725，2016-09-13 注册）[来源](https://trademarks.justia.com/867/55/todoist-86755038.html)；
- Notion Labs 持有 NOTION 商标（注册号 5964558）[来源](https://trademarks.justia.com/879/23/notion-87923697.html)；
- Notion 近年是**被诉方**（如 TG-2006 Holdings 的专利侵权案 2025、UBQS-IP 专利案 2026），而非起诉模仿者。[来源](https://www.courtlistener.com/docket/69728118/tg-2006-holdings-llc-v-notion-labs-inc)、[来源](https://dockets.justia.com/docket/new-york/nysdce/1:2026cv02878/661411)

【一般性建议】**"没有找到公开诉讼"不等于"没有风险"**：原厂更常见的做法是（1）App Store 知识产权投诉/下架、（2）DMCA、（3）律师函、（4）商标异议，而非公开诉讼。这些都不会留下显眼的判例记录。

### 4.2 中国境内"模仿 App 界面"的合规风险要点

【事实】法律框架：

- **《反不正当竞争法》第六条（混淆条款）**：禁止擅自使用他人有一定影响的标识引人误认。**2025 年修订版把"应用程序名称或者图标"明确纳入"标识"范围**，混淆条款条号由第六条变为**第七条**，新法 **2025-10-15 施行**。[来源（环球）](https://www.glo.com.cn/Content/2025/08-06/1523377995.html)、[来源（新浪/北交所解读）](https://cj.sina.cn/articles/view/5952915720/162d2490806704twmq)
- **《反不正当竞争法》第二条（一般条款）**：对不属于具体条款、但明显"搭便车/不劳而获"、违背诚信与商业道德的行为兜底规制。[来源（环球）](https://www.glo.com.cn/Content/2025/08-06/1523377995.html)
- **《著作权法》**：保护"表达"而非"思想"；软件界面要作为美术作品/计算机软件受保护，门槛较高。

【事实】真实案例：

| 案件 | 法院/结果 | 要点 |
|---|---|---|
| **中华万年历 vs 网跃互动"中华万年历无广告版"** | 认定构成不正当竞争，停止侵权 + 在《法制日报》消除影响 + **赔偿 30 万元** | 被告 App 与原告 **142 张资源图相同，占其总资源图 309 张的 46%**，"远超出正常比例，显然属于恶意抄袭"；另有抢注近似域名、伪造行政处罚决定书恶意投诉（构成商业诋毁）。法院适用反法**第二条**。法官后语指出：能用著作权规制的按著作权，**恶意抄袭界面认定不正当竞争属较少见**。[来源](https://www.zhichanli.com/p/2024618187) |
| **快手（一笑科技）vs 小看 App（乐鱼公司）** | 北京海淀区人民法院：**驳回原告（快手）全部诉讼请求** | 法院认为 18 个操作步骤对应的界面属"为实现功能所必备的设计"，主要体现功能性，部分借鉴其他软件，**难以证明整体构成独特设计组合、达到可区分来源的作用**，故快手对该界面**不享有可制止他人模仿的合法权益**。裁判要旨：**正当模仿与不正当竞争的界限在于是否造成来源混淆；仅为满足功能而设计的界面不能阻止他人正当模仿。** [来源](https://www.zhichanli.com/p/678987278) <br>⚠️ **注意来源冲突**：另有律所页面称"2018 年海淀法院认定被告直接使用快手 App 界面设计、违反反法"（该所自述代理快手）。[来源](https://www.javv-lawyers.com/news/dongtai/1866046300433170434.html) 两者可能指同一案件的不同审级或存在描述偏差，**引用时须以裁判文书为准**。 |
| **某 App 名称/图标仿冒案（微信小程序）** | 杭州铁路运输法院（2020）浙 8601 民初 1841 号：赔偿 **3 万元** | 被告小程序图标、名称与原告 App 几乎完全相同，业务相同。法院认定具有影响力的 App 标识属反法第六条保护的商品名称标识，被告"搭便车、模仿的故意"明显。[来源](https://www.ipeconomy.cn/dongtai/5682.html) |
| **抖音"变身漫画特效" vs 亿某科"少女漫画特效"** | 最高法 2025-09-08 发布的反不正当竞争典型案例；一审认定违反反法第二条 | AI 模型结构与参数被抄袭；说明**技术/算法层面的模仿也可能落入反法一般条款**。[来源](https://www.csrc.gov.cn/beijing/c105537/c7582591/content.shtml) |
| **搜狗诉百度输入法专利（8 项，索赔 8000 万）** | 历时约 4 年、近 50 次诉讼较量；最终认定搜狗构成不正当竞争 | 说明"界面/交互相关知识产权诉讼"的**时间与成本极高**。[来源](https://javy-lawyers.com/news/dongtai/1866046300433170434.html) |
| **软件界面抄袭的著作权举证** | 北京知识产权法院：原告败诉 | 判定遵循"接触 + 实质性相似 − 其他来源"；**仅接触目标程序一般不视为著作权意义上的"接触"**；软件功能设置相似 ≠ 软件构成实质性相似。[来源（中国保护知识产权网）](https://ipr.mofcom.gov.cn/article/gnxw/sf/zz/zzbq/202312/1983176.html) |

【一般性建议，非法律意见】

1. **最大的法律风险不在"界面像"，而在"名称/图标/商标"**。把 App 名称、图标、Slogan 做得与滴答清单近似，直接落入反法第六条（新法第七条）混淆条款 + 商标侵权，胜诉概率和赔偿都明显更高。
2. **纯功能性界面布局（列表、勾选圆圈、日期选择）很难获得独占保护**，抄袭这类设计的法律风险较低；但**整套视觉设计 + 资源图 + 图标 + 文案」的高比例雷同**会被认定为恶意抄袭。
3. **UI 外观设计专利**：中国允许 GUI 申请外观设计专利。若对方在相关类别申请了 GUI 外观设计专利，风险会显著上升。做产品前应做**商标 + 外观设计 + 著作权**三轮检索。
4. **不要复制非功能性资产**：图标、插图、LaTeX 式插画、宣传文案、示例数据、帮助文档，都是著作权的高风险区。
5. **不要用对方商标做 App 名称、ASO 关键词、比价页面**（"滴答清单替代品"用作产品内对比说明通常是描述性使用，用作名称或关键词则有风险）。
6. 上线前请中国执业律师做一次自由实施（FTO）/侵权风险评估，尤其是名称与图标。

---

## 5. 上架应用商店的成本与门槛

### 5.1 Apple App Store

| 项目 | 数字（官方） | 来源 |
|---|---|---|
| Apple Developer Program 年费 | **99 USD/年** | [Apple 官方](https://developer.apple.com/help/account/membership/program-enrollment) |
| Apple Developer Enterprise Program（仅内部员工分发） | **299 USD/年** | 同上 |
| 佣金 · 标准 | **30%** | [Apple 官方项目页转述](https://ambsandigital.com/apple-developer-program-fee-2026) |
| 佣金 · 小型企业计划（Small Business Program，年收入 ≤ $1M） | **15%** | [来源](https://the-platform-law.com/2020/11/18/apple-reduces-app-store-commission-for-small-developers-shall-we-all-be-happy) |
| 佣金 · 自动续订订阅 | 第 2 年起 **15%** | [来源](https://www.airbridge.io/en/blog/subscription-vs-one-time-purchase-app) |
| 教育机构 | 可申请免年费 | [Apple 官方](https://developer.apple.com/help/account/membership/program-enrollment) |

**变化中（需持续跟踪）**：2026 年 Apple 在部分司法辖区（US/UK/EEA）调整了佣金结构，并出现"服务费 + 支付处理费"的拆分口径；不同来源数字不完全一致（例如有来源称小型企业以外的新安装 IAP 有效费率变化）。上架前请以 **Apple 官方费率页面**为准。[相关分析](https://medium.com/@jakeludington/unpacking-apples-new-app-store-fee-structure-a5a42a7a2dac)

### 5.2 Google Play

| 项目 | 数字 | 来源 |
|---|---|---|
| 开发者注册费 | **25 USD，一次性、不可退**，无年费、无按 App 收费 | [Google 政策页转述](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)、[来源](https://www.iconikai.com/blog/google-play-developer-account-fee-2026) |
| 新个人开发者账号（2023-11-13 之后创建） | 必须完成封闭测试：**至少 12 名测试者连续 opt-in ≥ 14 天**，才能申请生产发布权限 | [Google 官方帮助](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en) |
| 服务费 · 订阅 | 自 2022-01 起对所有人 **15%**（无首年 30%） | [来源](https://adapty.io/blog/google-play-billing-changes-subscriptions-fees) |
| 服务费 · 一次性内购（≤ $1M） | 有效 **15%** | 同上 |
| 2026-06-30 起（US/UK/EEA） | 拆分为 **10% 服务费 + 5% 支付处理费**；走自有支付或网页结账则服务费降至 10% | 同上 |

### 5.3 中国区上架：资质清单

【事实】

1. **工信部 App 备案（强制）**
   - 依据：2023-08 工信部《关于开展移动互联网应用程序备案工作的通知》；2023-09 至 2024-03 为存量备案阶段，2024-04 至 2024-06 为监督检查阶段；**未履行备案不得从事 App 互联网信息服务，网络接入服务提供者不得提供接入，分发平台不得提供分发**。[来源](https://zhuanlan.zhihu.com/p/663085497)
   - 备案前置条件：企业认证、实名认证域名（有效期 ≥3 个月）、中国内地节点服务器且包月 ≥3 个月、已完成应用商店开发者账号注册、已生成签名证书（需填写包名、公钥、证书指纹 MD5）。[来源（阿里云文档）](https://help.aliyun.com/zh/icp-filing/basic-icp-service/getting-started/quick-sta-rt-for-icp-filing-for-personal-app)
   - 周期：云厂商初审约 1 个工作日，管局审核不超过 **20 个工作日**。[来源（天翼云）](https://www.ctyun.cn/document/10000037/10001119)
   - 权威示例：**腾讯轻联页面显示其 ICP 备案/许可证号 粤 B2-20090059**。[来源](https://qinglian.tencent.com/apps/details/dida)

2. **Apple App Store 中国区要求 ICP 备案号（强制）**
   - 自 2024 年 4 月起，中国大陆新 App 提审**必须填写 ICP 备案号**，否则报错；苹果后台会**自动校验 App 名称与工信部备案信息是否一致**，不一致无法进入下一步。国际开发者（主体与服务器均不在国内）当时未被要求提供。[来源（21 经济网）](https://www.21jingji.com/article/20240404/herald/0186266187de0c6b1e4b0889dc5392a6.html)
   - 海外 App 不申请备案号则无法在中国大陆上架。[来源（cnBeta）](https://www.cnbeta.com.tw/articles/tech/1387241.htm)

3. **软件著作权（软著）**
   - **国内安卓主流商店（华为、小米、OPPO、vivo、应用宝、360、百度）将软著列为上架硬性前置资质，无豁免通道**；个人开发者账号的软著登记姓名须与实名认证身份证完全匹配。[来源（同创知识产权）](https://www.tczscq.com/show/55.html)、[来源（掘金）](https://juejin.cn/post/7640041577754787894)
   - **Apple 仅建议、不强制**软著。[来源（同创知识产权）](https://www.tczscq.com/show/55.html)
   - 软著名称、商店上架名称、工信部备案名称**三者核心关键词必须统一**（小米、华为要求最严）。[来源](https://juejin.cn/post/7640041577754787894)
   - 官方渠道：中国版权保护中心 `ccopyright.com.cn`，**可自主申请、官方不收费**。[来源（知乎流程）](https://zhuanlan.zhihu.com/p/2012190307538732132)
   - 周期（不同来源冲突）：
     - 一说常规约 **60 个自然日**；[来源](https://www.sohu.com/a/1003527579_120461092)
     - 2026 年来源称实质审查拉长至 **100–120 个工作日**，加急 **3–10 个工作日**（官方加急名额有限、额外收费）。[来源（掘金）](https://juejin.cn/post/7640041577754787894)
     - **2026-03-15 起中国版权保护中心从严审查**：新申请表功能描述从 ≤200 字改为 **500–1300 字**，需实名手抄承诺（含"未使用 AI 编写代码/材料"声明）+ 身份证号，AI + 人工双重审核，材料不一致直接补正/驳回，并建立失信名单。[来源](https://finance.sina.com.cn/wm/2026-03-17/doc-inhrhavy9585639.shtml)
   - 【风险提示】软件必须自研；纯套模板、仅改图标文字的 App，软著会被驳回，商店也会后台核查原创性并批量下架。[来源](https://www.tczscq.com/show/55.html)

4. **ICP 许可证（增值电信业务经营许可证）—— 🔴 本节原结论已在 2026-10-01 撤销，见下**

   > **原写法（保留，为了让后来者看清它错在哪）**：
   > "判断钥匙是两个字：**收费**。只要向用户有偿提供信息服务（会员费、订阅费…），就属'经营性'，须办 ICP 许可证"；
   > "如果做「App 内订阅收费」+「国内上架」，**ICP 许可证（公司、100 万注册资本、3 人社保）很可能是硬门槛**"。
   > 来源是**知乎**（<https://zhuanlan.zhihu.com/p/2055232717172875499>）与**代办机构页**（<https://m.miibt.com/show-48-7263-1.html>）。
   >
   > 🔴 **为什么这句必须撤销，而不只是加个标注**：它当时被本文附录 A 列进了**【事实】**，
   > 于是下游把它当依据引用了一次 —— 结论是"heyta 的订阅定价被 ICP 许可证显著抬高门槛，
   > 考虑先只做海外"。**一个代办广告语改变了一个产品的定价与发行范围**，这就是漂移的代价。

   **更正后的结论（2026-10-01，产品负责人裁决 + 官方文本复核）：heyta 只办 ICP 备案（网站/App 备案），不办 ICP 经营许可证。**

   三条依据，逐条给出处（详见 [`legal-filing-prerequisites.md`](legal-filing-prerequisites.md) §5）：

   - **法源的宾语不是"收费"**：《互联网信息服务管理办法》第三条把经营性定义为
     "通过互联网向上网用户**有偿提供信息**或者网页制作等服务活动"。heyta 卖的是**自己软件的功能额度**，
     不采集、不加工、不向用户或第三方**提供信息**；服务端因 E2EE **看不到内容**，
     结构上不存在"把信息卖给你"这件事。 ⇒ 不落在经营性定义里。
   - **"3 人社保"根本不在法规里**：《电信业务经营许可管理办法》第六条逐字只有四项
     （注册资本 100 万/1000 万、可行性研究报告与技术方案、必要的场地设施、三年内无重大违法），
     **没有任何员工人数或社保要求**；《电信条例》第十三条只讲"相适应的资金和专业人员"。
     那条"3 名员工近 1 个月社保"是**代办窗口话术**。 ⇒ 原"硬门槛"的三个数字里有一个是编的。
   - **同品类实证**：滴答清单中国版页脚公示的是「**浙ICP备12005180号-3**」，
     **未公示增值电信业务经营许可证号**（抓取于 2026-10-01，需人工复核；未公示 ≠ 不持有）。

   **什么时候要重判（翻脸条件，不是修辞）** —— 出现下面任何一件，本节结论作废、按 §5 重做：
   上线**托管 AI 并对用户收费**；任何**内容面向多用户分发**的功能（公开清单、模板市场、分享广场、社区）；
   加**广告**；卖**信息服务**性质的东西（付费内容订阅、任务模板内容库）。

   **对定价的影响：无。** 原先那句"ICP 许可证会显著抬高门槛，考虑先海外/只做买断"随之撤销。


5. **其他合规项**
   - **个人信息保护**：App 个人信息处理须遵循最小必要原则，不得因用户拒绝非必要权限而拒绝提供基本功能；App 分发平台对新上架 App 实行上架前个人信息处理规范性审核，问题 App 可被责令整改、公告、下架，被下架后 40 个工作日内不得通过任何渠道再次上架。[来源（中国法翻译·征求意见稿）](https://www.chinalawtranslate.com/app-personal-data-protection)
   - **游戏** App 还需网络游戏出版物号（版号）；新闻、出版、影视、宗教等类目需前置审批。[来源（21 经济网）](https://www.21jingji.com/article/20240404/herald/0186266187de0c6b1e4b0889dc5392a6.html)
   - 应用分发平台自身的备案（网信部门）要求也在演进中。[来源（环球）](https://www.glo.com.cn/Content/2022/06-24/0957219558.html)

### 5.4 成本速算（【一般性建议/估算，非官方】）

| 项目 | 金额 | 性质 |
|---|---|---|
| Apple Developer Program | $99/年 ≈ ¥700/年 | 官方硬性 |
| Google Play | $25 一次性 ≈ ¥180 | 官方硬性 |
| 软著（自主申请） | ¥0（官方） | 官方免费，但耗时 |
| 软著（代办加急） | 市场价数百至数千元 | 市场调节价 |
| 域名 + 国内服务器（备案要求包月 ≥3 个月） | 数百元/年起 | 备案前置条件 |
| ~~**ICP 许可证**~~ | ~~注册资本 **100 万元（认缴）** + 3 人社保 + 材料/代办成本~~ | 🔴 **2026-10-01 撤销：heyta 不适用**（自营软件服务只需 ICP/App 备案；"3 人社保"不是法规条文，见 §5.3 第 4 项） |
| 佣金 | Apple 15%（≤$1M）/ Google 15%（≤$1M） | 收入分成 |

---

## 6. 独立开发者做这类 productivity app 的变现模式与定价参考

### 6.1 主流变现模式（【事实】：来自公开的行业分析）

2026 年 Mac/iOS 独立开发者的六种有效模式：**订阅、Freemium、一次性买断、通过 Setapp 分发、应用内购买、混合模式**；最成功的 App 往往同时用两到三种。[来源（Setapp）](https://setapp.com/app-reviews/app-monetisation-strategies)

- **一次性买断**：适合"价值在首次启动即交付完"的聚焦型工具（计算器、文件管理、文本编辑）；典型单价 **$5–$50**，专业工具更贵。[来源（Setapp）](https://setapp.com/app-reviews/app-monetisation-strategies)
- **订阅**：适合长期持续交付价值的产品；年度计划 + 试用是 LTV 最优组合。[来源（Adapty）](https://adapty.io/state-of-in-app-subscriptions-report)
- **混合模式（推荐参考）**：CleanMy®Phone 同时提供月订、年订（带免费试用）和一次性终身买断。[来源（Setapp）](https://setapp.com/app-reviews/app-monetisation-strategies)

**关键行业数据（Adapty 2026，覆盖 10,000+ 订阅 App）**：

| 指标 | Productivity 类目 | 全类目中位数 |
|---|---|---|
| 月订阅中位价 | **$7.99** | $9.99 |
| 年订阅中位价 | **$49.99** | $59.99 |
| 试用开始率 | 59% | 58% |
| 试用转付费率 | **58%** | 53% |
| 选择年付占比 | 51% | 47% |
| 平均 LTV（所有计划） | **$46.97（全类目第一）** | — |
| 一年后留存 | **14%（全类目最佳）** | — |

[来源（Adapty 报告）](https://adapty.io/state-of-in-app-subscriptions-report)、[来源（汇总）](https://www.rocketshiphq.com/adapty-subscription-app-benchmark-2025-summary)

**市场结构性事实（RevenueCat/Adapty 2026 综述）**：

- 订阅 App 月均收入中位数 **$492**，同比 **下降 22%**；**Top 10% 的 App 拿走 94.5% 的订阅收入**（2023 年为 92.7%）。
- 周订阅现贡献约 **55.5%** 的订阅收入，且搭配免费试用时 12 个月 LTV 最佳。
- **89.4% 的试用开始发生在安装当天（Day 0）**。
- 硬付费墙（hard paywall）下载转付费中位数 **10.7%**，Freemium 仅 **2.1%**。
- 一年做 50+ 次实验的 App 收入中位数 $914,734，只做 1 次实验的仅 $48,848。
[来源](https://www.igniscor.com/post/state-of-app-monetization-2026)、[来源](https://www.airbridge.io/en/blog/subscription-vs-one-time-purchase-app)

### 6.2 直接对标产品的定价（2026 年）

| 产品 | 模式 | 价格 | 来源 |
|---|---|---|---|
| **TickTick** | Freemium 订阅 | Premium **$35.99/年**（约 $3/月）；另有来源报 $3.99/月、$28/年、$49.99/年，**来源间冲突** | [checkthat.ai](https://checkthat.ai/brands/ticktick/pricing)、[digitalprojectmanager](https://thedigitalprojectmanager.com/tools/ticktick-pricing)、[Deepak Gupta 对比](https://guptadeepak.com/tools/top-10-task-management-apps-2026) |
| **Todoist** | Freemium 订阅 | Pro：**$5/月（年付，$60/年）或 $7/月（月付）**；Business **$8/用户/月（年付）或 $10/月**。2025-12 从 $4 涨到 $5 | [alfred](https://get-alfred.ai/blog/todoist-pricing)、[CompareEdge](https://comparedge.com/tools/todoist/pricing) |
| **Things 3** | **纯一次性买断，无订阅** | iPhone + Apple Watch **$9.99**；iPad **$19.99**；Mac **$49.99**；全套 **$79.97**（含 Vision Pro 则 $109.96） | [ellieplanner](https://ellieplanner.com/productivity-copilot/things-3-pricing)、[lifestack](https://lifestack.ai/blog/things-3-pricing) |
| **Any.do** | 订阅 | Premium 约 **$60–72/年** | [checkthat.ai](https://checkthat.ai/brands/ticktick/pricing) |
| **Vikunja** | 自托管免费 + 托管订阅 | Personal **€4/月（€40/年）**；Organization **€5/月/用户** | [vikunja.io/pricing](https://vikunja.io/pricing) |
| **Adapty 全类目中位数** | 订阅 | **$7.48/周、$12.99/月、$38.42/年** | [Adapty](https://adapty.io/blog/productivity-app-subscription-benchmarks) |

### 6.3 【一般性建议，非事实结论】

1. **定价锚点**：做任务/清单类产品，**年付 $30–$50 是 Productivity 类目的中位区间**；若对标 TickTick，$28–$36/年 是用户心智价；若走"更专业/更强 AI"，$49.99–$79.99/年 有空间。
2. **平台现实**：中位订阅 App 月收入仅 $492，且 Top 10% 拿走 94.5% 收入——**渠道与增长（ASO、内容、社区）比定价优化更能决定生死**。
3. **模式选择**：
   - 本地优先、无服务器成本的工具 → 一次性买断（可参考 Things 3 的分平台定价 + 单版本升级付费）；
   - 有同步/服务端/AI 推理成本 → 订阅（年付为主，配 7 天试用；年付选项一定要和月付并列展示）；
   - 更稳妥 → 混合模式（月订 + 年订 + 终身买断三档，参考 CleanMy®Phone）。
4. **合规对定价的反向约束**：~~在中国大陆做订阅收费，ICP 许可证（公司 + 100 万注册资本 + 3 人社保）会显著抬高门槛。若暂时不满足，可选方案是**先走海外商店 + 境外主体**，或**先做一次性买断/买断式解锁**降低"经营性"认定争议。~~
   🔴 **本条已于 2026-10-01 撤销，不再生效**（依据见 §5.3 第 4 项的更正块）：heyta 是**自营软件服务**，不属"经营性互联网信息服务"，只需 **ICP 备案 + App 备案**；那条门槛来自**代办机构话术 + 知乎**，且"3 人社保"在《电信业务经营许可管理办法》第六条里**根本不存在**。
   ⚠️ **仍然成立的一半**：备案本身要时间（接入商初审 + 管局），所以**发行节奏仍受备案进度约束** —— 但那是排期问题，不是"要不要改成买断/只做海外"的定价问题。

---

## 附录 A：事实 vs 建议对照

| 类型 | 内容 |
|---|---|
| **事实**（有来源支撑） | AGPL 第 13 条原文与解释；BUSL Change Date 4 年上限与 GPL 兼容要求；Vikunja 采用 AGPL-3.0、无 CLA、官方定价；TickTick 官方 Open API 存在、仅 2 个 scope、无 webhook；TickTick ToS 原文条款；Apple $99 / Google $25 / 12 测试者规则；工信部 App 备案、Apple 大陆 ICP 要求、软著为安卓商店硬性资质；Adapty/RevenueCat 各项基准数据；各家定价；中国反法案例判决结果 |
| 🔴 **已撤销的"事实"（2026-10-01）** | **「ICP 许可证条件」曾被列进上面那一行** —— 它的实际来源是知乎 + 代办机构页，其中"3 名员工近 1 个月社保"**在《电信业务经营许可管理办法》第六条里不存在**。许可证的**法定条件**只有第六条那四项，逐字文本见 [`legal-filing-prerequisites.md`](legal-filing-prerequisites.md) §5【依据】第 2 条。**结论层面：heyta 不办此证**（§5.3 第 4 项） |
| **【一般性建议】** | fork AGPL 项目的具体合规操作；第三方客户端的法律风险判断；界面模仿的风险等级排序；定价区间推荐；模式选择建议；成本估算 |
| **【未核实 / 需补查】** | `developer.ticktick.com` 开发者协议与审核条款全文；AGPL 在"未修改运行"情形下的官方/司法认定；Apple 2026 最新佣金结构在各辖区的准确口径；讯息来源对"快手诉小看案"结果存在冲突，需以裁判文书为准 |

## 附录 B：主要来源索引

**许可证**
- [FOSSA — AGPL 101](https://fossa.com/blog/open-source-software-licenses-101-agpl-license)
- [FOSSA — BSL 1.1 要求、条款与历史](https://fossa.com/blog/business-source-license-requirements-provisions-history)
- [FOSSA — LGPL 101](https://fossa.com/blog/open-source-software-licenses-101-lgpl-license)
- [Apache License 2.0 原文](https://www.apache.org/licenses/LICENSE-2.0)
- [SPDX — Elastic License 2.0](https://spdx.org/licenses/Elastic-2.0.html)
- [The IPKat — MongoDB/SSPL 第 13 条分析](https://ipkitten.blogspot.com/2019/02/closing-agpl-cloud-services-loop-hole.html)
- [Goodwin — 从开源转向的许可趋势](https://www.goodwinlaw.com/en/insights/publications/2024/09/insights-practices-moving-away-from-open-source-trends-in-licensing)
- [OpenAtom — AGPLv3 中译文](https://www.openatom.org/journalism/detail/3N0zX9I7fX4u)
- [土法炼钢 — 开源许可证全景（BUSL/SSPL 案例）](https://quant67.com/post/opensource/03-license-taxonomy/license-taxonomy.html)
- [Lexology — SaaS 场景下的开源合规（中文）](https://www.lexology.com/library/detail.aspx?g=34e521c4-63a8-4185-9175-e43b7f09d25c)
- [金杜 — 从维权视角审视开源软件合规（中国法院关于传染范围的认定）](https://www.kingandwood.com/cn/zh/insights/latest-thinking/examining-the-use-of-open-source-software-in-compliance-with-from-the-perspective-of-rights-protection.html)
- [OSSScan — 许可违约之后会发生什么（Neo4j v PureThink）](https://ossscan.com/blog/what-happens-after-open-source-license-breach.html)
- [Mi&Bee — 罗盒案与开源许可可执行性](https://blog.mickeyzzc.tech/en/posts/architecture/source-available-ai-license)

**AGPL fork / Vikunja**
- [Vikunja — Vikunja stays open](https://vikunja.io/changelog/vikunja-stays-open)
- [Vikunja — 定价](https://vikunja.io/pricing)
- [Vikunja LICENSE (AGPL-3.0)](https://github.com/go-vikunja/vikunja/blob/main/LICENSE)
- [TermsFeed — 双许可 vs 开源核心](https://www.termsfeed.com/blog/dual-licensing-vs-open-core)
- [Open Core Ventures — AGPL 对多数公司是劝退项](https://opencoreventures.com/insights/agpl-license-is-a-non-starter-for-most-companies)
- [博客园 — 个人免费/企业收费的 6 种方案对比](https://www.cnblogs.com/itech/p/20045835)

**TickTick**
- [TickTick Developer（开发者平台）](https://developer.ticktick.com)
- [TickTick Terms of Service](https://ticktick.com/tos?language=en_us)
- [Carly — TickTick MCP：官方服务器与 Webhook 缺口](https://www.usecarly.com/blog/ticktick-mcp)
- [Rollout — TickTick API 要点](https://rollout.com/integration-guides/tick-tick/api-essentials)
- [掘金 — 滴答清单官方 API 尝试](https://juejin.cn/post/7376484708547870731)
- [dida365 / open v1 端点对齐说明](https://github.com/GalaxyXieyu/didatodolist-mcp/blob/main/README.md)

**法律案例**
- [NYT 对 Wordle 克隆 DMCA（AP）](https://apnews.com/article/new-york-times-wordle-clones-takedown-dmca-35d32b7548f7312ea74a2065b2cd31a6)
- [Pomodone 关停公告](https://www.reddit.com/r/todoist/comments/1gehe1y/pomodone_is_done)
- [OpenAI 商标诉讼胜诉](https://www.courthousenews.com/openai-wins-trademark-lawsuit-against-doppelganger-company)
- [知产力 — 中华万年历 App 界面抄袭案](https://www.zhichanli.com/p/2024618187)
- [知产力 — 工具类软件界面正当模仿与不正当竞争的界限（快手诉小看）](https://www.zhichanli.com/p/678987278)
- [杭州互联网法院网络不正当竞争十大典型案例](https://www.ipeconomy.cn/dongtai/5682.html)
- [最高人民法院 2025 年反不正当竞争典型案例](https://www.csrc.gov.cn/beijing/c105537/c7582591/content.shtml)
- [中国保护知识产权网 — 软件抄袭判定"接触+实质性相似"](https://ipr.mofcom.gov.cn/article/gnxw/sf/zz/zzbq/202312/1983176.html)
- [环球 — 网站抄袭行为的司法救济路径（含 2025 反法修订）](https://www.glo.com.cn/Content/2025/08-06/1523377995.html)
- [嘉潍 — 互联网产品"互抄"现象的法律审视与困境](https://javy-lawyers.com/news/dongtai/1866046300433170434.html)

**应用商店与资质**
- [Apple — Program Enrollment（官方费用）](https://developer.apple.com/help/account/membership/program-enrollment)
- [Google Play — 新个人账号测试要求（官方）](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
- [21 经济网 — 苹果落实 ICP 备案准入门槛](https://www.21jingji.com/article/20240404/herald/0186266187de0c6b1e4b0889dc5392a6.html)
- [cnBeta — Apple App Store 政策调整：必须有 ICP 备案号](https://www.cnbeta.com.tw/articles/tech/1387241.htm)
- [知乎 — APP 备案教程（工信部通知要点）](https://zhuanlan.zhihu.com/p/663085497)
- [阿里云 — App 备案快速入门](https://help.aliyun.com/zh/icp-filing/basic-icp-service/getting-started/quick-sta-rt-for-icp-filing-for-personal-app)
- [知乎 — ICP 许可证条件、材料、流程（2026 版）](https://zhuanlan.zhihu.com/p/2055232717172875499)
- [同创知识产权 — 各大应用商店对软著的要求](https://www.tczscq.com/show/55.html)
- [掘金 — Android APP 上架软著完全指南（2026）](https://juejin.cn/post/7640041577754787894)
- [新浪财经 — 中国版权保护中心软著登记重大改革（2026-03）](https://finance.sina.com.cn/wm/2026-03-17/doc-inhrhavy9585639.shtml)
- [中国法翻译 — 移动互联网应用程序个人信息保护管理暂行规定（征求意见稿）](https://www.chinalawtranslate.com/app-personal-data-protection)

**定价与变现**
- [Adapty — 应用内订阅基准报告 2026](https://adapty.io/state-of-in-app-subscriptions-report)
- [Adapty — Productivity 应用订阅基准](https://adapty.io/blog/productivity-app-subscription-benchmarks)
- [Setapp — 2026 独立开发者变现策略](https://setapp.com/app-reviews/app-monetisation-strategies)
- [Igniscor — RevenueCat/Adapty 2026 变现趋势综述](https://www.igniscor.com/post/state-of-app-monetization-2026)
- [alfred — Todoist 2026 定价](https://get-alfred.ai/blog/todoist-pricing)
- [ellieplanner — Things 3 定价](https://ellieplanner.com/productivity-copilot/things-3-pricing)
- [checkthat.ai — TickTick 定价与档位](https://checkthat.ai/brands/ticktick/pricing)
