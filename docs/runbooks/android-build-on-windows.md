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
|    | 逐臂含义：臂 0 = 阳性对照，臂 1–6 各抓一条 G1–G6，臂 7/8 = "门禁文件只描述不执行"那条豁免的正反两腿，臂 9 = G7，臂 10/10b/10c = G8 三条腿，臂 11/11b/11c = G9 三条腿。**臂数别抄进文档 —— 现取 `--self-test` 末行** |
| 1.5 | 前置：远端**逐个声明依赖**解析得到（不是"node_modules 目录在"），且 dry-run 里这枚探测照跑、照打读数 | ✅ 实测 2026-10-05 01:33 `--dry-run` 现量 `RNDEPS=True ROOTDEPS=True LOCALPROPS=absent DEPCHECK=19 DEPMISS=2`；01:36 远端补装后同一条复量 **`DEPMISS=0`**（同棵树上的正反对账）。🔴 这一格**是被 18 分钟的失败照出来的**，见 §7.1；旧形状在同一条命令里报 ✅ |
| 2 | 远程真打出 Release APK，`apksigner verify` 通过 | ✅ **02:14–02:34 通过（带一条签名身份的边界，见 §7.3）**：`BUILD SUCCESSFUL in 41s` → 步骤 5/6/7 全绿 → 回传 `size=66,915,556 B / sha256=ea6fb4421d3df38f…（与远端逐字相同）/ 本地 mtime 回写为远端完成时刻`；`apksigner verify --print-certs` **rc=0**。⚠️ 签名证书是 `CN=Android Debug` —— 这是**设计如此**：`apps/mobile/android/app/build.gradle:182-219` 在四个发布 keystore 键任一缺失时把 release 变体挂到 `signingConfigs.debug`。所以这条判据证到的是"远程打出的产物是一个合法签名的 APK"，**不是**"可以上架的发布签名" |
| 3 | APK 拉回本机装进模拟器，启动截图**非空白且主蓝命中**（§6.1.1 判据） | ✅ **有读数了，但不是本批跑的**：`adb install` Success → 截图 `1080x2400`、内容占比 **56.7%**、主蓝命中 **4001**（现量出处 `BLOCKED.md:5073`，提交 `e2f8b91d`，载体是并行那条线的 `heyta-wt-ai-closeout @ afe7ff7a`，图**人看过了**）。同一枚 APK 的 `66,915,556 B / sha256=ea6fb4421d3df38f…` 与 §7.3 逐字相同 ⇒ **两条独立记录指向同一产物**。⚠️ 边界：那枚 png 在 `/tmp/heyta-reinstall-android.png`（固定共享路径），**下一次重装就地覆盖** ⇒ 长期可复查的是那一行记录，不是那张图 |
| 4 | 连续两轮「改 JS 源码 → 远程重打 → 装机」验产物是当前源码（防 §7 第 27 条旧 bundle） | 🔴 **仍未实测**（02:5x 现量：上面那几趟都是"同一份源码打一次"，没有"改一处 JS → 远程重打 → 装机读到那处改动"的第二轮）。⚠️ 别拿 `check:apk-freshness` 抵这条，理由见 §7.3 末：它只判 mtime 先后，判不了"远端解的是哪棵树" |

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
- ✅ **宿主的只读前置已经量过**（2026-10-05 00:2x，探针 `~/.heyta-window-rigs/heyta-android-host-probe.sh`，
  只读：不写远端字节、不起 gradle/模拟器）：`gradlew.bat` / `apps/mobile/node_modules` / `node_modules/.pnpm`
  / `ANDROID_HOME` + `android-36`（与本仓**现取**的 `compileSdkVersion` 对上）/ `JAVA_HOME` + `bin\java.exe`
  全在位，`local.properties` 没有残留 Mac 路径，盘剩 92G+。逐条读数与两条装置判据
  （`CHANNEL-DEAD` / `LABEL-MISSING`）记在 `../plans/multi-end-coverage-handoff.md` 的 00:2x 那节。
  🔴 这不等于"远程构建跑过"——判据 2 仍是未实测，它只消掉了"会不会红在环境档"这一整档不确定性。
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
| `--self-test` | `rc=0`：臂 0 阳性对照 0 红，臂 1–6 各恰好 1 条红，臂 7/8 是豁免的正反两腿，臂 9 是 G7，臂 10/10b/10c 是 G8 的三条腿，臂 11/11b/11c 是 G9 的三条腿（01:54 现量：**16 枚 ✅ 臂、0 枚存活**；臂数以它自己打印的逐条为准，别抄进别的文档） |
| 喂旧内容 | `git show 0858032e^:scripts/run-gradle.mjs`（分流之前那份）放进候选树 ⇒ `rc=1`、🔴 4 条（G5 三条 + G6 一条） |
| 存量基线 | `scripts/verify-mobile-aed.sh` 仍是唯一待迁基线；`verify-android-vault-storage.sh` 已经通过 `run-gradle.mjs` 迁到 Windows 构建路由，instrumentation APK 路径由路由器的显式例外登记 |
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

