# ADR-0070：共享清单的「成员可见状态变了」另立一条 WS 信号，并撤掉面板与入群对话框那两枚轮询

- **状态**：已接受（2026-10-23，产品判定权已交给本线，见文末「由谁拍」）
- **日期**：2026-10-23
- **相关**：[ADR-0062](0062-shared-list-key-distribution.md) 决策 7（实时信号只说"哪一份动过"、不带内容）、
  [ADR-0068](0068-share-member-identity-and-content-publication.md) §五（成员信封由 owner 异步下发）、
  [ADR-0069](0069-share-op-per-op-signing-keys-and-disposition.md)（签名公钥发布是成员可见状态的一部分）、
  [ADR-0019](0019-upload-rejection-does-not-block-download.md)（信号丢失不许变成数据丢失）

---

## 一、要解决的问题

共享面板显示的是**清单详情 + 成员名册**（`GET /shares/:id` 与 `GET /shares/:id/members`）。这两份状态的一半
变更**发生在别的设备上**：被邀请的人在另一台机器点了「接受」、owner 在另一台机器补发了信封、成员自己换机后退出。

今天的做法是轮询：面板开着时每 3s 重取一次（`apps/web/src/features/share/ShareFeature.tsx:348`），
入群对话框等信封时同样每 3s 重取一次（`apps/mobile` 将来也要走的那条 `JoinSharedListDialog.tsx:217`）。

服务端侧的事实（现量，别照本文推）：

- `notifyShareOps` 全仓**恰好两处**命中 —— 定义 `server/src/sync/services/websocket-connection.service.ts:434`、
  唯一调用 `server/src/shares/share.routes.ts:946`（share log 追加路径）。
- 其余十条改成员可见状态的写路径**一条信号都不发**：发邀请 / 吊销邀请 / 接受邀请 / 改角色 /
  信封下发 / 签名公钥发布 / 移除成员 / 退出 / 转让（创建清单只影响本人，走个人 op-log，不在内）。
- 客户端 `packages/sync-client/src/realtime.ts` 只认三类消息（`connected` / `new_share_ops` / `new_ops`），
  其余静默忽略（:469-470）—— 所以**加一类事件对老客户端是安全的**，它本来就忽略未知类型。

## 二、三个选项与结论

| 选项 | 内容 | 判定 |
|---|---|---|
| 甲 | 新增一类 WS 事件 `share_roster_changed`，在上述九条写路径上逐条发 | ✅ **采用** |
| 乙 | 复用 `new_share_ops`，让客户端"顺手"重取成员 | ❌ 否。那条事件的载荷是 `latestSeq`，语义是"这份日志有第 N 条 op"；把它当成员变化用，要么污染下行游标判断（`share-signals.ts` 按**日志差集**决定拉不拉），要么逼宿主为一条假 seq 走一次无意义的下载。两件事被塞进一个名字，下次读到那条信号的人无法判断该拉什么 |
| 丙 | 保留轮询，只把间隔调长 | ❌ 否。用户读到的是"对面接受了但我的面板不动"，而这条线的产品承诺是实时可见；且**移动端不该照抄一枚定时器** —— M6 的面板要建在同一套信号上，先留轮询等于把债复制一遍 |

## 三、裁决（六条，每条都可失败）

1. **事件形状**：`{type:'share_roster_changed', shareId, timestamp}`。🔴 **不带任何内容、不带序号、不带成员名单** ——
   与 `new_share_ops` 同一条安全契约（服务端本来也只有密文与元数据），信号被 MITM 看到只多知道"这份清单的成员面动过"。
2. **扇出对象**：该 share 当前全部成员（`removedAt: null`）的**全部**在线连接，**不排除发起方**（`excludeClientId = null`）。
   理由是形状决定的，不是省事：owner 的**另一台**设备也要知道名册变了；而发起方那一台多刷一次是幂等的读请求。
   排除自己会让"同一账号另一台设备"跟着漏掉，那条 bug 在界面上表现为"只有我操作的这台在动"。
3. **发送时机**：**写成功之后**才发，且发送失败**不许影响写结果**（沿用 `share.routes.ts:946` 那块的 `try/catch + Logger.warn` 形状）。
   信号是提示不是数据通道：丢信号的后果是"对端晚一点才看到"，由下一次真实读取或下一条信号补上（ADR-0019 同一条纪律）。
4. **客户端只搬运，判断住宿主**：`realtime.ts` 把 `shareId` 原样交给 `onShareRosterChanged`；
   回调抛错不许掀连接、消息形状不合格（`shareId` 非 string）静默丢 —— 与 `new_share_ops` 四条臂逐字对齐。
   "该不该重取、一次变化吵几次"住 `packages/app-host`，外壳只装配投递（AGENTS §3.5）。
5. **重取按 shareId 合并**：同一份清单在途重取未结束时再来信号 ⇒ 不并发第二次，只记"结束后再取一次"。
   一次信号吵一次不等于一秒内吵五次 —— 接受邀请会在几十毫秒内连着触发成员与签名公钥两次写。
6. **撤掉两枚轮询，不做兜底定时器**：`ShareFeature` 与 `JoinSharedListDialog` 里不许再出现 `setInterval`。
   ⚠️ 面板那枚定时器今天同时是 `autoSeal` 与 `ensureSigningKey` 两条补发链的唯一驱动，撤它必须把这两条链
   挂到同一次重取之后，否则"界面不轮询了"会以"信封永远补不出去"的形式付账。

## 四、后果

- 面板上"对面接受邀请 / 信封到位 / 角色被改"的延迟从 ≤3s 变成 ≤一次往返；移动端接同一条信号，不必带一套定时器。
- 服务端每条成员写路径多一次 `shareMember.findMany` + 扇出。这些路径都是人按一次按钮的量级，不去抖
  （`notifyShareOps` 文件头那条"有读数依据再优化"的判断同样适用）。
- 老客户端（没认这类事件的壳）行为不变：忽略未知类型 ⇒ 它继续只在 op 变化上动，成员变化要等它自己重开面板。
  **这是降级不是破坏**，所以不 bump `CURRENT_SCHEMA_VERSION`、不动 `packages/shared-schema`
  （WS 事件名从来只住服务端字面量与 sync-client，先例即 `new_share_ops`）。
- 判据口径新增一格常驻断言：**这两份源码里不许有定时器**，撤臂会红。

## 五、由谁拍

负责人 2026-10-22 的授权口径是「你从产品的角度看一下，这个应该怎么办？允许你来拍板」，
2026-10-23 追加「以 M6 完成为目标，尽可能并行启动多个 Agent」。本题不属于对外法律表征、
也不动不可逆层 ⇒ 本线按产品视角定案，翻案条件：**若将来出现"信号风暴"读数（同一 share 每秒 ≥2 条）**，
按 §3 第 5 条把合并窗口从"在途一次"改成"固定 2s 窗口"，并在此追加勘误段而非改写本节。

## 六、事实基线与现量命令

这一节写的是**立这份 ADR 那一刻**（2026-10-23）的读数，保留是为了让下一位看清当时怎么判的；
HEAD 在动，照下面三条现量，别抄本节正文：

- `grep -rn "notifyShareOps" server/src` ⇒ 当时是 2 行（定义 + share log 追加路径那一处调用）。
- `grep -rn "setInterval" apps/web/src/features/share/` ⇒ 当时两枚命中（面板 + 入群对话框）。
- `grep -n "message.type ===" packages/sync-client/src/realtime.ts` ⇒ 当时三类；本批加第四类。

落地后的实施记录与读数写回 `docs/plans/collaboration-shared-lists.md` 的 M5 收尾那一节。
