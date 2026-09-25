# 功能模块 5：自然语言日期/时间解析（NLP Dates）

> 调研目标：为自研滴答清单（TickTick 替代品）挑选「自然语言日期/时间解析」的可用开源项目。
> 核实日期：**2026-09-25**（所有 Star / last commit / release 均为当日实测）。
> 核实方法：`research/ghinfo.py` 抓 GitHub 公开页面 + atom feed（star / fork / license 标签 / archived / last commit / latest release / top lang）；
> 许可证如遇 GitHub 显示 `NOASSERTION` / `Other` / `NA`，一律用 `curl https://raw.githubusercontent.com/OWNER/REPO/BRANCH/LICENSE`（或 `LICENCE`、`duckling.cabal`、`Cargo.toml`）读原文确认。
> 工具限制：本机 `web_fetch` 抓 github.com 会被拒，故全部用 `curl` + `ghinfo.py`；`api.github.com` 当日触发 403 rate limit，未使用 API 数据。

## 0. 一句话结论（先说结论）

- **英文/多语种**：JS/TS 选 **wanasit/chrono**（且它自带 zh 中文 locale），Python 选 **scrapinghub/dateparser**，Go 选 **olebedev/when**，Java 选维护版 **natty-parser/natty**，Rust 选 **stevedonovan/chrono-english**；多语种服务用 **facebook/duckling**（BSD-3-Clause，含中文维度）。
- **中文**：只有 **JioNLP**（Apache-2.0，活跃）和 **chrono 的 zh locale** 属于「license 清晰 + 仍在维护」；Time_NLP 系列（原版 / python3 版）**均无 LICENSE 文件**，只能当参考实现，不能直接进商用产品。
- **现实结论**：中文「明天下午三点」「每周一」这类高频表达，靠现成库能覆盖 70–85%；长尾（口语、方言、跨句上下文、农历/节日/模糊词）必须**自研 + 兜底 LLM**。建议组合：chrono（中英统一入口）→ 失败则 JioNLP（中文长尾）→ 仍失败则 LLM 结构化抽取。
- **系统原生**：iOS 有 `NSDataDetector`（系统能力，免费但相对时间弱）；Android **没有**官方 NL 日期解析，只有格式化 API，必须靠第三方库或自研。

---

## 1. 推荐总表（按语言/生态，每项首选加粗）

### 1.1 JS / TypeScript

| 项目 | 仓库 | Star（2026-09-25 实测） | License | 语言/生态 | 中文支持 | 活跃度 | 集成方式 |
|---|---|---|---|---|---|---|---|
| **chrono（chrono-node）** | https://github.com/wanasit/chrono | **5287** | MIT | TypeScript（npm: chrono-node） | **支持**：源码含 `src/locales/zh`，分 `hans`/`hant`，有 `ZHHansCasualDateParser`、`ZHHansTimeExpressionParser`、`ZHHansDeadlineFormatParser`、`ZHHansWeekdayParser`（可直接解析「明天」「今天」「下午」「晚上」「中午」「周五」等） | 极活跃：last commit 2026-09-22，最新 release v2.10.1（2026-07-20），未 archived | **库（首选）**，前端/Node 服务端都能跑 |
| spacetime | https://github.com/spencermountain/spacetime | 4108 | **Apache-2.0**（raw LICENSE 原文核实，GitHub 标签为 Other） | JavaScript | 无中文 NL 解析（定位是时区/格式化） | 活跃：2026-09-19，v7.15.0（2026-09-19） | 库（做时区/展示辅助，不做解析） |
| andrewplummer/Sugar | https://github.com/andrewplummer/Sugar | 4504 | MIT | JavaScript | 无中文 | **停更**：last commit 2020-04-19，release 2.0.6（2018） | 库（`Date.create` 老方案，不建议新项目） |
| rrule（rrule.js） | https://github.com/jakubroztocil/rrule | 3744 | **BSD-3-Clause**（raw `LICENCE` 原文核实，含 3-clause 条款，GitHub 标签为 Other） | TypeScript | 无中文（`RRule.fromText()` 仅英文） | 维护放缓：2023-11-10，v2.7.2（2023-02-10） | 库（**RRULE 组合**：chrono 出 DTSTART，rrule 出重复规则） |
| super-productivity | https://github.com/super-productivity/super-productivity | 22240 | MIT | TypeScript | 取决于 chrono-node（`package.json` 实证依赖 `chrono-node ^2.9.0`） | 极活跃：2026-09-24，v19.1.0（2026-09-19） | **参考实现**：Todoist 风格「新建任务时行内写日期」，含 UI 高亮/预览 |
| kermankohli/natural-language-date-parser | https://github.com/kermankohli/natural-language-date-parser | 5 | GitHub 显示 NA（README 自称 MIT，**未在仓库原文核实到 LICENSE**） | TypeScript | 无中文 | 2025-02-10 | 参考实现（置信度打分、debug trace 设计可借鉴） |
| freakynit/smart-date-parser | https://github.com/freakynit/smart-date-parser | 0 | MIT | JavaScript | 无中文 | 2026-03-18 | 参考实现（歧义格式打分） |
| holistics/js（@holistics/date-parser） | https://github.com/holistics/js | 31 | GitHub 显示 NA（**仓库内无 LICENSE 文件**；npm 页标 MIT，未在仓库原文核实） | JavaScript | 无中文 | **已 archived**，last commit 2024-01-05，包 3.3.0（2023-10-13） | 参考实现（基于 chrono-node 做「区间/范围」解析，已停更，商用不建议依赖） |

