# Part 2A —— RRULE 循环规则引擎 与 自然语言日期解析 · 组件事实核验

- **核验日期**：2026-09-25（环境本地时间 `Fri Sep 25 14:31 CST 2026`，作为"今天"用于活跃度判断）
- **核验方法（全部为本会话实际执行）**：
  1. **GitHub 公共 HTML + `commits.atom` / `releases.atom`**：`research/tools/ghinfo.py owner/repo`（刻意不走 api.github.com，规避限流）。Star / fork / archived / 最近提交 / 最新 release 均来自此。
  2. **许可证原文**：`curl` 拉取 `raw.githubusercontent.com/OWNER/REPO/HEAD/LICENSE*`（含 `LICENCE`、`COPYING`）逐行阅读。
  3. **官方注册表 API**（权威元数据）：`registry.npmjs.org`、`crates.io/api/v1`、`pub.dev/api/packages` + `pub.dev/packages/<pkg>/license`、`pypi.org/pypi/<pkg>/json`。
  4. **仓库目录 HTML**：用于确认 locale / 语言子目录是否存在（如 `src/locales/zh/hans`、`Duckling/Time/ZH`）。
- **工具限制声明**：本会话 `web_search` 持续返回 `Tavily API error (HTTP 432)`，`web_fetch` 对多数非 GitHub 域名报"non-public IP"，因此 **本文件不含任何依赖搜索摘要的结论**；所有数字均来自上述主源。凡主源未覆盖者，一律写 `未核实`。
- **许可政策**：本项目要求组件允许 **闭源商用**。MIT / Apache-2.0 / BSD / ISC / MPL-2.0 视为可用；AGPL / GPL / LGPL / BUSL / Elastic / SSPL / FSL / 专有 一律红标。

---

## 目录 1 —— RRULE / 循环规则引擎（按语言）

| 组件 | 仓库/包 URL | Star(实测) | License(精确SPDX) | 语言 | 最近提交/发布 | 闭源商用? | 备注与来源 |
|---|---|---|---|---|---|---|---|
| **rrule.js** | https://github.com/jkbrzt/rrule | **3744** | **BSD-3-Clause** | TypeScript (98.2%) | 提交 `2023-11-10T20:05:10Z`；npm `rrule@2.8.1` @ `2023-11-10` | ✅ 可 | npm registry 与仓库 `package.json` 均声明 `BSD-3-Clause`；根目录许可文件名为 **`LICENCE`**（英式拼写），原文为 3 条款 BSD 文本。GitHub 侧栏显示 `NOASSERTION (Other)` 系文件名拼写导致漏识别，非许可证本身有问题。RFC 5545：README 自述"遵从 RFC 5545，但有若干重要差异"，并链接 `#differences-from-icalendar-rfc`。**维护停滞近 3 年**。 |
| **python-dateutil (rrule 模块)** | https://github.com/dateutil/dateutil | **2636** | **BSD-3-Clause AND Apache-2.0**（双许可，按贡献年代） | Python (99.6%) | 提交 `2026-05-19T23:50:16Z`；release `2.9.0` @ `2024-03-01` | ✅ 可 | `LICENSE` 原文：`2017-12-01` 之后的贡献及已重授权部分适用 **Apache-2.0**，此前历史代码适用 **BSD-3-Clause**。两种许可均允许闭源商用。Python 生态事实标准 `dateutil.rrule`。RFC 5545 符合度：官方仅有 `docs/rrule.rst`（automodule 文档），**未读到显式符合度声明 → 部分未核实**。 |
| **rust-rrule** | https://github.com/fmeringdal/rust-rrule | **95** | **Apache-2.0**（GitHub）/ **MIT OR Apache-2.0**（crates.io） | Rust (99.5%) | 提交 `2025-04-20T17:53:31Z`；crates.io `rrule@0.14.0` @ `2025-04-20` | ✅ 可 | crates.io 为权威：`MIT OR Apache-2.0`（双许可任选，最宽松）。README 明示遵循 RFC-5545，支持 RRULE / RDATE / EXRULE / EXDATE，并对 `RRuleSet::all` 设有硬上限。crate 下载量约 124.6 万。 |
| **teambition/rrule-go** | https://github.com/teambition/rrule-go | **382** | **MIT** | Go (100%) | 提交 `2023-04-01T12:53:05Z`；tag `v1.8.2` @ `2023-01-13` | ✅ 可 | Go 生态中唯一有可观用户的实现。README 自述为 **RFC 2445** 的部分移植（RFC 2445 已被 5545 取代）。停滞约 3.5 年。 |
| stephens2424/rrule | https://github.com/stephens2424/rrule | 17 | BSD-3-Clause | Go | 提交 `2019-06-11` | ✅ 可 | "RFC 5545 recurrences and rrules" 实现，**7 年未动**。 |
| JulienBreux/rrule-go | https://github.com/JulienBreux/rrule-go | 26 | MIT | Go | 提交 `2017-02-22` | ✅ 可 | 无 release，9 年未动。 |
| lingsamuel/go-rrule | https://github.com/lingsamuel/go-rrule | 4 | BSD-3-Clause | Go | 提交 `2018-03-23` | ✅ 可 | 无 release，接近废弃。 |
| Xyedo/rrule | https://github.com/Xyedo/rrule | 1 | MIT | Go | 提交 `2024-05-24`；`v1.2.2` @ `2024-05-21` | ✅ 可 | 仍在更新但几乎无采用。 |
| **rrule (Dart)** | https://github.com/JonasWanke/rrule | **58** | **Apache-2.0** | Dart (99.8%) | 提交 `2026-01-06T15:23:38Z`；pub.dev `0.2.18` @ `2026-01-06` | ✅ 可 | pub.dev 许可页原文 "Apache License Version 2.0"。Dart/Flutter 侧最活跃、最完整的 RFC 5545 引擎。 |
| teno_rrule | https://github.com/hnvcam/teno_rrule | 4 | MIT | Dart | 提交 `2026-06-13`；pub.dev `0.0.10` @ `2026-03-17` | ✅ 可 | pub.dev 描述自称实现 RFC5545，支持 `TZDateTime` 时区、`WKST`、`EXDATE`。采用度低、版本号 0.0.x。 |
| rrule_generator | https://github.com/tkortekaas/rrule_generator | 11 | **ISC** | Dart/Flutter | 提交 `2026-08-04`；pub.dev `0.10.1+2` @ `2026-08-04` | ✅ 可 | **仅 UI 生成器组件**，不承担日期计算；需与计算引擎搭配。 |
| recurrence_picker | https://github.com/Huluk/flutter_recurrence_picker | 未核实 | **BSD-3-Clause** | Dart/Flutter | pub.dev `0.3.0` @ `2026-04-21` | ✅ 可 | Flutter 构建 RRULE 的 UI 组件；仓库 Star 本会话未抓取 → `未核实`。 |
| 🟥 **python-recurring-ical-events** | https://github.com/niccokunzmann/python-recurring-ical-events | 121 | **LGPL-3.0** | Python | 提交 `2026-09-23`；`v3.9.0` @ `2026-05-16` | 🟥 **禁止/需法务** | 🟥 **LGPL-3.0-or-later —— 弱传染但闭源分发有义务（动态链接亦需提供替换库能力与许可证声明）**。它并非 RRULE 引擎本身，而是基于 icalendar 展开事件；若仅作服务端内部使用风险较低，但**不得作为可分发闭源客户端依赖**。 |

