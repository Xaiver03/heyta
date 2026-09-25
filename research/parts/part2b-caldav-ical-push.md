# Part 2B — CalDAV / WebDAV、iCal/ICS 解析、推送通知基础设施 事实核查

> **核查日期**：2026-09-25（本环境当期真实日期）
> **核查方法**：
> 1. GitHub 公开 HTML + `commits.atom` / `releases.atom`，由 `research/tools/ghinfo.py` 抓取（**未使用** api.github.com，该 IP 已被限流；一次尝试得到 `API rate limit exceeded`，故改用 HTML/atom）。
> 2. 许可证精确文本：`curl -x http://127.0.0.1:7890 https://raw.githubusercontent.com/OWNER/REPO/HEAD/LICENSE*`，并以 npm / PyPI / crates.io / pub.dev 的**注册表元数据**交叉验证。
> 3. Star / Fork / License 字段来自 github.com 页面内嵌 JSON（`stargazerCount` / `license.spdxId`）。
> 4. `web_search` / `web_fetch` 本会话不可用（Tavily 432、非公网 IP 解析失败），改用 `curl + 系统代理` 直取一手页面。
>
> **规则**：任何未取得一手来源的数字一律写 `未核实`，绝不猜测。所有可得证据见文末「附录：原始证据」。

---

## 术语：许可证红线的判定口径

- 🟥 **AGPL / GPL / LGPL / BUSL / Elastic / SSPL / FSL / 专有** —— **禁止**把代码链接、嵌入或改造成本产品的一部分（违反会传染整个分发物）。
- ✅ **MIT / Apache-2.0 / BSD-2/3 / ISC / MPL-2.0** —— 允许闭源商用；MPL-2.0 为**文件级** copyleft，仅被修改的 MPL 文件需继续以 MPL 公开。
- **独立部署的服务器程序**：把 GPL/AGPL 服务器当作**独立进程/独立服务**自托管（本产品只通过 HTTP 协议与其通信，不链接、不修改分发），通常**不构成衍生作品**，可商用；但**一旦把其代码打进本产品的安装包/容器镜像一起分发，或修改其源码再分发，就触发 copyleft**。下表每行都单独标注这一区别。

---

## Category 3 — CalDAV / WebDAV 客户端与服务器

### 3.1 客户端（重点是「可替代 `@nextcloud/cdav-library` 的宽松许可客户端」）

| 组件 | 仓库 URL | Star(实测) | License(精确SPDX) | 语言 | 最近提交/发布 | 闭源商用? | 备注与来源 |
|---|---|---|---|---|---|---|---|
| `@nextcloud/cdav-library` | https://github.com/nextcloud/cdav-library | 73 | 🟥 **AGPL-3.0-or-later** | JavaScript | 提交 2026-09-22 / v2.8.0 @ 2026-09-01 | ❌ 禁止嵌入 | **确认**：npm `package.json` 字段 `"license": "AGPL-3.0-or-later"`，仓库 `LICENSE` 为 GNU Affero GPL v3 全文。**这是必须替换的组件** |
| `perry-mitchell/webdav-client`（npm `webdav`） | https://github.com/perry-mitchell/webdav-client | 818 | MIT | TypeScript | 提交 2026-09-19 / v5.11.0 @ 2026-09-19 | ✅ | npm `webdav@5.11.0` license=MIT。**仅 WebDAV**：README 未出现 CalDAV/calendar 字样，不能直接当 CalDAV 客户端 |
| `natelindev/tsdav`（npm `tsdav`） | https://github.com/natelindev/tsdav | 355 | **MIT** | TypeScript | 提交 2026-09-19 / v2.3.4 @ 2026-09-19 | ✅ | npm `tsdav@2.3.4` license=MIT；描述 "WebDAV, CALDAV, and CARDDAV client for js runtimes and the Browser"。**JS 生态最佳替代候选** |
| `KlautNet/ts-caldav`（npm `ts-caldav`） | https://github.com/KlautNet/ts-caldav | 29 | MIT | TypeScript | 提交 2026-08-23 / v0.4.2 @ 2026-08-23 | ✅ | npm license=MIT；描述含 "manage calendars, events, and **tasks**"，社区小 |
| `python-caldav/caldav` | https://github.com/python-caldav/caldav | 413 | **Apache-2.0** | Python | 提交 2026-09-21 / v3.3.1 @ 2026-09-16 | ✅ | PyPI `caldav` 7.x 系（版本号以仓库 release 为准）；成熟 CalDAV 客户端 |
| `pimutils/vdirsyncer` | https://github.com/pimutils/vdirsyncer | 1880 | **BSD-3-Clause** | Python | 提交 2026-09-03 / v0.21.0 @ 2026-09-04 | ✅ | 仓库 `LICENSE` 含第三条 "names ... may not be used to endorse or promote"，即标准 3-clause；topics 含 `vtodo`，任务同步可用。**CLI 同步器，非库** |
| `pimutils/khal` | https://github.com/pimutils/khal | 3056 | **MIT** | Python | 提交 2026-09-23 / v0.14.1 @ 2026-08-21 | ✅ | CLI 日历应用；README 未提 VTODO，**是否支持任务组件 = 未核实** |
| `bitfireAT/dav4jvm` | https://github.com/bitfireAT/dav4jvm | 104 | **MPL-2.0** | Kotlin | 提交 2026-09-24 / 4.1.0 @ 2026-09-01 | ✅（文件级 copyleft） | WebDAV+CalDAV+CardDAV，JVM/Kotlin/Java 首选 |
| `bitfireAT/davx5-ose` | https://github.com/bitfireAT/davx5-ose | 2897 | 🟥 **GPL-3.0** | Kotlin | 提交 2026-09-24 / v4.5.20-beta.2-ose @ 2026-09-16 | ❌ 禁止嵌入 | DAVx⁵ 应用本体；其底层库 dav4jvm 才是 MPL-2.0 |
| `emersion/go-webdav` | https://github.com/emersion/go-webdav | 498 | **MIT** | Go | 提交 2026-06-28 / 0.7.0 @ 2025-10-18 | ✅ | Go 的 WebDAV/CalDAV/CardDAV 库 |
| `libdav`（crate `libdav`） | https://git.sr.ht/~whynothugo/libdav | 未核实（非 GitHub） | **ISC** | Rust | crates 0.11.0 @ 2026-09-05 | ✅ | crates.io 版本元数据 `license: ISC`；活跃 Rust CalDAV 客户端 |
| `minicaldav`（crate `minicaldav`） | https://gitlab.com/floers/minicaldav | 未核实（GitLab） | 🟥 **GPL-3.0-or-later** | Rust | crates 0.8.0 @ 2023-07-02 | ❌ 禁止嵌入 | 已停更 |
| Dart `caldav` | https://github.com/ssyuk/caldav | 1 | **MIT** | Dart | 提交 2026-06-13 / pub 1.5.0 @ 2026-06-13 | ✅ | pub.dev score tag `license:mit`；全平台；社区极小（1 star），需自行评估成熟度 |
| Dart `webdav_client` | https://github.com/flymzero/webdav_client | 67 | **BSD-3-Clause** | Dart | 提交 2024-05-12 / pub 1.2.2 @ 2024-05-12 | ✅ | pub.dev tag `license:bsd-3-clause`；**仅 WebDAV**，且 2024 后无发布 |
| Dart `webdav` | https://github.com/timestee/dart-webdav | 未核实 | **Unlicense** | Dart | pub 1.0.8-dev @ 2020-07-06 | ✅ | pub.dev tag `license:unlicense`；**2020 年停滞**，不建议 |
| `caldav-adapter`（npm） | https://github.com/forwardemail/caldav-adapter | 35 | MIT | JavaScript | 提交 2026-09-01 / v9.4.0 @ 2026-09-01 | ✅ | ⚠️ 名称易误解：描述为 "CalDAV **server** for Node.js and Koa"，是**服务端框架**，不是客户端 |