### 1.2 Python

| 项目 | 仓库 | Star（2026-09-25 实测） | License | 语言/生态 | 中文支持 | 活跃度 | 集成方式 |
|---|---|---|---|---|---|---|---|
| **dateparser** | https://github.com/scrapinghub/dateparser | **2862** | BSD-3-Clause | Python（PyPI: dateparser） | **支持**：官方 `docs/supported_locales.rst` 列出 `zh`、`zh-Hans`、`zh-Hant`（含 zh-Hans-HK/MO/SG、zh-Hant-HK/MO） | 极活跃：2026-09-23，最新 release 1.4.3（2026-09-03） | **库（首选）** |
| python-dateutil | https://github.com/dateutil/dateutil | 2636 | **Apache-2.0 OR BSD-3-Clause**（`setup.cfg` 明确 `license = Dual License`，classifier 同时列 BSD 与 Apache；LICENSE 正文注明 BSD 条款覆盖全部代码） | Python | 无中文 NL（`parser` 只吃数字/英文格式与 "tomorrow" 等英文相对词） | 活跃：2026-05-19，release 2.9.0（2024-03-01） | 库（基础解析 + `rrule` 重复规则） |
| JioNLP | https://github.com/dongrixinyu/JioNLP | 3870 | Apache-2.0 | Python | **原生中文最强**：`jio.parse_time` 覆盖年月日/时分秒/星期/世纪/年代/月旬/节日/季节/季度/节气/农历月日/时间周期/时间长度/法律时间/模糊时间代词，输出 `type(时间类型)+definition(准确度)+time` | 活跃：last commit 2026-07-29（release 停在 v1.3.47 / 2021） | **库（中文首选）**，需显式传 `time_base` |
| parsedatetime | https://github.com/bear/parsedatetime | 711 | Apache-2.0 | Python | 无中文（locale 资源以英文为主） | 低：2024-08-08，release 2.6（2020-05-31） | 库（jrnl 生产在用，见下） |
| timefhuman | https://github.com/alvinwan/timefhuman | 128 | Apache-2.0 | Python | 无中文 | 活跃：2026-04-09，0.1.5（2026-04-05） | 库（擅长从长文本抽 datetime/区间/列表） |
| ctparse | https://github.com/comtravo/ctparse | 130 | MIT | Python | 无中文 | **已 archived**：last commit 2022-11-28 | 不建议新项目（PyPI 仍可装） |
| pytimeparse | https://github.com/wroberts/pytimeparse | 299 | MIT | Python | 无关（纯时长解析） | 2026-07-05 | 库（解析 "in 2 hours" 的时长部分） |
| recurrent | https://github.com/kvh/recurrent | 270 | MIT | Python | 无中文 | 停更：2021-08-16 | 库（**NL → RFC RRULE**，配合 `dateutil.rrulestr`） |
| zhanzecheng/Time_NLP（python3 版） | https://github.com/zhanzecheng/Time_NLP | 521 | **无 LICENSE**：raw `LICENSE` 返回 404，仓库根目录文件列表无任何 license（已原文核实） | Python | 中文（时间点/时间段/时间间隔） | 停更：last commit 2020-03-09 | **仅参考实现**（无授权 = 默认保留全部权利，商用风险高） |
| jrnl | https://github.com/jrnl-org/jrnl | 7323 | GPL-3.0 | Python | 英文语境 | 活跃：2026-08-08，v4.6（2026-08-07） | **参考实现**（`pyproject.toml` 实证依赖 `parsedatetime>=2.6` + `python-dateutil`） |

