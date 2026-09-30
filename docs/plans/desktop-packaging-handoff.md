# 交接：桌面三端安装包 + 截图/渲染可信性

> 状态：**三端安装包已交付**（都实测"装完能起来、界面有真实内容"；剩余空白见 §4）
> 交接日期：**2026-09-28**（CST）
> 给**全新会话**用：不从聊天记录继承任何前提。每条都带可复现命令或实测输出。
>
> 🔴 本文只记**当前停在哪**，不重复已经定下来的决策与已有知识。那些在
> [`docs/research/dida365-feature-benchmark.md`](../research/dida365-feature-benchmark.md)、
> [`docs/plans/site-and-parity-alignment.md`](site-and-parity-alignment.md)、
> `AGENTS.md §7 环境陷阱` 里。

---

## 0. 一句话现状

**三端原生壳的安装包都已交付，且都实测到「装完能起来、界面有真实内容」**：
macOS 公证通过并装订；Linux `.deb` 装完在 Xvfb 里起来；
**Windows MSIX 在非提权交互式会话里装成功、启动并截到真实界面**。

一路上挖出两个**都不是「打包失败」**的坑，都留了档（§3）：AppX 的提权/非提权会话之别，
以及 `dotnet publish` 悄悄丢掉应用自己的 XAML 资源。

---

## 1. 交付状态（事实，非推测）

| 端 | 产物 | 大小 | 实测到哪一步 |
|---|---|---|---|
| **macOS** | `Heyta-1.0.0.dmg` | 630,967 B | ✅ Developer ID 签名 → **公证 `status: Accepted`** → **装订并验证通过** → 打包后的 `.app` 自截屏成功（1800×1120，内容 100%） |
| **Linux** | `heyta_1.0.0_amd64.deb` | 218,978 B | ✅ `dpkg -i` 成功 → `/usr/bin/heyta` 就位 → Xvfb 里起来（`WINDOW_TITLE=heyta` `WINDOW_SIZE=900x560`）→ 截图校验通过（900×560，边缘 0.994） |
| **Windows** | `heyta.msix` | 97,225,732 B | ✅ `makeappx pack` → `signtool sign` → `signtool verify` **exit 0** → **非提权交互式会话里 `Add-AppxPackage` 成功** → 装完后启动并截图（1152×587，内容 17.8%） |

产物落点（**未入库**；`.gitignore:2` 就是 `dist/`，且 `release/` 也在 `.gitignore:10` —— 均由脚本按需生成）：

```
/tmp/heyta-macos-dist/Heyta-1.0.0.dmg          # 默认输出目录，见脚本参数
dist/linux/heyta_1.0.0_amd64.deb
dist/windows/heyta.msix
dist/windows/heyta-selfsigned.cer
dist/windows/packaged-first-run.png            # 打包产物的窗口证据
dist/windows/install-capture.txt               # 安装+启动的实测事实
远端 windows-pc: C:\src\heyta-msix\            # 🔴 是 C:\src\heyta-msix\，不是 C:\heyta-msix\
```

同一张窗口图另有一份进了库，供截图门禁盯回归：
`apps/desktop-windows/evidence/packaged-first-run.png`（+ 同名 `.txt` 说明采集方式）。

---

## 2. 复现命令（三条，各自独立）

```bash
# macOS：构建 → 组装 .app → Developer ID 签名 → 启动验证 → .dmg → 公证 → 装订
bash apps/desktop-macos/scripts/package-app.sh

# Linux：rsync 到 sanjiaozhou → -Werror 构建 → 组装 .deb → dpkg -i → Xvfb 启动验证
bash apps/desktop-linux/scripts/package-deb.sh sanjiaozhou

# Windows：publish → manifest → logos → makeappx → 自签名 → 信任证书 → Add-AppxPackage → 启动验证
bash apps/desktop-windows/scripts/package-msix.sh
```

前置：macOS 需要 `swift`；Linux 走 SSH 到 `sanjiaozhou`（Ubuntu 24.04，有 gtk4/jsc/dpkg-deb）；
Windows 走 SSH 到 `windows-pc`（Win11，有 Windows SDK x64 + dotnet 10 + **管理员**）。