> 另核实到的次要候选（npm 搜索）：`dav`（MPL-2.0，2018 年停滞）、`dav-request`（MPL-2.0，2025）、`caldav`（2013 年，0.0.1，实际不可用）。Rust crates 搜索到的 `fast-dav-rs` / `opendal-service-webdav`（Apache OpenDAL 系）等许可证字段在 crates.io 版本元数据中**未核实**，未列为主候选。

### 3.2 服务器

| 组件 | 仓库 URL | Star(实测) | License(精确SPDX) | 语言 | 最近提交/发布 | 闭源商用? | 备注与来源 |
|---|---|---|---|---|---|---|---|
| `sabre-io/dav`（SabreDAV） | https://github.com/sabre-io/dav | 1723 | **BSD-3-Clause** | PHP | 提交 2026-08-02 / Release 4.7.1 @ 2026-07-07 | ✅ **可任意嵌入/分发** | LICENSE 为 fruux GmbH 的 BSD 三条款全文；**唯一可打包进闭源产品的成熟 CalDAV 服务器** |
| `Kozea/Radicale` | https://github.com/Kozea/Radicale | 5044 | 🟥 **GPL-3.0** | Python | 提交 2026-09-24 / 3.8.1 @ 2026-09-25 | ⚠️ **自托管独立部署 OK；嵌入/再分发其代码 ❌** | Python CalDAV/CardDAV 服务器；作为独立服务跑（HTTP 通信）不构成衍生作品 |
| `sabre-io/Baikal` | https://github.com/sabre-io/Baikal | 3320 | 🟥 **GPL-3.0** | PHP | 提交 2026-08-13 / 0.12.1 @ 2026-08-05 | ⚠️ 同上：独立自托管 OK，嵌入/打包分发 ❌ | 基于 SabreDAV 的成品服务器（App 层 GPL，底层库 BSD，二者许可不同，勿混淆） |
| `stalwartlabs/stalwart` | https://github.com/stalwartlabs/stalwart | 14804 | 🟥 **AGPL-3.0-only 或 Stalwart Enterprise License v2（专有）** 双许可 | Rust | 提交 2026-09-24 / v0.16.23 @ 2026-09-21 | ❌ 禁止嵌入；独立自托管亦受 AGPL 网络条款约束 | README「License」节 + `LICENSES/AGPL-3.0-only.txt` + `LICENSES/LicenseRef-SEL.txt` 明确双许可。AGPL 的网络条款对「以服务形式提供」有传染性 |
| `nextcloud/server` | https://github.com/nextcloud/server | 36910 | 🟥 **AGPL-3.0** | PHP | 提交 2026-09-25 / v35.0.1 @ 2026-09-24 | ❌ 禁止嵌入 | 作为对照项；`@nextcloud/cdav-library` 的 AGPL 与之同源 |

### Cat 3 结论 / 推荐