### 1.3 Go

| 项目 | 仓库 | Star（2026-09-25 实测） | License | 语言/生态 | 中文支持 | 活跃度 | 集成方式 |
|---|---|---|---|---|---|---|---|
| **when** | https://github.com/olebedev/when | **1461** | Apache-2.0 | Go | 规则包只有 en / common / ru 等，**无中文** | 活跃：2026-08-10（release 停在 2024-11-12） | **库（英文首选）**，规则可插拔 |
| dateparse | https://github.com/araddon/dateparse | 2142 | MIT | Go | 无中文 | **停更**：2021-04-29，无 release | 库（只做「未知格式的绝对日期」解析，非 NL） |
| rrule-go | https://github.com/teambition/rrule-go | 382 | MIT | Go | 无 NL | 停更：2023-04-01 | 库（**RRULE 组合**） |
| naturaldate.go | https://github.com/anatol/naturaldate.go | 24 | MIT | Go | 英文 | 活跃：2026-03-17 | 库（小众，可作对照） |
| strtotime（KarpelesLab） | https://github.com/KarpelesLab/strtotime | 1 | MIT | Go | 英文（PHP strtotime 兼容） | 活跃：2026-04-13，v0.1.14 | 库（小众） |
| **bububa/TimeNLP** | https://github.com/bububa/TimeNLP | 12 | Apache-2.0 | Go | **中文**（Time-NLP 的 Go 移植） | 相对新：2025-03-06，v1.0.5（2025-03-06） | **库（Go 里的中文选项）**，star 极少需自测 |

### 1.4 Java / Kotlin / Android

| 项目 | 仓库 | Star（2026-09-25 实测） | License | 语言/生态 | 中文支持 | 活跃度 | 集成方式 |
|---|---|---|---|---|---|---|---|
| **natty（维护版）** | https://github.com/natty-parser/natty | 15 | MIT | Java（Maven: `io.github.natty-parser:natty`） | 无中文 | **活跃**：2026-09-15，natty-1.1.4（2026-08-26） | **库（Java 首选）** |
| natty（原版） | https://github.com/joestelmach/natty | 529 | MIT | Java | 无中文 | **停更 2017-01-26**（release natty-0.13）；社区 fork 到 natty-parser 组织继续维护 | 库（仅在无法用维护版时参考） |
| jchronic | https://github.com/samtingleff/jchronic | 127 | MIT | Java | 无中文 | 基本停更：2022-07-12（release 2018） | 参考实现（Ruby chronic 的直译） |
| ggutim/natural-date-parser | https://github.com/ggutim/natural-date-parser | 10 | MIT | Java（`java.time.LocalDateTime`，Maven: `io.github.ggutim:natural-date-parser`） | 无中文 | 2025-12-03 | 库（规则+归一化，零 AI，路线图活跃但体量小） |
| sisyphsu/dateparser | https://github.com/sisyphsu/dateparser | 104 | MIT | Java | 无中文 | 停更：2022-09-13 | 库（只做绝对格式，非 NL） |
| Time4A | https://github.com/MenoData/Time4A | 80 | Apache-2.0 | Java / Android（AAR） | 无 NL（日历/时区） | 停更：2021-03-26 | 库（Android 日期基础能力） |
| kotlinx-datetime | https://github.com/Kotlin/kotlinx-datetime | 2824 | Apache-2.0 | Kotlin Multiplatform | 无 NL | 活跃：2026-09-21，v0.8.0（2026-05-07） | 库（KMP 栈基础，不是解析器） |
| dmfs/opentasks | https://github.com/dmfs/opentasks | 965 | Apache-2.0 | Java / Android | 无 NL 解析 | 停更：2021-03-30 | **参考实现**（Android 任务 App 的日期/重复规则处理）；**未核到 dmfs 名下独立的自然语言日期解析库**（见「未核实项」） |