🔴 **01:37 更正这一节的自我评估（现量见 §7.1/§7.2）**：第一次真构建**确实跑了**，
而它红在**这张表没列的第四件事**上 —— 远端 `node_modules` 里少两枚已声明的包。
⇒ 这张表当时是**没牙的**：三条前置全对上了（未决 1/2 由那一趟换成实量、未决 3 与构建无关），
红却来自第 0 件事，而第 0 件事当时被一条"目录级"判据伪装成 ✅。
补法已落地：§三 判据 1.5（逐包 + 先证明探针跑成了）。留下的教训是
**"前置清单齐了"不等于"前置齐了"** —— 清单之外那一格由谁照出来，才是判据真正的强度。

| # | 未决的事 | 现量依据（三个说法互不一致） | 它会在哪一步现形 |
|---|---|---|---|
| 1 | **windows-pc 上 Android SDK 到底在哪个盘** | ① 仓外迁移文档（仓库同级 `ANDROID_BUILD_ON_WINDOWS.md`，2026-10-04）写 `C:\Users\41478\AppData\Local\Android\Sdk` 并称 `ANDROID_HOME` 已设；② 上一位 agent 的**只读探测**报 SDK 实际在 `D:\android-sdk`；③ 同一次探测报 `C:\Android\cmdline` 是一枚**半安装的坏路径**，会让 gradle 报 `Invalid android command`。**三个说法一个都没被真机构建证实过** —— 本批的分工禁止真跑构建（现量 `sysctl -n vm.loadavg` 1 分钟均值 89.68 / 00:0x，另一条会话在跑 Playwright），所以这一格只有转述、没有读数 | 步骤 4（远端 gradle）。gradle 解析 SDK 只认 `local.properties` 的 `sdk.dir` 或 `ANDROID_HOME`，而步骤 1 只验"那一行不是一条 Mac 路径"（`/Users/` 或 `/opt/homebrew`），**不验 SDK 真的存在**。指错盘、或指向半安装的那一枚 ⇒ 症状是一句与平台无关的 SDK 报错，而步骤 0–3 全绿。**⇒ 01:37 已闭合**：那一趟真构建走到了 ninja（三个 ABI 的 CMake 编译），三个说法被区分开 —— 见 §7.2 表第二行 |
| 2 | 两个"远端仓库根"旋钮**不成对** | `scripts/run-gradle.mjs` 读 `HEYTA_ANDROID_REMOTE_ROOT`，而它调用的 `scripts/lib/sync-windows-sources.sh` 读 `HEYTA_WINDOWS_REPO_ROOT`。两个默认值**逐字相同**（现量：`bash -c 'cd "$(git rev-parse --show-toplevel)" && source scripts/lib/sync-windows-sources.sh && echo "$HEYTA_WINDOWS_REPO_ROOT"'` ⇒ `C:\src\heyta`）⇒ 此刻没有影响 | **只移一个**就变成"同步解包到 A 树、gradle 在 B 树里构建"，而 B 是那台机器上永远不动的旧树 —— 这是 §7 第 82 条那个形状（旧树构建、判据全绿）在远程路径上的复现。修法是一行（远程模式把同一个值同时导出给同步那一侧），但它要连着一次真远程构建才验得动 ⇒ 排在判据 2 之后，不"顺手改"。**⇒ 02:4x 已闭合**：那一行已经落地并被 G8 钉住（现量 HEAD：`scripts/run-gradle.mjs:397` 把 `'${REMOTE_ROOT}'` 作为第二枚实参传进 `sync_windows_sources_for_android`，`scripts/lib/sync-windows-sources.sh:145-146` 把它绑回 `local HEYTA_WINDOWS_REPO_ROOT`；G8 的两条腿在 `--self-test` 臂 10/10b 各摘一边验证会红），而判据 2 那趟真构建（§7.3）就是它的行为证据 —— ninja 回显的工作目录在 `C:\src\heyta\…`，与本机打印的远端根同一棵树 |
| 3 | §八 那枚门禁的**接线待定** | `check:android-build-host` **刻意不进** `pnpm check` 的 `&&` 串（§六 那枚已经在链里了）。链的分母正被并行会话计数 ⇒ 现量，别手抄：`node -e 'console.log(JSON.parse(require("child_process").execSync("git show HEAD:package.json")).scripts.check.split("&&").length)'` | 摘除条件：并行那批不再引用链段数之后，把它并进链，并**同时删掉** `scripts/check-gate-wiring.mjs` 允许表里那条登记 —— 登记留着而它已进链，`check:gate-wiring` 会红（那枚门禁自己写着"留着就是在掩护下一道"） |