1. **客户端必须替换**：`@nextcloud/cdav-library` 已从两个一手来源确认是 `AGPL-3.0-or-later`（npm package.json + 仓库 LICENSE），**不可保留**。
2. **JS/TS 首选替代：`natelindev/tsdav`（MIT，355★，2026-09-19 仍活跃）**。它同时覆盖 WebDAV + CalDAV + CardDAV，支持浏览器与 Node/Deno/Bun，API 面与 cdav-library 的「发现→查日历→查/写对象」流程最接近，迁移成本最低。次选 `KlautNet/ts-caldav`（MIT），但其体量小（29★），作为补充或对比。
3. **纯 WebDAV 需求**用 `perry-mitchell/webdav-client`（MIT，818★），但它不含 CalDAV 协议，不能替代 cdav-library 的 CalDAV 部分。
4. **非 JS 技术栈**：Java/Kotlin → `dav4jvm`（MPL-2.0）；Python → `python-caldav`（Apache-2.0）+ `vdirsyncer`（BSD-3-Clause）；Go → `emersion/go-webdav`（MIT）；Rust → `libdav`（ISC）。
5. **服务器**：只有 **`sabre-io/dav` 是 BSD-3-Clause**，可放心打包/嵌入闭源产品。Radicale / Baikal（GPL-3.0）**只能以独立自托管服务**形式使用；**不要把它们的代码打进产品分发物**。Stalwart 是 AGPL 网络条款 + 专有双许可，自托管作服务需评估 AGPL 合规。

---

## Category 4 — iCal / ICS 解析（重点：VTODO + VALARM 支持）

| 组件 | 仓库 URL | Star(实测) | License(精确SPDX) | 语言 | 最近提交/发布 | 闭源商用? | VTODO 支持 & 备注与来源 |
|---|---|---|---|---|---|---|---|
| `kewisch/ical.js`（npm `ical.js`） | https://github.com/kewisch/ical.js | 1179 | **MPL-2.0** | JavaScript | 提交 2026-09-17 / v2.2.1 @ 2025-08-08 | ✅ 允许闭源商用（**文件级** copyleft） | **VTODO：通用支持**。`lib/ical/design.js` 定义 `vtodo: icalSet`（第 984/1003 行），可解析/序列化 VTODO 组件；但**无专用 `Todo` 高层类**（仓库只有 `event.js`，无 `todo.js`），任务字段需手工处理。npm `ical.js` license=MPL-2.0，LICENSE 为 MPL 2.0 全文 |
| `jens-maus/node-ical`（npm `node-ical`） | https://github.com/jens-maus/node-ical | 170 | **Apache-2.0** | JavaScript | 提交 2026-09-13 / 0.27.2 @ 2026-09-13 | ✅ | **VTODO：仅部分**。源码只在 RRULE 合法性判断中出现 `['VEVENT','VTODO','VJOURNAL']`（ical.js L239/L243），**无 VTODO 对象模型**，README 无 todo 字样 → 偏 VEVENT。任务管理器不建议单独依赖 |
| `collective/icalendar`（PyPI `icalendar`） | https://github.com/collective/icalendar | 1174 | **BSD-2-Clause** | Python | 提交 2026-09-23 / v7.3.0 @ 2026-08-20 | ✅ | **VTODO + VALARM：完整**。`pyproject.toml` `license = "BSD-2-Clause"`；`src/icalendar/cal/todo.py` 首行 `:rfc:5545 VTODO component`，`__init__.py` 导出 `Todo`/`Alarm`，`alarms.py` 明确 `Parent = Event | Todo`。**Python 首选** |
| `ical4j/ical4j` | https://github.com/ical4j/ical4j | 837 | **BSD-3-Clause** | Java | 提交 2026-09-25 / ical4j-4.3.0 @ 2026-06-27 | ✅ | **VTODO：完整**。`src/main/java/net/fortuna/ical4j/model/component/VToDo.java` 存在，含 34 处 VTODO 引用；`LICENSE.txt` 为 BSD 3-Clause 全文。README 提到 RFC9074 VALARM 扩展 |
| `arran4/golang-ical` | https://github.com/arran4/golang-ical | 415 | **Apache-2.0** | Go | 提交 2026-08-18 / v0.3.6 @ 2026-08-18 | ✅ | **VTODO + VALARM：完整**。`components.go` 定义 `type VTodo struct`、`NewTodo()`、`ComponentVTodo`；README 有 `NewAlarm` + `SetTrigger` VALARM 示例 |
| `emersion/go-ical` | https://github.com/emersion/go-ical | 72 | **MIT** | Go | 提交 2025-06-09 / 无 release | ✅ | VTODO 专用支持**未核实**（`ical.go` 中 0 处 vtodo）；偏通用组件解析。若要 VTODO 建议用 `arran4/golang-ical` |
| `hoodie/icalendar`（crate `icalendar`） | https://github.com/hoodie/icalendar | 189 | **MIT/Apache-2.0**（双） | Rust | 提交 2026-07-28 / v0.17.13 @ 2026-07-28 | ✅ | Rust 首选；crates 版本元数据 `license: MIT/Apache-2.0`；VTODO 具体支持**未核实** |
| `pimalaya/ical`（crate `ical-rs`） | https://github.com/pimalaya/ical | 1 | **MIT OR Apache-2.0** | Rust | 提交 2026-09-02 / v0.5.1 @ 2026-09-02 | ✅ | crates 版本元数据确认；较新、体量小，VTODO **未核实** |
| `Peltoche/ical-rs`（crate `ical`） | https://github.com/Peltoche/ical-rs | 109 | 仓库页 **Apache-2.0**；crates.io 版本元数据标注 `non-standard`（**冲突**） | Rust | 提交 2024-08-17，**已归档** / v0.11.0 @ 2024-03-13 | ⚠️ 不建议（已归档 + 许可标注冲突） | 归档状态来自 GitHub HTML `isArchived:true` |
| Dart `icalendar` | https://gitlab.com/powerbuilding/opensource/mobile/support-libraries/icalendar-dart | 未核实（GitLab） | **BSD-3-Clause** | Dart | pub 0.1.3 @ 2023-01-10 | ✅ | pub.dev tag `license:bsd-3-clause`；2023 后无更新 |
| Dart `ical` | https://github.com/dartclub/ical | 未核实 | **BSD-3-Clause** | Dart | pub 0.2.2 @ 2021-11-23 | ✅ | pub.dev tag `license:bsd-3-clause`；2021 后停滞，不建议 |