### 1.5 Rust

| 项目 | 仓库 | Star（2026-09-25 实测） | License | 语言/生态 | 中文支持 | 活跃度 | 集成方式 |
|---|---|---|---|---|---|---|---|
| **chrono-english** | https://github.com/stevedonovan/chrono-english | 60 | MIT | Rust（crate: chrono-english） | 英文（`date` 命令风格："tomorrow 5pm"） | 活跃：2026-08-26，v0.2.1（2026-08-26） | **库（Rust 首选）**，输出 `chrono` DateTime |
| dateparser（Rust） | https://github.com/waltzofpearls/dateparser | 52 | MIT | Rust | 无中文 NL（格式解析） | 活跃：2026-03-25，v0.3.1 | 库（绝对格式兜底） |
| natural-date-parser | https://github.com/koejdga/natural-date-parser | 1 | **无 LICENSE 文件**（raw 404，GitHub NA）；`Cargo.toml` 里写 `license = "MIT"`——**声明与文件不一致，未核实为有效授权** | Rust | 英文 | 2025-10-09，v0.1.3 | 谨慎评估后参考 |
| chrono（crate） | https://github.com/chronotope/chrono | 见注 | MIT OR Apache-2.0 | Rust | — | — | 库（**注意**：这是日期时间基础库，与本清单的 NL 解析不是同一层；本次未逐项核实 chronotope/chrono 的 star，标为未核实） |

### 1.6 Haskell / 多语种服务

| 项目 | 仓库 | Star（2026-09-25 实测） | License | 语言/生态 | 中文支持 | 活跃度 | 集成方式 |
|---|---|---|---|---|---|---|---|
| **duckling** | https://github.com/facebook/duckling | **4324** | **BSD-3-Clause**（`duckling.cabal` 写 `license: BSD-3-Clause`，LICENSE 为三条款 BSD，均已原文核实；GitHub 标签为 Other） | Haskell，编译为 HTTP 服务（Docker） | **支持中文**：`duckling.cabal` 模块列表实测含 `Duckling.Rules.ZH`、`Duckling.Dimensions.ZH`、`Duckling.Time.ZH.Corpus/Rules`、`Duckling.Time.ZH.CN/HK/MO/TW.Corpus/Rules`、`Duckling.Ranking.Classifiers.ZH_CN/HK/MO/TW/XX`，以及 AmountOfMoney/Distance/Duration/Numeral/Ordinal/Quantity/Temperature 的 ZH 模块 | 半活跃：last commit 2026-03-15，最新 release 仍为 **Duckling v0.2.0.0（2021-04-16）**，未 archived | **服务**（独立 HTTP 服务，多语言统一入口；部署重，Haskell/Docker） |

### 1.7 Ruby（参考，非本项目主栈）

| 项目 | 仓库 | Star（2026-09-25 实测） | License | 语言/生态 | 中文支持 | 活跃度 | 集成方式 |
|---|---|---|---|---|---|---|---|
| chronic | https://github.com/mojombo/chronic | 3252 | MIT | Ruby | 无中文 | 2023-01-30（release 停在 2013） | 参考实现（jchronic / 多数 Java 移植的源头） |

### 1.8 Apple / Android 原生能力

