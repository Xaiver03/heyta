# 交接：桌面三端安装包 + 截图/渲染可信性

> 状态：**进行中**（macOS / Linux 已交付，Windows 卡在安装）
> 交接日期：**2026-09-28**（CST）
> 给**全新会话**用：不从聊天记录继承任何前提。每条都带可复现命令或实测输出。
>
> 🔴 本文只记**当前停在哪**，不重复已经定下来的决策与已有知识。那些在
> [`docs/research/dida365-feature-benchmark.md`](../research/dida365-feature-benchmark.md)、
> [`docs/plans/site-and-parity-alignment.md`](site-and-parity-alignment.md)、
> `AGENTS.md §7 环境陷阱` 里。

---

## 0. 一句话现状

**三端原生壳的安装包脚本都写好了、也都能跑出产物**；
**macOS 与 Linux 已完整交付并实测装完能起来**；
**Windows 的 MSIX 打包与签名都成功，唯独 `Add-AppxPackage` 被拒**。

---

## 1. 交付状态（事实，非推测）

| 端 | 产物 | 大小 | 实测到哪一步 |
|---|---|---|---|
| **macOS** | `Heyta-1.0.0.dmg` | 630,967 B | ✅ Developer ID 签名 → **公证 `status: Accepted`** → **装订并验证通过** → 打包后的 `.app` 自截屏成功（1800×1120，内容 100%） |
| **Linux** | `heyta_1.0.0_amd64.deb` | 218,978 B | ✅ `dpkg -i` 成功 → `/usr/bin/heyta` 就位 → Xvfb 里起来（`WINDOW_TITLE=heyta` `WINDOW_SIZE=900x560`）→ 截图校验通过（900×560，边缘 0.994） |
| **Windows** | `heyta.msix`（在远端） | 96,639,056 B | ⚠️ `makeappx pack` ✅ · `signtool sign` ✅ · **`Add-AppxPackage` ❌ `0x80070005 拒绝访问`** |

产物落点（**未入库**，`.gitignore` 里没有 `dist/`，由脚本按需生成）：

```
/tmp/heyta-macos-dist/Heyta-1.0.0.dmg          # 默认输出目录，见脚本参数
dist/linux/heyta_1.0.0_amd64.deb
dist/windows/                                   # ← 空的：MSIX 还没取回来
远端 windows-pc: C:\src\heyta-msix\heyta.msix
```

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

## 3. 🔴 当前阻塞：Windows MSIX 装不上

### 实测输出（远端原话，GBK 乱码已换掉，语义无损）

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

### 已经排除的（**不要重走**）

| 猜测 | 实测结论 |
|---|---|
| "签名没通过" | ❌ 不是。证书装进 `LocalMachine\TrustedPeople` **之后**再验：`signtool verify /pa /v` → **`Number of errors: 0`，exit 0** |
| "证书没装" | ❌ 不是。`Cert:\LocalMachine\TrustedPeople` 里 `CN=heyta local build` **有 1 张**（`Root` 里 0 张，但 MSIX 要的是 TrustedPeople） |
| "makeappx 打包失败" | ❌ 不是。`Package creation succeeded.`，96,639,056 字节 |
| "manifest 的 Publisher 与证书不匹配" | ❌ 不是。两边都是 `CN=heyta local build`，且打包阶段没报错 |

### 最可能的原因（**这是推测，未验证**）

**`Add-AppxPackage` 是在提权（管理员）会话里跑的。**
这台机器上 `IsAdmin = True`（实测），而 AppX 部署是**按用户**的 ——
在提权上下文里做 per-user 安装，`0x80070005` 是已知的失败形态。

⚠️ 注意：**不要靠"再管理员跑一次"来试**。这个假设的方向正相反。

### 下一步（按顺序，每步都可独立验证）

1. **在非提权上下文里装**。本仓库已有现成机制：用 `schtasks /ru <用户> /it`
   把脚本投进**交互式桌面会话**（同一个办法已经在
   `apps/desktop-windows/scripts/capture-window.sh` 里用于窗口取证，实测有效）。
   ```powershell
   # 把 Add-AppxPackage 那段单独写成一个 .cmd，用交互式计划任务跑
   schtasks /create /tn heyta-msix-install /tr C:\src\heyta-msix-install.cmd `
     /sc once /st 00:00 /ru 41478 /it /f
   schtasks /run /tn heyta-msix-install
   ```
   然后读 `Get-AppxPackage -Name cloud.finlaw.heyta.desktop` 是否出现。

2. 若第 1 步仍拒：改用 **`Add-AppxProvisionedPackage -Online`**（面向所有用户，
   **必须**提权）——这条路是给"装给全机"用的，语义与第 1 步不同。

3. 若两条都拒：看 `Get-AppPackageLog -ActivityID <上面那个 ActivityId>` ——
   实测输出里给了一个 `ActivityId`，那是 Windows 自己的日志，会指出**真正**的失败点。

4. 装成之后**必须**走到"启动 + 截图"那一步（脚本第 7 步已经写好）。
   **「装上了」不等于「跑得起来」** —— 这条纪律在本仓被代价教育过多次。

5. 最后把 `C:\src\heyta-msix\{heyta.msix,packaged-first-run.png}` 取回到 `dist/windows/`。
   （脚本第 ③ 段会自动做；因为第 6 步失败提前退出了，所以现在没取。）

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
分支 main，与 origin/main 同步（无未推送提交）
未提交：5 个文件，**全部属于并行会话**（他们在做滴答导入 UI）：
  apps/web/src/App.tsx
  apps/web/src/features/settings/TickTickImportPanel.tsx
  apps/web/src/features/settings/ticktick-import.ts
  packages/i18n/src/locales/{zh-CN,en}.ts
```

🔴 **不要把这些并行会话的在途改动混进你的提交。** 本任务上一轮已经犯过一次
（用 `git add apps/mobile` 误提了对方 61 个文件），修法记录在那个提交的信息里。
**`git add <目录>` 在多会话并行的仓库里不该用，要显式列文件。**

最近与本任务相关的提交：

```
70bb25e feat(desktop): 三端安装包脚本 —— macOS 已完整交付，Linux .deb 已交付，Windows MSIX 卡在安装
1bd7ba3 refactor(macos): 自截屏从废弃的 CGWindowListCreateImage 迁到 ScreenCaptureKit
```

---

## 8. 验收判据（"这个交接做完了"长什么样）

1. `bash apps/desktop-windows/scripts/package-msix.sh` 能**跑到最后**，
   且 `dist/windows/` 里有 `heyta.msix` + `packaged-first-run.png`；
2. 那张 `packaged-first-run.png` 经 `pnpm screenshot:verify` 的空白/尺寸/alpha 三类校验通过，
   **并且人眼（`read_image`）看过一眼确认不是白屏或糊图**；
3. 三端产物在 `docs/runbooks/multi-platform-build.md` 里有可复现命令；
4. 新产物的采集方式登记进 `scripts/screenshots/targets.mjs` 的 `SHELL_EVIDENCE`；
5. `pnpm check` 全绿。

---

## 9. 下一会话的开头指令建议

> 读 `docs/plans/desktop-packaging-handoff.md`。先做第 3 节第 1 步：
> 用 `schtasks /ru <用户> /it` 把 `Add-AppxPackage` 投进**非提权**的交互式会话里装 MSIX，
> 然后把"启动 + 截图"跑完并把产物取回 `dist/windows/`。
> **不要**再试「用管理员再跑一次」—— 那个方向是反的（见第 3 节「已排除的」）。