### 本轮核验暴露的 slug 修正
- 任务书给出的 `bschwind/dtparse` **不存在**（GitHub 404）；正确的 Rust `dtparse` 仓库是 **`bspeice/dtparse`**（crates.io `repository` 字段亦指向 `bspeice/dtparse.git`）。见目录 2。
- `jkbrzt/rrule` 可正常访问；其 npm 仓库地址为 `jakubroztocil/rrule.git`，两者为同一仓库（用户名改名）。

### 中文 / locale-aware 的 RRULE 文本输出 —— 核验结论
**没有任何被测引擎内建中文文本输出**，理由（实测）：
- `rrule.js` 的 `toText()` 走 `src/nlp/i18n.ts`，该文件**只导出 `ENGLISH`** 一个 `Language`；`src/nlp/index.ts`、`totext.ts` 允许调用方传入自定义 `Language`（`dayNames` / `monthNames`），但**官方未提供中文包**。因此中文（"每周一"）需自建 `Language` 对象或自行渲染。
- rust-rrule / teambition-rrule-go / python-dateutil / Dart rrule 均**未发现**内建文本化输出的中文支持（`未核实` 更细的语言清单，但目录与 README 中无 zh 资源）。
- 结论：**RRULE 中文自然语言描述必须自建**（建议放在客户端 i18n 层，而不是依赖上游库）。

### RFC 5545 符合度速览
| 引擎 | 符合度证据 |
|---|---|
| rrule.js | README 原文："遵从 RFC 5545，**但存在若干重要差异**（differences from iCalendar RFC）"——即**基本符合、有已知偏差**。 |
| rust-rrule | README："遵循 iCalendar (RFC-5545) 规范"，覆盖 RRULE/RDATE/EXRULE/EXDATE；有主动施加的规模上限。 |
| teambition/rrule-go | README 自述为 **RFC 2445**（旧版）的部分移植。 |
| python-dateutil | `docs/rrule.rst` 存在但**无显式符合度声明** → `未核实`。 |
| Dart rrule / teno_rrule | 描述声明实现 iCalendar RFC / RFC5545，**无逐条符合度矩阵** → 声明级证据。 |

