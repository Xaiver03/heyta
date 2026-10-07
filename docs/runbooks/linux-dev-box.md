# Linux 载体操作手册（Ubuntu 24.04）

> 这副手册管的是：**把那台 Ubuntu 24.04 开发机当成 heyta 的 Linux 构建与门禁载体来用**。
> 计划、裁决与工单状态在 [Linux 端适配计划](../plans/linux-adaptation.md)；机器身份（主机名 / 用户 / 地址 /
> ZeroTier 网络）住 [build-matrix.md](../reference/build-matrix.md)，本文件不抄。
>
> ⚠️ 标「未核实」的命令是没在那台机实跑过的；其余每条都有读数。
> 本文件不写会漂的值（SHA、测试条数、镜像末节号）—— 一律给现量命令。

---

## 1. 一次性前置

```bash
# 在载体上，普通用户：只读体检，缺哪格直接点名
bash scripts/linux/setup-build-host.sh --step verify

# 装齐（要 sudo —— 这台机的 sudo 需要密码，所以这一步只能人亲手跑）
sudo bash scripts/linux/setup-build-host.sh --step all
```

`--step` 可单跑：`base`（编译器 + pkg-config）/ `gtk`（GTK4、JavaScriptCoreGTK、sqlite3 的 -dev 包）/
`gui`（Xvfb + ImageMagick 的 `import`）/ `browser`（e2e 那三族门禁要的 Chromium 运行库）。

四步都幂等：先 `dpkg -s`，已就位就不叫 apt。`--step verify` **缺东西会判红**，不是打印一句"建议安装"就走。

### 1.1 此刻这台机上到底缺哪一格（06 17:4x 现量，别照这一节推下周）

免 root 就能取的读数：`apt-cache policy <包>` 打 `已安装：(无)` 的就是缺，`ldconfig -p` 数 SONAME 判断运行库在不在。

| 格 | 读数 | 结论 |
|---|---|---|
| 运行库 `libwebkit2gtk-4.1-0` / `libjavascriptcoregtk-4.1-0` / `libgtk-4` / `libsqlite3` | 四枚 SONAME 都在（`libwebkit2gtk-4.1.so.0` ⇒ 2.52.6），`dpkg -l` 全是 `ii` | ✅ **一行都不用装** —— 它们是 `--step browser`（Playwright Chromium 那批依赖）**顺带带进来的**，不是本单装的 |
| `pkg-config`（24.04 上它是 `pool/main/p/pkgconf/pkg-config_1.8.1…deb`，7 264 B，只 `Depends: pkgconf (>= 1.8.0-7~)`；`pkgconf` 自己 `Provides: pkg-config`） | 两个包名都查到 `已安装：(无)`，候选 1.8.1-2build1 | ❌ 缺 ⇒ 壳门禁的编译分支现在就卡在这。**装 `pkgconf` 就够**（带 `pkg-config` 的虚名），装 `pkg-config` 会顺带把它拉进来 —— 两个写法都对，不是二选一的另一枚工具 |
| `libgtk-4-dev` | `已安装：(无)`，候选 4.14.5+ds-0ubuntu0.10 | ❌ 缺 |
| `libjavascriptcoregtk-4.1-dev` | `已安装：(无)`，候选 2.52.6-0ubuntu0.24.04.1 | ❌ 缺 |
| `libsqlite3-dev` | `已安装：(无)`，候选 3.45.1-1ubuntu2.8 | ❌ 缺 |
| `libwebkit2gtk-4.1-dev`（批二 P2 才需要） | `已安装：(无)`，候选 2.52.6-0ubuntu0.24.04.1 | ❌ 缺 |
| `build-essential` / `dpkg-dev` | 已装（12.10ubuntu1 / 1.22.6ubuntu6.6） | ✅ 编译器与 `.deb` 打包器都在 |

🔴 **一次读数我读错了两次，都记在这儿免得重犯**：
① `dpkg-query -W` 对"包名不在 db 里"和"没装"都失败 —— 我第一版把它打印成"未装"，
   而 `pkg-config` 与 `pkgconf` 是**两个都存在的包**（前者只是 7 KB 的转介包），
   **必须用 `apt-cache policy` 把两个名都查一遍**再下结论；
② 数运行库我第一次 grep 的是 `libwebkit2gtk-4.1.so.375` —— 那是 **4.0** 的 SONAME，
   4.1 的是 `.so.0`（实测）。拿错 SONAME 会得出"运行库没装"，而它装着。

### 1.2 那行 sudo 现在能缩成两行（体积是量的，不是拍的）

`apt-get install --print-uris` **不需要 root**，所以下载体积可以事先量出来给人拍板：
上面六枚缺包一起装 = **101 个 `.deb`、约 54.9 MB**（06 17:4x 现量；重取同一条命令即可）。

```bash
# 批一收口用：让壳门禁第一次真编译 + 冒烟
sudo apt-get install -y pkg-config libgtk-4-dev libjavascriptcoregtk-4.1-dev libsqlite3-dev
# 批二 P2 起跑用：M2 需要的 WebKitGTK 开发头（运行库 §1.1 已证在车上）
sudo apt-get install -y libwebkit2gtk-4.1-dev
```

🔴 **上面这两行不该被手抄成清单。** `--step gtk` 装的就是 `apps/desktop-linux/Makefile` 里 `PKGS`
那几枚模块对应的 `-dev` 包，同源可自查：

```bash
node scripts/linux/shell-modules.mjs --pairs     # 模块名<TAB>包名，逐枚
bash scripts/linux/setup-build-host.sh --step verify
```

⇒ P2 给壳加 `webkit2gtk-4.1` 时，**只改 Makefile 会红**（映射表里没有它），只改映射表不会漏装。
这一格洞的自检证据在计划 §3 的 E11；`--step verify` 现在也不会再把"没有 pkg-config"
报成"三枚 -dev 包都缺"（那种读数会让人多装两个包）。

🔴 **P1 已裁决，§1 这一段旧话要按 [ADR-0057](../adr/0057-native-system-library-linking.md) 读**：
原文写的是"故意不装 `libwebkitgtk-6.0-dev`（LGPL）等 P1 裁决"。今天的答案是
**装 4.1 那一代**（`libwebkit2gtk-4.1-dev`），理由不是 LGPL 被放行，而是 ADR-0057 那四条判定线
（不进产物 / 不静态链 / 随发行版走 / 逐项登记）把"系统运行时库的动态链接"划成了一类。
⚠️ 但**登记与接线必须同批**：这张登记册有双向对账，先往 `.deb` 的 `Depends` 加 webkit 而不加登记行会红，
反过来先加登记行而 `Depends` 里没有它也会红（见 `docs/reference/native-library-licenses.md` 的判据 ①②）。

### 1.3 没有 sudo 也能把编译链装齐：用户态前缀（07 03:0x 实测，这条把 §1.2 变成可选项）

§1.2 那两行 `sudo` 一直没人跑（sudo 要口令，而这条约束不接受我索取口令）。
但 **`apt-get install --print-uris` 不需要 root** —— 于是"下载 + `dpkg -x` 解到用户态目录"
这条路能把同一份清单搬进 `$HOME`，**一个字节都不碰系统**。脚本：
`scripts/linux/provision-user-prefix.sh`（清单仍然同源：`node scripts/linux/shell-modules.mjs --debs`）。

```bash
bash scripts/linux/provision-user-prefix.sh            # 装到 ~/heyta-linux-prefix
source ~/heyta-linux-prefix/env.sh                     # 新 shell 里也要这一句
bash scripts/linux/provision-user-prefix.sh --verify   # 只体检，不装
bash scripts/linux/provision-user-prefix.sh --with-x11 # 还要 Xvfb（M2 窗口那一档要它）
```

07 03:05 现量（复用缓存那一趟）：闭包 **94 枚 `.deb`**、解包 **95** 枚、**118 枚 `.pc`**、
重建悬空软链 **92 条 / 2 趟 / 复核仍悬空 0 条**、`--verify` 四枚模块全绿、整趟 **1.8 s**；
从零下载那一趟是 72 s、约 53 MB。装完之后 `HEYTA_REQUIRE_LINUX_SHELL=1 pnpm check:linux-shell`
第一次在这台载体上真跑到 M2 那一档（读数见 §5.7）。

🔴 三个坑，每一个的症状都是"看起来装好了"：

1. **`-dev` 包里的 `lib*.so` 是指向 `.so.N` 的悬空软链** —— 运行时库在系统目录里，
   而 `dpkg -x` 只解包不装。必须**多趟**重链（一趟不够：链的链），并且**重链之后重新数一遍**
   （第一版是拿重链前的计数判断"还剩几个悬空"，于是那句 ⚠️ 打印出来是个空列表 ——
   一个"报告问题"的分支自己就是坏的）。
2. **`PKG_CONFIG_SYSROOT_DIR` 必须设**：`.pc` 里的 `libdir` 是 `/usr/lib/x86_64-linux-gnu` 这种
   绝对路径，不设 sysroot 就会去链系统里那枚（这台机上恰好也在，于是**测试通过但测的不是前缀**）。
3. **脚本自己不 export 那些变量**，只有它写出的 `env.sh` 里有 —— 所以"自检"的方式就是
   `source env.sh` 之后再验（等价于一个全新 shell）。第一版在脚本里 export 完直接验，
   报的是"前缀可用"，而新开一个 shell 什么都不认。

⚠️ 边界：前缀解决的是**编译期与 pkg-config**。运行期要系统集成的那些（GSettings schema、
gio modules、bubblewrap）不在里面 —— M2 的运行取证因此仍然需要系统那套 WebKitGTK（这台机上装着，
见 §5.7 的 `dpkg -l` 读数）。这一条也不是"给用户装 heyta"的通道，只是载体的 provisioning。


