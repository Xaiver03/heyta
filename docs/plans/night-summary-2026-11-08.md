# 夜间工作汇总 · 2026-11-07 深夜 → 11-08 凌晨

> 一句话：**功能那四格全部入库；交付那一步推进到"探针已可信、真因已定位"，
> 卡在一个刚被挖出来的产品缺陷上** —— 移动端在**明文账号**上的同步是坏的。
> 目标保持 active，不宣称完成。

---

## 1. 这一晚落库了什么（共 34 笔提交，本轮新增 11 笔）

| 提交 | 内容 |
|---|---|
| `4dfd7c364` | 把 `@react-native/community-cli-plugin` 声明进 `apps/mobile` —— 修掉 `pod install` 必然失败 |
| `f15ca64db` | 结清上一笔的锁文件（`--frozen-lockfile` 复验 rc=0） |
| `9f8e27b3c` | 设备腿第一批 5 个探针缺陷 |
| `4d4fa072a` | 设备腿第二批 3 个探针缺陷（屏幕尺寸 / 滚动死区 / 便签落点 / 同步配对腿） |
| `b45db0afc` | 设备腿这一晚的现量与待裁决缺口（plans） |
| `6e16541f8` | 归属取证段 SQL 形状写错、被 `2>/dev/null` 吞成静默空转 |
| `0e77a46cb` | 🔴 **移动端明文账号同步是坏的**（plans，产品缺陷定性） |
| `f972fe082` | 双向复现读数 |

（另 3 笔是本轮更早的：`4dfd7c364` 之前的 `9f842ff64` / `695342cf5` / traps 那一批。）

## 2. 设备腿：从"跑不起来"到"跑到判据 A"

修掉 **9 处探针缺陷**，每一处都是"报出来的话指向别处"：

1. 「设置」入口的可达名过期（`SettingsRow` 只把 `label` 给 `accessibilityLabel`）；
2. 设置是**两层**（总览 → 数据与同步 → 自托管表单）；
3. 便签输入框在「我的 → 便签」二级页；
4. **顺序**错了：先同步后建便签 ⇒ 那时还没有 op ⇒ 「立即同步」不在树上；
5. 收起态的「服务器地址」是 `AXStaticText`，同名 ⇒ 探针跳过展开、`--set` 打在说明行；
6. shim 的 `screen_size` 取 `Application` frame（386×678）而非逻辑屏（466×678）⇒ 假 `tap-outside-screen`；
7. `--scroll-into-view` 在这页滚不动（10 下 y 不变），且起点 x=200 压在文字上；
8. 便签落点 chip「收集箱」要点一下才算选中；
9. 归属取证段 SQL 写错 + `2>/dev/null` ⇒ **静默空转**。

## 3. 🔴 真卡点：产品缺陷，不是探针

**移动端在 `readable`（明文）账号上同步不出去。**

- 服务端 `/api/sync/payload-mode` 回 `{"mode":"readable"}`（实测）；
- 客户端上传仍带 `isPayloadEncrypted: true` 的**密文** ⇒ 服务端 `PLAINTEXT_REQUIRED`；
- `latestSeq` **恒 0**，两趟复现都是 **+1 次**审计事件（确定性，不是偶发）；
- 因果链：`host.ts:812` 读出 `'plain'` → `host.ts:778` 有 plain 分支 →
  但 `apps/mobile/src/db/open-host.ts:110` **没传 `encryptionMode`** ⇒ 落回 `password` 分支。

详见 [`mobile-plaintext-sync-gap-2026-11-08.md`](mobile-plaintext-sync-gap-2026-11-08.md)，
含**两个待裁决问题**（修在哪一层 / 本地库与上传是否必须同模式）。

**我没有自己拍板修的三个理由**（写在这里，免得下一个人以为我漏了）：
1. 「本地明文 + 云端密文」正是 ADR-0080 那条承重假设要挡的组合，补一个字段会留下它；
2. 两端同模式意味着切换 payload mode 时要**重建/迁移本机库**，而没有任何现存机制；
3. 两个候选修法在"用户选了 vault 加密而账号是 readable"时会给出**相反**的赢家。

## 4. 现量（收工前跑的）

| 判据 | 读数 |
|---|---|
| `pnpm typecheck` | **rc=0** |
| 19 道门禁（design / text-color / tokens / theme / persistence-keys / ui-language / layering / reachability / empty-state / **state-tiers** / ui-provider / entry-table / **tag-resolution** / row-single-source / selection-single-source / control-semantics / l4 / docs / md-tables） | 逐条 **rc=0** |
| `apps/web` | **2793 passed / 0 failed** |
| `apps/mobile` | 1327 passed |
| `packages/ui` | 921 passed |
| iOS 重装（`reinstall:all --only ios`） | ✅ 已清旧包、重打、重装、有当前产物判据（`heyta-reinstall-ios.png` 内容占比 53.5%） |
| **macOS 重装（`reinstall:all --only mac`）** | ✅ 已清旧包、重打、卸旧、装新、有当前产物判据（窗口 2412×1552、webview 内容占比 **100.0%**、主蓝命中 842） |
| macOS **公证** | ⚠️ **没通过**：`Error: HTTPClientError.connectTimeout`（Apple 侧超时）。包本身**已签名可用**，只是没装订票据。⚠️ 脚本在这一档**仍然整体 rc=0**，所以"✅ mac"那一行**不等于**公证通过 —— 单独读打包日志的 ⑥ 段 |
| iOS 设备腿 | ❌ 停在判据 A 之后的同步（§3） |

## 5. 工作树里**不是我**的改动（一个字没碰）

```
 M .gitignore                                  软著材料忽略规则
 M AGENTS.md + A docs/agents/entry-layers.md   入口分层规则
 A docs/plans/reverse-learning-to-prd-2026-11.md
 A docs/research/industry-ux-baseline-2026-11.md
 M apps/desktop-windows/scripts/package-msix.ps1
 M scripts/check-windows-signing-posture.mjs
 M scripts/reinstall-all.sh
?? .arms-YE8le9/m.py
```

⚠️ 我**清掉了自己那几趟产生的 `apps/mobile/evidence/ios-account-erasure-{1..6}*`**：
其中有 `*dump.json`（`describe-all` 会把输入框的值一起抄进去 ⇒ 本机一台明文凭据）
与填写态截图。理由与脚本文件头那段同一条：**证据目录会被并行会话按目录扫、提交**。

## 6. 明早第一件事

1. 读 [`mobile-plaintext-sync-gap-2026-11-08.md`](mobile-plaintext-sync-gap-2026-11-08.md) §4，
   裁决两个问题；2. 修完之后设备腿应能一路跑到判据 D/E；
3. 再跑 macOS / Windows / Android 三段（`pnpm reinstall:all`，不带 `--only`）。