### 7.1 2026-10-05 01:0x–01:3x：**第一次真远程构建跑了，红了 18 分钟，根因是远端依赖过期**

🔴 先说归属：这一趟**不是本批起的**，是并行会话的窗口看门狗在隔离载体 `heyta-wt-reinstall`
（HEAD `bc606fef`，含 §一 那套分流）里跑 `reinstall-all` 的 Android 段。本批做的是读它的日志、
复现它的根因、并把 §七 未决 1/2 那两格换成读数（见 7.2）。

| 时刻 | 读数 |
|---|---|
| 01:08:19 | 远端时钟记的构建起点（步骤 3 打的就是远端 UTC，不是本机时间） |
| 01:0x–01:1x | 步骤 0–3 全绿：`源码包 54M / 清单 3314 条` → `tar sha256=909b07b4b7a61f50…` 两端逐字相同 → `14 个 packages/*/dist 远端已先清后解` |
| 01:26 | `BUILD FAILED in 18m 18s`；`Execution failed for task ':app:createBundleReleaseJsAndAssets'` ⇒ `Process 'command 'cmd'' finished with non-zero exit value 1` |
| 同一份日志往上 | `Error: Unable to resolve module @react-native-documents/picker from C:\src\heyta\apps\mobile\src\screens\ProfileScreen.tsx` |
| 01:29（本批复现） | 逐包只读探测：`CHECKED=19 APP=17 ROOT=0 MISSING=2` ⇒ 缺 `@react-native-documents/picker`、`@heyta/widget-core` |
| 01:33（修复后首跑） | `--dry-run` 的同一条探测打 `RNDEPS=True ROOTDEPS=True LOCALPROPS=absent DEPCHECK=19 DEPMISS=2` |
| 01:36 | 远端 `pnpm install --frozen-lockfile` ⇒ `Done in 38.7s`、`INSTALL_RC=0`；复量同一枚探测 ⇒ **`DEPMISS=0`** |

**成因分类：环境，不是产品，也不是分流本身。** 三条依据：
`apps/mobile/package.json:31` 声明了它、本机 `apps/mobile/node_modules/@react-native-documents` 在位、
lockfile 里有它 ⇒ 源码是自洽的；远端那次 install 早于这两笔新增（`git log -S` 现取：`6a0e26fa`），
而 §二 那条同步**按设计不送 node_modules**（被 gitignore）。