## 2. 三条只会以同样方式再踩的坑（都实测过）
1. **非交互 SSH 不读 `~/.profile`** ⇒ `command -v node` 读成 MISSING，而登录 shell 里有货。
   正确姿势：`ssh <载体> 'bash -lc "…"'`。
   实测：`command -v node` 空，`bash -lc 'command -v node'` 给出 `~/.local/bin/node`（v24）。
   `setup-build-host.sh --step verify` 已经把这一格做成两种读数分开报，别再把 PATH 问题写成"这台机没装 Node"。
2. **判主机死活要看 TCP 那一侧**。这台机 `ping` 回 100% 丢包而同一时刻 SSH 正常进出。
   两条通道一起取，只看 ping 会把活着的载体判成不可达（AGENTS §7 里"否定结论也要枚举分母"同一族）。
3. **"关空闲挂起"在关键路径上，不是优化项**：GNOME 默认 15 分钟空闲挂起 ⇒ 症状是 ping 丢包 + TCP 超时
   （不是 refused），而网卡默认不开 WoL，只有按键盘能叫醒。
   现量：`gsettings get org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type` 应为 `'nothing'`。

## 3. 依赖通道：三条镜像的实测结论

| 源 | 实测 | 结论 |
|---|---|---|
| `registry.npmjs.org` | 家宽直连超时（DNS 只给 AAAA 记录，机器没有 IPv6 出口） | 不能用 |
| `registry.npmmirror.com` | `@op-engineering/op-sqlite/-/op-sqlite-18.2.5.tgz` → **404** | 不能用（这条在 [ci-and-runner.md](ci-and-runner.md) §12.2 记过，2026-10-06 在真机上复现） |
| `mirrors.cloud.tencent.com/npm` | 同一枚包 200，18.8 MB，实测 ~0.9 MB/s | **采用** |

钉法：在**载体本地的检出根**放一枚 `.npmrc`（不入库，仓库自己的纪律是以官方源为准）：

```bash
printf 'registry=https://mirrors.cloud.tencent.com/npm\n' > ~/heyta/.npmrc
```

⚠️ 用户级 `~/.npmrc` 会盖过 `npm_config_registry` 环境变量 —— 只设 env 不生效，读数会骗人。

## 4. 送源码：tar 形状会缺一块，必须带上 `.git`

```bash
# ① 干净树（HEAD 那一批源码 = 新克隆的语义）
git archive <SHA> | ssh <载体> 'mkdir -p ~/heyta && tar xf - -C ~/heyta'
# ② 🔴 还要带 .git —— 否则链尾的 pnpm -r test 必红
rsync -az .git/ <载体>:heyta/.git/
# ③ 让树与 HEAD 对齐（并行会话随时可能把 Mac 的 HEAD 推走）
ssh <载体> "cd ~/heyta && git checkout -f --detach <SHA>"
```

- **为什么 ② 是必须的**：`@heyta/landing` 有一条判据要求 `origin/main` 这个 ref 真存在
  （它的原文是"工作树里有不算"）。没有 `.git` 时它 `throw`，于是 `pnpm check` 的**最后一段**红，
  而那红是载体形状、不是产品。同一枚坑对 finlaw 那枚 tar 送源码的 gate 载体**同样成立**。
- **为什么顺序是 ①②③ 而不是"传完就行"**：本次实测在 ① 与 ② 之间，Mac 的 HEAD 被并行会话推走了一枚
  ⇒ 树与 `.git` 的 HEAD 不一致，`check:brand-assets` 直接报 `Could not read <oid>`、`check:docs` 报"不是 Git 仓库"。
  ③ 那一步把两者钉回同一枚 SHA，读人才可以说"这批读数属于哪一棵树"。
- ⚠️ **macOS 自带的 rsync 是 2.6.9，不认 `--info=progress2`**：它会打印 usage 并**一个字节都不传**，
  而管道尾的退出码看着像成功。要么用 `rsync -az`，要么按本仓另一条线的做法走 tar-over-ssh。
- 🔴 **06 16:4x 又踩了一次，而且这次的形状不同**：为了改文档我 repeatedly 只 `scp` 单文件到载体，
  **没有重做 ①②③** ⇒ 载体树停在 `10cf58d3`，而 Mac 的 HEAD 在同一小时内已被并行会话推到 `82e0ee6b`、
  `615253f3`。后果是那一轮 `--all` 里 `check:docs` 报 **8 个死链 + 3 处失效章节引用**，
  而**同一枚门禁在 Mac 上报的是另一回事**（只有"本机有、仓库里没有"那一类，零死链、零失效章节）。
  ⇒ 那三条不是 Linux 缺陷，是**树混着两个状态**：载体上的 `git show HEAD:<file>` 读的是旧那一批，
  而我 scp 过去的文档链接指向新那批才有的文件。
  📌 **规则**：增量 `scp` 只够跑**单段探针**；要跑整条链或要写"红段归因"，必须先重做 ①②③，
  并把读数标成"属于 `<SHA> 这棵树 + 哪几枚未提交的自有改动`"。
  ⚠️ 也别拿时间当坐标 —— 这条共享检出上"16:40 那批"这种说法一小时后就没人认得了，只有 SHA 认得。

## 5. 逐段跑链与读数

```bash
# 逐段跑链用仓库里那枚薄工具（段清单从根 package.json 的 check 现读，**不在脚本里抄第二份**）
bash scripts/linux/run-gate-segments.sh --all          # 全链
bash scripts/linux/run-gate-segments.sh               # 只跑 e2e 那族（最可疑的一批，快）
bash scripts/linux/run-gate-segments.sh "pnpm check:image-license"   # 单段
```
它做三件我手工做过、每次都做错的事：段名消毒后**断言日志真的落盘**、用 `mapfile` 而不是
`while read`（否则丢掉没有尾换行的最后一段）、**跑过的段数必须等于清单条数**否则整条判红。
`pnpm check` 本身回答"这链能不能过"，不回答"几段红、各红在哪" —— 归因需要后者。

⚠️ 自己写逐段循环时，**最后一行没有换行会被 `while read` 静默丢掉**（本单第一轮就这么丢过链尾那一段，
而丢的恰好是 `pnpm -r test`）。用 `mapfile -t` 或写文件时补 `\n`，并断言"记录行数 == 段数"。

### 5.1 已取到的读数（Ubuntu 24.04.5 / 内核 7.0.0-38 / 12 线程 / 15 GiB）

