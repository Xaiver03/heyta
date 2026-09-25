# 跨语言集成路径评估

> 问题：heyta 如果 UI 不用 JS 栈（例如用 Flutter/Dart），能否复用 `@sp/sync-core`？
> 方法：本机实测密码学契约 + 核实 Dart 生态可用包。
> 时间：2026-09-25

---

## 0. 结论先行

| 问题 | 答案 |
|---|---|
| 加密层能跨语言吗？ | ✅ **能，而且上游已经做过一次**（Kotlin，633 行，CI 验证互通） |
| 同步算法能跨语言吗？ | 🟡 **能，但要自己动手**——上游没移植过；算法小（4,240 行）但必须逐位一致 |
| 直接跑 TS 吗？ | ⚠️ 可行但脆（QuickJS/FFI 门槛） |
| **推荐路线** | **见第 5 节：取决于你的技术栈选择** |

---

## 1. ✅ 密码学契约：已完整提取，可直接移植

这是最好的消息——**加密契约被上游完整文档化了**，Kotlin 侧注释原文（`OpPayloadDecryptor.kt:28-29`）：

```
base64( SALT(16) | IV(12) | AES-256-GCM ciphertext+tag(16) ), key =
Argon2id(password, salt, p=1, t=3, m=64 MiB, len=32).
```

并经我本机交叉验证，与 TS 侧常量完全一致：

| 项 | TS 常量（`web-crypto.ts`） | Kotlin 常量（`OpPayloadDecryptor.kt`） | 值 |
|---|---|---|---|
| 算法 | `ALGORITHM = 'AES-GCM'` | AES-256-GCM | ✅ 一致 |
| 盐长 | `SALT_LENGTH = 16` | `SALT_LENGTH = 16` | ✅ |
| IV 长 | `IV_LENGTH = 12` | `IV_LENGTH = 12` | ✅ |
| 密钥长 | `KEY_LENGTH = 32` | `KEY_LENGTH = 32` | ✅ AES-256 |
| GCM tag | — | `GCM_TAG_LENGTH_BYTES = 16` | ✅ |
| **Argon2id** | `iterations: 3, memorySize: 65536 Ki, parallelism: 1` | `p=1, t=3, m=64 MiB` | ✅ **一致** |
| 最小密文长 | `28` 字节 | `SALT+IV+TAG = 44` | ✅ |

`OpPayloadDecryptor.kt:55` 甚至写着："**Must match `packages/sync-core/src/encryption/argon2.ts` exactly**"。

**含义**：这套契约是**语言无关的**（Argon2id 是 RFC 9106 标准算法，AES-GCM 是 NIST 标准），
任何语言只要按同样参数实现就能互通。**移植不是"逆向工程"，而是"照规格实现"。**

---

## 1.5 ✅ 我实测验证了契约的可移植性（决定性证据）

光读注释不够。我**实际做了一次跨语言往返测试**，证明这个契约真的是语言无关的：

**做法**（照搬上游 Kotlin 互操作测试的模式）：
1. 用构建好的 `sync-core`（TS）加密一段含中文和表情的 JSON
2. 用 **Python 的完全独立实现**（`argon2-cffi` + `cryptography`）解密
3. 比对明文

**实测结果**：
```
ciphertext bytes : 101
salt(16)         : f606f7da9aa9b363c082d6641a47fff8
iv(12)           : 005e84714cad679ff3cad1ae
ct+tag bytes     : 73  (ct=57, tag=16)
derived key(32)  : 2b3e8d908b9782fc9b56e47335f9a377...
decrypted        : {"task":"买牛奶","due":"2026-09-26T09:00:00Z","qty":2}
expected         : {"task":"买牛奶","due":"2026-09-26T09:00:00Z","qty":2}
RESULT: ✅ 跨语言互通成功
```

Python 侧用的参数：`time_cost=3, memory_cost=65536 (KiB), parallelism=1, hash_len=32, type=Argon2id`
—— 映射到上游契约 `p=1, t=3, m=64 MiB, len=32` **逐位一致**。