### Cat 4 结论 / 推荐

1. **JS/TS 最佳 VTODO-capable 解析器 = `kewisch/ical.js`（MPL-2.0）**。它是 JS 生态事实标准，且 `design.js` 显式建模 VTODO。**MPL-2.0 的商业含义要讲清楚**：允许闭源商用、允许与专有代码链接；但**若你修改了 ical.js 自身的某个源文件，被你修改的那个文件必须以 MPL-2.0 继续公开**（文件级 copyleft，不传染到你的其他文件）。只要原样使用、不改其源码，就只需保留其 LICENSE/版权声明。**注意它没有专用 `Todo` 类，任务属性需自行按组件操作。**
2. 若需求是 **VTODO + VALARM 一等公民**且可接受非 JS：Python `icalendar`（BSD-2-Clause，`Todo`/`Alarm` 完备）或 Java `ical4j`（BSD-3-Clause，`VToDo.java`）最稳。
3. Go 场景直接用 `arran4/golang-ical`（Apache-2.0，`VTodo` + `VALARM` 已实现）。
4. **不推荐** `node-ical` 作为任务组件解析主力（仅 VEVENT）。
5. 若坚持「JS 且零 copyleft」，`ical.js` 的 MPL 是唯一的轻微妥协；否则需自研 VTODO 解析或接受 Python/Go 后端解析。

---

## Category 5 — 推送通知基础设施（自托管）

| 组件 | 仓库 URL | Star(实测) | License(精确SPDX) | 语言 | 最近提交/发布 | 闭源商用? | 备注与来源 |
|---|---|---|---|---|---|---|---|
| `binwiederhier/ntfy` | https://github.com/binwiederhier/ntfy | 34427 | **Apache-2.0 或 GPL-2.0 双许可**（GPL 在此**非强制**，可选 Apache-2.0） | Go | 提交 2026-09-23 / v2.28.0 @ 2026-08-27 | ✅ 选 Apache-2.0 分支即可 | LICENSE 为 Apache-2.0 全文；README「License」节：*dual licensed under the Apache License 2.0 and the GPLv2*。**付费托管**：README「ntfy Pro」明确 `as low as $5/month`；**自托管服务器本身完全开源、可商用**（付费仅针对官方托管服务，不限制 self-host） |
| `gotify/server` | https://github.com/gotify/server | 15975 | **MIT** | Go | 提交 2026-09-24 / v3.1.1 @ 2026-09-15 | ✅ | 仓库 LICENSE 为 "MIT License, Copyright (c) 2018 jmattheis"；GitHub HTML license 字段显示 NOASSERTION 是检测问题，**以 LICENSE 原文为准 = MIT** |
| `gotify/android` | https://github.com/gotify/android | 1498 | **MIT** | Java/Kotlin | 提交 2026-07-06 / v2.10.1 @ 2026-07-06 | ✅ | GitHub license 字段直接为 MIT |
| `UnifiedPush/specifications` | https://github.com/UnifiedPush/specifications | 110 | **Apache-2.0** | Ruby/规范文本 | 提交 2025-05-06 / 无 release | ✅ | 描述为 `Mirror of https://codeberg.org/UnifiedPush/specifications`，**主仓在 Codeberg，GitHub 为镜像** |
| `UnifiedPush/android-connector` | https://github.com/UnifiedPush/android-connector | 37 | **Apache-2.0** | Kotlin | 提交 2025-07-01 / 3.0.10 @ 2025-06-12 | ✅ | 同为 Codeberg 镜像 |
| `UnifiedPush/fcm-distributor` | https://github.com/UnifiedPush/fcm-distributor | 30 | **Apache-2.0** | Kotlin | 提交 2025-07-21 / 2.0.1 @ 2025-02-08 | ✅ | GitHub `isArchived:true`，已归档；功能已并入 `android-embedded_fcm_distributor` 等新仓 |
| `UnifiedPush/flutter-connector` | https://github.com/UnifiedPush/flutter-connector | 32 | **Apache-2.0** | Dart | 提交 2025-06-12 / 5.0.2 @ 2024-08-29 | ✅ | Codeberg 镜像 |
| `caronc/apprise` | https://github.com/caronc/apprise | 17384 | **BSD-2-Clause** | Python | 提交 2026-09-25 / v1.13.1 @ 2026-08-31 | ✅ | 多通道通知分发框架（100+ 服务），适合服务端聚合下发 |

**UnifiedPush 生态构成（基于 org 仓库列表 + 各仓描述）**：一个**开放规范**（`specifications`）+ 若干 **connector**（应用侧接入库：Android/Flutter/Go/Dart/Rust/Ruby/Java）+ 若干 **distributor**（承载推送的后台应用，如 `fcm-distributor`、`gotify-android`、`nextpush` 等）。目的是让应用不必绑定 Google FCM，而由用户选择 distributor。许可证统一为 Apache-2.0。