### 结论 / 推荐（目录 1）
**推荐（面向"客户端 Dart/Kotlin/JS + 服务端"的任务管理器）**：
将 **RFC 5545 RRULE 字符串作为唯一持久化真相**，各端各自用本地宽松许可引擎计算：
- **服务端（Python）**：`python-dateutil` 的 `rrule`（BSD-3-Clause / Apache-2.0 双许可，最成熟、最广泛验证）。
- **客户端 Dart/Flutter**：**`JonasWanke/rrule`（Apache-2.0）**为主引擎 + `rrule_generator`（ISC）做 UI；备选 `teno_rrule`（MIT，含时区支持）。
- **Web/TS**：`rrule.js`（BSD-3-Clause）——成熟但 3 年未更新，接受其"有已知 RFC 差异"的现实。
- **Rust**：`rrule` crate（MIT OR Apache-2.0）。
- **Go 侧是短板**：仅 `teambition/rrule-go`（MIT）可用且已停滞 3 年；如需 Go，建议自建移植或 fork 后加补丁，并在 CI 中用 Python `dateutil` 做交叉一致性校验。
- **一律不要引入** `python-recurring-ical-events`（LGPL-3.0）作为可分发依赖。

---

## 目录 2 —— 自然语言日期解析

| 组件 | 仓库/包 URL | Star(实测) | License(精确SPDX) | 语言 | 最近提交/发布 | 闭源商用? | 备注与来源 |
|---|---|---|---|---|---|---|---|
| **chrono-node** | https://github.com/wanasit/chrono | **5287** | **MIT** | TypeScript (100%) | 提交 `2026-09-22T23:42:14Z`；npm `2.10.1` @ `2026-07-20` | ✅ 可 | 本类目最活跃。**中文实测存在**：`src/locales/zh/hans/` 与 `src/locales/zh/hant/`，含 7 个 parser（Ago / CasualDate / Date / DeadlineFormat / RelationWeekday / TimeExpression / Weekday）+ 2 个 refiner。 |
| **dateparser** | https://github.com/scrapinghub/dateparser | **2862** | **BSD-3-Clause** | Python (100%) | 提交 `2026-09-23T18:07:00Z`；PyPI `1.4.3` @ `2026-09-03` | ✅ 可 | **中文实测存在**：`dateparser/data/date_translation_data/` 下有 `zh.py`、`zh-Hans.py`、`zh-Hant.py`；README 直接给出中文示例 `dateparser.parse('2小时前')`。活跃维护。 |
| parsedatetime | https://github.com/bear/parsedatetime | **711** | **Apache-2.0** | Python (99.6%) | 提交 `2024-08-08`；`2.6` @ `2020-05-31` | ✅ 可 | PyPI `2.6`，classifier "Apache Software License"。约 6 年未发版，**中文支持未核实**（未读其语言数据）。 |
| **chrono-english** | https://github.com/stevedonovan/chrono-english | **60** | **MIT** | Rust (100%) | 提交 `2026-08-26`；crates.io `0.2.1` @ `2026-08-26` | ✅ 可 | crates.io 声明 MIT；下载量约 415.6 万。主要解析英语口语日期（类似 `date` 命令）。 |
| **dtparse** | https://github.com/bspeice/dtparse | **52** | **Apache-2.0**（crates.io）/ GitHub `NOASSERTION` | Rust (88.8%) | 提交 `2024-08-18`；crates.io `2.0.1` @ `2024-08-18` | ✅ 可（以 crates.io 声明为准） | **slug 修正点**：任务书的 `bschwind/dtparse` 为 404，正确为 `bspeice/dtparse`。crates.io 明示 `Apache-2.0`。定位是 dateutil 兼容的时间戳解析器。 |
| **olebedev/when** | https://github.com/olebedev/when | **1461** | **Apache-2.0** | Go (100%) | 提交 `2026-08-10` | ✅ 可 | Go 侧唯一活跃的自然语言时间解析器，可插拔规则（README 显示含 RU 规则扩展）。 |
| araddon/dateparse | https://github.com/araddon/dateparse | **2142** | **MIT** | Go (100%) | 提交 `2021-04-29` | ✅ 可 | **并非自然语言解析**：它是在已知多种格式中自动嗅探的解析器（"without knowing format in advance"）。约 5 年未更新。 |
| chrono_dart | https://github.com/g-30/chrono_dart | **15** | **MIT**（pub.dev 许可页原文）/ GitHub `NOASSERTION` | Dart | 提交 `2024-08-13`；pub.dev `2.0.2` @ `2024-08-13` | ✅ 可 | chrono-node 的 Dart 移植。**成熟度不足**：15 star、2 年未更新、无 release。 |
| universal_date_parser | https://github.com/pragneshkoli/universal_date_parser | **0** | **MIT** | Dart | 提交 `2026-05-31`；pub.dev `1.1.4` @ `2026-05-31` | ✅ 可 | 是"多格式自动嗅探"解析器，**不做自然语言**。 |
| any_date | https://github.com/gbassisp/any_date | **6** | **BSD-3-Clause** | Dart | 提交 `2026-03-18`；pub.dev `1.2.2` @ `2026-03-18` | ✅ 可 | 多格式解析，非自然语言。 |
| **facebook/duckling** | https://github.com/facebook/duckling | **4324** | **BSD-3-Clause**（LICENSE 为 Facebook 3 条款 BSD 文本） | Haskell (100%) | 提交 `2026-03-15`；release `v0.2.0.0` @ `2021-04-16` | ✅ 可 | **中文时间实测不支持**：`Duckling/Time/` 下语言目录为 AR/BG/CA/DA/DE/EL/EN/ES/FR/GA/HE/HR/HU/IT/JA/KA/KO/NB/NL/PL/PT/RO/RU/SV/TR —— **无 ZH**。定位重（Haskell 服务），本场景不推荐。 |