| 腿 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile`（21 个 workspace 项目） | ✅ rc=0，5m12s |
| `pnpm -r build` | ✅ rc=0 |
| `pnpm -r typecheck` | ✅ rc=0 |
| `pnpm -r test`（第一轮，无 `.git` 的 tar 载体） | 🔴 rc=1 —— 唯一失败是 `@heyta/landing` 那条要 `origin/main` 的判据，**载体形状、非产品** |
| `pnpm check` 逐段 · 第一轮（tar 载体，无 `.git`） | 96 段里 17 段红 —— 其中 5 段后来被证明是"载体没带 `.git` + 树与 HEAD 不一致"造成的 |
| `pnpm check` 逐段 · 第二轮（§4 的 ①②③ 做完，钉住一枚 SHA） | **96 段全部执行（行数 == 段数）**，10 段真红 + 1 段是我这台装置自己的产物（段名里的 `/` 没消毒 ⇒ 日志没落盘）。归因见 §5.2 |

### 5.2 第二轮那 10 段红的归因

| 归因 | 段 | 处置 |
|---|---|---|
| **载体形状**：e2e 那副独立工作区没装依赖 | `check:ai-e2e`、`check:privacy-consent-e2e`、`check:landing-e2e`、`check:web-storage`、`check:web-migration`（后两格的原文是 `MODULE_NOT_FOUND`，`requireStack` 直接指着 `e2e/package.json`） | 一条 `cd e2e && pnpm install` 覆盖这 5 格；~~再要 Chromium 运行库（§1 `--step browser`）与浏览器二进制~~ 🔴 **这半句已被 §5.4 实测否证**：那台机上 Chromium 的运行库**一枚不缺**（`ldd` 里 `not found` 计数 = 0），真启动直接 `LAUNCH=OK`。要装的只有 GTK4/Xvfb 那一半 |
| **载体形状**：上面那族跑不起来，探针就没报告 | `check:vault-diagnostics` | 同上（它的原文是 "Diagnostic probe did not produce a test report; check the test lock/browser availability"） |
| 🔴 **真·平台差异，且是判据口径** | `check:image-license`：`@node-rs/argon2-linux-x64-gnu@2.2.1` 落在扫描集里 ⇒ 它说"豁免不再成立" | 那条豁免登记是按 macOS 的依赖树量的。**不许本载体代改口径** —— 它要的是"平台专属可选依赖"这一类的逐项裁决，见计划 P1 同族 |
| 🔴 **真·平台差异：探针自己在 Linux 上坏了** | `check:calendar-evidence-rigs`（拆到第三枚 `r17-reshoot-stale.sh --selftest`：臂 a/a3/e 红，症状是"一张取证图消失了却没人报"） | 同一枚装置在 macOS 上 rc=0。归属 calendar/reshoot 那条线；复现：`bash research/tools/r17-reshoot-stale.sh --selftest` 在那台机上跑 |
| **HEAD 级债**（不是 Linux，也不是载体） | `check:md-tables`：`docs/plans/trash-and-archive.md:744` 格内反引号配不成对 | 在这台 Mac 上绿，只因为那棵树里躺着别人**未提交**的修改 —— 干净检出上是红的。归属回收站/归档那条线 |

✅ 第一轮里被误判成"Linux 坏了"、第二轮转绿的：`check:docs`、`check:brand-assets`、`check:detail-pane-evidence-refs`、
`check:detail-pane-slot`、`check:doc-citations`、`check:shell-unicode`、`check:apk-freshness`（这格是真红、真修，见计划的 §2）。

### 5.3 取读数时自己踩的三格（写下来是因为它们都会复现）

1. `echo "$(命令) rc=$?"` —— 命令替换**先**跑，`$?` 就变成那条替换的码（AGENTS §7 第 45 条）。第二次和第三次都是这么把 rc=1 读成 rc=0 的。
2. 逐段循环里 `while IFS= read -r` 会丢**最后一行没有换行符**的那一段 —— 本单第一轮丢的恰好是链尾 `pnpm -r test`。用 `mapfile -t`。
3. 把段名做成日志文件名之前要消毒 `/`：`pnpm --filter @heyta/landing check:entries` 那一段就是因为文件名里带了斜杠而**根本没执行**，却被记成红段。

### 5.4 🔴 第三轮（06 16:2–16:4）：把"Chromium 缺库"那句归因**实测否证**，e2e 族在 Linux 上直接全绿

起因是这条链上唯一还挂着的人为前置（§7 第 1 条那条 sudo）看起来挡住了 e2e 族，
而我 §5.2 里写的是"再要 Chromium 运行库"。**没有先证伪它就把那句写进文档了** —— 这正是本仓
"归因给环境之前先跑一条最便宜的实测"该拦的形状。最便宜的那两条实测分别是：

```bash
bash scripts/linux/probe-chromium-libs.sh
```
现量读数（同那台 Ubuntu 24.04.5 / Playwright 1.63.0 / chromium-1243）：

| 实测 | 读数 |
|---|---|
| `ldd chrome` 里 `not found` 的 soname 数 | **0** —— 运行库一枚不缺 |
| 真启动一次 + `setContent` + 回读文本 | `LAUNCH=OK text=heyta`，`PROBE_RC=0`，**全程零 sudo** |

⚠️ 探针第一版是**我自己写错的**：拿 `require("playwright")` 去探，读出 `MODULE_NOT_FOUND` ——
e2e 的 `package.json` 只声明 `@playwright/test`，`playwright` 是它的传递依赖、
**没有**链到 `e2e/node_modules` 顶层（现量：顶层只有 1 条目 `@playwright`）。
那种读数会被当成"这台机缺东西"，其实是探针用错了模块名。脚本里已把这条写成注释。

装好 e2e 工作区之后（`cd e2e && pnpm install`，这步不需要 sudo；本次报 `Already up to date` 是因为
上一轮已经装过 ⇒ **红段那一次它确实没装**，两轮读数都对，只是当时我没去查第二半句），逐段真跑：

| 段 | 退出码 | 条数读数 |
|---|---|---|
| `pnpm check:e2e-helper-exports` | ✅ 0 | 静态门禁，无条数 |
| `pnpm check:ai-e2e` | ✅ 0 | **281 passed / 2 skipped**（17.2m）；跳的那两条是 `[chromium] tests/desktop-window.spec.ts` 的 Electron 腿（开发构建 + 打包产物）⇒ **Electron 在 Linux 上没有二进制，那族自己选择跳过**，不是红 |
| `pnpm check:privacy-consent-e2e` | ✅ 0 | 7 passed（9.6s） |
| `pnpm check:landing-e2e` | ✅ 0 | 22 passed（1.2m） |
| `pnpm check:web-storage` / `pnpm check:web-migration` | ✅ 0 / ✅ 0 | 上一轮这两格的 `MODULE_NOT_FOUND` 消失 |

⇒ **这批红段的成因只有一条：e2e 那副独立工作区没装依赖**，与 Chromium 运行库无关。
§5.2 那一行已经就地打回原句并改正。批一还挂在前置上的段只剩**需要 GTK4 / Xvfb / pkg-config 的那几格**
（`check:linux-shell` 的编译+冒烟那一半、`check:macos-window` 类的窗口取证在 Linux 上本就不该跑）。

🔴 这一轮同时暴露一条**跨线口径要重记**：`desktop-window.spec.ts` 那两条是 Electron 的
"壳级 GUI 门禁"（AGENTS §2 明写它待退役、由三个原生壳的壳级门禁替换它的断言）。
它在 Linux 载体上是**跳过**而不是执行 —— 这就是为什么批二 P3 的窗口判据必须落到 Linux 原生壳自己身上，
不能指望 Electron 那族替它兜。

### 5.5 第四轮：整条链在 Linux 上的全量读数（可归因）

```bash
ssh linux-dev-lan "bash -lc 'cd ~/heyta && bash scripts/linux/run-gate-segments.sh --all'"
```
它现读 96 段（`段清单来自 package.json 的 check 脚本，现读 96 段`），跑完打印
`SUMMARY segments=… reds=…` 与逐条退出码。**没有读数之前本节不写任何结论** ——
上一节那句"Chromium 缺库"就是没有读数先写造成的。

**这批读数的主语（先写形状，否则读数没法归因）**：

| 项 | 这一轮的值 |
|---|---|
| 载体树 | `615253f3`，按 §4 的 ①②③ 重钉；`git checkout -f --detach` 后 `git status --porcelain --untracked-files=no` = **0 行** |
| 载体上的未提交内容 | 本线 21 枚自有文件（13 枚跟踪修改 + 8 枚未跟踪新文件） |
| 依赖 | `pnpm-lock.yaml` 在 `10cf58d3 → 615253f3` 之间**未变** ⇒ 没有重装 `node_modules` |
| 全链读数 | `SUMMARY segments=96 reds=6` |

### 6 段红的逐条归因（载体 rc / Mac 同门禁 rc）

| 段 | 载体 | Mac | 归因 |
|---|---|---|---|
| `check:image-license` | 1 | 0 | **平台差异，且红在判据自己的平台假设上**：那条豁免的 `why` 原文是"本机（darwin-arm64）的 pnpm store 里没有它"（`check-image-license-coverage.mjs:90`）—— 它锚在**写它的那台机**上。Linux 上 pnpm 会装可选原生变体 ⇒ 它进了扫描集 ⇒ 判据报"删掉这条登记"。🔴 **但照它说的删会让 Mac 红**：快照里有这一条（`server/image-npm-tree.json` 命中 1），Mac 扫描集里没有 ⇒ 走到 `:512` 那个算术恒等式就"计数不闭合"（这是读码推论，未做变异复现）。⇒ 要的是**按平台分档**，不是删除。判据口径属别线，未代改。 |
| `check:docs` | 1 | 1 | **不是 Linux 读数，是"整仓还没到可提交状态"**：载体报 12 死链 + 2 处章节失效，**全部指向别线未入库的文档**（目标文件在 Mac 是 `A`/`AM`）。判据：那 12 条链接行在 `git show HEAD:docs/README.md` 与 `HEAD:docs/plans/README.md` 里 **0 命中** ⇒ 它们只活在 Mac 工作树里，而我送上去的是共享文档的工作树版本（索引行过去了、目标文件没过去）。另有 7 条"本机有、仓库里没有"指向本线那 4 枚未提交文档 ⇒ 随提交自动消。 |
| `check:md-tables` | 1 | 0 | **HEAD 级债**：`docs/plans/trash-and-archive.md:744`（第 5 格反引号配不成对）在 **HEAD 里是坏的**，别线工作树已修未提交 ⇒ 于是 Mac 绿、载体红。载体这格读的是真·干净检出，读得对。 |
| `check:calendar-evidence-rigs` | 1 | 三段子脚本分别 rc=0（`pass=36 fail=0`、`pass=16 fail=0`、`SELFTEST=OK`） | **Linux 可移植性缺陷，外加顺带照出的一类假绿** —— 见下一节，那是本轮真正的产出。 |
| `check:shell-unicode` | 1 | 1 | 载体红名单**从 2 枚降到 1 枚**：本线那一处（`scripts/linux/run-gate-segments.sh:87` 的 `rc=$rc（日志：$log）`）当场修掉并复跑证明（同一趟里 `docs` 的章节失效也从 3 → 2，另一处是本线的 `§12.3` 死引用 —— 那一节只存在于别线未提交版本，已改指 §8 那张点名跳过表，两版都在）。剩下的 `scripts/verify-mobile-habits.sh` 属别线（H12 那笔 `cd546407` 带进来的，入口在 HEAD 上是活的）。 |
| `pnpm -r test` | 1 | 本轮未在 Mac 重取（**这一格不做成对结论**） | **在册项同形状**：只有 `apps/mobile test: Failed`，`Vitest caught 5 unhandled errors`，逐条都是 `RolldownError: Parse failure` 且 `This error originated in "tests/auth-flow.spec.ts"` ⇒ 与既有 `RTEST-UNHANDLED-01` 的描述逐字对得上，**不记 Linux 缺陷**。反向副产品一条：`apps/landing` 在载体上跑绿 ⇒ §4 那个"带 `.git`"的修法确实把链尾那格从"载体形状红"里救出来了。 |

⇒ 于是 批一 那条"载体能跑整条门禁链"能这样说而不虚：**96 段全部执行、每段有日志、6 段红里只有 1 段是 Linux 平台本身造成的（且红在别线判据的平台假设上）、1 段是 Linux 上的可移植性缺陷（别线探针）、其余 4 段与 Linux 无关**。

⚠️ **本节读数属于 `615253f3` 那棵树**。同一小时内并行会话把 mac 的 HEAD 推到了 `c84e09a9`，
载体随后为 E10 的双端对账**又按 ①②③ 重钉过一次**（新钉之后重取的读数是：
`node research/tools/check-shell-portability.mjs` 与 `pnpm check:linux-shell` 在两端**逐字相同**、都 rc=0）。
⇒ 别把这两批读数混着引用，也别拿"现在这台机上跑出来的是什么"倒推本节。

### 🔴 本轮真正的产出：一类在 Linux 上**空转**的判据

`r17-reshoot-stale.sh` 那 4 臂红的直接成因就在日志里，一行就够：

```
research/tools/r17-reshoot-stale.sh: 行 134: md5: 未找到命令
```

`md5` 是 BSD/macOS 的命令，Linux 上那枚叫 `md5sum`（载体现量：`command -v md5` 输出为空）。
于是 `snap_tree()` 给每张 png 记下的摘要**全是空串**，拍前后两次指纹必然全等 ⇒
"这一趟到底动了哪张图"永远读成"没动" ⇒ 那枚"spec 绿了但零信号必须红"的腿**正确地响了**。
这一枚是响亮失败，好的。

🔴 **同一枚平台差异在另一枚臂脚本里方向是反的**：
`calendar-line-commit-only-arms.sh` 里的裸 `md5 -q` 测的是「文件 md5 **前后一致** ⇒ 默认不动盘 / 不替别人带字节」。
Linux 上两边都是空串 ⇒ 恒等式**永远成立** ⇒ 那几臂在这台机上没有牙 —— 而它照样打印
`合计 pass=36 fail=0`。这就是元规则第 2 条的形状（一条永远通过的判据比没有判据更糟），
也是 §7 里 `stat -f` 那一族的第五种面目：**BSD-only 工具在 GNU 上不是报错，是把值读成空**。

站点分布不抄在这里，现量：

```bash
grep -rn 'md5 -q' --include='*.sh' . 2>/dev/null | grep -v node_modules \
  | awk -F: '{print $1}' | sort | uniq -c | sort -rn