🔴 **为什么步骤 1 当时报 ✅ 而构建 18 分钟后才炸**：那一格量的是 `Test-Path apps\mobile\node_modules`
——**目录级**判据对"少两枚包"零分辨力。这正是 §7 元规则二那一族（一条永远通过的判据比没有更糟），
而且它和这个文件里上一条学费（"按 `android/node_modules` 判 ⇒ 永不开的门"）是**同一族**：
两个形状都是"拿目录存在当构建输入齐"。修法已进代码：名单从 `apps/mobile/package.json` 推导、
逐包判、**并且先证明探针跑成了**（`DEPCHECK` 读不到或数不对 ⇒ 判探针故障，绝不放行成"缺 0 个"）。

⚠️ **一条会被误读的地方**：`DEPMISS=0` **不等于**"远程构建验证通过"。它只说明前置过了；
判据 2（真打出 APK + `apksigner verify`）**仍未通过**，要重跑一趟真构建才算。

📌 **代拍的运维动作（写明是代拍）**：本批自己在远端跑了 `pnpm install --frozen-lockfile`。
依据：这条命令是 §三 判据 1.5 失败提示里写着的官方修法，`--frozen-lockfile` 不改 lockfile、
只补齐声明过的包（实测 38.7 s、`INSTALL_RC=0`），且当刻远端没有别人的构建在跑（现量
`pgrep -f 'reinstall-all\.sh'` 为空）。回退：无需回退（新增的是 `node_modules` 里的软链与解包，
源码与 lockfile 一个字节没动）。⚠️ **本批没有把它做成自动步骤** —— 每次 lockfile 变化后仍需人
（或下一趟构建前的这条探测）触发；要不要让 `run-gradle.mjs` 在 `DEPMISS>0` 时**自动**远端 install，
是一条待拍的运维默认值（自动装意味着构建路径会改共享主机的状态，不该默认发生）。

📌 一条顺手量到的环境事实：远端 `pnpm --version` 报 **10.33.4**，而 install 的收尾行写
`using pnpm v11.8.0` ⇒ 那台机器上**裸命令与仓库内命令走的不是同一个 pnpm**（`packageManager` 经
corepack 生效）。以后在远端跑 pnpm 类命令要预期这一档差异，别把版本号抄成单值。

### 7.2 2026-10-05 01:0x–01:1x：第一次真实远端构建**跑到步骤 4** 的过程读数（§七 未决 1/2 由这一趟换成实量）

⚠️ 先说归属，免得下一段把它读成"这批自己跑通过"：**这一趟不是我起的**。
是并行会话的窗口看门狗（父进程 `research/tools/.b-window-keeper.sh.snap.27336`）在**隔离检出
`heyta-wt-reinstall`** 里跑 `reinstall-all`，它的 Android 段走到了我这批的分流（那棵载体的
HEAD 含 `5be80374` 的收口点改动）。我只做了两件事：读它的日志、加一条只读 ssh 探测。

| 未决 | 现在有了什么读数（时刻 01:13 现取） | 还差什么 |
|---|---|---|
| 1（SDK 在哪个盘） | 🔴 **三个说法被真机区分开了**：远端 `local.properties=absent`（步骤 1 自己打的），所以 gradle 只能认 `ANDROID_HOME`；只读探测 `ssh windows-pc "echo [%ANDROID_HOME%]"` ⇒ **`C:\Users\41478\AppData\Local\Android\Sdk`**（与仓外迁移文档那条**逐字相同**；`%…%` 能展开同时证明 ssh 默认 shell 是 cmd，不是 PowerShell —— 这决定了以后写远端命令的语法）。而步骤 4 已经进到 `:op-engineering_op-sqlite:buildCMakeRelWithDebInfo[arm64-v8a / armeabi-v7a / x86_64]` 并真的在跑 ninja ⇒ **SDK 与 NDK/CMake 全链解析成功** —— 指向 `D:\android-sdk` 或那枚半安装的 `C:\Android\cmdline` 都到不了这一步 | 不需要了。**这一格从"只有转述"升级为"有读数"**，但要写明它证到的是"这一台远端、这一棵 `C:\src\heyta` 上 SDK 可用"，不构成换远端根/换主机后可复用 |
| 2（两个远端根旋钮不成对） | 已被 `5be80374` 的接线改掉并被这一趟**行为上**证实：日志里 `远端仓库根 = C:\src\heyta`（run-gradle 打印）、`✅ Android 构建输入已同步（14 个 packages/*/dist，远端已先清后解）`（同一条 REMOTE_ROOT 传给同步）、ninja 的工作目录是 `C:\src\heyta\apps\mobile\node_modules\@op-engineering\op-sqlite\android\.cxx\...`（**构建那一侧自己报出的绝对路径**）。⇒ "同步进 A 树、构建在 B 树"这一趟**没有发生**，且证据不是同一个变量打印两次，而是三个不同来源（本机打印 / 同步回执 / 远端编译器回显）互相指认同一棵树 | G8 只钉形状（传参调用式 + dry-run 打印 + lib 绑定正则），"真的同一棵树"要**每次真构建**看 ninja 那条回显 —— 把这一条当成判据 2 的配套肉眼步骤，写进 §三 |
| 3（`check:android-build-host` 接线） | 与本趟无关，仍是待拍 | 不变 |