### 中文 NL 日期解析 —— 专项核验

| 组件 | 仓库/包 URL | Star(实测) | License(精确SPDX) | 语言 | 最近提交/发布 | 闭源商用? | 备注与来源 |
|---|---|---|---|---|---|---|---|
| **6tail/lunar-javascript** | https://github.com/6tail/lunar-javascript | **1686** | **MIT** | JavaScript | 提交 `2025-11-05`；`v1.7.7` @ `2025-11-05` | ✅ 可 | 公历/农历/干支/节气/八字等完整日历库（**农历转换**，非自然语言解析）。 |
| **6tail/lunar-java** | https://github.com/6tail/lunar-java | **970** | **MIT** | Java | 提交 `2025-11-05`；`v1.7.7` @ `2025-11-05` | ✅ 可 | 同上，Java 版。 |
| **6tail/lunar-python** | https://github.com/6tail/lunar-python | **662** | **MIT** | Python | 提交 `2026-01-24`；`v1.4.8` @ `2025-11-05` | ✅ 可 | PyPI `lunar-python 1.4.8`，license `MIT`。 |
| **6tail/lunar-flutter** | https://github.com/6tail/lunar-flutter | **213** | **MIT** | Dart | 提交 `2025-11-05`；`v1.7.8` @ `2025-11-05` | ✅ 可 | pub.dev 包名 `lunar@1.7.8` @ `2025-11-05`，许可页原文 "MIT License"。**Dart 侧农历首选**。 |
| **Ailln/cn2an** | https://github.com/Ailln/cn2an | **768** | **MIT** | Python (96.9%) | 提交 `2026-04-23` | ✅ 可 | PyPI `cn2an 0.5.24`，license `MIT License`。中文数字↔阿拉伯数字转换（含日期、温度），**是中文 NL 解析的关键预处理件**。 |
| 🟥 crapthings/chinese-datetime-parser | https://github.com/crapthings/chinese-datetime-parser | **0** | **无 License 声明（NA）** | JavaScript | 提交 `2026-09-16` | 🟥 **禁止** | 🟥 **无任何许可证 = 默认保留全部版权 —— 禁止闭源商用**。功能上只抽取"显式公历日期+钟点"，不覆盖 明天/下周三 等相对表达。 |
| 🟥 taccisum/cntime-nlp | https://github.com/taccisum/cntime-nlp | **1** | **无 License 声明（NA）** | Python | 提交 `2024-05-08` | 🟥 **禁止** | 🟥 **无许可证 = 禁止闭源商用**。定位正是"中文自然语言时间表达解析"，但 1 star、2024 年停更，**不可作为生产依赖**。 |

### 中文时间表达（明天 / 下周三 / 每月5号 / 月底）—— 直接结论
- **成熟库不存在**。可复用的只有两条具有中文支持的成熟通道：
  1. **JS/TS**：`chrono-node`（MIT）内建 `zh-Hans` / `zh-Hant`，覆盖"明天""下周三""3天后"一类**相对时间点**。
  2. **Python**：`dateparser`（BSD-3-Clause）含 `zh` / `zh-Hans` / `zh-Hant` 数据，README 明示支持 `'2小时前'`。
- **"每月5号""月底"属于循环规则（recurrence）而非时间点解析**，上述库不产出 RRULE。正确设计是：NL 解析器只负责把中文短语映射为**结构化字段**（如 `{freq: MONTHLY, bymonthday: 5}`），再由目录 1 的 RRULE 引擎计算。**"月底"（BYMONTHDAY=-1）与"每月5号"（BYMONTHDAY=5）本身在 RFC 5545 中是一等公民**，无需特殊库，但中文短语→RRULE 的映射层必须自建。
- **农历/中文数字**有成熟 MIT 库（6tail 全家桶 + cn2an），可直接用。
- `dateparser` 与 `chrono-node` 均为宽松许可，可闭源商用。