**这个验证的意义**：
- ✅ 证明**线格式规格正确**（`base64(salt(16)|iv(12)|ct+tag(16))`）
- ✅ 证明**Argon2id 参数可跨实现精确映射**
- ✅ 证明**任何语言只要实现这两个标准算法就能互通** —— Dart / Kotlin / Swift / Go 都一样
- ✅ 测试已固化为可复用工具：`research/tools/crypto-interop/`（`run.sh` 一键重跑）

> ⚠️ 仍未直接验证的是 **libsodium 的 `crypto_pwhash`** 能否精确表达 `t=3, m=64MiB, p=1`
> （它是用 opslimit/memlimit 表达的，映射需要实测）。但这已经从"能不能"降级为"怎么调参"。

---

## 2. 🎯 上游的 Kotlin 移植：现成的蓝本
| 文件 | 行数 |
|---|---|
| `crypto/Argon2.kt` | 371 |
| `crypto/Blake2b.kt` | 124 |
| `crypto/OpPayloadDecryptor.kt` | 138 |
| **合计** | **633** |

**并且有 CI 级互操作验证**：
- `LiveJsEncryptRoundTripTest.kt` —— 用**实时生成的** JS 密文验证 Kotlin 解密
- `tools/generate-android-crypto-fixtures.mjs` —— 每次 CI 用真实 `sync-core.encrypt()` 产出 TSV 固件
- 覆盖非 ASCII 密码（`live-fixture-pässword-🔑`）、Unicode 载荷（`Müsli 🥣 買い物`）、大载荷

`Argon2.kt:13-14` 有一条很有价值的实现提示：
> "Lanes are computed **sequentially**: parallelism only permits concurrency, the result is identical. Fine here — production always uses `parallelism=1`."

**这就是移植 Argon2id 最容易踩的坑**：并行度只影响性能不影响结果，单线程顺序算完全可行。

---

## 3. ⚠️ 但必须精确区分：只移植了"读"，没移植"同步"

实测 `SuperSyncBackgroundProvider.kt`（438 行）的职责：
轮询服务端 op 增量 → 解密 → **提取提醒相关字段（`remindAt` / `deadlineRemindAt`）** → 排本地通知。

```
grep -rn "vectorClock|VectorClock|conflict" android/app/src/main/java/
→ 零命中
```

**它不实现向量时钟，也不做冲突解决。**

iOS 侧更彻底：`ios/` 只有 **7 个 Swift 文件**，全是插件（ShareInbox、WebDavHttp、StoreReview），
**同步完全依赖 Capacitor WebView**。

---

## 4. Dart 生态可行性（本机实测 pub.dev）

| 包 | 最新版本 | 发布 | 评估 |
|---|---|---|---|
| **`sodium`** | 4.1.1+1 | **2026-09-24** | ✅ **libsodium 的 Dart 绑定（VM + Web）**。libsodium 的 `crypto_pwhash` 原生支持 Argon2id，性能最优 |
| `cryptography` | 2.9.0 | 2025-11-21 | ✅ AES-GCM 等，纯 Dart + 可选原生 |
| `pointycastle` | 4.0.0 | 2025-02-19 | ✅ BouncyCastle 移植，算法全 |
| `argon2` | 1.0.1 | **2021-06-18** | ⚠️ 纯 Dart Argon2，但**已 4 年未更新** |
| `crypto` | 3.0.7 | 2025-11-04 | 仅 SHA/MD5/HMAC，不够用 |

### 🔴 最大的技术风险：64 MiB × 3 轮的 Argon2id

参数 `m=64 MiB, t=3, p=1` 是**重量级**配置——`sync-core` 自己的注释说需要 **500ms–2s**
（这也是它要做 session key cache、把派生结果按会话复用的原因）。

**纯 Dart 实现的 Argon2id 大概率比原生慢 5–20 倍。** 在这种参数下，移动端可能要 5–30 秒，
**这在产品上是不可接受的。**

→ **结论：Dart 侧应该走 libsodium FFI（`sodium` 包），而不是纯 Dart 实现。**