```

最大的一枚是 `research/tools/r17-evidence-md5-check.sh` —— 它是这条线的**规范裁判**，
`r17-reshoot-stale.sh:105` 那句注释明说解析形状"逐字抄"它。

换工具会不会改变判据读到的字节？两侧同一串，现量：

```
printf 'heyta-md5-proof\n'
macOS   md5 -q              → 9009bb379f34fd49c8df9e22a1dfa6c3
Linux   md5sum | cut -d' ' -f1 → 9009bb379f34fd49c8df9e22a1dfa6c3
```

⇒ 摘要值逐字相同，**改的是探针不是判据**；仓里也已有先例形状（`r14c-carrier-chain.sh:74-81`
就是 `md5` / `md5sum` 二选一，还写了"两个都没有 ⇒ 对账做不了"的响亮失败）。
**这些脚本属别的线，本轮一枚都没代改**；工单、归属与建议修法登记在计划 §4.1。

另记一格非平台的：`r17-reshoot-arms.sh:226` 在 **Mac 和 Linux 上都**打
`==: command not found`（一次未加引号的空展开），而两台的 rc 都是 0 ——
"红字出现在通过的运行里"这一形状本仓已入档过（#197），这里是同一族的新实例。

### 5.6 第五轮：试"借生产机跑壳门禁"这条路，被实测否证（06 17:4x）

动机不是省事，是载体那一格**只能等人 sudo**，而那台打包机的 dev 包是全的：

| 查的东西 | 读数 |
|---|---|
| 工具 | `pkg-config` `gcc` `make` `dpkg-deb` `Xvfb` `node` `pnpm` 都在 |
| `pkg-config --exists` | `gtk4=YES 4.14.5`、`javascriptcoregtk-4.1=YES 2.52.6`、`sqlite3=YES 3.45.1`、**`webkit2gtk-4.1=NO`** |
| WebKit 的运行库 | `/usr/lib/x86_64-linux-gnu` 里匹配 `libwebkit2gtk-4.1*` **一个都没有**；`dpkg -l` 的 webkit 行**零条** ⇒ 连运行库都没有，批二在那台机上更起不来 |

前两步都成了：⓪ 组两枚判据在**第二台 Linux**上逐字跑通 ——
`✅ 原生系统库登记对账通过：Depends 3 枚 ↔ 登记 3 行` 与
`✅ shell 可移植性对账通过：按 HEAD 扫 150 个 .sh、35 枚文件共 114 处站点`。
（"每平台都跑"这条性质从此有了两台不同机器的读数，而不是只有一台 Ubuntu + 一台 mac。）

🔴 第三步就撞在我自己的假设上：**我以为 `check:linux-shell` 是一枚"只要系统库"的门禁。**
它不是 —— 它先要跑 `packages/app-host/scripts/build-native-bridge.mjs` 把 TS 门面打成
`bridge-bundle/native-bridge.js`，而那一步吃 **esbuild**；esbuild 又不是任何 `package.json`
的直接依赖（要靠 pnpm 的 hoist 目录解析），门面本身又 import 了 `@heyta/domain`／`@heyta/sync-client`
等**工作区包**。我把 esbuild 与 `@esbuild/linux-x64`（0.27.7，与 lock 同版，合计 4.7 MB）
解开放进那棵取证树的 `node_modules/`，esbuild 确实解析成功了（`version= 0.27.7`），
接着红的是 **22 条 `Could not resolve "@heyta/*"`** —— 缺的是整个 pnpm 工作区（`pnpm install` + 各包 `dist`），
不是哪一枚工具。

⇒ **结论：这条路不成立。**在别人的生产机上跑一次全量 `pnpm install`（几百 MB、走网络、留常驻目录）
不是"编译取证"，本单不做；而且**跑通了也不是批一要的读数** —— 批一要的是**载体**能跑，
那台机上装不装都不改变载体还缺 dev 包这一格。取证树（204 MB，含我解进去的两个包）已
`rm -rf` 删除并复验 `ls -d` 不存在，全程没有 `apt` 动作、没碰那台机的任何既有目录。

📌 可迁移的一条：**"这枚门禁只需要系统库"是一句要实测的前提**。
判断方法是看它有没有在编译之前先跑构建脚本 —— 本仓的壳门禁是 C ⟷ TS 门面那一类，
它的运行前提里写着"工作区已安装"，与 GTK 无关。载体满足它（`node_modules` 在），
所以那一行 sudo **就是**批一这格唯一缺的东西，不需要再造第二条腿。

⚠️ **07 04:0x 更正上面最后这半句**：它当时是对的（那一轮确实只有 sudo 一条路），而 §1.3 那条
用户态前缀把这一格**从"等人跑 root"变成了"本单自己能跑"**：`apt-get install --print-uris` 拿清单 →
`curl` → `dpkg -x` 解进 `$HOME/heyta-linux-prefix` → 多趟重链 → `PKG_CONFIG_SYSROOT_DIR`，
之后 `HEYTA_REQUIRE_LINUX_SHELL=1 node scripts/check-linux-shell.mjs` 在同一台载体上 **rc=0**，
全程零 root、零 `apt` 写入。⚠️ 边界不要读多：前缀管的是**编译期与 pkg-config**，
运行期那套系统集成（GSettings schema、gio modules、bubblewrap）用的是这台机上本来就在的 WebKitGTK，
而**这条前缀不是给用户装 heyta 的通道**，只是载体的 provisioning。
真正需要 root 的只剩一格：`apparmor_restrict_unprivileged_userns` 那枚 sysctl（§5.7 卡点 1）。
本条保留的规律不变 —— 判"这台机够不够条件"要顺着门禁 spawn 的第一条命令往下读。

### 5.7 M2 运行取证：Linux 壳里装的确实是同一个 heyta（07 03:2–03:4）

**结论先说**：`SHELL_UI=web-dist` 这条路在这台载体上**跑通了**，而且判据已经进门禁 ——
`scripts/check-linux-shell.mjs` 的第 ④ 档真起窗口、真截图、真打分。门禁读数（严格档）：

```
✅ C ↔ TS 那一层真执行了 13/13 条断言
⚠️ M2 窗口默认档起不来（bwrap: setting up uid map: Permission denied）⇒ 改跑无沙箱档取证。
M2_GATE_SANDBOX=off（上面那行点名了原因）
✅ M2 窗口这一档成立：SHELL_UI=web-dist、2 发落定、快照 900x523 非空白（contentRatio=0.540）、主蓝命中 3987
```

页侧那一行的完整形状（`HEYTA_WEB_PROBE=1` 的取证跑法）：
`port=1 posts=8 backend=shell clientId=mux2v846 mounted=1 root=1 title=heyta`，
壳侧同时打出 `STORAGE_HOST=on STORE_CLIENT_ID=mux2v846-1-…` —— **clientId 来自壳自己的 SQLite**，
不是页侧编的。图入库 `apps/desktop-linux/evidence/linux-m2-webdist.png`，**人打开看过**
（收集箱 + 顶部 rail + 「在使用联网功能之前」那张同意卡，主蓝按钮）。

🔴 走到这一步要拆掉四个卡点，每一个的症状都是"页面什么都不发生"（不崩、不 timeout、日志干净）：

1. **bwrap 起不来是致命的，不是静默的**。`dpkg -s libwebkitgtk-6.0-4` 现量：`bubblewrap` 是它的
   硬 Depends；这台载体 `kernel.apparmor_restrict_unprivileged_userns=1`（而
   `unprivileged_userns_clone=1`）⇒ `bwrap: setting up uid map: Permission denied` →
   `ERROR **: Failed to fully launch dbus-proxy` → **SIGTRAP，rc=133**。
   取证跑法用 `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1`，且门禁**必须把用了哪一档打出来**
   （静默降级就等于"验的是一个不跑沙箱的壳"）。真正修好这一格要 root 改 sysctl，属人跑的那一步。
2. **门面的 JSC 上下文先于 WebView 创建 ⇒ WebKit 从此一次加载信号都不发**。
   这一格骗了我一整轮：helper 进程（`WebKitNetworkProcess` / `WebKitWebProcess`）都起来了、
   `webkit_web_view_get_uri()` 也返回目标 URI、`gtk_widget_get_visible()` 是 1，
   但 `load-changed` / `load-failed` / scheme 请求**一个都不来**，24 拍之后判超时。
   最小复现装置 `apps/desktop-linux/src/webview-load-probe.c`（同一条命令跑五种形状）：

   | 跑法 | `PROBE_LOAD` 计数 |
   |---|---|
   | 只有 WebView，不碰 JSC | 12 |
   | 先 `JSGlobalContextCreate`（老 C API）再建 WebView | **0** |
   | 先 `jsc_context_new`（6.0 原生新 API）再建 WebView | **0** |
   | WebView 建好之后才建 JSC 上下文 | 12 |
   | WebView 建好、加载之前才建 | 12（且自定义 scheme 正常回请求） |

   ⇒ 与"哪一代 API"无关，与"两代 JSC 同时链进来"也无关（只链 6.0 那一枚照样死）——
   是**顺序**。壳因此改成 `heyta_web_new` → 门面 → `heyta_web_load`，三处都写了这条为什么不能换。
3. **产物里的入口脚本带 `crossorigin`，那是一次真正的 CORS 请求**。只
   `webkit_web_context_register_uri_scheme` + `as_local/as_secure` 不够：响应里没有
   `Access-Control-Allow-Origin` 时模块被拦，而**拦的时候页侧是静默的**
   （不抛 `window.onerror`、不进 `console.error`）。补法与 macOS 那份逐字同一条承诺
   （`HeytaMacApp.swift` 的 `headerFields: ["Content-Type":…, "Access-Control-Allow-Origin":"*"]`）：
   走 `webkit_uri_scheme_response_new` + `set_http_headers`，另加
   `webkit_security_manager_register_uri_scheme_as_cors_enabled`。
4. **自定义 scheme 下 `new Worker(url, {type:'module'})` 构造即失败**。
   `worker-error` 事件有、`message` 是空串，而壳的 scheme 处理程序**根本没收到那一发请求**
   （请求日志停在 index.html / .js / .css 三发）。共享层 `migrateLegacyOpfsSqlite`
   正等在这个 worker 的 `ready` 上 ⇒ 启动永久挂死。
   🔴 这一条不是 Linux 专属的产品缺陷：**它违反了那份代码自己写下的第五条守卫**
   （"失败不阻断启动，但必须留痕"）—— worker 起不来时 `session.ready` 永不 settle，
   于是"留痕"变成了"什么都不发生"。已按守卫的原意修：把 `error` 事件变成一个
   **会被 `importIntoEmptyTarget` catch 的失败**。⚠️ 对 Linux 壳这不丢数据：
   同一个 worker 正是当年写那份 OPFS 的唯一入口，它在这一档 scheme 下从来没起来过。

⚠️ **判据的边界，别读成"像素能证明一切"**：共享 UI 的**启动屏**是一整块品牌蓝 logo ——
实测启动屏主蓝命中 **3858**、挂载后 **3987**。也就是说 §7 第 82 条那套「非空白 + 主蓝命中」
在这一端**分不开"卡在启动屏"与"应用真起来了"**。承重的是页侧那行 `M2_SETTLED_AFTER`
（端口在 / `backend=shell` / clientId 由库给 / `#root` 有子节点），像素那两条只挡
"有结算行但画布是空的"。这一面已经写进门禁的输出，不让下一个人重新踩。