### 结论 / 推荐（目录 2）
**推荐**：
- **JS/TS（含 Web 端）**：**`chrono-node`（MIT）**——最活跃、内建 zh-Hans/zh-Hant，是中文自然语言日期解析的**首选**。
- **Python（服务端）**：**`dateparser`（BSD-3-Clause）**——中文数据文件与中文示例均已实测确认，且活跃维护；`parsedatetime` 仅作备选（Apache-2.0，但约 6 年未发版）。
- **Dart/Flutter**：**无成熟方案**。`chrono_dart`（MIT）是仅有的 chrono 移植，但 15 star、2 年停更，建议**不作为生产依赖**；务实做法是**由服务端做 NL 解析**（或自建一层中文规则，复用 `cn2an` 思路处理中文数字）。
- **Rust**：`chrono-english`（MIT）用于英语；`dtparse`（crates.io 声明 Apache-2.0）用于 dateutil 兼容解析。二者**均无中文**。
- **Go**：`olebedev/when`（Apache-2.0）为唯一活跃 NL 解析器（**无中文**）；`araddon/dateparse`（MIT）只做格式嗅探。
- **中文特有表达**：**接受"必须自建"的现实**——用 `chrono-node` / `dateparser` 覆盖相对时间点，用 `cn2an` 处理中文数字，把"每月N号/月底/每周X"的输出规约为 RFC 5545 RRULE 字段；农历需求用 6tail 系列（MIT）。
- **禁用**：`recurring-ical-events`（LGPL-3.0）、`crapthings/chinese-datetime-parser` 与 `taccisum/cntime-nlp`（无许可证）。

---

## 附录 A —— 原始证据（本会话工具输出逐字摘录）

> 说明：以下为核验过程中实际打印的 TSV / curl 输出。会话中途父代理重构了 `research/`（`ghinfo.py` 移至 `research/tools/`，临时 TSV 被清理），故此处以本次实际输出为准留档。

### A.1 ghinfo.py 输出（列：repo / stars / forks / license / archived / branch / last_commit / latest_release / top_lang / desc / topics）

**RRULE 引擎（第一批）**
```
repo	stars	forks	license	archived	branch	last_commit	latest_release	top_lang	desc	topics
jkbrzt/rrule	3744	565	NOASSERTION (Other)	false	master	2023-11-10T20:05:10Z	v2.7.2 @ 2023-02-10T18:52:20Z	typescript: 98.2%	JavaScript library for working with recurrence rules for calendar dates as defined in the iCalendar RFC and more.	calendar,icalendar-rfc,jakubroztocil,javascript,library,python-dateutil,recurrence-rules,rfc,rrule,typescript
dateutil/dateutil	2636	583	NOASSERTION (Other)	false	master	2026-05-19T23:50:16Z	2.9.0 @ 2024-03-01T03:54:24Z	python: 99.6%	Useful extensions to the standard Python datetime features	datetime,library,parsing,python,time,timezones
fmeringdal/rust-rrule	95	32	Apache-2.0 (Apache License 2.0)	false	main	2025-04-20T17:53:31Z	v0.10.0 @ 2022-08-15T08:20:04Z	rust: 99.5%	Rust crate for working with recurrence rules for calendar dates as defined in the iCalendar RFC and more.	calendar,cargo,crate,fmeringdal,icalendar-rfc,library,python-dateutil,recurrence-rules,rfc,rrule,rust
teambition/rrule-go	382	69	MIT (MIT License)	false	master	2023-04-01T12:53:05Z	v1.8.2 @ 2023-01-13T07:41:13Z	go: 100.0%	Go library for working with recurrence rules for calendar dates.	
```

**Go RRULE 候选（第二批）**
```
repo	stars	forks	license	archived	branch	last_commit	latest_release	top_lang	desc	topics
lingsamuel/go-rrule	4	0	BSD-3-Clause (BSD 3-Clause \)	false	master	2018-03-23T09:47:06Z	NO-RELEASES @ NA	go: 100.0%	RFC 5545 in Go	
stephens2424/rrule	17	6	BSD-3-Clause (BSD 3-Clause \)	false	master	2019-06-11T13:14:13Z	v1.2.0 @ 2019-06-11T13:14:13Z	go: 99.8%	A Go implementation of RFC 5545 recurrences and rrules.	
JulienBreux/rrule-go	26	3	MIT (MIT License)	false	master	2017-02-22T17:16:09Z	NO-RELEASES @ NA	go: 100.0%	Go library for working with recurrence rules for calendar dates.	calendar,golang,golang-library,icalendar-rfc,recurrence-rules,rrule
Xyedo/rrule	1	1	MIT (MIT License)	false	main	2024-05-24T03:05:25Z	v1.2.2 @ 2024-05-21T05:01:25Z	go: 100.0%	Go library for working with recurrence rules for calendar dates	
```