---

## 3. ✅ 已解决：Windows MSIX「装不上」+「装上了起不来」

这一段是两层**互不相干**的坑，第一层修好之后第二层才露出来。两层都留了档，
因为它们的失败形态都很像「打包坏了」，但**都不是**。

### 3.1 第一层：`Add-AppxPackage` 被拒 `0x80070005`

**实测输出（远端原话，GBK 乱码已换掉，语义无损）**

```
=== 5. sign (self-signed) ===
  thumbprint = 26214509F232F691CA8D3FDBCA0975DDF6FDAF83
  Successfully signed: C:\src\heyta-msix\heyta.msix

=== 6. install ===
  cert trusted in LocalMachine\TrustedPeople
  Add-AppxPackage : 部署失败，HRESULT: 0x80070005, 拒绝访问。
  目标卷 C: 执行的 添加 操作失败，错误为 0x80070005
RESULT=INSTALL_FAILED
```

**已经排除的（不要重走）**

| 猜测 | 实测结论 |
|---|---|
| "签名没通过" | ❌ 不是。证书装进 `LocalMachine\TrustedPeople` **之后**再验：`signtool verify /pa /v` → **`Number of errors: 0`，exit 0** |
| "证书没装" | ❌ 不是。`Cert:\LocalMachine\TrustedPeople` 里 `CN=heyta local build` **有 1 张**（`Root` 里 0 张，但 MSIX 要的是 TrustedPeople） |
| "makeappx 打包失败" | ❌ 不是。`Package creation succeeded.` |
| "manifest 的 Publisher 与证书不匹配" | ❌ 不是。两边都是 `CN=heyta local build`，且打包阶段没报错 |

**根因（已验证）**：`Add-AppxPackage` 是在**提权（管理员）会话**里跑的。
这台机器上 `IsAdmin = True`（实测），而 AppX 部署是**按用户**的 ——
在提权上下文里做 per-user 安装，`0x80070005` 就是它的失败形态。

**同一段代码、同一个包，换到非提权的交互式桌面会话就成功。**（本轮实测的判据是
被投进去的脚本自己打印的 `CONTEXT IsAdmin=False SessionId=2` —— 见 §3.3。）

修法：`package-msix.ps1` 只把「信任证书」留在提权会话（那一步**真的**需要管理员），
把「安装 + 启动 + 截图」整段交给 `install-and-capture.ps1`，用
`schtasks /ru <用户> /it` 投进交互式会话：

```powershell
schtasks /create /tn heyta-msix-install /tr C:\src\heyta-msix\install-and-capture.cmd `
  /sc once /st 00:00 /ru $env:USERNAME /it /f
schtasks /run /tn heyta-msix-install
```

🔴 **「再用管理员跑一次」是反方向，不要再试** —— 提权正是失败的那个上下文。
`Add-AppxProvisionedPackage -Online`（面向全机、**必须**提权）是**另一条语义不同的路**
（给"装给全机"用的），不是这条路的加强版。

### 3.2 第二层：装上了、进程也起来了，但**窗口从来没出现**

修好安装之后立刻暴露出来的第二个问题，而且更隐蔽 —— 它长得像"打包坏了"，其实不是。

| 事实 | 证据 |
|---|---|
| 包能装上 | `Add-AppxPackage` 返回成功，`Get-AppxPackage` 有，`Status=Ok` |
| 进程真的起来了 | WER 里有 `MoAppCrash`，`praid:App`，进程 ID 都分配了 |
| 但窗口没有 | 40 秒内 `Get-Process HeytaWindows` 查不到活着的进程 |
| 崩在哪 | `Microsoft.UI.Xaml.dll`，异常代码 `0xc000027b`（stowed exception），`combase.dll` 里 `80004005`（E_FAIL） |

**根因（已验证）**：`dotnet publish` **丢掉了应用自己的 XAML 资源**。
同一棵树上实测对比：

```
dotnet build   → App.xbf ✅  MainWindow.xbf ✅  HeytaWindows.pri ✅   （1057 个文件）
dotnet publish → 三个全都没有                                        （527 个文件）
```

`Compare-Object` 的结论很干净：publish 相对 build **只少这三个文件**。
所以 `InitializeComponent()` 加载不到 `ms-appx:///App.xaml`，进程在开窗之前就死了。

