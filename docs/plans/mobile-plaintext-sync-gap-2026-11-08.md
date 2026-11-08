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

## 4.5 双向复现（不是一次性的巧合）

同一条链路**跑两趟，两趟都出现同一条审计事件**，而 `latestSeq` 两趟都是 0：

| 趟 | `PLAINTEXT_REQUIRED` 计数 | 该账号 `latestSeq` |
|---|---|---|
| 跑之前 | 10 | — |
| 跑之后 | **11**（+1，正是这一趟那次上传） | **0** |

⇒ 载荷形状与服务端门之间是**确定性**的不匹配，不是时序/负载造成的偶发。
（复现命令：`PORT=3100 bash scripts/verify-mobile-ios-account-erasure.sh`，
`IOS_UDID` / `DEVICE_NAME` 见文件头；服务端审计事件与 `/api/sync/status` 是两个独立信源。）

## 4.55 安静机器上再跑一次：同一条失败（排除"负载造成的偶发"）

`uptime` 读数 **6.03 / 7.02 / 9.46**（这一晚最安静的一段）下重跑设备腿：

```
PLAINTEXT_REQUIRED: 12 → 13      ← 又是一次
❌ 同步之后没读到「已是最新」
通过 11 项，失败 1 项
```

⇒ **与负载无关**。这也是这一晚第四次独立复现（前三次分别在 11 / 12 / 20+ 的负载下）。

## 4.6 第三个独立信源：**当场再复现一次**（不重装、不改代码）

用一条只读探针（`/tmp/probe-payload-shape.sh`）在**不重装、不改代码**的前提下再点一次
「立即同步」：

```
立即同步 found=True
审计事件计数：跑之前 11 → 跑之后 12      ← 又是一次 PLAINTEXT_REQUIRED
最近三条审计：…"PLAINTEXT_REQUIRED","userId":404
该账号 latestSeq：0
该账号 payloadMode：{"mode":"readable"}
```

⇒ 服务端一句话(`readable`)、服务端门禁一句话(`PLAINTEXT_REQUIRED` ×3)、
客户端上传形状(每次 +1)三个信源同时成立。**这不是时序、不是负载、不是探针。**

## 4.9 ✅ 已修：服务端侧的两个独立读数都翻了

修法（`cd6034527`）与它的两个落点写在提交信息里；这里只记**读数**：

| 读数 | 修之前（4 趟） | 修之后 |
|---|---|---|
| 服务端审计 `PLAINTEXT_REQUIRED` | 每趟 **+1** | 这一趟 **+0**（13 → 13） |
| 该账号 `/api/sync/status` 的 `latestSeq` | **恒 0** | **1** |
| `storageUsedBytes` | 0 | **106** |

⇒ 设备上建的那条便签**真的上传成功并落到服务端**了。这条链路第一次通。

⚠️ 同一次运行的**界面腿**仍红，但那是另一件事：`uptime` 读数
**102.17 / 141.03 / 88.92** —— 陷阱 #634 记的正是这个形状（高负载下界面探针批量假红）。
所以这一次只作"协议层已通"的证据，不作界面结论；界面腿要在安静机器上重跑。

## 4.95 ✅ 设备腿自己也读到了：`已是最新`

同一条腿、同一份产物上：

```
✅ 同步成立：界面上读得到「已是最新」
通过 14 项（此前 11）
PLAINTEXT_REQUIRED 停在 13（不再 +1）
```

⇒ 不只是"服务端收了"，**设备界面上也读到了同步成功**。这条缺陷从头到尾关掉了。

（同趟后续的两条红是**探针**的：`open_settings_sheet` 被调用三次而第二次人还在设置面里，
「设置」被盖着 ⇒ 报「滚不进可见区」；已修，见 `7ca0fde82`。）

## 5. 现在的判据（能红）

把上面 §1 那三步连起来跑，**服务端 `latestSeq` 必须 > 0**；
红了就说明这条链路没通。今天的读数是 **0**（红）。
设备腿里的落点是 `scripts/verify-mobile-ios-account-erasure.sh` 的
"步骤 3 之后那一发同步 + 配对腿「已是最新」"。