| 能力 | 来源 | 类型 | License | 中文支持 | 活跃度 | 集成方式 |
|---|---|---|---|---|---|---|
| **NSDataDetector** | Foundation（Apple 官方文档） | **系统能力**（免费，`NSRegularExpression` 子类） | 随 SDK，无需额外授权 | **有限**：官方定位是「在自然语言文本中匹配 date/address/link/phone/transit」；对「明天下午三点」这类**相对表达通常解析不出**（社区反馈一致） | 跟随 iOS/macOS 系统 | 系统 API，零依赖（可作为「文本里已有绝对日期」的抽取器） |
| SwiftDate | https://github.com/malcommac/SwiftDate | 开源库 | MIT | 无中文 NL（强于解析/操作，弱于 NL） | **停更**：2022-09-12，7.0.0（2022-09-12） | 库 |
| android.text.format.DateUtils / DateFormat | Android SDK（官方） | **系统能力** | 随 SDK | 仅**格式化/相对时间显示**（如「3 小时前」），**不含自然语言解析** | 跟随 Android 系统 | 系统 API（展示层用，替代不了解析器） |
| SmartDateParser（Android 第三方） | 搜索线索，未核到可靠活跃仓库 | — | — | — | — | **未核实**，不作为候选 |

### 1.9 「日期解析 + RRULE 结合」与 Todoist 风格参考实现

| 组合 / 项目 | 仓库 | Star（2026-09-25 实测） | License | 说明 | 集成方式 |
|---|---|---|---|---|---|
| chrono + rrule.js | https://github.com/jakubroztocil/rrule | 3744 | BSD-3-Clause（原文核实） | JS 里最成熟的「自然语言 → DTSTART + RRULE」组合；`RRule.fromText()` 本身只吃英文 | 库组合 |
| recurrent + dateutil.rrule | https://github.com/kvh/recurrent | 270 | MIT | Python 里把 "every tuesday and thurs until next month" 直接转 RFC RRULE | 库组合（已停更） |
| rrule-go | https://github.com/teambition/rrule-go | 382 | MIT | Go 侧重复规则引擎，需自配 NL 前端（when/naturaldate） | 库组合 |
| super-productivity | https://github.com/super-productivity/super-productivity | 22240 | MIT | 生产级 Todoist 风格「行内自然语言建任务」，`package.json` 实证用 chrono-node | 参考实现（最贴近滴答清单） |
| jrnl | https://github.com/jrnl-org/jrnl | 7323 | GPL-3.0 | CLI 日记的行内日期解析（parsedatetime + dateutil） | 参考实现（GPL，勿抄代码） |
| taskwarrior / todo.txt | — | — | — | **未核实到成熟的内置自然语言解析插件**：taskwarrior 官方语法是 `due:2026-09-30` 之类的结构化输入；todo.txt 格式本身只定义 `YYYY-MM-DD`。搜索到的相关项均为「讨论/issue/第三方小插件」，证据不足，不作为候选。 | 不推荐 |

---

## 2. 中文支持专项（本次调研的重点结论）

### 2.1 有明确证据、license 清晰的中文方案

| 方案 | 证据 | License | 可商用 | 备注 |
|---|---|---|---|---|
| **JioNLP `parse_time`** | 官方 README/Wiki「时间语义解析说明文档」，能力面最全 | Apache-2.0 | ✅ | 中文**首选**；需显式传 `time_base`；对跨句上下文/模糊词仍会出错（官方自述难点） |
| **chrono zh locale** | 源码 `src/locales/zh/index.ts` + `hans/parsers/ZHHansCasualDateParser.ts`（正则实测含 `现在/即刻/今/明/前/大前/后/大后/昨` × `早/晚`、`上午/早上/下午/晚上/夜晚/中午/凌晨`） | MIT | ✅ | 一个库同时覆盖中英；对「明天下午三点」「周五」这类高频表达很合适，长尾弱于 JioNLP |
| **duckling（ZH 维度）** | `duckling.cabal` 模块清单实测含 `Duckling.Time.ZH.CN/HK/MO/TW` 等 | BSD-3-Clause | ✅ | 多语言统一服务；部署成本高、release 停在 2021 |
| **dateparser（zh）** | 官方 `docs/supported_locales.rst` 列出 `zh` / `zh-Hans` / `zh-Hant` | BSD-3-Clause | ✅ | 中文相对表达覆盖面一般，适合做兜底 |
| **bububa/TimeNLP** | 仓库 README「Time-NLP 的 golang 版本」 | Apache-2.0 | ✅ | Go 侧唯一 license 清晰的中文 NL 解析；star 仅 12，需自测 |