**决定性实验**：把这三个文件手工补进 publish 目录 → 同一份 exe 立刻起窗口（1152×587）。
`package-msix.ps1` 第 1 步因此从 build 产物把 `*.xbf` / `*.pri` 补回 publish 目录并**断言存在**；
`install-and-capture.ps1` 再断言一次包内确实有 `PAYLOAD_PRI=True` / `PAYLOAD_XBF=2`。

> ⚠️ 这条值得单独记：它把「装上了」到「跑得起来」之间那道缝显性化了。
> **`Add-AppxPackage` 返回成功不是验收，窗口截图才是。**
> 本轮原计划的下一步正是「用 `schtasks /it` 装进去」，那个方向是对的 ——
> 但它只解决了第一层；不修第二层，第 4 步的"启动 + 截图"照样跑不出来。

### 3.3 当前实测结果（2026-09-28，`bash apps/desktop-windows/scripts/package-msix.sh` 全程）

```
=== 1. dotnet publish ===
  publish files = 527
  restored into publish: App.xbf, HeytaWindows.pri, MainWindow.xbf, ...
=== 4. makeappx pack ===   Package creation succeeded.  97206380 bytes
=== 5. sign ===            Successfully signed
=== 6. trust ===           cert trusted in LocalMachine\TrustedPeople
                           signtool verify exit = 0     ← 现在这个数字才有意义
=== 7. install + launch + capture (interactive, non-elevated) ===
  CONTEXT IsAdmin=False SessionId=2
  ADD_APPX=OK
  INSTALLED_VERSION=1.0.0.0
  PAYLOAD_PRI=True   PAYLOAD_XBF=2
  WINDOW_TITLE=heyta   WINDOW_RECT=1152x587
  PNG_SAVED=True bytes=34435   RESULT=OK
=== ④ 校验 ===  1152x587  内容 17.8%  色阶 255  边缘 0.718  ✅
```

两个顺带修掉的东西：

- `signtool verify` 原来报 `exit = 1`，是因为**它跑在信任证书之前** —— 链不可信，
  那个 1 毫无信息量，还被误读成"签名有问题"。已把它挪到 `Import-Certificate` 之后。
- `package-msix.sh` 第 ③ 段原来从 `C:/heyta-msix/` 取件，实际产物在
  `C:/src/heyta-msix/`。路径写错时的表现是「取不到 heyta.msix」，看起来像打包失败。

---

## 4. 还没有人做过的（明确的空白）

- **鸿蒙签名**：`apps/mobile/harmony/build-profile.json5` 里 `signingConfigs: []`，
  产物**未签名**。需要华为开发者账号 —— **没有账号就做不了，不要伪造**。
- **桌面端"装完手测"**：三端都是自动化截图（Xvfb / CopyFromScreen / 自截屏），
  **没有真人点过一遍**。
- **卸载/升级路径**：`.deb` 只验了 `dpkg -i`；MSIX 与 dmg 只验了首次安装。

---

## 5. 与本任务相关的既有资产（别重造）

| 东西 | 位置 | 为什么相关 |
|---|---|---|
| 截图/渲染校验门禁 | `scripts/screenshots/`（`png-stats.mjs` / `verify-artifacts.mjs`） | 三端打包脚本都用它校验"装完的界面不是空白" |
| 六端证据清单 | `scripts/screenshots/targets.mjs` 的 `SHELL_EVIDENCE` | 新增打包产物后**应在此登记采集方式**，否则门禁不管它 |
| Windows 窗口取证 | `apps/desktop-windows/scripts/capture-window.sh` + `.ps1` | **交互式计划任务**的现成范例，第 3 节第 1 步直接复用 |
| macOS 自截屏 | `apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift` | ScreenCaptureKit 实现 + **三条被证伪的渲染路径**都写在注释里 |
| 多端构建手册 | `docs/runbooks/multi-platform-build.md` | 打包完成后**应把命令补进去** |

