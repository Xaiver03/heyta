# iOS 设备腿 · 2026-11-07/08 那一趟（探针 8 处缺陷 + 一个待裁决的产品缺口）

> 这一晚把「四端交付」的 iOS 腿从**跑不起来**推进到**跑到判据 D/E**，
> 过程中修掉 **8 个探针缺陷**，每一个都是"报出来的话指向别处"。
> 同时挖出**一个产品侧缺口**（下面 §3），它才是这条腿现在不过的真正原因。
> 状态：🔴 **设备腿未通过**；探针已可信，缺口已定位但**未裁决**。

---

## 1. 现在跑到哪一步

```
✅ 0 现场与归属（设备 / 新鲜度 / 服务端 / AX 接口 / 别人的验收）
✅ 1 全新态起 App，处置首启两屏
✅ 2 三个凭据填进设置面（服务器地址 / 口令 / 令牌）
✅ 3 界面上建一条便签（先点「收集箱」落点，再写）
✅ 4 判据 A：注销**前**本机库在盘上、ops>0、明文命中 1（阳性对照成立）
❌ 4.5 配对腿：便签之后的同步**没成** —— 见 §3
⬜ 5 判据 B（换坏令牌 ⇒ 库必须还在）
⬜ 6 换回真令牌并同步
⬜ 7 DELETE /api/account ⇒ 410
⬜ 8 判据 C（设备读到「账号已注销」）
⬜ 9 判据 D（Library 里残留 0 枚 + 内容级 0 命中）
⬜ 10 判据 E（重启一趟残留仍是 0）
```

## 2. 修掉的 8 个探针缺陷（全部有实测读数）

| # | 症状 | 真因 |
|---|---|---|
| 1 | 「设置」滚不进可见区 | 可达名写成"标题+副标题拼串"；`SettingsRow` 只把 `label` 给 `accessibilityLabel`（`Settings.tsx:171`），hint 从不进可达名 |
| 2 | 设置面没打开 | 设置是**两层**：总览 → 数据与同步 → 自托管表单 |
| 3 | 便签输入框找不到 | 它不在「我的」首屏，在「我的 → 便签」（`ProfileScreen.tsx:1133` 的 `profile:notes`） |
| 4 | 同步没被触发（90+90 秒空转） | **顺序**错了：先同步后建便签 ⇒ 那时还没有 op ⇒ `form.configured` 为假 ⇒ 按钮不在树上。实测：建便签前 found=False，建完 found=True |
| 5 | 服务器地址三次写不进去 | 收起态下**同名的说明行**也是 `服务器地址`（`AXStaticText`），`--list` 命中它 ⇒ 跳过展开 ⇒ `--set` 打在说明上。判据必须钉 `--role AXTextField` |
| 6 | `tap-outside-screen`（点不到「立即同步」） | shim 的 `screen_size` 取 `Application` frame = **386×678**（可视区），而逻辑屏是 **466×678** ⇒ y=703 被误判越界 |
| 7 | 滚不动（连拖 10 下 y 不变） | swipe 起点 x=200 压在「同步请求失败…」那段 StaticText 上，HID 拖拽被吃掉；x=340 一下就到 |
| 8 | 便签建出来了但同步不出去 | 落点 chip「收集箱」**要点一下**才算选中（`CaptureComposer.tsx:811`）；不点它，「新建落进收集箱」只是一句描述 |

## 3. 🔴 产品侧缺口（这才是腿不过的原因）

**现象**：凭据填好、按了「立即同步」，**服务端一条 op 都没收到** ——
`/api/sync/status` 的 `latestSeq` 一直是 **0**，服务端日志里也没有任何该账号的
`PLAINTEXT_REQUIRED` / `E2EE_REQUIRED` 审计事件。界面只说"同步失败"。

**读代码得到的因果链**（两段形状不同，这就是缺口）：

| 位置 | 行为 |
|---|---|
| `packages/app-host/src/host.ts:609` `requireLibraryOwner()` | 身份不符时 **`throw`** `LocalLibraryOwnedByAnotherAccountError` |
| `apps/mobile/src/sync/store.ts:196` | 只在 `try` 里接 `host.sync()`；抛出来的错误落进 `catch` ⇒ `reason:'unexpected'` |

⇒ 「本机库归属与当前登录账号不符」与「网络抖动」在界面上**长得一模一样**，
而处置完全不同（前者要销毁/重建本机库，后者等一会儿再试）。

**为什么这一条是产品缺陷而不是探针问题**：`unexpected` 那一支渲染的是原始 `message`，
而 `apps/mobile/src/sync/status-text.ts:77` 的 `KNOWN_FAILURE_REASON_COVERAGE`
是**编译期穷尽**的 —— 那里没有"归属不符"这一档，说明这条失败从设计上就没有被分过类。

**待裁决的两条路**（都改产品，今晚没做）：
1. 在 `SyncFailureReason` 里加 `'library-owner-mismatch'`（连带词条、`status-text` 的
   `satisfies` 见证、`syncFailureMessageKey` 映射、以及 web/desktop 两端的同一张表）；
2. 或让 `host.sync()` 把这一类**翻成** `{kind:'error', reason:'not-configured'}` ——
   不推荐：`not-configured` 会引导用户去重填凭据，而凭据本来就对。

**先要确认的事**：本机库到底是不是归属不符。探针现在会在步骤 2.5 打出
`meta` 表里的 owner 行（`META_KEYS.LOCAL_LIBRARY_OWNER`），拿它跟当前
`accountId + serverOrigin` 一对就知道。**下一趟第一件事就是读那一行。**

## 4. 环境侧的状态（明天接着跑要知道的）

- **测试服务端**：`PORT=3100`，`TEST_MODE=true`，库 `heyta_mobile_smoke`，
  启动命令见 `docs/plans/delivery-blocked-2026-11-07.md` §3。
  ⚠️ 它**不在**仓库的 npm 脚本里，是一条手工命令。
- **idb companion**：必须先 `mkdir -p /tmp/idb` —— 机器重启后那个目录不存在，
  companion 报 `GRPCCore.RuntimeError error 1`，而 `ensure_idb_companion` 只说
  "30 秒内没起来"（形状同 traps 那一族：症状指向别处）。
- **凭据文件**：`/tmp/heyta_mobile_{email,token,e2ee}.txt` 每趟重建
  （`heyta_e2e_fresh_account`），机器重启后 `/tmp` 会清空。
- **负载**：这一晚从 6 到 77 波动很大；判据 B/C/D/E 没跑到，所以还不清楚
  高负载会不会在设备腿上也制造假红（web 侧 traps #634 记过同类）。
