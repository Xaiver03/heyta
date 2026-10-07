# ADR-0057：系统运行时库的**动态链接**不在 §3.2 的禁止面内（Linux 原生壳的许可立场）

> 状态：**已接受**
> 日期：2026-10-06
> 取代：**无**。本 ADR **定义适用范围**，不推翻任何一份既有决定 ——
> 它把 [ADR-0034](0034-windows-native-winui3-not-rnw.md) / [ADR-0037](0037-desktop-ui-falls-back-to-webview.md)
> 在 Linux 上必然带进来的那类依赖（发行版提供的系统运行时）与"我们把第三方代码放进产品"这两件事分开。
> **不改** [ADR-0040](0040-email-password-auth-decoupled-from-e2ee.md) 的"Linux 不做钥匙串"。

---

## 1. 问题不是"要不要引入 LGPL"，而是"这一格从来没人登记过"

先说实测到的事实，因为它决定了这份 ADR 该写什么：

| 事实 | 出处 |
|---|---|
| Linux 壳链 `gtk4 / javascriptcoregtk-4.1 / sqlite3` 三枚系统库 | `apps/desktop-linux/Makefile:14` |
| `.deb` 的运行时依赖写着 `libgtk-4-1, libjavascriptcoregtk-4.1-0, libsqlite3-0` —— **已经在发出去了** | `apps/desktop-linux/scripts/package-deb.sh:111` |
| 🔴 其中 **只有 GTK4** 落在 LGPL 上（`Files: *` 逐字是 `LGPL-2+ and LGPL-2.1+ and … Expat and BSD-3-clause-Google and Apache-2.0 and CC0-1.0 and ZPL-2.1`）；JavaScriptCoreGTK 的整包默认许可是 **BSD-2-clause**；sqlite3 是 public-domain | 那台 Ubuntu 24.04 上 `/usr/share/doc/<pkg>/copyright` 原文（2026-10-06 现量，复现命令在 [登记册](../reference/native-library-licenses.md)"怎么复现这三行"一节）。⚠️ **本行同日更正过一次**：第一版这里写的是"GTK4 与 JavaScriptCoreGTK 的许可都是 LGPL-2.1-or-later" —— 那是把上游的说法当成了发行版那份的写法。实测那份的 `Files: *` 是 `License: BSD-2-clause`，并带一句 "The default license of WebKit is BSD 2-clause. The exceptions are listed in the sections that follow."，37 个例外块里的 LGPL/GPL 全是 `or` 形态的多许可 |
| 许可证门禁扫的是**实际安装的 npm/NuGet 依赖树**，系统库既不在 package.json 也不在 lockfile | `research/tools/license-inventory.mjs` 的 `STORES`（只有两枚 pnpm store）与 `license-policy.mjs` |

⇒ 也就是说：**AGENTS §3.2 那两句话（"每个依赖必须逐项登记"与"LGPL 禁止进入产品代码"）在这三条依赖上，前一句从来没被满足，后一句从来没被真正判断过。**
⚠️ 那句更正把这份 ADR 的**对象收窄了**：真踩在 §3.2 禁止面上的只有 **GTK4 一枚**（JSC 按 BSD 本来就在允许面上）。
🔴 **裁决没变**：四条判定线、双向对账、逐枚登记出处都不依赖"几枚是 LGPL"，而依赖"这些库已经随包发出去却没人登记"那个实测事实。
仓库里另一处同类问题已经修过一次：`license-inventory.mjs` 的文件头记着"只扫根 store 时 Playwright 完全不可见，`check:licenses` 绿着而它根本没看过那个包"，
以及"生成物漏掉整棵 React Native 子树（315 → 908）"。**同一类失效的第三个面目就是系统库这一册。**

## 2. 决策

**把发行版提供的系统运行时库经动态链接使用，不算"进入产品代码"。** 它落在 §3.2 的禁止面之外，
但**必须**逐项登记并由判据对账 —— 少任何一半都会退化成一句口号。

四条判定线，**必须同时成立**（少一条就不属于这一类，要按 §3.2 原样过门）：

1. **不进产物**：我们分发的包里不许出现它的 `.so` / `.dll`；产物里只出现**包名依赖**（`Depends`）。
2. **不静态链**：链的是发行版那份动态库 ⇒ 用户换掉那份库就能换掉实现，这是 LGPL 允许动态链接的核心语义。
3. **不改上游**：不 fork、不打补丁、不把它任何源码复制进仓库。（真要做，那份**代码**就变成产品代码，按 §3.2 原样判定。）
4. **随发行版走**：由系统包管理器安装与升级，许可与版权说明由发行版携带并向用户展示。

并且：

5. **逐项登记**：每一枚都要在 [`docs/reference/native-library-licenses.md`](../reference/native-library-licenses.md) 里
   写明用途、实测版本、许可**原文出处**、以及这四条为什么成立。登记不是注释 —— 它有判据。
6. **对账**：`research/tools/check-native-lib-registry.mjs` 双向钉住「`.deb` 的 `Depends`」与「登记册」
   （发出去的每枚都必须登记；登记的每行都必须仍然在发 ⇒ **表只能跟着现实变小，不许攒旧账**），
   锚点取不到时**响亮失败**而不是按"没有依赖"放行。它由 `pnpm check:linux-shell` 调用，
   且刻意放在该门禁所有平台分支**之前** —— 这条对账读的是提交物文本，不需要 GTK、不需要 Linux，
   没有任何理由只在某一台机器上执行。