**Dart 包对应仓库**
```
repo	stars	forks	license	archived	branch	last_commit	latest_release	top_lang	desc	topics
JonasWanke/rrule	58	30	Apache-2.0 (Apache License 2.0)	false	main	2026-01-06T15:23:38Z	v0.2.18 @ 2026-01-06T15:27:27Z	dart: 99.8%	🔁 Recurrence rule parsing & calculation as defined in the iCalendar RFC	dart,hacktoberfest,ical,icalendar,package,recurrence,recurrence-rules,recurrent-event,rrule
hnvcam/teno_rrule	4	1	MIT (MIT License)	false	main	2026-06-13T03:47:48Z	0.0.5 @ 2024-04-17T09:06:37Z	dart: 100.0%	I don't want to do this, but I have no choice.	
g-30/chrono_dart	15	5	NOASSERTION (Other)	false	main	2024-08-13T16:18:34Z	NO-RELEASES @ NA	dart: 100.0%	A natural language date parser in Dart. Inspired by @wanasit/chrono.	android,dart,date-parser,date-parsing,datetime,flutter,ios
gbassisp/any_date	6	0	BSD-3-Clause (BSD 3-Clause \)	false	main	2026-03-18T12:24:24Z	v1.0.4 @ 2024-08-31T09:28:32Z	dart: 98.3%		
tkortekaas/rrule_generator	11	20	ISC (ISC License)	false	master	2026-08-04T16:29:45Z	NO-RELEASES @ NA	dart: 96.6%	RRuleGenerator is a Flutter widget for generating recurring rules	
```
```
repo	stars	forks	license	archived	branch	last_commit	latest_release	top_lang	desc	topics
pragneshkoli/universal_date_parser	0	0	MIT (MIT License)	false	main	2026-05-31T11:44:42Z	NO-RELEASES @ NA	dart: 100.0%	A highly optimized, auto-detecting, zero-configuration date and time parsing package for Dart & Flutter. ...	dart,date-formatter,date-parser,date-utility,datetime-parser,flutter,package,pub-dev
```

**NLP 解析器（第一批）**
```
repo	stars	forks	license	archived	branch	last_commit	latest_release	top_lang	desc	topics
wanasit/chrono	5287	388	MIT (MIT License)	false	master	2026-09-22T23:42:14Z	v2.10.1 @ 2026-07-20T00:29:36Z	typescript: 100.0%	A natural language date parser in Javascript	
scrapinghub/dateparser	2862	522	BSD-3-Clause (BSD 3-Clause \)	false	master	2026-09-23T18:07:00Z	1.4.3 @ 2026-09-03T10:07:00Z	python: 100.0%	python parser for human readable dates	hacktoberfest
bear/parsedatetime	711	114	Apache-2.0 (Apache License 2.0)	false	master	2024-08-08T01:37:43Z	2.6 @ 2020-05-31T23:52:03Z	python: 99.6%	Parse human-readable date/time strings	
stevedonovan/chrono-english	60	12	MIT (MIT License)	false	master	2026-08-26T16:08:25Z	v0.2.1 @ 2026-08-26T16:10:30Z	rust: 100.0%	Converting informal English dates (like `date` command) to chrono DateTime in Rust	
bschwind/dtparse									FETCH_ERROR:HTTP Error 404: Not Found	
olebedev/when	1461	94	Apache-2.0 (Apache License 2.0)	false	master	2026-08-10T01:28:37Z	Extend RU rules  @ 2024-11-12T03:05:22Z	go: 100.0%	A natural language date/time parser with pluggable rules	date,datetime,golang,natural-language,parser,time
araddon/dateparse	2142	174	MIT (MIT License)	false	master	2021-04-29T16:20:01Z	NO-RELEASES @ NA	go: 100.0%	GoLang Parse many date strings without knowing format in advance.	date,dates,datetime,golang,time
```