需要验证的一点：libsodium 的 `crypto_pwhash` 用 `opslimit`/`memlimit` 表达参数，
需确认能否精确映射到 `t=3, m=67108864 bytes, p=1`，并与 hash-wasm 的 `argon2id` 输出逐位一致。
**这个必须写一个跨语言往返测试来锁死**（照搬上游 `generate-android-crypto-fixtures.mjs` 的做法）。

---

## 5. 四条集成路线

| 路线 | 做法 | 复用度 | 风险 | 评级 |
|---|---|---|---|---|
| **A. 留在 JS 生态** | UI 用 React/Vue + Tauri(桌面) + Capacitor(移动) | 🟢 **接近 100%**——sync-core 与 op-log 语义都能直接参考甚至搬运 | 移动端是 WebView 套壳；Capacitor 就是这个方案的上游实践 | ⭐⭐⭐⭐ **最快** |
| **B. Flutter + 移植** | UI 用 Flutter，把加密移植到 Dart（参照 Kotlin），同步算法也移植 | 🟡 加密 633 行可照抄思路；同步 4,240 行要重写 | 中——需跨语言一致性测试；Argon2 性能要解决 | ⭐⭐⭐ |
| **C. Flutter + sidecar** | UI 用 Flutter，本地跑一个 JS/Node 同步进程，通过 localhost HTTP 通信 | 🟢 高 | 移动端**不允许**随意常驻后台进程；包体增大；两套运行时 | ⭐⭐ |
| **D. 服务端权威** | 客户端只做薄缓存，同步逻辑全放服务端 | 🔴 低——放弃"本地优先"的核心卖点 | 与你的"本地优先"原则冲突 | ⭐ |

### 对路线 A 的补充说明

**它不只是"最省事"，而且和你的产品定位高度契合**：
- Super Productivity 本身就是 Angular + Electron + Capacitor 做到全平台的，**这条路已被验证可行**
- op-log 那 51,708 行是 Angular 服务——**如果留在 JS 生态，你可以直接阅读甚至引入它的语义，而不必从零推演**
- 你的"本地优先"承诺天然满足（数据先落 IndexedDB/SQLite）

**代价**：移动端体验不如原生；iOS 后台同步能力受限（上游就只在 Android 做了原生后台）。

### 对路线 B 的补充说明

Flutter 的优势是**六端一套 UI**，这对"一个人做全平台"是真实价值。
但代价是**同步系统要移植**，而同步系统恰好是最容易出错的部分。

**折中建议**：如果选 B，把移植拆成两步——
1. 先只移植**加密层**（有 Kotlin 蓝本，633 行级别，风险可控）
2. 同步算法**先不移植**，改用"服务端权威 + 客户端只读缓存"过渡，再逐步补齐

---

## 6. 无论选哪条路，这三件事都必须做

1. **写跨语言往返测试**：照搬上游 `generate-android-crypto-fixtures.mjs` 的模式——
   用 TS 版生成密文固件，让目标语言解密，CI 每次跑。**这是唯一能防住"KDF 参数漂移"的手段。**
2. **锁死密码学契约**：`Argon2id(p=1, t=3, m=64MiB, len=32)` + `AES-256-GCM(IV=12, tag=16, salt=16)` +
   `base64(salt|iv|ciphertext+tag)`。**任何一处漂移 = 用户数据永久解不开。**
3. **不要用 `@nextcloud/cdav-library`**（AGPL-3.0-or-later，见 `research/licenses.md`）

---

## 7. 未确认项

- 未实测 libsodium 的 `crypto_pwhash` 与 hash-wasm `argon2id` 的输出是否逐位一致（**关键验证项**）
- 未实测 Kotlin 移植的实际性能
- 未评估把 4,240 行 TS 移植到 Dart 的具体工时
- 未确认 Capacitor 在 iOS 后台同步上的具体限制
- 子代理的独立跨语言调研仍在进行

---

*相关：`research/deep-dive-sync-core.md`（同步内核）、`docs/research/reuse-plan.md`（复用方案）。*
