# Android 构建统一到 windows-pc —— 操作手册

> 状态：**进行中**（分流已落进唯一收口点并有门禁；**远程真构建尚未跑过一次**）
> 决策来源：产品负责人 2026-10-04 拍板 ——
> 「之后 Android 任务一律 ssh windows-pc，不要再在 Mac 起新的 Gradle 构建或模拟器。」
> 起因不是整洁，是资源：Mac 被 headless 模拟器打爆（3.6G+ 常驻、90% CPU），
> SDK/AVD/Gradle 缓存吃掉约 20G+ 磁盘。
>
> **事实源分工**：环境/版本/产物/状态 → [`../reference/build-matrix.md`](../reference/build-matrix.md)；
> 本文件只写"怎么打、怎么验、边界在哪"。AGENTS 的规则本体在 §6.1。

---

## 一、唯一收口点

所有 Android 构建入口都汇成一枚脚本，没有第二条路：

```
根 package.json  build:android{,:debug,:bundle} / clean:android
  → pnpm --filter @heyta/mobile run …
    → apps/mobile/package.json 里逐字 `node ../../scripts/run-gradle.mjs <task>`
```

`scripts/run-gradle.mjs` 按平台分流：

| 运行平台 | 行为 |
|---|---|
| Windows（就是打包机本身） | **逐字不变**地在本机跑 `gradlew` —— 远端那条命令也是 `pnpm build:android`，两条路必须等价 |
| macOS / Linux | `ssh windows-pc` 同步源码 → 远端 `gradlew.bat <task>` → 回传产物到**消费者原本期望的路径** |

不静默降级：远程不可达就直接红，不会退回"那我在本机跑一下"。
确实要在本机跑（例如远程主机在重装）才显式加 `HEYTA_ANDROID_LOCAL_GRADLE=1` —— 那是**例外开关，不是兜底**。

远端仓库根：`C:\src\heyta`（MSIX 打包流程一直在用那台机器和那个树）。

> ⚠️ **副作用要说在前面**：`pnpm verify:mobile-*` 那一族脚本里的那句 `pnpm build:android`
> 现在会 ssh 出去远程构建（脚本本身一个字都不用改）。所以跑它们的前提变成两条**同时**成立：
> windows-pc 可达（构建）+ 本机模拟器在跑（装机）。远程不可达时它们会红在
> `run-gradle` 的步骤 1/2，**不是**产品的缺陷 —— 也别顺手改成"那我在 Mac 上打一份"。
> 产物回传后本地 mtime 被回写成**远端构建完成时刻**，
> 所以 `scripts/lib/apk-freshness.sh` 那条"APK 必须比源码新"仍然判得动
> （留成传输时刻它就成了一条永远通过的**假**判据 —— §7 第 27 条的防线就空转了）。

## 二、怎么打

```bash
# 1. 先看计划，一个字节都不写（八步全打出来，含将执行的 ssh / scp 原样命令）
node scripts/run-gradle.mjs assembleRelease --dry-run

# 2. 真打（Mac 上这条命令 = 远程构建 + 回传）
pnpm build:android              # Release APK
pnpm build:android:debug        # Debug APK
pnpm --filter @heyta/mobile run build:android:bundle   # 上架用 AAB
```

前置：`pnpm -r build` 必须先跑过 —— 步骤 0 会检查 10 个 workspace 依赖的 `packages/*/dist`
在不在（清单从 `apps/mobile/package.json` 现推导，不写死）。这就是 AGENTS §6.1 那句
"打包前必须先 `pnpm -r build`"，APK 里打的是 `dist`。

源码同步走 `scripts/lib/sync-windows-sources.sh` 的 `sync_windows_sources_for_android`，
与 MSIX 那条腿共用同一个内部实现（`_heyta_windows_sync_push`：清单 → tar → scp →
**远端收到的那一整包的 sha256 与本地逐字相同**才解包 → 远端先清后解）——
对不上就拒绝构建（§7 第 82 条的常驻防线）。