### 平台推送成本（一手来源）

| 项目 | 事实 | 来源 |
|---|---|---|
| **Firebase Cloud Messaging (FCM)** | **No-cost（免费）** —— 定价表 Cloud Messaging 行标注 `No-cost`，且 Spark 计划无成本额度包含 FCM，无需绑定付款方式 | https://firebase.google.com/pricing （curl 抓取，见附录证据 E5） |
| **Apple Developer Program 年费** | **US$99 / 年** —— 页面原文 `Join the Apple Developer Program $99 annual membership` | https://developer.apple.com/programs/ （curl 抓取，见附录证据 E6） |
| **APNs 使用费** | **无额外按量费用**：APNs 不单独计费，前提是持有 Apple Developer Program 会员资格（即上述 $99/年）。**「APNs 本身是否另行收费」的官方独立计费页 = 未核实**（未找到专门定价页，结论建立在上述会员费页面 + 常规认知之上，请勿当作官方逐条声明） | 同上 |

### Cat 5 结论 / 推荐

1. **ntfy 是首选自托管推送服务**：Apache-2.0 可选分支、34k★、活跃。付费档只针对官方托管 `ntfy.sh`，**不影响自托管与商用**，但**发布 iOS 推送仍需经 Apple APNs**（ntfy 客户端走 APNs，这属于客户端/账号侧成本，不改变服务端许可）。
2. **gotify/server 是纯 MIT 的更简洁方案**，但生态与端侧覆盖不如 ntfy；适合 Android/Web。
3. **UnifiedPush** 解决「Android 不依赖 FCM」的合规/隐私问题，规范与连接器全部 Apache-2.0，可放心集成。注意其 GitHub org 多为 **Codeberg 镜像**，贡献/issue 应去 Codeberg。
4. **服务端多通道聚合**用 `apprise`（BSD-2-Clause，17k★），可同时下发 ntfy / Gotify / 邮件 / Webhook。
5. **成本结论**：FCM 免费、Apple 仅 $99/年会员费，推送通道本身没有按条计费成本（APNs 逐条计费页未核实）。

---

## 总体红线清单（必须替换 / 不可嵌入）

| 组件 | 禁止原因 |
|---|---|
| 🟥 `@nextcloud/cdav-library` | AGPL-3.0-or-later —— **必须替换**（网络条款传染） |
| 🟥 `nextcloud/server` | AGPL-3.0 |
| 🟥 `bitfireAT/davx5-ose` | GPL-3.0（其库 dav4jvm 为 MPL-2.0，可单独用） |
| 🟥 `minicaldav`（Rust crate） | GPL-3.0-or-later |
| 🟥 `Kozea/Radicale` | GPL-3.0 —— 仅可独立自托管，禁止嵌入/再分发 |
| 🟥 `sabre-io/Baikal` | GPL-3.0 —— 同上 |
| 🟥 `stalwartlabs/stalwart` | AGPL-3.0-only 或专有 SELv2（AGPL 网络条款） |
| ⚠️ `Peltoche/ical-rs` | 已归档，且 crates.io 标注 `non-standard` 与仓库 Apache-2.0 冲突 |

---

## 附录：原始证据

### E1. `ghinfo.py` 输出（TSV，逐字）

第一批（客户端）：
```
repo	stars	forks	license	archived	branch	last_commit	latest_release	top_lang	desc	topics
nextcloud/cdav-library	73	16	AGPL-3.0 (GNU Affero General Public License v3.0)	false	main	2026-09-22T12:03:51Z	v2.8.0 @ 2026-09-01T10:28:25Z	javascript: 99.3%	:date: 📇 CalDAV and CardDAV client library for JavaScript	caldav,carddav,cdav-library,javascript,js,library,nextcloud,rfc4791,rfc6352
perry-mitchell/webdav-client	818	156	MIT (MIT License)	false	master	2026-09-19T11:29:24Z	v5.11.0 @ 2026-09-19T11:29:24Z	typescript: 98.4%	WebDAV client written in Typescript for NodeJS and the browser	browser,dav,davfs,javascript,nodejs,webdav,webdav-client
python-caldav/caldav	413	112	Apache-2.0 (Apache License 2.0)	false	master	2026-09-21T23:38:11Z	v3.3.1 @ 2026-09-16T06:30:52Z	python: 96.4%		
pimutils/vdirsyncer	1880	185	NOASSERTION (Other)	false	main	2026-09-03T16:12:26Z	v0.21.0 @ 2026-09-04T00:28:21Z	python: 98.6%	📇 Synchronize calendars and contacts.	caldav,calendar,carddav,cli,contacts,icalendar,pim,python,sync,synchronisation,tasks,todo,vcard,vevent,vobject,vtodo,webdav
pimutils/khal	3056	234	MIT (MIT License)	false	master	2026-09-23T16:31:31Z	v0.14.1 @ 2026-08-21T06:24:39Z	python: 99.8%	:calendar: CLI calendar application	calendar,icalendar,python,terminal
```
```
repo	stars	forks	license	archived	branch	last_commit	latest_release	top_lang	desc	topics
natelindev/tsdav	355	58	MIT (MIT License)	false	main	2026-09-19T16:54:42Z	v2.3.4 @ 2026-09-19T16:55:52Z	typescript: 99.6%	WebDAV, CALDAV, and CARDDAV client for js runtimes and the Browser	...
KlautNet/ts-caldav	29	13	MIT (MIT License)	false	main	2026-08-23T23:01:11Z	v0.4.2 @ 2026-08-23T23:03:39Z	typescript: 99.7%	A lightweight and robust CalDAV client for Node.js applications	...
forwardemail/caldav-adapter	35	10	MIT (MIT License)	false	master	2026-09-01T06:36:30Z	v9.4.0 @ 2026-09-01T06:36:45Z	javascript: 99.9%	CalDAV server for Node.js and Koa.	...
ssyuk/caldav	1	3	MIT (MIT License)	false	main	2026-06-13T11:32:17Z	NO-RELEASES @ NA	dart: 100.0%	A comprehensive CalDAV client for Dart.	...
flymzero/webdav_client	67	71	BSD-3-Clause (BSD 3-Clause \)	false	main	2024-05-12T15:03:51Z	1.2.0 @ 2023-02-23T12:23:36Z	dart: 91.2%	A dart WebDAV client library	dart,flutter,webdav,webdav-client
```