✅ 判据能失败（这一档不通过 = 门禁没牙）：把 `apps/web/dist/index.html` 换成
只有空 `#root` 的桩 ⇒ `MUT_RC=1`（红在"到点没落定"，并把 24 拍读数与 `title=stub` 打出来）；
还原后 `cmp` 逐字相同，再跑 `BACK_RC=0`。mac 侧两档也重量了：默认 `rc=0`（响亮跳过）、
严格档 `rc=1`（点名"载体选错了"）。

还没闭合的三格，不包装成完成：① `.deb` 里装的是不是这份 web-dist（P4：`package-deb.sh` 现在装的是
二进制 + `native-bridge.js`，**一处都没装 `apps/web/dist`** ⇒ 要补的是"进包 + 缺席就红 + 包内字节对账"三格）；
② Linux 进 `check-shell-surfaces` 的 D1–D4 桌面三端循环，台账从 `wired-unverified` 翻 `reachable`；
③ 沙箱那一档要 root（`kernel.apparmor_restrict_unprivileged_userns`），属人跑的那一步。

🔴 **上面这三格是 07 03:4x 的现场记录，其中 ① 与 ② 已经在同一天 04:4x 由 §5.9 闭合**
（那两格当时的措辞与读数都没错，只是保质期到 §5.9 为止）；**③ 仍然开着**，口径见 §5.9 末尾边界第 ③ 条。
本节下面那条"像素判据分不开启动屏"的边界**没有被 §5.9 消掉** —— 包内取证跑到的同样是首启同意卡，
主蓝命中同值，承重仍是页侧落定行。

### 5.8 第二轮读数：钉在**当前工作树**上（07 04:1x）

上一节那三行读数当时有一个说不出口的边界：载体上那棵 `~/heyta` 是**几小时前**投送的树，
而本机工作树在这期间被并行线推进过 ⇒ 那组数描述的是"旧源码 + 新壳"。本轮先把树对平再跑，
这一格才算"当前产物"。做法与判据：

```bash
# 1) 本机取投送集合（screenshots/ 与 .worktrees/ 不参与本门禁，显式排除；不存在的空条目丢掉）
git ls-files -co --exclude-standard | grep -vE '(^|/)node_modules/|^tmp/|^\.worktrees/|/evidence/|^research/' > /tmp/list.txt
COPYFILE_DISABLE=1 tar -czf heyta-sync.tgz -T /tmp/list.txt        # ⚠️ 不带这个旋钮就会带出 ._*= AppleDouble
scp heyta-sync.tgz linux-dev-lan: && ssh linux-dev-lan "tar xf heyta-sync.tgz -C ~/heyta"   # 覆盖式，不动远端 node_modules
# 2) **两边各自**算扫描集清单，用 LC_ALL=C 归一排序后逐字节对
find apps/web/src apps/desktop-linux scripts packages/app-host/src -type f \
  \( -name '*.ts' -o -name '*.tsx' -o -name '*.c' -o -name '*.h' -o -name '*.mjs' -o -name '*.sh' \) \
  -not -path '*/node_modules/*' -print0 | xargs -0 sha256sum | sed -E 's/^([0-9a-f]{16})[0-9a-f]*  /\1  /' \
  | LC_ALL=C sort -k2
# 3) 载体上重打全量产物，再跑严格档
ssh linux-dev-lan "bash -lc 'cd ~/heyta && source ~/heyta-linux-prefix/env.sh && pnpm -r --filter \"!@heyta/sync-server\" build && HEYTA_REQUIRE_LINUX_SHELL=1 node scripts/check-linux-shell.mjs'"
```

07 04:1x 现量：

| 格 | 读数 |
|---|---|
| 投送集合 | **2910** 枚（`git ls-files -co` 里 30 枚指向已不存在的截图，`test -e` 过滤掉 —— 留着会让 `tar` 退 1 而**仍然打出一包**） |
| 内容对账 | 扫描集两侧各 **469** 枚，清单摘要逐字相同 `5cf96415a6d52c19` ⇒ **差异 0 处** |
| 载体构建 | `pnpm -r --filter '!@heyta/sync-server' build` **rc=0**（取的是 `${PIPESTATUS[0]}`，不是管道尾） |
| 门禁 | `HEYTA_REQUIRE_LINUX_SHELL=1 node scripts/check-linux-shell.mjs` **rc=0** |
| 跨语言冒烟 | `HEYTA_LINUX_SMOKE=OK 13/13`（与第一轮同号同数） |
| M2 窗口 | `M2_GATE_SANDBOX=off` → `SHELL_UI=web-dist`、**2 发落定**、快照 `900x523` 非空白（`contentRatio=0.540`）、主蓝命中 **3987** |

🔴 **"读数与第一轮逐字相同"本身是一格要另证的事**：同一屏（首启那张同意卡）确定性强，
但"相同"也可能是**读到了 WebKit 磁盘缓存里的旧 `index.html`**。单独证一次"这一轮加载的是刚打的那份"：

```bash
# 先看当前产物的哈希文件名，再让壳自己把每一发请求打出来
grep -o 'assets/index-[A-Za-z0-9_-]*\.\(js\|css\)' apps/web/dist/index.html | sort -u
WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 HEYTA_WEB_PROBE=1 HEYTA_EXIT_AFTER_MS=9000 \
  xvfb-run -a -s "-screen 0 1280x800x24" ./heyta-linux | grep M2_SCHEME_REQ
```

07 04:1x 现量：`M2_SCHEME_REQ=/assets/index-B9QIBWQ-.js 2291742B text/javascript`、
`M2_SCHEME_REQ=/assets/index-FuRzuea4.css 87317B text/css`，共 3 发请求、**`M2_SCHEME_MISS` 0 发**
⇒ 命中的是**本轮重打出来的那份文件名**（旧 dist 已 `rm -rf`，缓存里的旧名字不可能有字节）。
📌 一般规律：**内容确定的判据，"两次读数相同"不是证据**；要另找一条**每次都会变**的东西（哈希文件名、
nonce、mtime）当"这一轮真跑了"的凭证。这一格在 P4 会升级成包内字节对账，届时以那条为准。

⇒ 这同时闭合了下面 §7 那张清单的第 6 条"载体读数的第二轮（钉 SHA）"：**钉的是内容摘要，不是 SHA** ——
工作树里有别的线未提交的改动，`git rev-parse HEAD` 描述不了这棵树，而"远端字节 == 本地工作树"
这句话的判据只能是逐文件摘要（AGENTS §7 第 82 条那一族）。