> ⚠️ 两条腿的**对账锚点不一样**，这是刻意的：MSIX 那一腿除了 tar 之外还要
> `apps/web/dist/index.html` 与桥的 bundle 两条按文件的哈希对账 + chunk 计数
> （因为那两个"构建产物"本身是壳的构建输入）；Android 那一腿构建输入是
> `packages/*/dist`，`index.html` 对 APK **什么都不证明**，所以只用 tar 的 sha256。
> 同一枚同步、两种锚点 —— 不要为了"看起来统一"把它们并成一套。

产物回传后本地 mtime 回写成**远端构建完成时刻**：这样
"APK 必须比源码新"那条新鲜度判据（§7 第 27 条）在远程构建下仍然有效。
路径对账由 `check:android-gradle-remote` 的 G3 钉住：`run-gradle.mjs` 回传落点必须
逐字等于 `scripts/reinstall-all.sh` android 段里 `$APK` 读的那个路径。

## 三、验收判据

**这一节只有第一条是实测过的。** 其余写在下面，是为了下一轮打远程构建时照着收读数，
不是"已经满足"。

| # | 判据 | 状态 |
|---|---|---|
| 1 | 门禁：`node scripts/check-android-gradle-remote.mjs --self-test` 逐臂按预期转红/转绿 | ✅ 实测 2026-10-05 00:1x `rc=0`；00:4x 复跑加了臂 9（G7：远程前置不许是一条永不开的门）后**仍 rc=0**。
|    | 逐臂含义：臂 0 = 阳性对照，臂 1–6 各抓一条 G1–G6，臂 7/8 = "门禁文件只描述不执行"那条豁免的正反两腿，臂 9 = G7。**臂数别抄进文档 —— 现取 `--self-test` 末行** |
| 2 | 远程真打出 Release APK，`apksigner verify` 通过 | 🔴 **未实测** —— 分流落地后还没有跑过一次真构建 |
| 3 | APK 拉回本机装进模拟器，启动截图**非空白且主蓝命中**（§6.1.1 判据） | 🔴 未实测 |
| 4 | 连续两轮「改 JS 源码 → 远程重打 → 装机」验产物是当前源码（防 §7 第 27 条旧 bundle） | 🔴 未实测 |

⚠️ 判据 2–4 全绿之前，**第四节的 Mac 清理清单一条都不许执行** —— 那台 Mac 上的模拟器
目前仍是唯一的 e2e 通道，而远程通道还没被证明能出货。

## 四、迁移验收通过后的 Mac 释放清单（尚未执行）

| 释放项 | 大小 | 动作 |
|---|---|---|
| Homebrew Android SDK | 12G | 删 `/opt/homebrew/share/android-commandlinetools` |
| `heyta-w3-yearly` AVD | 3.6G | 删 `~/.android/avd/heyta-w3-yearly.*` |
| Gradle 缓存 | 6.4G | 删 `~/.gradle` |
| `~/.zshrc` 里 `ANDROID_HOME` / `ANDROID_SDK_ROOT` / `PATH` 导出 | — | 删那两段 |
| 常驻 headless 模拟器 | 3.6G 内存 | `adb emu kill` |

这些都在**仓库之外**（用户主目录 / Homebrew），本仓库的门禁管不到它们，
删除是要人点名授权的动作 —— 尤其 `adb emu kill`：它就是判据 3 现在唯一的载体。

## 五、边界（别读多）

- **Windows 侧没有 Android 模拟器**：无 emulator 本体、无 system-images。
  所以 Android 的**设备侧验收**目前仍然只能在 Mac 的模拟器上跑
  （`verify-mobile-*` 那一族）。把模拟器搬上 windows-pc 需要先开 BIOS 虚拟化 +
  Windows 的 Hyper-V / 虚拟机平台，那是管理员 + 重启级的人工动作，**未做**。