Java/Kotlin/Go：
```
repo	stars	forks	license	archived	branch	last_commit	latest_release	top_lang	desc	topics
bitfireAT/dav4jvm	104	24	MPL-2.0 (Mozilla Public License 2.0)	false	main	2026-09-24T14:06:59Z	4.1.0 @ 2026-09-01T15:49:39Z	kotlin: 100.0%	WebDAV (including CalDAV, CardDAV) library for the Java virtual machine (Java/Kotlin)	caldav,carddav,webdav
bitfireAT/davx5-ose	2897	136	GPL-3.0 (GNU General Public License v3.0)	false	main	2026-09-24T13:45:18Z	v4.5.20-beta.2-ose @ 2026-09-16T12:06:36Z	kotlin: 97.9%	DAVx⁵ is an open-source CalDAV/CardDAV suite and sync app for Android.	...
ical4j/ical4j	837	219	BSD-3-Clause (BSD 3-Clause \)	false	develop	2026-09-25T04:58:40Z	ical4j-4.3.0 @ 2026-06-27T00:26:47Z	java: 86.2%	A Java library for parsing and building iCalendar data models	icalendar,java,library,scheduling
emersion/go-webdav	498	110	MIT (MIT License)	false	master	2026-06-28T10:28:23Z	0.7.0 @ 2025-10-18T08:57:16Z	go: 100.0%	A Go library for WebDAV, CalDAV and CardDAV	caldav,carddav,filesystem,http,ical,vcard,webdav
arran4/golang-ical	415	88	Apache-2.0 (Apache License 2.0)	false	master	2026-08-18T10:42:38Z	v0.3.6 @ 2026-08-18T10:43:25Z	go: 100.0%	A  ICS / ICal parser and serialiser for Golang.	golang,ical,ics,library
emersion/go-ical	72	20	MIT (MIT License)	false	master	2025-06-09T11:28:44Z	NO-RELEASES @ NA	go: 100.0%	An iCalendar library for Go	calendar,ical,icalendar,ics
```

服务器：
```
repo	stars	forks	license	archived	branch	last_commit	latest_release	top_lang	desc	topics
Kozea/Radicale	5044	527	GPL-3.0 (GNU General Public License v3.0)	false	master	2026-09-24T06:56:23Z	3.8.1 Fixes+Improvements+Extensions @ 2026-09-25T03:26:26Z	python: 87.8%	A simple CalDAV (calendar) and CardDAV (contact) server.	caldav,carddav,icalendar,python
sabre-io/Baikal	3320	319	GPL-3.0 (GNU General Public License v3.0)	false	master	2026-08-13T20:02:23Z	0.12.1 @ 2026-08-05T13:17:37Z	php: 87.1%	Baïkal is a Calendar+Contacts server	
sabre-io/dav	1723	372	BSD-3-Clause (BSD 3-Clause \)	false	master	2026-08-02T12:31:39Z	Release 4.7.1 @ 2026-07-07T08:40:23Z	php: 99.0%	sabre/dav is a CalDAV, CardDAV and WebDAV framework for PHP	
nextcloud/server	36910	5247	AGPL-3.0 (GNU Affero General Public License v3.0)	false	master	2026-09-25T00:28:24Z	v35.0.1 @ 2026-09-24T13:54:44Z	php: 57.2%	☁️ Nextcloud server, a safe home for all your data	...
stalwartlabs/stalwart	14804	962	NA	false	main	2026-09-24T18:22:07Z	v0.16.23 @ 2026-09-21T09:57:07Z	rust: 98.0%	All-in-one Mail & Collaboration server...	caldav,carddav,imap,jmap,mail,pop3,rust,server,smtp,webdav
```
> 注：`ckulka/baikal` 返回 `FETCH_ERROR:HTTP Error 404`，正确 slug 为 `sabre-io/Baikal`。