**补充仓库**
```
repo	stars	forks	license	archived	branch	last_commit	latest_release	top_lang	desc	topics
bspeice/dtparse	52	13	NOASSERTION (Other)	false	master	2024-08-18T20:43:00Z	v2.0.0 @ 2023-08-24T23:07:54Z	rust: 88.8%	A dateutil-compatible timestamp parser for Rust	dateutil,rust,rust-library
crapthings/chinese-datetime-parser	0	0	NA	false	main	2026-09-16T11:14:50Z	NO-RELEASES @ NA	javascript: 100.0%	Extract and validate explicit Gregorian dates and clock times from Chinese text. Zero dependencies, with TypeScript declarations.	chinese,chinese-numerals,date-extraction,date-parser,datetime,gregorian-calendar,javascript,text-extraction,typescript,zero-dependencies
taccisum/cntime-nlp	1	0	NA	false	main	2024-05-08T13:42:54Z	NO-RELEASES @ NA	python: 99.9%	Chinese natural language time expression string parser.	
6tail/lunar-flutter	213	61	MIT (MIT License)	false	master	2025-11-05T07:46:03Z	v1.7.8 @ 2025-11-05T12:37:50Z	dart: 100.0%	日历、公历(阳历)、农历(阴历、老黄历)...	calendar,flutter
```
```
repo	stars	forks	license	archived	branch	last_commit	latest_release	top_lang	desc	topics
niccokunzmann/python-recurring-ical-events	121	31	LGPL-3.0 (GNU Lesser General Public License v3.0)	false	main	2026-09-23T08:41:44Z	v3.9.0 @ 2026-05-16T05:08:34Z	html: 65.4%	Python library to calculate recurrence times of events, todos, alarms and journals based on icalendar RFC5545	hacktoberfest,icalendar,recurrence,rfc5545
collective/icalendar	1174	436	NOASSERTION (Other)	false	main	2026-09-23T16:58:50Z	v7.3.0 @ 2026-08-20T05:46:53Z	python: 99.2%	icalendar parser library for Python	alarm,event,generator,hacktoberfest,icalendar,ics,journal,parser,rfc5545,todo
```
```
repo	stars	forks	license	archived	branch	last_commit	latest_release	top_lang	desc	topics
6tail/lunar-javascript	1686	298	MIT (MIT License)	false	master	2025-11-05T03:04:25Z	v1.7.7 @ 2025-11-05T12:20:14Z	javascript: 99.9%	日历、公历(阳历)、农历(阴历、老黄历)、佛历、道历...	calendar,javascript,lunar
6tail/lunar-java	970	208	MIT (MIT License)	false	master	2025-11-05T02:56:26Z	v1.7.7 @ 2025-11-05T12:22:22Z	java: 100.0%	日历、公历(阳历)、农历(阴历、老黄历)、佛历、道历...	calendar,java,lunar
6tail/lunar-python	662	161	MIT (MIT License)	false	master	2026-01-24T03:07:22Z	v1.4.8 @ 2025-11-05T12:33:26Z	python: 100.0%	日历、公历(阳历)、农历(阴历、老黄历)、佛历、道历...	calendar,lunar,solar
Ailln/cn2an	768	84	MIT (MIT License)	false	master	2026-04-23T21:13:53Z	NO-RELEASES @ NA	python: 96.9%	📦 快速转化「中文数字」和「阿拉伯数字」～ ...	arabic-numbers,arabic-numerals,asr,chinese-numerals,cn2an,nlp-library,nlp-tool,pypi,python,speech-recognition
```
```
repo	stars	forks	license	archived	branch	last_commit	latest_release	top_lang	desc	topics
facebook/duckling	4324	739	NOASSERTION (Other)	false	main	2026-03-15T21:56:54Z	Duckling v0.2.0.0 @ 2021-04-16T17:06:51Z	haskell: 100.0%	Language, engine, and tooling for expressing, testing, and evaluating composable language rules on input strings.	
```

### A.2 许可证原文（curl raw.githubusercontent.com）
```
=== rrule.js LICENCE ===
rrule.js: Library for working with recurrence rules for calendar dates.
Copyright 2010, Jakub Roztocil <jakub@roztocil.name> and Lars Schöning
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    1. Redistributions of source code must retain the above copyright notice, ...
    2. Redistributions in binary form must reproduce the above copyright ...
    3. Neither the name of The author nor the names of its contributors may
       be used to endorse or promote products derived from this software ...
```
```
=== dateutil LICENSE head ===
Copyright 2017- Paul Ganssle <paul@ganssle.io>
Copyright 2017- dateutil contributors (see AUTHORS file)
   Licensed under the Apache License, Version 2.0 (the "License");
   ...
The above license applies to all contributions after 2017-12-01, as well as
all contributions that have been re-licensed (see AUTHORS file ...).
--------------------------------------------------------------------------------
dateutil - Extensions to the standard Python datetime module.
Copyright (c) 2003-2011 - Gustavo Niemeyer <gustavo@niemeyer.net>
...
All rights reserved.
Redistribution and use in source and binary forms, with or without
[BSD-3-Clause 文本继续]
```
```
=== duckling LICENSE ===
BSD License
For Duckling software
Copyright (c) 2016-present, Facebook, Inc. All rights reserved.
Redistribution and use in source and binary forms, ... [3 条款，含
 "Neither the name Facebook nor the names of its contributors ..."]
```

### A.3 包注册表 API 输出
```
=== npm rrule ===
latest: 2.8.1 | license: BSD-3-Clause
repo: {'type': 'git', 'url': 'git://github.com/jakubroztocil/rrule.git'}
time latest: 2023-11-10T20:05:55.744Z
all versions: 40
=== package.json license ===
license: BSD-3-Clause | version: 2.8.0 | repo: {'type': 'git', 'url': 'git://github.com/jakubroztocil/rrule.git'}

=== npm chrono-node ===
latest: 2.10.1 | license: MIT | published: 2026-07-20T00:30:11.784Z

=== crates.io rrule ===
name: rrule | max_version: 0.14.0 | downloads: 1246276
repo: https://github.com/fmeringdal/rust-rrule
updated: 2025-04-20T17:53:09.621291Z | created: 2020-10-16T09:03:18.437499Z
latest_version: 0.14.0 | license: MIT OR Apache-2.0 | published: 2025-04-20T17:53:09.621291Z

=== crates.io dtparse ===
name: dtparse | max_version: 2.0.1 | downloads: 1811597
repo: https://github.com/bspeice/dtparse.git
latest_version: 2.0.1 | license: Apache-2.0 | published: 2024-08-18T20:44:01.588349Z

=== crates.io chrono-english ===
name: chrono-english | max_version: 0.2.1 | downloads: 4156443
repo: https://github.com/stevedonovan/chrono-english.git
latest_version: 0.2.1 | license: MIT | published: 2026-08-26T16:11:35.941243Z

=== PyPI dateparser ===
dateparser 1.4.3 None >=3.10
=== PyPI parsedatetime ===
parsedatetime | 2.6 | license: Apache License 2.0
=== PyPI cn2an ===
cn2an | 0.5.24 | license: MIT License | requires: >=3.7
=== PyPI lunar-python ===
lunar-python | 1.4.8 | license: MIT
=== parsedatetime classifiers ===
['License :: OSI Approved :: Apache Software License', 'Programming Language :: Python :: 2.7', 'Programming Language :: Python :: 3', 'Programming Language :: Python :: 3.7']
```

