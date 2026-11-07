# P2 交付现量（2026-11-08 凌晨）

> 一张表看完：四端各自到哪了、卡在什么上、谁在等谁。
> 明细在各自的计划文档里，本文只做总览 + 指向。

---

## 1. 四端重装

| 端 | 状态 | 判据读数 | 备注 |
|---|---|---|---|
| **macOS** | ✅ | 窗口 2412×1552、webview 内容占比 **100.0%**、主蓝命中 842；安装对账 9 chunk 同一次构建 | ⚠️ **公证没过**（Apple 侧 connectTimeout），而脚本在这一档**仍判 ✅** ⇒ 那一行不等于公证通过 |
| **Windows** | ✅ | 远端 `windows-pc` 打包+自签+`Add-AppxPackage`+启动截图；取证 5 条全在位（`ADD_APPX=OK` / `INSTALLED_VERSION=1.0.0.0` / `INSTALL_LOCATION=…WindowsApps\…` / `PAYLOAD_PRI` / `PAYLOAD_XBF=3`） | 签名姿态门禁 rc=0（自签主体 `CN=heyta local build` 自报本地构建） |
| **iOS** | ✅ 装包 | `iPhone Duo heyta` 上已是当前产物；重装判据过（内容占比 53.5%） | 设备腿（注销销毁）❌ 卡在产品缺陷，见 §3 |
| **Android** | ❌ | `adb devices` 空 / `~/.android/avd` 空 / `emulator -list-avds` 无输出 | **这台机器上一台 AVD 都没有**。不是"没在线"，是**没建过**；要建需 system image + AVD + 首启，数 GB |

## 2. 源码侧

| 判据 | 读数 |
|---|---|
| `pnpm typecheck` | **rc=0** |
| 18 道门禁（design / text-color / tokens / theme / persistence-keys / ui-language / layering / reachability / empty-state / **state-tiers** / ui-provider / entry-table / **tag-resolution** / l4 / docs / md-tables / **windows-signing-posture**） | 逐条 **rc=0** |
| `apps/web` | **2793 passed / 0 failed** |
| `packages/app-host` | 2108 passed + **1 红（故意的，见 §3）** |
| `apps/mobile` / `packages/ui` | 1327 / 921 passed |

## 3. 🔴 唯一阻塞：移动端明文账号同步（产品缺陷）

- 现量见 [`mobile-plaintext-sync-gap-2026-11-08.md`](mobile-plaintext-sync-gap-2026-11-08.md)：
  **四趟独立复现**，负载分别 11 / 12 / 20+ / **6.0（最安静）**，每次 `PLAINTEXT_REQUIRED` **+1**、`latestSeq` 恒 0。
- 判据已经落库且**现在就是红**：`packages/app-host/tests/payload-mode-host.spec.ts`
  的「readable 账号 + 活配置 + 没有 accountId ⇒ 仍必须发明文」。
- 方向待裁决：[`decisions-needed-2026-11-08.md`](decisions-needed-2026-11-08.md) ①②。

## 4. R13b 的完成度

| 维度 | 状态 |
|---|---|
| 主题预设（warm / mist） | ✅ 零 op + 逐预设逐明暗算对比度 |
| 自动深浅（三态） | ✅ 零 op；`system` = 删键；真的订阅 `prefers-color-scheme` |
| 纯色自定义 | ❌ 与预设不是一回事（要现场生成整套 token 并逐对算对比度），ADR-0085 排在射程外 |
| 字号档 / 密度 / 行着色三态 | ❌ 零命中，各自要先定方案 |
| 应用图标 | 按 ADR 不做（安装器级资源） |

⇒ **目标第 1 条只完成了一部分**，逐格落点见 [`p2-remaining-scope-2026-11-08.md`](p2-remaining-scope-2026-11-08.md)。

## 5. R11 与三笔挂账

- R11：`ErrorState` / `Skeleton` 已入库并接上第一个消费者；档位账本门禁（30 行）已入库。
  **但 32 个容器只接了 1 处**，`card` 档 0 个消费者 —— 如实登记在
  [`r11-error-and-loading-2026-11-11.md`](r11-error-and-loading-2026-11-11.md) 与
  [`r11-state-tiers-ledger.md`](r11-state-tiers-ledger.md) §3。
- 三笔挂账：**全部关闭**（provider 登记 / 幽灵门禁 `check-tag-resolution` 补齐且带自检臂 /
  移动端两条永不命中的键）。