iCal 解析：
```
repo	stars	forks	license	archived	branch	last_commit	latest_release	top_lang	desc	topics
kewisch/ical.js	1179	158	MPL-2.0 (Mozilla Public License 2.0)	false	main	2026-09-17T11:28:52Z	v2.2.1 @ 2025-08-08T06:10:15Z	javascript: 98.3%	Javascript parser for ics (rfc5545) and vcard (rfc6350) data	ical,icalendar,jcal,jcard
mozilla-comm/ical.js	1179	158	MPL-2.0 (Mozilla Public License 2.0)	false	main	2026-09-17T11:28:52Z	v2.2.1 @ 2025-08-08T06:10:15Z	javascript: 98.3%	（与 kewisch/ical.js 同一仓库：数字完全一致，为 fork/镜像关系）
collective/icalendar	1174	436	NOASSERTION (Other)	false	main	2026-09-23T16:58:50Z	v7.3.0 @ 2026-08-20T05:46:53Z	python: 99.2%	icalendar parser library for Python	alarm,event,generator,hacktoberfest,icalendar,ics,journal,parser,rfc5545,todo
Peltoche/ical-rs	109	30	Apache-2.0 (Apache License 2.0)	true	master	2024-08-17T17:46:13Z	v0.11.0 @ 2024-03-13T05:36:12Z	rust: 74.4%	Rust parser for ics (rfc5545) and vcard (rfc6350)	ical,parser,rust,rust-library,vcard
jens-maus/node-ical	170	65	Apache-2.0 (Apache License 2.0)	false	master	2026-09-13T19:36:22Z	0.27.2 @ 2026-09-13T19:35:52Z	javascript: 97.6%	Feature-rich iCalendar/ICS (RFC 5545) parser for Node.js	ical,icalendar,ics,nodejs,npm,rrule
hoodie/icalendar	189	45	Apache-2.0 (Apache License 2.0)	false	main	2026-07-28T19:23:15Z	v0.17.13 @ 2026-07-28T19:25:08Z	rust: 98.8%	📆 icalendar library, in Rust of course	calendar,icalendar,library,rust
pimalaya/ical	1	0	Apache-2.0 (Apache License 2.0)	false	master	2026-09-02T21:20:21Z	v0.5.1 @ 2026-09-02T21:20:28Z	rust: 97.9%	iCalendar parser, validator, editor, merger and builder library for Rust	...
```

推送：
```
repo	stars	forks	license	archived	branch	last_commit	latest_release	top_lang	desc	topics
binwiederhier/ntfy	34427	1617	Apache-2.0 (Apache License 2.0)	false	main	2026-09-23T23:13:22Z	v2.28.0 @ 2026-08-27T20:38:30Z	go: 72.6%	Send push notifications to your phone or desktop using PUT/POST	curl,notifications,ntfy,ntfysh,pubsub,push-notifications,rest-api
gotify/server	15975	881	NOASSERTION (Other)	false	master	2026-09-24T04:20:59Z	v3.1.1 @ 2026-09-15T18:45:27Z	go: 68.9%	A simple server for sending and receiving messages in real-time per WebSocket.	...
gotify/android	1498	218	MIT (MIT License)	false	master	2026-07-06T15:37:07Z	v2.10.1 @ 2026-07-06T15:48:06Z	java: 51.8%	An app for creating push notifications for new messages posted to gotify/server.	...
caronc/apprise	17384	668	BSD-2-Clause (BSD 2-Clause \)	false	master	2026-09-25T00:48:52Z	Release v1.13.1 @ 2026-08-31T22:23:58Z	python: 99.7%	Apprise - Push Notifications that work with just about every platform!	...
UnifiedPush/specifications	110	6	Apache-2.0 (Apache License 2.0)	false	main	2025-05-06T15:00:32Z	NO-RELEASES @ NA	ruby: 100.0%	Mirror of https://codeberg.org/UnifiedPush/specifications	
UnifiedPush/android-connector	37	9	Apache-2.0 (Apache License 2.0)	false	main	2025-07-01T06:25:09Z	3.0.10 @ 2025-06-12T12:20:39Z	kotlin: 71.7%	Mirror of https://codeberg.org/UnifiedPush/android-connector/	
UnifiedPush/fcm-distributor	30	1	Apache-2.0 (Apache License 2.0)	true	main	2025-07-21T07:33:37Z	2.0.1 @ 2025-02-08T11:38:41Z	kotlin: 100.0%	Mirror of https://codeberg.org/UnifiedPush/fcm-distributor	
UnifiedPush/flutter-connector	32	11	Apache-2.0 (Apache License 2.0)	false	main	2025-06-12T15:05:47Z	5.0.2 @ 2024-08-29T16:21:49Z	dart: 57.5%	Mirror of https://codeberg.org/UnifiedPush/flutter-connector	
UnifiedPush/documentation	45	28	Apache-2.0 (Apache License 2.0)	true	main	2025-05-04T10:40:04Z	NO-RELEASES @ NA	html: 91.4%	Documentaton about UnifiedPush - Mirror of https://codeberg.org/UnifiedPush/documentation
```

### E2. 精确 LICENSE 文本抓取（`raw.githubusercontent.com/.../HEAD/LICENSE`）

```
===== nextcloud/cdav-library =====
--- LICENSE ---
                    GNU AFFERO GENERAL PUBLIC LICENSE
                       Version 3, 19 November 2007
 Copyright (C) 2007 Free Software Foundation, Inc. <http://fsf.org/>
```
```
===== gotify/server =====
--- LICENSE ---
MIT License
Copyright (c) 2018 jmattheis
```
```
===== pimutils/vdirsyncer =====   （确认第 3 条 = BSD-3-Clause）
Copyright (c) 2014-2020 by Markus Unterwaditzer & contributors. ...
* The names of the contributors may not be used to endorse or
  promote products derived from this software without specific
```
```
=== ical4j LICENSE.txt head ===
BSD 3-Clause License
Copyright (c) 2012, Ben Fortuna
```
```
=== kewisch/ical.js LICENSE head ===
Mozilla Public License Version 2.0
==================================
```
```
=== icalendar pyproject license ===
license = "BSD-2-Clause"
license-files = ["LICENSE.rst"]
```
```
=== sabre-io/dav LICENSE head ===
Copyright (C) 2007-2016 fruux GmbH (https://fruux.com/).
All rights reserved.
Redistribution and use in source and binary forms ... （BSD 三条款）
```
``` 
=== ntfy LICENSE head ===
                                 Apache License
                           Version 2.0, January 2004
```
```
=== node-ical LICENSE head ===
                                 Apache License
                           Version 2.0, January 2004
```