**pub.dev（`api/packages/<pkg>` + `/license` 页原文）**
```
rrule              0.2.18      published 2026-01-06T15:23:57Z   repo JonasWanke/rrule            license page: "Apache License Version 2.0"
rrule_generator    0.10.1+2    published 2026-08-04T16:34:02Z   repo tkortekaas/rrule_generator  license page: "ISC License"
teno_rrule         0.0.10      published 2026-03-17T05:52:56Z   repo hnvcam/teno_rrule           license page: "MIT License"
recurrence_picker  0.3.0       published 2026-04-21T16:07:52Z   repo Huluk/flutter_recurrence_picker  license page: "BSD 3-Clause License"
chrono_dart        2.0.2       published 2024-08-13T16:19:00Z   repo g-30/chrono_dart             license page: "MIT License"
universal_date_parser 1.1.4    published 2026-05-31T11:45:12Z   repo pragneshkoli/universal_date_parser  license page: "MIT License"
any_date           1.2.2       published 2026-03-18T15:17:48Z   repo gbassisp/any_date            license page: "BSD 3-Clause"
lunar              1.7.8       published 2025-11-05T07:45:55Z   repo 6tail/lunar-flutter          license page: "MIT License"
timetide           1.2.1       published 2026-05-05T09:14:55Z   repo PlaxXOnline/timetide        （日历+Rrule，未纳入本表）
```

### A.4 目录/文件存在性证据
```
=== chrono zh dir (github tree HTML) ===
"name":"hans","path":"src/locales/zh/hans"
"name":"hant","path":"src/locales/zh/hant"
"name":"index.ts","path":"src/locales/zh/index.ts"
=== chrono zh/hans/parsers ===
ZHHansAgoFormatParser.ts, ZHHansCasualDateParser.ts, ZHHansDateParser.ts,
ZHHansDeadlineFormatParser.ts, ZHHansRelationWeekdayParser.ts,
ZHHansTimeExpressionParser.ts, ZHHansWeekdayParser.ts
[说明] 任务书猜测路径 src/locales/zh/hans.ts 为 404；实际是 src/locales/zh/hans/ 目录（含 index.ts）。正确。
=== chrono src/locales (全部语言) ===
de, en, es, fi, fr, it, ja, nl, pt, ru, sv, uk, vi, zh
=== dateparser zh 数据文件 ===
"name":"zh-Hans.py"  "name":"zh-Hant.py"  "name":"zh.py"
=== dateparser README 中文示例 ===
127:    >>> dateparser.parse('2小时前')  # Chinese (2 hours ago), current time: 22:30
162:    >>> parse('2小时前')  # Chinese (2 hours ago)
=== rrule.js nlp dir ===
i18n.ts, index.ts, parsetext.ts, totext.ts
=== rrule.js i18n.ts 语言导出 ===
export interface Language { dayNames: string[]; monthNames: string[] }
const ENGLISH: Language = { dayNames: [...], monthNames: [...] }
83:export default ENGLISH            <-- 仅英文，无 zh
=== rrule.js 根目录（许可文件为 LICENCE） ===
"name":"LICENCE","path":"LICENCE"   （LICENSE/LICENSE.md/COPYING 均 404）
=== duckling Duckling/Time 语言目录（无 ZH） ===
AR, BG, CA, DA, DE, EL, EN, ES, FR, GA, HE, HR, HU, IT, JA, KA, KO, NB, NL, PL, PT, RO, RU, SV, TR
```

### A.5 明确未核实项
- `Huluk/flutter_recurrence_picker` 的 GitHub Star：本会话未对该仓库调用 ghinfo → `未核实`（pub.dev 许可页已确认为 BSD-3-Clause）。
- `parsedatetime` 的中文支持：未读其语言数据 → `未核实`。
- `python-dateutil` 的 RFC 5545 逐条符合度：官方文档无显式声明 → `未核实`。
- GitHub 侧 `NOASSERTION` 但注册表/许可页明确的组件（rrule.js、chrono_dart、dtparse、duckling、dateutil），本表采用**许可原文 + 注册表**为准，并在"备注"列注明 GitHub 侧显示值。
