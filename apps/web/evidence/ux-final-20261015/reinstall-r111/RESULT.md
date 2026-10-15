# r111 —— 只跑 windows 一端的第七趟：验的是取证量具那笔 DPI 改动

## 这趟存在的唯一理由

`de7b5493` 给 `apps/desktop-windows/scripts/{install-and-capture,capture-window}.ps1` 加了 DPI 感知声明
与 `WINDOW_DPI=` 读数。那两枚文件**本机跑不了**（这台 Mac 没有 pwsh，也没有 Windows），
所以"改了"在这趟之前只是一句未经运行时验证的话。开工前立下的判据有两条，本文件逐条给读数。

## 出处（现量在 `provenance.txt`，别抄这里的数）

| 字段 | 值 |
|---|---|
| 载体 | `../heyta-wt-r111`（只含已提交内容的隔离 worktree，`--detach`） |
| HEAD | `2dbfdba6d139bce1c89d6a6d73cb6b8cb0655dbe` |
| 起跑 dirty | 0 |
| 起跑 load1 | 33.78（链自带的安静窗阈值是 12，它自己等的，没调阈值） |
| 私有落点 | `~/heyta-r111-reinstall` |
| 范围 | `--only windows`（mac / android / ios **不在本趟范围**，见下"不证"） |
| 整链退出码 | `REINSTALL_RC=0`（`reinstall.txt` 末行） |

## 判据两条，逐条读数

| # | 判据 | 读数（`heyta-reinstall-win.log.txt`） | 判定 |
|---|---|---|---|
| ① | 抓取进程**声明到了** DPI 感知 | `WINDOW_DPI=96 DPI_CTX=True` | ✅ `DPI_CTX=True`；⚠️ 但 DPI 报 **96**，不是开工前预测的 120（见下"更正一条"） |
| ② | 图不再是被裁的左上角：**png 宽 == `WINDOW_RECT` 宽** | `WINDOW_RECT=1440x734`，`PNG_SAVED=True bytes=198791`，本目录 `heyta-reinstall-win-window.png` 实测尺寸 **(1440, 734)** | ✅ 逐字相等 |

对照旧形状：r110 同一枚脚本、同一台机器记的是 `WINDOW_RECT=1152x587` + png 1152×587，
而 10-08 那趟**带 DPI 声明**的一次性抓取（`apps/desktop-windows/evidence/ux-final-20261008-candidate/auth-legal-frozen/attempt-3-upgraded/installed-dpi-full.json`）
记的是 `1440x734 / dpiAware:true`。本趟把常规路径拉到了同一档 ⇒ 裁切这件事**已修，且有运行时证据**。

## 那条 125% 归因：两个来回 —— 🔴 本趟那枚 `WINDOW_DPI=96` 的射程被我读大了

开工前我按 `1152 → 1440` 的 1.25 倍差推"打包机是 125% 系统缩放"。本趟 `GetDpiForWindow` 报 **96**，
我据此把那句判成"缩放归因没有被现量支持"，并写下"机制还没量清"。
🔴 **2026-10-16 00:3x 现量：那个"否证"本身是错的，归因翻回原处** —— 那台机重新在线后读
`HKCU:\Control Panel\Desktop\WindowMetrics` 的 `AppliedDPI` = **120** = 96 × **1.25** ⇒ 系统缩放确实是 125%。
两张读数不矛盾的原因是射程不同：`WINDOW_DPI` 量的是**取证进程自己所在会话的桌面**，不是窗口那张。
同一台机、同一个 `ssh windows-pc`，两次连进去的桌面可以不同 —— 00:3x 那张现量：
`Screen::AllScreens` = `1024x768`、`deviceName=WinDisc`（会话没挂物理显示器时给的丢弃桌面）、
`SM_CXSCREEN=1024`、`GetDeviceCaps(LOGPIXELSX)=96`，且 `SetProcessDpiAwarenessContext(-4)` 在那里返回 **`False`**（本趟是 `True`）。

✅ 顺带把本趟这张图钉住（不必重取）：图 1440 宽，而 x=1100 / 1300 / 1439 三列各有 14 / 6 / 28 种颜色、不是空白
⇒ 抓取确实发生在一张 ≥1440 宽的桌面上，不是那张 1024 的 WinDisc。

🔴 读法边界（给下一张图带着）：**别用 `WINDOW_DPI` 推用户机器上的缩放**；要判因子从哪来读注册表 `AppliedDPI`。