- **e2e 端口类验收与此无关**：`check:ai-e2e` 那三段跑的是 Playwright + web 构建，
  不碰 gradle，因此不受这条规则约束（AGENTS §6.1 的规则量的是"起 Android 构建或模拟器"）。
- 🔴 **从哪棵树调用它会决定远端装的是谁的源码**：同步清单是 `git ls-files -co --exclude-standard`
  （工作树，含**别人未提交的半成品**），而 `C:\src\heyta` 是**共享**的构建宿主 —— MSIX 那条腿也在用它。
  所以第一次真远程构建应当在**干净的隔离载体**里发起，不是在共享主检出里顺手跑。
  这与 AGENTS §8.9"共享资源独占验收"是同一件事，只是宿主换成了远端那台。
- **备用机** `windows-codex`（未探测）不在本手册的路径里；换宿主是改旋钮
  `HEYTA_ANDROID_HOST`（远端仓库根另有 `HEYTA_ANDROID_REMOTE_ROOT`），
  **不是**在 `run-gradle.mjs` 里加一条 fallback 分支 —— 加 fallback 就是这条规则要挡的动作。

## 六、门禁与它的现量读数

`scripts/check-android-gradle-remote.mjs` —— 纯静态（不联网、不构建），钉的是**形状**：
新开一条 `./gradlew` 入口 / 白名单比现实宽 / 回传路径与 `reinstall-all.sh` 的 `$APK`
对不上 / 绕开收口点 / 远程支里出现 `runLocal(` / 长出第二份源码同步实现，各自都会红。

```bash
pnpm check:android-gradle-remote
node scripts/check-android-gradle-remote.mjs --self-test
node scripts/check-android-gradle-remote.mjs --root <候选树>   # 注入验证用，不动工作树
```

2026-10-04 现量（本机、真树）：

| 读数 | 值 |
|---|---|
| 真树 | `rc=0`，`G1/G2 扫描到 gradlew 落点 5 处（白名单 3 ／ 基线命中 2 ／ 违规 0）` |
| `--self-test` | `rc=0`：臂 0 阳性对照 0 红，臂 1–6 **各恰好 1 条**红，臂 7/8 是豁免的正反两腿，臂 9 是 G7（臂数以它自己打印的末行为准） |
| 喂旧内容 | `git show 0858032e^:scripts/run-gradle.mjs`（分流之前那份）放进候选树 ⇒ `rc=1`、🔴 4 条（G5 三条 + G6 一条） |
| 存量基线 | `scripts/verify-mobile-aed.sh`、`scripts/verify-android-vault-storage.sh` 两条**待迁**，各自登记了"为什么还留着"；迁走而基线不撤 ⇒ G2 红 |
| 扫描面 | 不含 `.md` 与 `.ps1`；`scripts/check-*.mjs` 里**只描述命令**的行按形状豁免（每一处都点名到 `file:line` 打进读数） |

⚠️ 两次**门禁抓到它自己/同类**的实测，都留在这里：

1. 本门禁首跑报了 12 条，全部来自它自己文件里的 needle 与打印文本 ⇒ 处置是
   **点名豁免 `SELF_FILE` + 写明理由**，而不是把 `'gradlew'` 拆成两段字符串来躲匹配
   （拆开之后基线 needle 就不再是它要匹配的真实形状，判据会跟着一起烂）。
2. 并行会话新增的 `scripts/check-android-build-host.mjs`（钉"不许在 Mac 起模拟器"那半边）
   里登记着自己的匹配模式与 needle ⇒ 本门禁当场报 **4 条红**，而那四行**一行都不执行构建**。
   ⇒ 加的不是"逐个文件放行"，而是一条**带反向判据的形状豁免**：
   同一行出现 `spawnSync(` / `execSync(` / `execFile(` / `fork(` / `child_process` 就照红。
   豁免因此有牙，并由臂 7（只描述 ⇒ 不红）与臂 8（真 spawn ⇒ 红）两条腿各自钉住。