---

## 6. 已知的、会反复咬人的环境陷阱（本轮又踩了）

写在这里是因为它们**每一条都在本轮真实发生过**，且在本仓既有记录里已经出现过：

| 现象 | 根因 | 修法 |
|---|---|---|
| `sed: RE error: illegal byte sequence`，**整条管道被中断** | C locale 下 `sed` 遇到多字节序列（远端 PowerShell 的中文报错、git 状态里的中文文件名）就报错退出 | `sed 's/^/  /'` → `awk '{print "  " $0}'`（本轮 8 个脚本 27 处已全换） |
| C# 报 `CS2015 …是二进制文件而非文本文件` | **macOS 的 `tar` 注入 AppleDouble `._*`** | 打包时 `COPYFILE_DISABLE=1` **且** `--exclude='._*'`，并清掉远端已有的 |
| bash 报 `VAR）: unbound variable` | **`$VAR` 紧跟非 ASCII（中文括号）会被吞进变量名** | 一律写 `${VAR}`；本仓有 `scripts/check-shell-unicode-vars.mjs` 拦，**改完要跑 `pnpm check`** |
| 远端 PowerShell 只回一句乱码「命令行太长」 | `-EncodedCommand` 的 base64(UTF-16LE) 超过命令行长度上限（9KB 脚本就超了） | 用 `-File <路径>`（先 scp 过去） |
| PowerShell 解析错误位置离现场很远 | **PS 5.1 把 UTF-8 无 BOM 的脚本按 ANSI 解码**，中文注释拆坏字符串字面量 | 打包用 PS1 **整份写成纯 ASCII**（本轮就是这么做的），或存成 UTF-8 with BOM + CRLF |

---

## 7. 交接时的工作区状态

```
分支 main。工作区**同时有多个会话在改**，改动面很大（timeline 重构、滴答导入、
移动端各端配置……）。提交前务必 `git status` 看清再 `git add`。
```

**本任务（桌面安装包）改动的文件，只有这些：**

```
M  apps/desktop-windows/scripts/package-msix.ps1          # 补 XBF/PRI + 交互式会话投递
M  apps/desktop-windows/scripts/package-msix.sh           # 路径修正 + 推 inner 脚本
?? apps/desktop-windows/scripts/install-and-capture.ps1   # 新增：交互式会话里装+起+截
?? apps/desktop-windows/evidence/packaged-first-run.png   # 新增：打包产物窗口证据
?? apps/desktop-windows/evidence/packaged-first-run.txt
M  scripts/screenshots/targets.mjs                        # SHELL_EVIDENCE 新增一条
M  docs/runbooks/multi-platform-build.md                  # 新增 §6 桌面安装包
M  docs/plans/desktop-packaging-handoff.md                # 本文
```

🔴 **不要把这些并行会话的在途改动混进你的提交。** 本任务上一轮已经犯过一次
（用 `git add apps/mobile` 误提了对方 61 个文件），修法记录在那个提交的信息里。
**`git add <目录>` 在多会话并行的仓库里不该用，要显式列文件。**

最近与本任务相关的提交：

```
581c16d docs: 交接文档 —— 桌面三端安装包（给全新会话）
70bb25e feat(desktop): 三端安装包脚本 —— macOS 已完整交付，Linux .deb 已交付，Windows MSIX 卡在安装
1bd7ba3 refactor(macos): 自截屏从废弃的 CGWindowListCreateImage 迁到 ScreenCaptureKit
```

---

## 8. 验收判据（"这个交接做完了"长什么样）

1. ✅ `bash apps/desktop-windows/scripts/package-msix.sh` **跑到最后**，
   `dist/windows/` 里有 `heyta.msix` + `packaged-first-run.png` + `install-capture.txt`
   （实跑记录见 §3.3，脚本退出码 0）；
2. ✅ `packaged-first-run.png` 过了 `pnpm screenshot:verify` 的空白/尺寸/alpha 三类校验
   （`1152x587 内容 17.8% 色阶 255 边缘 0.718`），并且 `read_image` 人眼看图确认：
   标题栏 `heyta`、副标题、输入框、`添加` 按钮、「还没有任务。上面写一条试试。」
   —— **不是白屏、不是糊图**；