🔴 本轮踩到并已清掉的一格：**`tar` 不带 `COPYFILE_DISABLE=1` 会在 Linux 侧解出 `._*` AppleDouble 文件**
（2910 枚，与源文件同数）。它**不会**编坏壳 —— `apps/desktop-linux/Makefile` 用的是**显式文件清单**
（`CORE := src/heyta_driver.c src/heyta_host.c src/heyta_api.c`），不是 `src/*.c` 通配，我原本担心的
"编译到二进制垃圾"这条被现量否证了。它污染的是**按扩展名扫描的判据集**：上面那条 `find` 就把它们全数算进
"扫描集枚数"，任何形如"`walkAll(dir)` 里出现 X 就算引用"的对账也会被假文件满足 —— 也就是"报告有东西"
那一格被垃圾填满了。本仓**早就有这条坑与修法**（`scripts/lib/sync-windows-sources.sh:79` 就写着
`COPYFILE_DISABLE=1`，症状那一面记在 `docs/plans/desktop-packaging-handoff.md:208` 的 C# `CS2015`）：
⇒ 这次属于**没先查同族条目就重新踩了一遍**，写在这里是为了让下一个人先去 grep 再去打 tar。
解包后仍要 `find . -name '._*' -not -path '*/node_modules/*' -delete` 并**复验计数归零**
（本轮实测：删前 2910 → 删后 0）。

### 5.9 P4 打包取证：`.deb` 里装的是不是同一份字节（07 04:4x）

§5.7 末尾留的三格里，① 与 ② 在这一节闭合（③ 沙箱要 root，仍是人跑的那一步，见 §7 第 1 条）。
上一节的边界是：**窗口那侧证到了，包这侧一格都没证** —— 旧 `package-deb.sh` 只装二进制 +
`native-bridge.js`，一处都没提 `apps/web/dist`，所以"打成 .deb 了"这句话对得上、装上却只能渲染
"找不到共享 UI 产物"那一屏。这正是 AGENTS §7 第 82 条在 macOS 侧踩过的同一格。

命令（本机是 macOS，所以目标机必须显式给；打生产机那条路已经被脚本自己拒了）：

```bash
pnpm build:linux linux-dev-lan         # = bash apps/desktop-linux/scripts/package-deb.sh <目标机>
bash apps/desktop-linux/scripts/package-deb.sh local            # 载体上直接跑（本机是 Linux 时可省参数）
```

07 04:4x 现量（`dist/linux/package-facts.txt`，纯 ASCII 机读行；`check:shell-surfaces` 的 Linux D4 读的就是它）：

| 格 | 读数 |
|---|---|
| 目标 | `PKG_TARGET=local`（在载体上跑） |
| 产物 | `heyta_1.0.0_amd64.deb`，`PKG_DEB_BYTES=1297376`（04:4x 那轮）→ **1297534**（05:2x 复跑） |
| 新鲜度（发起方 ↔ 目标机） | `PKG_FRESHNESS=OK` |
| 包外那份 `index.html` | sha256 `bbd08932…68f9a9ef`，与本工作树 `apps/web/dist/index.html` **逐字相同** |
| 新鲜度（包内那份） | `PKG_FRESHNESS_INPACKAGE=OK` |
| 沙箱 | `PKG_SANDBOX=off`（`rc=133` 后按 rc 键重试，明确打出来的那一档，见 #375） |
| 解包态窗口 | `PKG_RUN_RC=0`、`PKG_SHELL_UI=web-dist`、`PKG_SETTLED=OK`、`PKG_SNAPSHOT_TAKEN=OK` |
| 像素 | `PKG_PIXELS=OK`：`900x523` 非空白（`contentRatio=0.540`）+ 主蓝命中 **3987** |
| 总判据 | `PKG_RESULT=OK` |

取证**不需要 root**：`dpkg-deb -x` 把包解进临时根，再跑**解出来的那枚 `/usr/bin/heyta` wrapper**。
wrapper 用 `dirname "$0"` 而不是绝对路径 —— 写死 `/usr/lib/heyta/…` 的话解包态就跑不起来，
而那条验证正是上面 `PKG_RESULT` 的载体。图取回本机人打开看过：rail + 收集箱 +
首启那张「在使用联网功能之前」同意卡（主蓝实心钮），入库
`apps/desktop-linux/evidence/linux-deb-packaged-first-run.png`。

🔴 **这一节真正产出的两条是产品缺陷，都只在"从没被执行过的那条分支"里**：

1. `heyta_web.c` 找包内 UI 用的是 `%s/../share/heyta/web-dist`（exe 在 `/usr/lib/heyta/`，
   一层 `..` 落到 `/usr/lib/share/…`）。改成 `../../` 之前，**这个 FHS 位置从来没有被任何一条
   跑过的路命过**：开发态走 `HEYTA_WEB_ROOT`，壳级门禁走 exe 同目录，两条都绕开这一支。
2. `main.c` 的 `bundle_path()` 默认值是裸相对名 `"native-bridge.js"` ⇒ 它其实是**相对 cwd** 解析的。
   每一次真跑都设了 `HEYTA_BRIDGE_BUNDLE`，所以"默认那一支"同样从没被执行过；
   而解包态的取证**故意**用 `env -u HEYTA_BRIDGE_BUNDLE` 跑（不剥掉它，整条 D4 就是空证 ——
   环境变量指的是源码树，不是包），于是当场暴露。现在按 `/proc/self/exe` 解析到 exe 同目录。

📌 这两条合起来是一条判据纪律：**"每次都恰好设了环境变量"会让默认分支变成死代码，
而死代码在验收上长得和"已验证"一模一样**。取证时至少跑一次**不带**那条环境变量的形状。

Depends 是从二进制反查的，不手写（手写必漂）。07 04:5x 现量：`objdump -p` 的 NEEDED **9** 条，
排掉加载器与 `libc6` 后 **6** 枚包 ——
`libglib2.0-0t64 / libgtk-4-1 / libjavascriptcoregtk-4.1-0 / libsoup-3.0-0 / libsqlite3-0 / libwebkitgtk-6.0-4`。
🔴 第一版用的是 `ldd`，那给的是**传递闭包 = 110 枚包**（`libvulkan1` / `libunwind8` / `libgstreamer*` 全进来，
等于把半个 Ubuntu 写进 Depends）。`ldd` 答"进程加载了什么"，`objdump -p` 答"链接器记了什么"，
Depends 要的是后者。
⚠️ **而这次换口径顺手把登记册里一条理由改假了**，现量在 `scripts/linux/shell-modules.mjs` 的注释里更正：
`RUNTIME_PACKAGE` 那 5 枚与扫描那 6 枚是**两个问题**的答案 —— 登记册问"Makefile 声明的模块各自的运行时包名"
（所以它带 `libjavascriptcoregtk-6.0-1`，那是 webkitgtk 的传递层），Depends 问"本壳直接链了什么"
（换成 NEEDED 之后 `libjavascriptcoregtk-6.0-1` **不再出现**，而 `libglib2.0-0t64` / `libsoup-3.0-0` 出现了）。
🔴 A8 判据比的是"回退清单 == 登记册推导值"（两边同口径），所以它对"Depends 那一行实际写了什么"**是瞎的** ——
登记册原来那句理由正是"因为 Depends 里确实会出现它"，换口径后那句变假而**没有任何一层会红**。
两边数字不同不是漂移，不许为了好看把任何一边改小。
⚠️ 回退清单本身**只在扫描得到空集时**才被用，而那一定是探针坏了（Ubuntu 24.04 合并 `/usr`，
旧写法按 `/lib` 路径前缀过滤会把全部运行时库滤成空集 ⇒ 静默退回手写的三枚，症状是
"包里 `Depends` 三枚而产物其实链了五枚"，`dpkg -I` 看不出来、装到缺库的机器上才炸）。
现在这一格**响亮报**"反查得到空集 ⇒ 这一格的读数不可信"；回退清单的真源是
`scripts/linux/shell-modules.mjs` 的 `RUNTIME_PACKAGE`（A8 与 `check-native-lib-registry` 都从本文件
那一行取锚点，**逐行字面形状不许改**）。A8 自检现量：`self-test 臂 9 枚，不如预期 0 枚`，
登记册那枚 `--self-test` 现量：`自检 8 臂，不如预期 0 臂`（**臂数以它们自己打印的为准**）。

判据能红（07 04:5x 实测**六臂**，跑在 `HEYTA_CHECK_ROOT` 副本上，不动工作区）：
① 删 `package-deb.sh` 的 `cp -R … web-dist` 那行 ⇒ D1 红；② 把事实行 `PKG_SHELL_UI` 改成 `fallback`
⇒ D4 红点名那一格；③ 把生产方的 `FACTS=` 改名 ⇒ 断言 A 报"锚点漂移"（这是**两侧名字对账**：
门禁读的 basename 必须出现在写它的那行生产方代码里，否则 D4 会永远念"未取证"而没人发现 ——
G14 那一族）；④ 阳性对照：什么都不动 ⇒ rc=0；⑤ **把事实文件整个挪走** ⇒
`未取证 3 栏`（多出的那栏正是 `desktop-linux / countdown · 产物`）而 **rc 仍是 0** ——
没跑过就响亮跳过，不算通过；⑥ 在第 ⑤ 臂的条件下再加 `HEYTA_REQUIRE_PACKAGED_ARTIFACT=1`
⇒ **rc=1** 且点名 `🔴 [desktop-linux] countdown · 产物`（严格档把那一栏折成红；
同趟 mac 与 windows 也一起红 = 3 红，那是本机没有**本轮打的**那两个包，不是新缺陷）。
台账因此从 `wired-unverified` 翻成 `reachable`，而**包这一侧的未取证栏从 3 降到 2**。
🔴 汇总行本身这轮修掉一处**分母撒谎**：它原先把**判定记录数**当成**格数**打印，
而 Linux 那一格现在带两条判定（D 档 + L1/L2），于是"6 格（面 × 端）"里有一格被数了两遍
（现量 distinct = **5**）。改成同时印两个数（`判定 6 条 / 5 格`），红绿仍按**记录**计 ——
一条判定红了就是红了，不能被"同格另一条绿了"摊平。**格数请现取，别抄这一行**：
`node scripts/check-shell-surfaces.mjs` 自己打印 `判定 N 条 / M 格…未取证 K 栏`，
而 K 是"本机有没有本轮产物"的属性，不是仓库属性。