## 七、已知未决（2026-10-05 增）

🔴 **这一节决定第一次真远程构建能不能一次跑通。** 三条都不是"以后再说"的优化，
而是 §三 判据 2 起跑之前的前置；但它们**拦不住人** —— 前面几步的对账全绿时，
谁都会以为问题在分流本身，而不是在这三条里。

| # | 未决的事 | 现量依据（三个说法互不一致） | 它会在哪一步现形 |
|---|---|---|---|
| 1 | **windows-pc 上 Android SDK 到底在哪个盘** | ① 仓外迁移文档（仓库同级 `ANDROID_BUILD_ON_WINDOWS.md`，2026-10-04）写 `C:\Users\41478\AppData\Local\Android\Sdk` 并称 `ANDROID_HOME` 已设；② 上一位 agent 的**只读探测**报 SDK 实际在 `D:\android-sdk`；③ 同一次探测报 `C:\Android\cmdline` 是一枚**半安装的坏路径**，会让 gradle 报 `Invalid android command`。**三个说法一个都没被真机构建证实过** —— 本批的分工禁止真跑构建（现量 `sysctl -n vm.loadavg` 1 分钟均值 89.68 / 00:0x，另一条会话在跑 Playwright），所以这一格只有转述、没有读数 | 步骤 4（远端 gradle）。gradle 解析 SDK 只认 `local.properties` 的 `sdk.dir` 或 `ANDROID_HOME`，而步骤 1 只验"那一行不是一条 Mac 路径"（`/Users/` 或 `/opt/homebrew`），**不验 SDK 真的存在**。指错盘、或指向半安装的那一枚 ⇒ 症状是一句与平台无关的 SDK 报错，而步骤 0–3 全绿 |
| 2 | 两个"远端仓库根"旋钮**不成对** | `scripts/run-gradle.mjs` 读 `HEYTA_ANDROID_REMOTE_ROOT`，而它调用的 `scripts/lib/sync-windows-sources.sh` 读 `HEYTA_WINDOWS_REPO_ROOT`。两个默认值**逐字相同**（现量：`bash -c 'cd "$(git rev-parse --show-toplevel)" && source scripts/lib/sync-windows-sources.sh && echo "$HEYTA_WINDOWS_REPO_ROOT"'` ⇒ `C:\src\heyta`）⇒ 此刻没有影响 | **只移一个**就变成"同步解包到 A 树、gradle 在 B 树里构建"，而 B 是那台机器上永远不动的旧树 —— 这是 §7 第 82 条那个形状（旧树构建、判据全绿）在远程路径上的复现。修法是一行（远程模式把同一个值同时导出给同步那一侧），但它要连着一次真远程构建才验得动 ⇒ 排在判据 2 之后，不"顺手改" |
| 3 | §八 那枚门禁的**接线待定** | `check:android-build-host` **刻意不进** `pnpm check` 的 `&&` 串（§六 那枚已经在链里了）。链的分母正被并行会话计数 ⇒ 现量，别手抄：`node -e 'console.log(JSON.parse(require("child_process").execSync("git show HEAD:package.json")).scripts.check.split("&&").length)'` | 摘除条件：并行那批不再引用链段数之后，把它并进链，并**同时删掉** `scripts/check-gate-wiring.mjs` 允许表里那条登记 —— 登记留着而它已进链，`check:gate-wiring` 会红（那枚门禁自己写着"留着就是在掩护下一道"） |

## 八、第二枚门禁：`check:android-build-host`（规则的另一半）

规则原话里有**两个**被禁的东西："不要再在 Mac 起新的 Gradle 构建**或模拟器**"。
§六 那枚匹配的是 `gradlew`，且它的文件头明确把 `.md` 与 `.ps1` 排除在扫描面之外 ——
所以"模拟器"那三个字、文档侧的新入口、以及那两处引用是不是死链，由
`scripts/check-android-build-host.mjs` 钉。四条判据与 §六 **互不重叠**：