3. ✅ 三端命令写进了 `docs/runbooks/multi-platform-build.md` **§6**（含两条踩坑记录
   与取件路径）；
4. ✅ 新产物登记进 `scripts/screenshots/targets.mjs` 的 `SHELL_EVIDENCE`
   （`label: 'Windows MSIX 安装包'`，`methods: ['winui-schtasks-copyfromscreen']`），
   证据图与说明进库到 `apps/desktop-windows/evidence/`；
5. ✅ `pnpm check` **全绿**（`CHECK_EXIT=0`）：`check-empty-state` ✅、`check:docs` ✅、
   `check:ai-e2e` **25 passed / 1 skipped / 0 failed**、`check:shell-unicode` ✅、
   `screenshot:verify` ✅、`pnpm -r test` 各包全过。

   > ⚠️ **这条中间红过 4 次，值得记下来，因为它差点被误判成"本任务引入了回归"。**
   > 红的原因全部在**并行会话**的在途 timeline 重构里，而且每次红的点都不一样：
   >
   > | 第几次 | 红在哪 | 归属 |
   > |---|---|---|
   > | 1 | `check:ai-e2e`：`motivation.spec.ts` 1 条 + `ai-breakdown.spec.ts` 1 条 flaky | 负载 flaky —— 单独复跑 ✅，整份 e2e 复跑 25 passed / 1 skipped / 0 failed |
   > | 2 | `typecheck`：`apps/web/tests/plural-keys.spec.tsx` 引用 `TimelineView` / `GanttChartProps` | 这两个源文件被并行会话**删掉**（` D`），spec 还没跟上 |
   > | 3、4 | `check:empty-state`：2 处 → 1 处**新的**手写空态 | 并行会话**新建**的 `apps/web/src/features/timeline/{TimelinePanel.tsx,labels.ts}` 与 `motivation/GrowthView.tsx` |
   >
   > **归属验证的做法**（不碰任何会话的文件）：
   >
   > ```bash
   > git worktree add --detach /tmp/heyta-head HEAD
   > cd /tmp/heyta-head && node scripts/check-empty-state.mjs   # → ✅ 三道断言都通过（EXIT=0）
   > ```
   >
   > ⇒ **HEAD 本身是绿的；红来自未提交的并行改动。** 第 5 次复跑时对方收编完
   > 最后一处，门禁当场转绿，全套随之 `CHECK_EXIT=0`。
   >
   > 两条可复用的经验：
   > 1. **`pnpm check` 的 e2e 段（`check:ai-e2e` 会跑整份 Playwright 套件）在本机并发
   >    负载下会偶发红一次** —— 红一次不等于回归，先单独复跑再下结论。
   > 2. **多会话共用一个工作区时，`pnpm check` 是"整棵树"的绿，不是"你的改动"的绿。**
   >    它红了先做归属验证（worktree at HEAD / 看被点名的是谁的文件），
   >    **不要为了让门禁变绿去动别人的地盘** —— 也不要给 `EMPTY_SITES` 加行，
   >    加行 = 把这笔债合法化。

---

## 9. 下一步（本任务已完成，下面是新的前沿）

第 3 节那两条阻塞都清了，三端安装包都能"装完起来"。**不要重走 §3 的任何一步。**

还没人做的（§4 的三条，未变）：

1. **桌面端"装完手测"** —— 三端都只有自动化截图，没有真人点过一遍。这是目前最值得做的。
2. **卸载 / 升级路径** —— `.deb` 只验了 `dpkg -i`；MSIX 与 dmg 只验了首次安装。
   升级可以直接复现：改 `package-msix.ps1` 里的 `$version` 再跑一遍，
   看 `Add-AppxPackage` 能不能就地覆盖（现在装之前会先 `Remove-AppxPackage`，
   所以还得补一条**不卸载直接升**的用例）。
3. **鸿蒙签名** —— 需要华为开发者账号，**没有账号就做不了，不要伪造**。