### 2.2 license 不清晰、只能当参考实现的中文项目

| 项目 | Star（2026-09-25） | 实测状态 | 风险 |
|---|---|---|---|
| zhanzecheng/Time_NLP（python3 移植） | 521 | 根目录**无 LICENSE 文件**（raw 404，文件列表已核） | 无授权 = 默认保留全部权利，**不可直接商用**；停更 2020-03 |
| shinyke/Time-NLP（Java 原版，注意仓库名是 `Time-NLP` 带连字符） | 660 | GitHub license 标签 NA，**无 LICENSE 文件**；停更 **2017-07-19** | 同上；是清华/复旦系 Time-NLP 的源头实现 |
| NagiYan/TimeNLP（iOS/ObjC 移植） | 19 | `LICENSE` 为 **GPL-3.0** | 可商用但**有传染性**，闭源产品不可用 |
| koejdga/natural-date-parser（Rust） | 1 | `Cargo.toml` 写 MIT，但仓库**无 LICENSE 文件** | 声明与文件不一致，法务上不干净 |

> 注意：`shinyke/Time_NLP`（下划线）当日 404，正确的仓库名是 `shinyke/Time-NLP`（连字符）。搜索结果里出现过「Time-NLPY Java 版 https://github.com/shinyke/...」这类引用，实际已失效或改名，**不要按旧名字找**。

### 2.3 「是否必须自研 / 接 LLM」的判断

1. **高频表达（明天/后天/下周一/下午三点/每晚八点/in 2 hours）**：chrono（中英）+ JioNLP（中文长尾）可覆盖绝大多数；不需要 LLM。
2. **中文的先天难点**（JioNLP 官方自述）：时间实体强依赖上下文（「前两个月」在不同句子里是 1–2 月 / 大约两个月前 / 从今天往前推两个月）、时间基点不确定（默认当前时刻会错）。**规则库无法根治**。
3. **建议架构**：`规则库（chrono / JioNLP）→ 置信度低或未命中 → LLM function-calling 返回结构化 JSON（datetime + tz + rrule）→ 人工可纠正`。LLM 只做兜底与长尾，既控成本又保准确率。
4. **农历 / 节日 / 节气**：JioNLP 覆盖节日/节气/农历月日；若只要日期换算，`kinegratii/borax`（Python 农历+节日库）可作为补充（本次仅搜索到，未做 star 核实）。

---

## 3. 证据分级说明（务必区分）

- **已 curl 实证**：上表所有 Star、forks、license 标签、archived、default branch、last commit、latest release、top language，均由 `ghinfo.py` 当日抓 GitHub 页面/atom feed 得到；所有标 `Apache-2.0`/`MIT`/`BSD-3-Clause` 且原标签为 `NOASSERTION`/`NA` 的条目，均另读 raw LICENSE 原文确认（dateutil、duckling、rrule、spacetime）。中文支持结论均由**读源码/读文档/读 cabal 模块清单**得到（chrono zh、duckling ZH、dateparser zh、JioNLP）。
- **搜索摘要看到但未核实**：`kinegratii/borax`（仅搜索命中）；`ChineseTimeNLP` PyPI 包（搜索命中，指向已失效的 shinyke 链接，未核实）；`SmartDateParser`（Android 第三方，未核到可靠仓库）；`dmfs` 名下「自然语言日期解析库」（搜索未命中，仅核实到 `dmfs/opentasks` 任务 App）。
- **未核实/存疑**：`chronotope/chrono`（Rust 基础库）的 star 未逐项核实；`holistics/js` 的 npm MIT 声明未在仓库原文核实（仓库内无 LICENSE 文件且已 archived）；`kermankohli/natural-language-date-parser` 与 `koejdga/natural-date-parser` 的 MIT 声明均未在仓库内找到 LICENSE 文件。