### E3. stalwart 双许可（README「License」节原文）

```
This project is dual-licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0 ...)
and the **Stalwart Enterprise License v2 (SELv2)**:
- The [GNU Affero General Public License v3.0](./LICENSES/AGPL-3.0-only.txt) ...
- The [Stalwart Enterprise License v2 (SELv2)](./LICENSES/LicenseRef-SEL.txt) is a proprietary license ...
```
仓库根目录含 `LICENSES` 目录，其中 `AGPL-3.0-only.txt`、`LicenseRef-SEL.txt`（REUSE 规范）。

### E4. 包注册表元数据（npm / PyPI / crates.io / pub.dev）

```
=== npm @nextcloud/cdav-library ===  license: AGPL-3.0-or-later   version: 2.8.0
=== npm webdav ===                    license: MIT                version: 5.11.0
=== npm ical.js ===                   license: MPL-2.0            version: 2.2.1
=== npm tsdav ===                     license: MIT  version: 2.3.4  repo: natelindev/tsdav
=== npm ts-caldav ===                 license: MIT  version: 0.4.2
=== npm caldav-adapter ===            license: MIT  version: 9.4.0
=== npm node-ical ===                 license: Apache-2.0  version: 0.27.2
--- npm dav ---                       license: MPL-2.0  version: 1.8.0
--- npm dav-request ---               license: MPL-2.0  version: 1.9.0
```
```
=== PyPI icalendar ===  icalendar 7.3.0 | license classifier: BSD License
=== PyPI caldav ===     caldav 3.3.1 | (classifier 未列 license)
```
```
--- crates libdav/0.11.0 ---        license: ISC            created: 2026-09-05
--- crates minicaldav/0.8.0 ---     license: GPL-3.0-or-later  created: 2023-07-02
--- crates ical/0.11.0 ---          license: non-standard    created: 2024-03-13
--- crates icalendar/0.17.13 ---    license: MIT/Apache-2.0
--- crates ical-rs/0.5.1 ---        license: MIT OR Apache-2.0
```
```
----- pub.dev/caldav -----          version 1.5.0  published 2026-06-13  tags: license:mit
----- pub.dev/webdav_client -----   version 1.2.2  published 2024-05-12  tags: license:bsd-3-clause
----- pub.dev/webdav -----          version 1.0.8-dev  published 2020-07-06  tags: license:unlicense
----- pub.dev/icalendar -----       version 0.1.3  published 2023-01-10  tags: license:bsd-3-clause
----- pub.dev/ical -----            version 0.2.2  published 2021-11-23  tags: license:bsd-3-clause
```

### E5. FCM 定价原文（firebase.google.com/pricing，curl 抓取后去标签）

```
... Cloud Messaging (FCM) No-cost ...
... A/B Testing, Analytics, App Check, App Distribution, Cloud Messaging (FCM),
    Crashlytics, In-App Messaging, and Performance Monitoring.
    Generous no-cost usage limits ... No payment method needed No-cost (Spark plan) ...
```

### E6. Apple Developer Program 费用原文（developer.apple.com/programs/，curl 抓取后去标签）

```
... ment to register for free. Create your account Join the Apple Developer Program
    $99 annual membership Includes all Apple developer account benefits ...
```

### E7. VTODO / VALARM 支持证据（源码 grep）

```
ical4j VToDo.java -> HTTP 200   VTODO matches: 34
  https://raw.githubusercontent.com/ical4j/ical4j/HEAD/src/main/java/net/fortuna/ical4j/model/component/VToDo.java
ical.js component.js -> HTTP 200  VTODO matches: 0
ical.js design.js:
  984:   * @property {designSet} vtodo       iCalendar VTODO
  1003:    vtodo: icalSet,
collective/icalendar:
  src/icalendar/cal/todo.py 首行: """:rfc:`5545` VTODO component."""
  src/icalendar/__init__.py 导出: from icalendar.cal.todo import Todo ...
  src/icalendar/alarms.py:
    20: from icalendar.cal.todo import Todo
    37: Parent = Event | Todo
arran4/golang-ical components.go:
   16: // - *VTodo
  745: type VTodo struct {
  767: func NewTodo(uniqueId string) *VTodo {
  README: alarm := ics.NewAlarm("") ... alarm.SetTrigger("-PT15M")
emersion/go-ical ical.go -> VTODO matches: 0
node-ical ical.js:
  239: // Recurrence rules are only valid for VEVENT, VTODO, and VJOURNAL.
  243: if (['VEVENT','VTODO','VJOURNAL'].includes(value) && curr.rrule) {
```

### E8. UnifiedPush org 仓库清单（github.com/orgs/UnifiedPush/repositories）

```
android-connector, android-connector-ui, android-embedded_fcm_distributor,
android-example, android-foss_embedded_fcm_distributor, common-proxies, contrib,
dart-webpush-encryption, documentation, fcm-distributor, flutter-connector,
flutter-connector-webpush, go_dbus_connector, gotify-android, gotify-dbus-rust,
service-status, specifications, wishlist
```

---

*本文件所有 Star / License / 日期数据均来自 2026-09-25 本会话内实际执行的工具调用；无法一手核实处已标 `未核实`。*
