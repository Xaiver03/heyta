# 🔴 移动端同步在**明文账号**上是坏的（2026-11-07 夜间实测）

> 设备腿跑到判据 A 之后卡在这里。**这不是探针问题**，是产品侧一个可复现的缺陷，
> 而且它的症状与"网络抖动"在界面上完全一样。
> 状态：**未修**（本文只做定性 + 给出判据，修法需要裁决，理由见 §4）。

---

## 1. 现象（一条命令就能重现）

在 `TEST_MODE` 服务端（`PORT=3100`）+ 全新账号（`payload_mode = readable`）上：

1. 设备上把 服务器地址 / 端到端加密口令 / 访问令牌 三格填好、关掉设置面；
2. 回「我的」页，点「立即同步」；
3. 结果：

```
[INFO]  [user:402] Upload: 1 ops from client mw6ofg0m...      ← 客户端确实发了
{"event":"PLAINTEXT_REQUIRED","userId":402,"clientId":"mw6ofg0m-...",
 "errorCode":"PLAINTEXT_REQUIRED","surface":"ops","opsCount":1} ← 服务端拒了
```

`/api/sync/status` 的 `latestSeq` 一直是 **0**（一条 op 都没落地），
而设备上存着的那条 op 的 payload 是**明文对象**：

```json
{"payload":{"content":"ios-erase-012749","projectId":null,"isPinnedToToday":false}}
```

服务端的门（`payloadGateViolation`，ADR-0080）对 `readable` 账号要求
`isPayloadEncrypted === false` **且**载荷不是密文形状。现在客户端发的是
`isPayloadEncrypted: true` + 密文 ⇒ `PLAINTEXT_REQUIRED`。

## 2. 因果链（三个落点，读代码得到，一条条对得上）

| 落点 | 现状 |
|---|---|
| `packages/app-host/src/host.ts:812` `refreshPayloadMode()` | 读 `/api/sync/payload-mode`（**已实测该端点回 `{"mode":"readable"}`**），返回 `'plain'` |
| `packages/app-host/src/host.ts:778` `buildSyncClient(payloadMode)` | 有 `payloadMode === 'plain'` 分支（`encryptionMode: 'plain'`） |
| `apps/mobile/src/db/open-host.ts:110` `openAppHost({...})` | **没有传 `encryptionMode`** ⇒ 落到默认的 `password` 分支（`sync-wiring.ts:131`）⇒ `getPassword: () => config.password` ⇒ 有口令就加密 |

⚠️ 但**"补一个字段"未必是完整修法**：设备上的 op 明明是**明文**存进本地库的
（`state` 表物化出来的也是明文），而上传那条是密文 —— 也就是说
**本地库的加密模式与上传的加密模式是两个独立决定**，只改上传那一侧会留下
"本地明文 + 云端密文"这种组合，而 ADR-0080 那句承重假设是"**整库同模式**"。
⇒ 修之前必须先把这两处的关系写清楚（§4 的第二个问题）。

## 3. 为什么它比"同步失败"严重

- 界面上只说"同步失败"，**分不出**"服务端拒了载荷形状"与"网络抖了"；
  用户会一直重试，而重试永远不会成功。
- `packages/sync-client/src/client.ts:1198` 的 `isPayloadEncrypted: writeMode.mode === 'e2ee'`
  说明**上传形状完全由 writeMode 决定**，而 writeMode 由调用方（宿主）选择 ——
  也就是说"服务端说 readable、客户端仍发密文"这件事**没有任何一层会拦**。
- web / desktop 两端的落地情况**未核**（本文只核了移动端）。

## 4. 两个必须裁决的问题

1. **修在哪一层**：
   - (a) `apps/mobile/src/db/open-host.ts` 补 `encryptionMode`（最小改动，但见下一条）；
   - (b) `packages/app-host/src/host.ts` 让 `buildSyncClient` 看**服务端的 mode**而不是
     调用方传的字段（更彻底，但那会让"用户选了 vault 加密"与"账号是 readable"
     在同一个地方打架 —— 需要先写清谁赢）。
2. **本地库与上传是否必须同模式**：如果是（按 ADR-0080 的承重假设），那么
   本机库在切换 payload mode 时要不要**重建/迁移**？这一步没有任何现存机制。

## 5. 现在的判据（能红）

把上面 §1 那三步连起来跑，**服务端 `latestSeq` 必须 > 0**；
红了就说明这条链路没通。今天的读数是 **0**（红）。
设备腿里的落点是 `scripts/verify-mobile-ios-account-erasure.sh` 的
"步骤 3 之后那一发同步 + 配对腿「已是最新」"。