🔴 这一格**还没闭合**的东西：步骤 4 之后还有回传产物、产物 mtime ≥ 构建起点（远端时钟）、
`adb install` 的 `Success`、启动截图非空白且主蓝命中。**这些一条都没读到之前，"远程构建已验证通过"
这句话不许写进任何地方** —— 现在只能写"跑到步骤 4 且前置四条对账全绿"。
另外两条同刻读数：本机 `pgrep -f 'GradleDaemon|org.gradle'` = 2 枚但 **%CPU 0.0、ELAPSED 7h52m / 13h25m**
⇒ 是历史驻留的 idle daemon，不是这一趟起的（这一趟的构建进程在本机只有一个
`ssh -o ConnectTimeout=10 windows-pc cd /d C:\src\heyta\apps\mobile\android && gradlew.bat assembleRelease`）；
"Mac 上不再起新的 Gradle 构建"这条规则在第一次真实调用上是**成立的**，且它的证据形态是
"本机只有 ssh 子进程 + idle daemon 零 CPU"，不是"本机 java 计数为 0"（后者永远不为 0，拿它当判据会恒红）。

### 7.3 2026-10-05 02:14：第一次**打出产物并回传**的远程构建（判据 2 由这一趟换成实量）

🔴 归属先写清，这一段最容易被读成"本批自己跑绿了"：**起跑的不是我起的**。
是并行那条线在隔离检出 `heyta-wt-ai-closeout`（载体 HEAD `afe7ff7a`，含本批 `5be80374`/`ee87f92c` 的分流与逐包前置）
里跑 `pnpm reinstall:all` 的 Android 段，走到 `scripts/run-gradle.mjs` ⇒ ssh `windows-pc` ⇒ 远端 `gradlew.bat assembleRelease`。
本批提供的是**构建路径本身 + 判据 1.5 那条逐包前置 + 下面这条 apksigner 命令**。