**05:2x 复跑（改掉 `package-deb.sh` / `provision-user-prefix.sh` 的判据行缺陷之后，见陷阱 #385/#386）**：
整条链在载体上重跑一遍，事实行**逐项等值**（`PKG_RESULT=OK` / `PKG_RUN_RC=0` / `PKG_SHELL_UI=web-dist`
/ `PKG_SETTLED=OK` / `PKG_PIXELS=OK` / 主蓝 **3987** / `PKG_INDEX_SHA` 仍是 `bbd08932…68f9a9ef`），
只有 `PKG_DEB_BYTES` 差 158 B。🔴 那一格要说清，否则下一个人会去追一个不存在的缺陷：
**`.deb` 的总字节数不是内容指纹** —— 成员表逐条对过没有变化（`/usr/bin/heyta` 373 B、
`/usr/lib/heyta/heyta-linux` 80328 B、`native-bridge.js` 1451609 B、`Installed-Size: 5556`、
`Depends` 仍是那 6 枚），差的 158 B 落在压缩层（tar 顺序 / mtime / gzip），
所以内容对账的依据是**包内 `index.html` 的 sha256 与成员表**，不是包体大小。
复跑后本机再拉一次事实文件并重取那张解包态窗口图，**人打开看过**：
rail（今天 / 收集箱 / 日历 / 四象限 / 番茄 / 习惯 / 搜索 / 帮助）+ 顶部 `heyta` 主蓝 mark +
「在使用联网功能之前」同意卡与主蓝实心钮，与其它端是同一份界面。
门禁复跑：`node scripts/check-shell-surfaces.mjs` **rc=0**，Linux 那格 D4 打印
"包内事实六项全绿，且那份 index.html 与本工作树 dist sha256 逐字相同"。

⚠️ 边界，不包装成完成：
① `PKG_BLUE_HITS=3987` 与 §5.7 那条启动屏读数**同值**（首启同意卡本身就占满主蓝），所以像素那一档
在这台机上分不开"卡在启动屏"与"应用真起来了" —— 承重的是 `PKG_SETTLED=OK` 那条页侧落定行；
② 装进系统（`dpkg -i`）这一格**没做**，取证走的是解包态。生产机 `sanjiaozhou` 不许装包，
所以真要装只能装在这台开发载体上，而那是另一件事；
③ 沙箱档（`PKG_SANDBOX=on`）仍要人跑一次 `sudo sysctl kernel.apparmor_restrict_unprivileged_userns=0`
（§7 第 1 条）。

### 5.10 P5 读数：ADR-0042 第 5 条那句"GTK4 无 backdrop blur"的主语换了（07 05:1x）

批二 P2 之后 Linux 的内容面不在 GTK 那一层，而在壳内 **WebKitGTK 6.0** 的 WebView 里，
所以"能不能玻璃"这一问要重新落到 WebView 上取一次数。装置是仓里那枚一次性探针
`apps/desktop-linux/src/webview-load-probe.c`（默认 `make` **不**构建它；本轮给它加了一个
`PROBE_BACKDROP=1` 旋钮，在第 14 拍 —— 自定义 scheme 那一屏加载完之后 —— 问一次属性）。

```bash
# 本机（macOS）改完探针后单独投这一枚文件就够（不必整树重投）
scp apps/desktop-linux/src/webview-load-probe.c linux-dev-lan:~/heyta/apps/desktop-linux/src/

ssh linux-dev-lan 'set -e; . ~/heyta-linux-prefix/env.sh; cd ~/heyta/apps/desktop-linux
  PKGS="gtk4 javascriptcoregtk-4.1 sqlite3 webkitgtk-6.0"
  gcc -std=c11 -O2 -Wall -Wextra -Werror -D_POSIX_C_SOURCE=200809L \
      $(pkg-config --cflags $PKGS) src/webview-load-probe.c -o heyta-webview-probe \
      $(pkg-config --libs $PKGS) -lm
  PROBE_BACKDROP=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 \
    xvfb-run -a -s "-screen 0 1280x800x24" ./heyta-webview-probe 2>/dev/null | grep PROBE_BACKDROP'
```

07 05:1x 现量：

```
PROBE_BACKDROP={"bf":true,"webkitBf":true,"ua":"Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/605.1.15 …"}
```

⇒ `CSS.supports('backdrop-filter','blur(20px)')` 与带 `-webkit-` 前缀那一版**都为真**；
`-Werror` 下探针 0 警告（`BUILD_RC=0`，产物 27160 B）。

🔴 这条读数的射程**只到"认不认这个属性"**，两格没取证、不许读成"Linux 上玻璃可用"：
① 真合成行为 —— 这台载体是 Xvfb + 无 GPU，GTK4 会从 ngl 退回 cairo 软件合成（§5.7 那条记录），
`backdrop-filter` 在那条路径上到底糊不糊没测；
② ADR-0042 §4 要求的"tint 合成在最坏背景上 ≥4.5:1"实算与 `prefers-reduced-transparency`
降级都没做。

⇒ 裁决写进 [ADR-0042 §6](../adr/0042-glass-material-boundary.md)：**六条结论一条没改**，
只是那条理由的主语换了；真要在 Linux 内容面开玻璃，要新写一份 ADR 承接它，
而不是在 §3 里动第 5 条。另外三条否决项（可读性有 88% 事故前科、滚动列表上的合成开销、
端能力协商只许住在 `MaterialSurface` 内）与本读数无关，仍然成立。

⚠️ 这台载体上 `pkg-config` / `Xvfb` / `xvfb-run` **全部来自用户态前缀**
（`~/heyta-linux-prefix/root/usr/bin/`），所以命令第一行那句 `source env.sh` 是承重的：
裸 SSH 里三枚都是 `MISSING`（07 04:5x 现量），只有 `/usr/bin/make` 与 `/usr/bin/gcc` 在。
`ImageMagick`（`import` / `convert`）前缀里也没有 —— 这是 `capture-window.sh` 在这条载体上
跑不起来的第二条独立原因（§7 第 4 条）。

## 6. 这台机能承担哪几腿、哪几腿仍留在 Mac

| 腿 | 在 Ubuntu 载体上 | 依据 |
|---|---|---|
| 编辑 / `-r build` / `-r typecheck` / 单测 | ✅ 可以 | 本次实测 rc=0 |
| `check:linux-shell`（Linux 原生壳 C↔TS 层） | ✅ **两轮都在这台载体上真执行**（07 03:5x 第一轮、07 04:1x 第二轮钉在当前工作树，读数见 §5.7/§5.8：`13/13`、rc=0、`-Werror` 0 警告、M2 窗口档成立）。🔴 **原先这格把宿主错记成"既有的 Linux 打包机"** —— 那条路在 §5.6/#374 里已经否证（那台机上步骤①打包 TS 门面就缺工作区，门禁从没跑到编译）；载体这一侧靠 §1.3 的用户态前缀（零 root）才成立 | 严格档 `HEYTA_REQUIRE_LINUX_SHELL=1` |
| `capture-window.sh` / `package-deb.sh`（Xvfb 起窗、.deb） | ✅ **`.deb` 这一腿已在本载体上真打过并真跑过解包态窗口**（07 04:4x，读数与**六臂**变异见 §5.9；入口 `pnpm build:linux <目标机>`，本机是 Linux 时可 `local` 或省参数）。🔴 原先这格写的"两枚脚本默认 SSH 到另一台远端、本地模式未做"只对了一半：`package-deb.sh` 有 `local`，而**默认打生产机那一档两枚都删了**（现在是 参数 > `HEYTA_LINUX_HOST` > 响亮拒绝；`package-deb.sh` 多一档"本机是 Linux 才 `local`"，`capture-window.sh` **刻意不加** `local`，理由写在它文件头与 §7 第 4 条）。⚠️ `capture-window.sh` 在这条载体上仍跑不起来，两条独立原因（`import` 缺 + 它的 SSH heredoc 不 source 前缀 `env.sh`）与"它采的是 M2 之前那一屏"都在 §7 第 4 条 | `apps/desktop-linux/scripts/package-deb.sh` 头部两条边界 |
| e2e / Playwright 族（heavy 档） | ✅ **可以**（06 16:3x 实测：`ai-e2e` 281 passed / 2 skipped、`privacy-consent-e2e` 7 passed、`landing-e2e` 22 passed、`web-storage`/`web-migration` rc=0，逐段退出码见 §5.4）。🔴 我原先在这格写的"Chromium 运行库没装"是**没实测就归因**，已被 `ldd` 计数 0 + `LAUNCH=OK` 否证 | 唯一没量过的是峰值内存 —— 那 1.8–26 GB 的档位限制仍是 [build-matrix](../reference/build-matrix.md) 的在册值，**本载体上没复现过 OOM，但也没取证**；跳过的 2 条是 Electron 的 `desktop-window.spec.ts`（Linux 上没有 Electron 二进制 ⇒ 它自己选择跳过，见 §5.4 那条跨线口径） |
| iOS / macOS 壳那两腿 | 🔴 本质不行（`simctl` / `screencapture` / `codesign`） | 不是缺陷，是平台 |
| Android 构建 | ⚠️ 本单没验。heyta 侧 `scripts/run-gradle.mjs:89` 的默认宿主仍是那台 Windows 打包机，单次可用 `HEYTA_ANDROID_HOST=<别名>` 覆盖 | 改默认值属另一次变更 |