7. **只有宽松或本类才准入**：许可列必须落在登记册声明的类别里。`GPL-2+` 单独存在（没有 public-domain /
   LGPL 选项）的库**不属于本类**，要另写 ADR —— 本 ADR 不替它开路。

## 3. 为什么这不是"给 §3.2 开个口子"

同一条立场在本仓**已经被接受过两次**，只是没人把它写成一般规则：

| 端 | 用的系统运行时 | 它怎么被登记的 |
|---|---|---|
| macOS 壳 | 系统自带的 WebKit / JavaScriptCore / libsqlite3 | 平台自带，无需登记（`apps/desktop-macos` 零第三方依赖那条结论的来源） |
| Windows 壳 | WebView2 运行时 + Windows App SDK（许可是许可文件、无 SPDX 标识符） | `license-policy.mjs` 的 `REVIEWED_LICENSE_FILE_PACKAGES` **逐条带理由登记** |
| Linux 壳 | GTK4 / JavaScriptCoreGTK / sqlite3 | 🔴 **此前：没有登记。现在：本 ADR + 那份表 + 那判据** |

⇒ 本 ADR 做的事是把 WebView2 那套"平台组件逐条登记"的做法**推广到 Linux**，
而不是新造一个例外。Windows 那枚先例连许可字符串都不是 SPDX，照样发了 ——
差别只在它**有登记**，而系统库这一册没有。

## 4. 后果

- **解锁 [ADR-0037](0037-desktop-ui-falls-back-to-webview.md) 的 Linux 那一半**：M2 定的是"原生壳 + 壳内 WebView 加载共享 Web UI"。
  Linux 上唯一可用的 WebView 就是 WebKitGTK —— 也就是说 ADR-0037 被接受的那一刻，这一类依赖就已经被隐含接受了，
  只是没人登记。**WebKitGTK 不是新开的一道许可决定。**
- 接线那一刻的**顺序是刻意的**：`libwebkitgtk-6.0-*` 要**连同登记册那一行一起**进来。
  提前登记会让判据立刻红（登记了但没在 `Depends` 里 = 攒旧账）；先接线不登记也红。
  ⇒ 这条对账同时是 P2 的实施顺序约束，不只是合规装饰。
- **不改 AGENTS.md**。§3.2 那张表的措辞读起来像"任何 LGPL 都不行"，与本 ADR 的适用范围不一致。
  同步那句话（"系统运行时库的动态链接见 ADR-0057"）属**规则本体的改动**，
  按仓库纪律要产品负责人在本任务里明确要求才动；在那之前以本 ADR 为准，两份文件的关系在这里写清，
  **不许两份各自按自己的读法漂着**。

## 5. 明确不做的事

- 不引入任何 **GPL-only** 的系统库（见第 2.7 条）。
- 不把系统库 `.so` 打进 `.deb` 或 AppImage —— 那会把"随发行版走"变成"我们自己分发受 LGPL 约束的副本"，
  随之而来的是可重链接（relink）与源码提供义务，那是**另一个决定**。
- 不为了少几行登记就把三枚库折成一行"GTK 全家桶"：登记的粒度就是判据的粒度。
- 不顺手把 NuGet / npm 侧的白名单"统一"进来 —— 唯一真源仍是 `license-policy.mjs`，本 ADR 只管它射程外那一类。

## 6. 判据能不能失败（实测）

`node research/tools/check-native-lib-registry.mjs --self-test` 逐臂证明：
原样绿 / 删一行登记红 / 多一枚未登记的运行时包红 / 登记过期红 / 锚点文件缺失响亮失败 / 表被掏空响亮失败 /
**许可格开头换成 `GPL-3+` 而散文里的宽松名一个字没动 ⇒ 仍要红** / **许可格写成没有标识符的散文 ⇒ 红**，
并且**每一臂先断言"变异体 ≠ 原体"**（臂数以它自己打印的为准，本文件不抄 —— 上一版这里抄了个数字，第二天就过期了）。

🔴 最后那两臂是**同日补的**，起因就是 §1 那条许可更正：登记册现在必须逐字抄发行版 copyright 的聚合写法
（GTK4 那一格里同时出现 `Apache-2.0` 与 `BSD-3-clause-Google`），而判据第 ④ 条原来是
"`includes` 任一宽松名"—— 那种写法下**一枚 GPL-only 的库会因为散文里提到 BSD 而被判绿**。
实测过：拿 GTK4 那行的开头标识符改成 `GPL-3+`，旧判据命中 `BSD` 与 `Apache-2.0` 两枚宽松名 ⇒ 照样报绿；
新判据只取**开头那一个**标识符 ⇒ 红。所以 ④ 的口径是"这行**声明**了哪一类"，不是"这行里出现过哪些词"。

第一版这里有两臂是假的：正则多写了一个前导空格 ⇒ 变异根本没生效，臂"通过"而它没测任何东西。
是那条前置断言把它抓出来的。