## 人眼看过这张图（AGENTS §6.2 规定一）

`heyta-reinstall-win-window.png`（1440×734，亮色，首跑，隐私同意面板立着，账号菜单被 M2-D 探针打开）：

- 右栏标题「对话助手」**完整可读**，右侧到窗口边还有一整段余量 —— 旧图里那个"最后一个字被窗口切掉"没有了。
- 右栏整列进画：`历史` / `执行 ▾` / 展开图标 / 「今天想先完成什么?」 / 「把想法变成下一步。」 /
  输入框占位「…任务，或问点什么…」 / 发送箭头 / 三条建议 chip / 页脚「AI 可能出错，请核对重要信息。」。
- 中间：隐私同意面板完整（两条按钮「同意并联网」「只用本机」+ 服务条款/隐私政策两个链接 + 右上 ✕）。
- 左侧：头像菜单开着（登录账号 / 个人中心 / 应用设置），下面是四象限四行 + 清单/标签两节。
- 窗口三个 caption 按钮（最小化/最大化/关闭）在右上角正常可见 ⇒ 这张图确实覆盖到了窗口右缘。
- **图里有一枚不属于本应用的红色小标签贴在右缘**（png 坐标 x≈1395..1440、y≈55..66，红字浅粉底）。
  它不是界面缺陷：本应用的 DOM 里查不到含「端」的右上角标签（现量
  `grep -rn '客户端\|本端\|端侧' apps/web/src packages/ui/src | grep -i 'badge\|chip\|pill\|label\|note'` ⇒ 空），
  而这台机器的抓取方式是**按窗口矩形抓屏幕区域**，所以任何压在那个屏幕区域上的 toast/别的窗口都会进图
  （r110 那张左上角那枚「部署探… Pro」就是同一族）。**读 windows 装机图时要带着这一条。**

## 这趟不证的

- 不证 mac / android / ios 三端装着当前产物 —— 它们不在 `--only` 范围（`reinstall.txt` 汇总那三行自己写着"没有验证"）。
  四端那一档的读数是 r110（`../reinstall-r110/`）。
- 不证 DPI 因子的机制归属（⚠️ 本趟没证；由 2026-10-16 00:3x 那次注册表现量补上，见上面那一节）。
- 不证深浅两档：这张图是亮色，暗色档本趟没取。
- 不证"以后每次抓都自动带上 DPI"：`DPI_CTX` 那行是**运行时**读数，若哪天宿主进程已有自己的上下文，
  它会翻成 `False`，那时 png 宽与 `WINDOW_RECT` 宽又会一起缩水 —— 所以判据 ② 才是长期承重的那一条。

## 一条命令重跑

```
bash apps/web/evidence/ux-final-20261015/reinstall-r111/run-r111.sh
```

（它会自建 `~/heyta-r111-reinstall` 私有落点、在 `../heyta-wt-r111` 上 `pnpm install --frozen-lockfile` 后跑
`scripts/reinstall-all.sh --only windows`。载体 worktree 不在时先
`git worktree add --detach ../heyta-wt-r111 HEAD`。）

## 本目录件名册

| 文件 | 是什么 |
|---|---|
| `run-r111.sh` | 这趟的跑法（含"为什么非跑不可"两条判据） |
| `provenance.txt` | 跑前/跑后出处（HEAD、dirty、load1、落点、RC） |
| `install.txt` | 步骤 1 `pnpm install --frozen-lockfile` 的原文与 `INSTALL_RC` |
| `reinstall.txt` | 步骤 2 的汇总段（含"三端不在范围"那三行）与 `REINSTALL_RC` |
| `heyta-reinstall-build.log.txt` | 前置 `pnpm -r build` 全量日志 |
| `heyta-reinstall-web.log.txt` | 前置 `@heyta/web build` 日志 |
| `heyta-reinstall-win.log.txt` | **windows 段全文**：同步对账 + 远端打包/安装 + 取证判据（判据 ① 的读数在这里） |
| `heyta-reinstall-win-window.png` | 修好之后的那张全窗口图（判据 ② 的读数） |
| `SHA256.txt` | 以上各件的 sha256 |

⚠️ 日志文件后缀写成 `.log.txt` 而不是 `.log`：仓库 `.gitignore` 里有 `*.log`，
按约定走（不 `-f` 硬塞），否则这些件根本进不了库、下一位读者只能看到图。