## 7. 还没做的（别把这节读成"载体已就绪"）

1. ~~§1 的 `--step all` 要人 `sudo` 跑一次~~ ✅ **07 04:1x 降级成可选项**：§1.3 那条用户态前缀
   （零 root）已经把编译链补齐，`check:linux-shell` 严格档在这台载体上两轮 rc=0（§5.8）。
   **仍然要 root 的只剩一格**：`kernel.apparmor_restrict_unprivileged_userns`
   —— 它决定 M2 窗口能不能**带沙箱**跑，而不决定这一档能不能取证（取证走的是明确打出来的无沙箱档）。
   要跑还是那一行：
   `ssh -t linux-dev-lan "sudo -b bash -s" -- < <(ssh linux-dev-lan 'cat ~/heyta/scripts/linux/setup-build-host.sh')`
   （回退：`sudo apt-get remove --autoremove -y libgtk-4-dev libjavascriptcoregtk-4.1-dev libsqlite3-dev xvfb imagemagick`；
   ⚠️ 那是 §1.2 那条老路的回退，**不含** §1.3 前缀里解出来的 95 枚 `.deb` —— 前缀的清理是 `rm -rf ~/heyta-linux-prefix`）
2. ~~e2e 那三族：`cd e2e && pnpm install`（独立 lockfile，**别并回根 lockfile**）+ 浏览器二进制 + §1 `--step browser`。~~
   ✅ **06 16:3x 已闭合**：装完之后那五段逐段 rc=0（读数在 §5.4），而且 `--step browser` 那一半**根本不需要**——
   `ldd` 里 `not found` 计数为 0、真启动 `LAUNCH=OK`。⇒ 那一步现在写成"待验证是否需要"而不是前置：
   `scripts/linux/setup-build-host.sh` 的 `browser` 那步在这台 Ubuntu 24.04.5 上**没有被证明是必需的**
   （它给的是 libnss3/libgbm1/libasound2t64 一类，这台机上现量都是 `ii`：
   `libnss3 2:3.98-1ubuntu0.2` / `libgbm1 25.2.8-0ubuntu0.24.04.2` / `libasound2t64 1.2.11-1ubuntu0.3`）。
   要不要保留这一步属精简议题，别当成阻塞项。
3. `reinstall-all.sh` 的第五端（Linux）—— 属四端重装那条线，要对齐后动，见计划 E7。
4. ~~`capture-window.sh` / `package-deb.sh` 的本地模式（现在只有"SSH 到远端"这一条路）。~~
   07 04:5x **分两格收口**：
   · `package-deb.sh` ✅ 有 `local`（本机是 Linux 时不给参数也走 `local`），且本地那一条**真跑过**
     —— §5.9 那整张读数表就是 `PKG_TARGET=local` 在载体上取的。
   · `capture-window.sh` 🔴 **没加本地模式，是刻意的**：它的远端段是一整条"同步→构建→起窗→截图"的
     SSH heredoc，加 `local` 等于再实现一遍，而那条实现一次都没跑过 —— 这正是陷阱 #384 的形状
     （"每次都恰好设了环境变量 / 每条候选各被谁命过"）。它现在欠的也不是本地模式，是**两格别的**：
     ① 采的是 M2 **之前**的原生那一屏（不同步 `apps/web/dist`），在当前树上重跑会落到回退屏；
     ② 这台载体上它依赖的两件东西**都不在**（07 04:5x 现量）：`import`/`convert`（ImageMagick）
     在没有前缀、source 了 `~/heyta-linux-prefix/env.sh` **之后仍然**是 `MISSING` —— 前缀里没有它；
     而该脚本的 SSH heredoc **不 source** `env.sh`，所以在载体上连 `pkg-config` 都是 `MISSING`
     （`Xvfb` / `xvfb-run` / `pkg-config` 三件全部来自 `~/heyta-linux-prefix/root/usr/bin/`，
     裸 SSH 里只有 `/usr/bin/make` 与 `/usr/bin/gcc`）。⇒ 它在这条载体上**跑不起来**，
     两条原因各独立。⇒ 重定向它要连采集方式、`scripts/screenshots/targets.mjs`
     的 `methods` 与既有 `window-first-run.png` 的归属一起改，排在 E7 一起做；本轮只做了
     "让它不会把回退屏判成通过"（加主蓝判据，现量：旧原生屏 0 / 两张 M2 图各 3987）与
     "拿掉默认远端是生产机"那一档（§8）。
5. ~~根 `package.json` 没有 `build:linux`；`.deb` 目前没有一条命令入口。~~ ✅ **07 04:4x 已闭合**：
   `"build:linux": "bash apps/desktop-linux/scripts/package-deb.sh"`，目标机透传（`pnpm build:linux linux-dev-lan`）。
6. ~~载体读数的第二轮（钉 SHA）—— 计划 E0 的最后一格。~~ ✅ **07 04:1x 已闭合，见 §5.8**：
   钉的是投送集合的逐文件摘要（两侧各 469 枚、摘要相同、差异 0 处），不是 `git rev-parse HEAD` ——
   工作树里还有别的线未提交的改动，SHA 描述不了这棵树。
7. 🔴 **06 16:0x 第三轮：不依赖 §7 第 1 条的可验证项已收完**（E3 可移植性、E5 口径与索引、P6 凭据那一格、
   以及登记册对账器判据第 ④ 条的口径修正 —— 它原来用 `includes` 在自由文本里找许可名，
   见 [`docs/reference/environment-traps.md`](../reference/environment-traps.md) 第 367 条）。
   当场重跑 `bash scripts/linux/setup-build-host.sh --step verify` 的现量**仍是 rc=1**
   （`pkg-config` 不在 PATH、三枚 `-dev` 条目缺、`Xvfb`/`import` 缺），⇒
   **批二 P2 起不了跑，仍然等 §7 第 1 条那一行 sudo**。这台机上唯一现在就能跑的是
   `node research/tools/check-native-lib-registry.mjs --self-test`（它只读提交物文本）：
   在那台 Ubuntu 上实测逐臂如期，臂数以它自己打印的为准。
   ✅ **这一条已被 07 03:0x 那一轮否证，留形不留为现状**：`--step verify` 当时报的那几格缺 dev 包，
   走 §1.3 的用户态前缀（零 root）就补齐了，批二 P2 不必等 sudo —— 运行读数见 §5.7。
   现在**只剩** `apparmor_restrict_unprivileged_userns` 那一格真的要 root。

## 8. 🔴 既有那台 Linux 打包机是生产机 —— 可以借它编译取证，不可以往它上面装包

`sanjiaozhou` 曾是 `apps/desktop-linux/scripts/capture-window.sh` 与 `package-deb.sh` 的**默认远端**。
🔴 07 04:5x **两枚脚本的默认值都已拿掉**（现在是"位置参数 > `HEYTA_LINUX_HOST` > 响亮拒绝"，
`package-deb.sh` 多一档"本机是 Linux 才 `local`"），所以**不再有"忘了带参数就打到生产机"这条路**：
前者退出码 2、后者退出码 1，两段拒绝文本都点名这台是生产机。
它今天的身份是：**可以借它编译取证，不可以往它上面装包**。现量身份：Caddy 在跑 litopia/SSOS 站点、
`postgresql@16-main`、几十个容器（ssos-* healthy）、还挂着 `mihomo.service`。

| 可以（文档化的既有用法，本单实测照做） | 不可以 |
|---|---|
| 把 `apps/desktop-linux` + `bridge-bundle` 同步到 `/tmp/heyta-linux`，`make`、跑冒烟、Xvfb 起窗截图、`dpkg-deb` 打包 | `apt-get install` 任何东西。装 `-dev` 的干跑显示它会 **`1 upgraded, 47 newly installed`** —— 在一台生产机上顺带升级一枚已有包不是"装个开发包" |

⇒ 本单在那台机上取到的读数（`-Werror` 编译 0 警告、冒烟自报 `HEYTA_LINUX_SMOKE=OK n/n`）都只写"借它编译"。
而 **P2（WebKitGTK）需要装包**，所以那一步只能落在这台 Ubuntu 开发机上，前置就是 §7 第 1 条那条命令。

🔴 **顺手否证掉一条"绕过 sudo"的想当然**（06 16:0x 现量，只读探测）：`sanjiaozhou` 上
`pkg-config / make / gcc / dpkg-deb / Xvfb / import / node / git` **全都在**，
三枚 dev 包也齐（`gtk4 4.14.5`、`javascriptcoregtk-4.1 2.52.6`、`sqlite3 3.45.1`）——
看起来"那不如直接在那台机上跑 `check:linux-shell` 严格档，第一次真跑的读数今天就拿到了"。
**不行**：`check:linux-shell` 的第 ① 步是重新打包 TS 门面，它要 `node_modules`（`research/tools/bundle-spike.mjs`），
而那台机上没有装过依赖、也不该为一个门禁去装（它是一台生产机，不是工作机）。
⇒ 结论没变，只是现在有了读数：**"能编译"≠"能跑门禁"**，这两件事的依赖面不一样。
（负载当时是 `0.69 0.64 0.89` / 8 核 —— 记在这里是为了下次有人想借它编译时先看这一格。）