| 环节 | 读数（02:34 现取，另一趟 02:14 落盘） |
|---|---|
| 远端 gradle | `BUILD SUCCESSFUL in 41s`（上一趟同一位置是 `BUILD FAILED in 18m 18s`，死在 `:app:createBundleReleaseJsAndAssets` ⇒ 这一趟唯一变化的输入是 §7.1 那次补装依赖） |
| 步骤 5（远端产物身份） | `size=66,915,556 B`、`sha256=ea6fb4421d3df38f…`、`完成时刻(UTC)=2026-10-04T18:14:24.000Z` |
| 步骤 6（回传落点） | 落进**消费者原本期望的路径** `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`（不是暂存目录） |
| 步骤 7（本地对账） | 本地 `sha256` 与远端**逐字相同**，本地 mtime 回写为远端完成时刻（02:34 复量：`size=66915556 mtime=2026-10-05 02:14:24` ⇒ 回写没被后续步骤改掉） |
| 签名核验 | `apksigner verify --print-certs` **rc=0**（`/opt/homebrew/share/android-commandlinetools/build-tools/36.0.0/apksigner`），`Signer #1 certificate DN: CN=Android Debug, OU=Android, O=Unknown…`，证书 SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` |

🔴 **这条判据证到哪一步为止（别读多）**：

1. 签名身份是 **`CN=Android Debug`**，这是**设计如此**不是缺陷 —— `apps/mobile/android/app/build.gradle:182-219`
   在四个发布 keystore 键（`RELEASE_STORE_FILE` 等）**任一缺失**时把 release 变体挂到 `signingConfigs.debug`。
   所以判据 2 现在的含义是"远程能打出**一个合法签名的** APK"，**不是**"能打出可上架的发布签名产物"。
   后者要等发布 keystore 落到那台打包机上、并把 `apksigner verify` 的期望 DN 写成判据才算。
2. **没有任何仓库脚本执行 `apksigner`**（现量：`grep -rn apksigner scripts/ package.json apps/mobile/package.json`
   ⇒ 只有 `scripts/check-android-build-host.mjs:46` 的**注释**提到它）。也就是说判据 2 的载体目前是**一条手敲命令**，
   它不会因为构建变红而红。要么把它接进 `run-gradle.mjs` 的步骤 7 之后（一行，但要连着一次真远程构建才验得动），
   要么在手册里长期写明"这一步靠人"。**当前选择是后者 + 在这里登记前者为待办**，理由：接进构建路径等于让
   `pnpm build:android` 依赖一台 Mac 上的 SDK 路径，而那正是 §五 要拆掉的东西。
3. 产物落在 **gitignore 的构建目录**里（现量：`git check-ignore -v` ⇒ `apps/mobile/.gitignore:17:android/app/build/`），
   所以上面那组哈希**不是一份可长期复查的证据** —— 下一次构建就地覆盖它。要留证据只能把 sha256 抄进日志或产物名。
   ⚠️ 同一台机器主检出的同路径下此刻还躺着另一枚**旧的本机** APK（`size=66,995,684 / sha256=3a83a74379e93f0d6b213872…`，
   10-04 15:02:47，分流之前 Mac 上打的）⇒ **以后引用"那枚远程 APK"必须带载体的绝对路径**，只写相对路径会指到错的树。

判据 2 绿**不覆盖**判据 3 与 4。**判据 3 已经有读数为**（02:5x 现量补进 §三 那一行：并行那条线的
`e2f8b91d` 用同一枚 APK 装进 `emulator-5554`，`adb install` Success、截图 `1080x2400`、内容占比 56.7%、
主蓝命中 **4001**，图人看过；出处是 `BLOCKED.md:5073` 那一行，载体 `heyta-wt-ai-closeout @ afe7ff7a` ——
**不是本批跑的**，本批提供的是构建路径与逐包前置）。
⇒ **只剩判据 4**（连续两轮"改 JS 源码 → 远程重打 → 装机"验产物是当前源码，防 §7 第 27 条旧 bundle）没读数。
这两条都是设备面，只在窗口内跑。

✅ **同一条结论原来住在两份文件里，现在两处一致了**（2026-10-05 收口这格遗留）：`AGENTS.md` §6.1 曾写
"那条'远程真打出 APK'的判据**尚未实测**，别把分流当成已经替换了本机通道" —— 它已被上面两格否证，
当时不改的两个理由（该文件正被并行会话脏着 / AGENTS 规则区不许 agent 自行改）在合并载体上都不成立，
所以那句已经换成"判据 2/3 有读数、签名那一格没有"。⚠️ **判据 4（连续两轮"改 JS 源码 → 远程重打 → 装机"）仍未实测**，
这句留在这里而不是 AGENTS，因为它的载体是设备窗口。
不改它有两个独立理由：① 该文件此刻正被并行会话脏着（现量 ` M AGENTS.md`），整文件提交会把别人的 hunk 带走；
② AGENTS 的规则区不许 agent 自行改（§8 与"不要擅自做的事"）。
⇒ **登记不代改**，并把取法写清：谁收口 `AGENTS.md` 谁把 :380 那句换成"判据 2/3 有读数（本手册 §三 与 §7.3），
判据 4 仍未实测"。**这句留着的原因**：`check:docs` 只查链接，跨文件的**结论一致性**没有任何门禁在挡 ——
同一个结论落在两处，改一处必 sweep 全仓，否则第二处就是一颗会自己变旧的假话。

⚠️ 判据 4 **不是从零开始**：它已有一枚部分载体 —— `scripts/lib/apk-freshness.sh`（`pnpm check:apk-freshness`，
"APK 的 mtime 必须不比源码面里最新的那枚 .ts/.tsx 旧"，取不到 mtime 判红），而步骤 7 把本地 mtime
回写成**远端构建完成时刻**正是它的前提（§二 末与 §7.2 已记：不回写的话 scp 的"传输时间"会让任何一次
远程产物都自动显得新鲜）。但它只挡"比源码旧"，**挡不住**"远程那台机器的 `C:\src\heyta` 解包解错树"
那一档（§7 第 82 条的形状），也**只覆盖那四个目录**（清单偏窄已登记在该文件头）。所以判据 4 要的两轮
端到端行为读数仍然没被这枚门禁抵掉 —— 别拿"有 check:apk-freshness"当"判据 4 已闭合"。

🟡 **03:2x 现状：判据 4 的装置已经写好并离线验过四臂，缺的只是一次窗口内的真跑**。
装置在 `~/.heyta-window-rigs/heyta-judge4-two-rounds.sh`（不在仓库里 —— 它要改载体工作树，
进仓就会被"干净检出"类门禁当成未跟踪脏文件），三趟结构：
**R1 基线重打 → R2 源码一字不改再重打（断言 bundle sha 与 R1 逐字相同；不同则 `TOOTH=ABSENT` 并整套作废）
→ R3 给一枚**界面上看得见**的词条（`common.privacy.consent.title`，中英两值各追加标记）重打，
断言 sha 变了、字节码里两种编码都探得到、全新安装后 `uiautomator` 的 AX 树里读得到标记**。**
R2 那条"相等"的负向对照是必需的：没有它，"R3 变了"可能只是构建本身不确定，抓不到 §7 第 27 条那个形状。
**每一趟重打还先做一次"路由自证"**（`run-gradle.mjs` 有一条要显式加旋钮才走的本机分支，它照样能打出 APK，
但那一趟证的就不是远程路径了）——三枚 needle 的正反两向写在装置里，这里不抄。

两条实测到的编码事实（写在这里，免得下一位拿 `strings` 的 0 命中当"改动没进产物"）：
Hermes `.hbc` 里**纯 ASCII 的串按单字节存、含中文的整条按 UTF-16LE 存** ⇒ 一枚 ASCII 标记追加在中文值里
只会以 2 字节形态出现；而 Apple 的 `strings`（Xcode 工具链那份）**不支持 `-el`**，用它探 UTF-16LE 恒得 0。
⇒ 装置里改用 node 的 `Buffer.from(s,"utf16le")` / `"utf8"` 各数一次，并要求**两种编码各 ≥1**
（中英两枚值各贡献一种，所以这条断言是有牙的：只落了一半就会 PARTIAL 判红）。
⚠️ 起跑前提：**不得与链抢设备** —— 它和 ① 用的是同一台 `emulator-5554`，且它自己会先过规范闸门
（`--go` 时 `REDS` 非空即 exit 3）。

⚠️ 但这里有一处**只靠远端时钟成立**的隐含前提，02:43 现量过一次：新鲜度那条判的是
"APK 的 mtime ≥ 源码里最新那枚 .ts/.tsx 的 mtime"，而 APK 的 mtime 是步骤 7 **回写的远端构建完成时刻**。
⇒ 远端时钟若比本机慢，`git checkout`（把源码 mtime 写成"本机此刻"）之后哪怕只慢过构建时长，
装包就会被**环境**判红而不是产品判红。实测：`ssh windows-pc "echo [%TIME%] [%DATE%]"` ⇒
`2:43:56.99 / 2026-10-05`（UTC+8），同趟本机 `date -u` 为 `18:43:55Z`↔`18:43:56Z` ⇒ **偏差 < 1 s**，
而一次远程构建是 41 s 量级 ⇒ 余量约 40 倍，这一趟不构成风险。
**这不是永久属性**：换打包主机、或那台机器休眠/时区改动后都要重量一次（一行命令，写在上面）。

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