| 判据 | 钉什么 | 为什么会静默烂掉 |
|---|---|---|
| H1 | 可执行文件里"起模拟器 / 建 AVD"的新形状（`emulator -avd`、`emulator @x`、`avdmanager create avd`）；注释行不算；存量按 `文件 + needle` 登记，**且反向判据要求登记那一行必须还在** | Mac 上被打爆的内存与 CPU 恰恰来自模拟器（3.6G 常驻 / 90% CPU），不是 gradle；而 Windows 侧没有 emulator 本体与 system-images（§五）⇒ 新开一个本机模拟器入口不是"换台机器跑"，是把 Mac 重新拖回那个状态 |
| H2 | `docs/runbooks/*.md` 的**代码块**里出现新的 gradle / 模拟器命令 | 手册是"照着跑"的地方，fence 里的一条命令就是一个入口。⚠️ 只判 fence 内：**散文里的禁令必须能写出来** —— 按字面全文匹配会把"不要写 `./gradlew`"这句禁令判成入口，而一条会把正确写法判红的门禁很快会被绕过而不是被遵守。`docs/plans/*` 与 `docs/reference/*` **不在面内**：按计划层与陷阱层的定位，它们是**记录**（"当时是这样跑的"）不是**指令**，把它们算成入口等于要求历史台账改写历史 |
| H3 | `scripts/run-gradle.mjs` 与 `scripts/lib/sync-windows-sources.sh` 里指向 runbook 的链接**必须有目标**，且引用不许被静默摘掉 | 本批开工时实测就是这个形状：两处链接指向一份还不存在的手册，而 `.mjs`/`.sh` 不在 `check:docs`（docs-link-check）的扫描面里 ⇒ **一道门禁都不会红**，全靠人读出来 |
| H4 | 这条规则的两枚门禁都必须有 npm 脚本定义，且每一枚要么在 `check` 链里、要么在 `check-gate-wiring.mjs` 的允许表里**点名消费方** | "定义在、没人跑"是 `check:gate-wiring` 自己修过的形状；链外门禁必须有名字可点的载体，否则"有意放在链外"就是"忘了加进链"的掩护 |

```bash
pnpm check:android-build-host
node scripts/check-android-build-host.mjs --self-test
node scripts/check-android-build-host.mjs --root <候选树>   # 注入验证用，不动工作树
```

现量读数（2026-10-05，本机真树；与 §六 一样是纯静态 —— 不联网、不起模拟器、不构建）：

| 读数 | 值 |
|---|---|
| 真树 | `rc=0`，四条 readings：H1 命中 1 处（基线 1 ／ 违规 0）、H2 命中 1 条（基线 1 ／ 违规 0）、H3 核对 2 处链接、H4 两枚门禁各有载体 |
| `--self-test` | `rc=0`，六臂：臂 0 阳性对照 0 红；臂 1 新开 `emulator -avd` 入口 ⇒ H1 恰好 1 条；臂 2 撤掉基线那一行而登记还在 ⇒ H1 反向恰好 1 条；臂 3 往手册 fence 里塞一条 gradle ⇒ H2 恰好 1 条；臂 4 删掉本手册 ⇒ H3 ≥3 条；臂 5 从允许表里摘掉本门禁 ⇒ H4 恰好 1 条 |
| 登记面 | H1 一条：`research/tools/r14c-window-retry.sh` 里那句 `pgrep -f 'emulator -avd'`（它**不启动**模拟器，只是不叠加别人的）；H2 一条：`multi-platform-build.md` §Android"第三个实例"里那段**报错复现** |
| 变异载体 | 六臂全部施在 `mkdtemp` 出来的**临时夹具**里（`--root` 指过去），工作树一个字节都不写 —— 这是多人共用的检出，往 `scripts/` 塞一个真文件就是给别人的验收丢雷 |