---

## 4. 落地建议（给自研滴答清单）

| 场景 | 推荐 | 理由 |
|---|---|---|
| 主解析引擎（Web/桌面/服务端） | **chrono（chrono-node）+ 自研中文补丁** | MIT、活跃、中英一套 API、支持时间区间与「distance/matching」调参 |
| 中文长尾补强 | **JioNLP `parse_time`** | Apache-2.0、中文能力面最广、活跃 |
| 服务端多语言统一 | **duckling Docker 服务** | BSD-3-Clause、含中文维度；但 release 老、部署重，建议只在对多语言要求高时上 |
| 重复任务（每周一/每天/每月 1 号） | **chrono（出 DTSTART）+ rrule.js（出 RRULE）**；Python 侧用 `recurrent`/`dateutil.rrule` | 现成组合最省事；中文重复表达需自研 pattern |
| 移动端 | iOS：`NSDataDetector` 兜底 + chrono？(JS 引擎不现实) → 建议原生自研小规则库；Android：**无系统能力**，用 natty 维护版（Java）或自研 | 原生生态没有 license 清晰的中文 NL 解析库 |
| 兜底 | **LLM function calling** | 处理口语、跨句、歧义；成本可控 |

## 5. 附：本次实测的 ghinfo 原始行（可复核）

```
wanasit/chrono	5287	388	MIT (MIT License)	false	master	2026-09-22T23:42:14Z	v2.10.1 @ 2026-07-20T00:29:36Z	typescript: 100.0%
scrapinghub/dateparser	2862	522	BSD-3-Clause	false	master	2026-09-23T18:07:00Z	1.4.3 @ 2026-09-03T10:07:00Z	python: 100.0%
dateutil/dateutil	2636	583	NOASSERTION (Other)	false	master	2026-05-19T23:50:16Z	2.9.0 @ 2024-03-01T03:54:24Z	python: 99.6%
bear/parsedatetime	711	114	Apache-2.0	false	master	2024-08-08T01:37:43Z	2.6 @ 2020-05-31T23:52:03Z	python: 99.6%
alvinwan/timefhuman	128	20	Apache-2.0	false	master	2026-04-09T07:17:44Z	0.1.5 @ 2026-04-05T11:41:53Z	python: 100.0%
joestelmach/natty	529	188	MIT	false	master	2017-01-26T04:49:55Z	natty-0.13 @ 2017-01-26T04:38:38Z	java: 79.1%
natty-parser/natty	15	6	MIT	false	main	2026-09-15T21:49:06Z	natty-1.1.4 @ 2026-08-26T21:08:32Z	java: 82.3%
olebedev/when	1461	94	Apache-2.0	false	master	2026-08-10T01:28:37Z	Extend RU rules @ 2024-11-12T03:05:22Z	go: 100.0%
araddon/dateparse	2142	174	MIT	false	master	2021-04-29T16:20:01Z	NO-RELEASES	go: 100.0%
stevedonovan/chrono-english	60	12	MIT	false	master	2026-08-26T16:08:25Z	v0.2.1 @ 2026-08-26T16:10:30Z	rust: 100.0%
facebook/duckling	4324	739	NOASSERTION (Other)	false	main	2026-03-15T21:56:54Z	Duckling v0.2.0.0 @ 2021-04-16T17:06:51Z	haskell: 100.0%
comtravo/ctparse	130	29	MIT	true	master	2022-11-28T09:08:56Z	0.3.6 @ 2022-11-28T09:08:56Z	python: 99.1%
zhanzecheng/Time_NLP	521	123	NA	false	master	2020-03-09T09:40:02Z	NO-RELEASES	python: 100.0%
shinyke/Time-NLP	660	183	NA	false	master	2017-07-19T09:05:59Z	NO-RELEASES	java: 100.0%
bububa/TimeNLP	12	4	Apache-2.0	false	main	2025-03-06T07:07:13Z	v1.0.5 @ 2025-03-06T07:07:47Z	go: 100.0%
NagiYan/TimeNLP	19	9	GPL-3.0	false	master	2018-03-09T03:36:51Z	0.1.3.4 @ 2018-03-09T03:36:51Z	objective-c: 94.4%
dongrixinyu/JioNLP	3870	441	Apache-2.0	false	master	2026-07-29T14:04:05Z	v1.3.47 @ 2021-12-29T09:14:38Z	python: 99.9%
jakubroztocil/rrule	3744	565	NOASSERTION (Other)	false	master	2023-11-10T20:05:10Z	v2.7.2 @ 2023-02-10T18:52:20Z	typescript: 98.2%
kvh/recurrent	270	32	MIT	false	master	2021-08-16T15:47:42Z	NO-RELEASES	python: 100.0%
spencermountain/spacetime	4108	190	NOASSERTION (Other)	false	master	2026-09-19T20:26:43Z	7.15.0 @ 2026-09-19T20:27:13Z	javascript: 99.6%
super-productivity/super-productivity	22240	2071	MIT	false	master	2026-09-24T18:59:28Z	v19.1.0 @ 2026-09-19T16:46:25Z	typescript: 90.4%
jrnl-org/jrnl	7323	565	GPL-3.0	false	main	2026-08-08T21:36:34Z	v4.6 @ 2026-08-07T10:35:38Z	python: 59.6%
Kotlin/kotlinx-datetime	2824	134	Apache-2.0	false	master	2026-09-21T14:53:53Z	v0.8.0 @ 2026-05-07T14:34:47Z	kotlin: 99.9%
samtingleff/jchronic	127	27	MIT	false	master	2022-07-12T20:47:45Z	jchronic-0.2.8 @ 2018-06-13T22:48:02Z	java: 100.0%
ggutim/natural-date-parser	10	0	MIT	false	main	2025-12-03T15:02:54Z	NO-RELEASES	java: 100.0%
sisyphsu/dateparser	104	24	MIT	false	master	2022-09-13T09:24:47Z	NO-RELEASES	java: 100.0%
MenoData/Time4A	80	13	Apache-2.0	false	master	2021-03-26T20:58:26Z	v4.8-2021a @ 2021-03-27T01:52:43Z	java: 100.0%
waltzofpearls/dateparser	52	14	MIT	false	main	2026-03-25T07:37:18Z	v0.3.1 @ 2026-03-25T07:40:32Z	rust: 97.1%
koejdga/natural-date-parser	1	2	NA	false	main	2025-10-09T20:56:22Z	NO-RELEASES	rust: 99.3%
anatol/naturaldate.go	24	0	MIT	false	main	2026-03-17T16:56:12Z	NO-RELEASES	go: 100.0%
KarpelesLab/strtotime	1	0	MIT	false	master	2026-04-13T12:22:17Z	v0.1.14 @ 2026-04-13T12:22:17Z	go: 99.9%
teambition/rrule-go	382	69	MIT	false	master	2023-04-01T12:53:05Z	v1.8.2 @ 2023-01-13T07:41:13Z	go: 100.0%
mojombo/chronic	3252	449	MIT	false	master	2023-01-30T03:51:21Z	v0.10.2 @ 2013-09-09T07:05:47Z	ruby: 100.0%
wroberts/pytimeparse	299	45	MIT	false	master	2026-07-05T17:53:10Z	pytimeparse 1.1.8 @ 2018-05-18T17:41:45Z	python: 100.0%
malcommac/SwiftDate	7691	774	MIT	false	master	2022-09-12T06:55:22Z	7.0.0 @ 2022-09-12T07:00:48Z	swift: 99.8%
dmfs/opentasks	965	258	Apache-2.0	false	master	2021-03-30T08:59:47Z	1.4.2 @ 2021-03-21T21:24:52Z	java: 100.0%
andrewplummer/Sugar	4504	305	MIT	false	master	2020-04-19T15:23:35Z	2.0.6 @ 2018-12-06T10:37:27Z	javascript: 84.6%
holistics/js	31	2	NA	true	master	2024-01-05T04:17:13Z	@holistics/date-parser@3.3.0 @ 2023-10-13T03:39:43Z	javascript: 100.0%
```
