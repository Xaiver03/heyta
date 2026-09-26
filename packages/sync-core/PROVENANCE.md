# 出处说明（Provenance）

本包**不是 heyta 原创代码**，是 vendored（内联复用）自开源项目的第三方代码。

## 来源

| 项 | 值 |
|---|---|
| 上游项目 | **Super Productivity** |
| 仓库 | https://github.com/super-productivity/super-productivity |
| 路径 | `packages/sync-core/` |
| **commit** | `aa9690ca28aa6751971dd0e47d9b39c5b72922cb` |
| **commit 日期** | 2026-09-24T20:59:28+02:00 |
| License | **MIT** |
| 版权 | Copyright (c) 2018 Johannes Millan |

原始 `LICENSE` 文件完整保留在本目录下，未作修改。

## 我们对上游代码做的改动

1. **`package.json` 的 `name`**：`@sp/sync-core` → `@heyta/sync-core`
   （已验证：`src/` 与 `tests/` 中**没有**对该包名的自引用，改名不影响任何代码）
2. 在 `package.json` 增加 `typecheck` script（与 `test:typecheck` 等价，便于工作区统一调用）
3. 🔴 **`src/encryption/web-crypto.ts`：把 `TextEncoder`/`TextDecoder` 从模块顶层 eager 求值
   改成惰性获取**（`TEXT_ENCODER` / `TEXT_DECODER` 两个常量 →
   `getTextEncoder()` / `getTextDecoder()` 两个函数），并同步更新
   `src/encryption.ts` 与 `src/encryption/legacy.ts` 里的 5 处调用。

   原因：原写法在模块**加载期**就执行 `new TextDecoder()`，而 React Native 的
   Hermes 引擎没有 `TextDecoder`（实测：`TextEncoder` 有、`TextDecoder` 没有、
   `crypto` 完全没有）。后果不是降级而是**崩溃**，且崩在 import 语句上：

   ```
   ReferenceError: Property 'TextDecoder' doesn't exist
   FATAL EXCEPTION: mqt_v_native  ← 位置是 loadModuleImplementation
   ```

   改成惰性后模块可被安全 import，真缺失时报的是清楚的错误。
   上游若将来修了这个问题，可以直接替换本文件。

   ⚠️ 这只是让失败可诊断，**不解决问题本身**：RN 宿主仍必须装
   `fast-text-encoding` 与 `react-native-get-random-values`
   （见 `apps/mobile/index.js` 顶部，那里记了许可证核查结论）。

4. 🔴 **`src/encryption/argon2.ts`：给 Argon2id 补上纯 JS 兜底后端，并加一条可注入的接缝。**

   Argon2id 原来只有一条实现：`hash-wasm` —— 一个 **WebAssembly** 模块。
   而 **Hermes 不支持 WebAssembly**，所以移动端在派生密钥时直接抛：

   ```
   WebAssembly is not supported in this environment!
   ```

   后果是移动端**一条数据都同步不出去**（服务端强制 E2EE，没有明文通道），
   而界面完全正常、报错又像基础设施问题，很容易被误判成同步协议的事。
   见 `AGENTS.md` §7 第 26 条。

   改动内容：
   - 保留 `hash-wasm` 作为默认后端（Web/Node 上快得多：实测 114–151ms）；
   - 新增 `@noble/hashes@^2.4.0`（**MIT**，`paulmillr/noble-hashes`，2026-09-08 仍在提交）
     的 `argon2idAsync` 作为**没有 WebAssembly 时**的兜底（实测 582–683ms）；
   - 新增 `setArgon2Provider()` 接缝，宿主将来有原生实现时可以覆盖；
   - `deriveKeyFromPassword()` 增加可选的 `options.onProgress`。

   **为什么这不是"降级后可能算错"**：两种实现在生产参数（64 MiB / 3 轮 / p=1）
   下已比对**逐字节相同**（`6ad10af9…5084`），且新增的
   `tests/argon2-fallback.spec.ts` 会**删掉 `WebAssembly` 后重跑同一条向量**，
   证明 Hermes 路径算出的密钥与 Web 端一致。换掉的是速度，不是语义。

   **为什么纯 JS 而不是写原生模块**：原生绑定要分别写 Android / iOS / 鸿蒙三套，
   而纯 JS 三端零平台工作 —— 这与 ADR-0004 选 React Native 的理由一致。

   🔴 **真机实测（Android 模拟器，Hermes，无 JIT）：第一次同步约 30–40 秒，
   同一会话内之后 1–2 秒。** 那 30–40 秒每次**应用会话只付一次** ——
   `session-cache.ts` 已缓存派生结果（加密密钥按口令、解密密钥按 `口令哈希:salt`）。
   但**这仍然是个体验问题**：30–40 秒里界面上只有一个转圈。
   「我的」界面现在会提前说明这段等待（`isArgon2SlowBackend()`）。
   ⚠️ **不要声称手机上很快**；V8 的 582–683 ms 只是理论下界，
   Hermes 没有 JIT，两者差约两个数量级。真正消掉它需要原生 Argon2 模块（**未做**）。

5. 🔴 **`src/vector-clock.ts`：`MAX_VECTOR_CLOCK_SIZE` 20 → 100，并在真的裁剪时打 warning。**
   决策与备选方案见 **`docs/adr/0008-vector-clock-limit.md`**（本节只记改了什么）。

   原因：heyta 的零 mock E2E 实测证明 **20 这个上限会致命**。服务端的 head 自己也被裁到
   同一个上限，而**两边保留条目的规则不同**（服务端保护 `op.clientId + protectedIds`，
   客户端只保护自己的 clientId）。于是只要真实时钟超过上限，客户端就可能少一个 head 有的键
   → 不再支配 head → 服务端把该设备写的**每一条** op 判成 `CONFLICT_CONCURRENT` 并**永久拒绝**，
   而客户端只表现为"同步不上"。**"两边各自裁剪"这个形状本身是错的。**

   改动内容：
   - `MAX_VECTOR_CLOCK_SIZE`：`20` → `100`（服务端的 DoS 上限由 `ceil(MAX × 2.5)` 派生，随之到 250）；
   - `limitVectorClockSize` 在发生裁剪时 `console.warn`，带上实际条数与上限 ——
     上一次这个故障是**完全静默**的，这条日志是已知限制**唯一的出口信号**。

   ⚠️ **这是把墙挪远，不是把墙拆掉。** 因果安全的压缩（ADR-0008 选项 B）**没有做**。

   `tests/vector-clock.spec.ts` 有 6 条测试用**写死的 20/21/25/35** 构造"超过上限"的时钟，
   已全部改为跟着 `MAX_VECTOR_CLOCK_SIZE` 走（并补"输入确实超限"的前提断言）。
   写死数字的边界测试会在常量变动时**静默停止测试任何东西**。

**除此之外，`src/` 的代码与上游一致；`tests/` 仅在上述第 5 条涉及的边界数据构造上做了常量化的调整。**

> 保持改动最小是刻意的：这样将来上游修 bug 时，我们可以直接 diff 并同步。
> 上面第 3、4 条都是**同一个根因**：上游代码假定了浏览器/Node 的运行时能力，
> 而 Hermes 缺其中几项。上游若将来自己处理了，这两条都可以直接撤掉。

## 为什么 vendor 而不是依赖 npm

`@sp/sync-core` **没有发布到 npm**（`registry.npmjs.org/@sp%2fsync-core` → `{"error":"Not found"}`），
上游是把它作为 monorepo 内部工作区包使用的。因此只能内联。

## 为什么可以这样用（许可证依据）

MIT 许可证允许"use, copy, modify, merge, publish, distribute, sublicense"，
条件是**保留版权声明与许可声明**。我们保留了原始 `LICENSE` 文件，
并在仓库根的 `THIRD_PARTY_LICENSES.md` 中登记了归属。

**MIT 允许闭源商用**，不受 heyta 自身许可证选择（见 `docs/adr/0001-license-decision.md`）的影响。

## 更新上游代码的方法

```bash
# 1. 拉取上游
git clone --depth 1 https://github.com/super-productivity/super-productivity /tmp/sp

# 2. 看上游在 vendored commit 之后改了什么
git -C /tmp/sp log --oneline aa9690ca..HEAD -- packages/sync-core/

# 3. 只有在确认需要时，才把改动搬过来并更新本文件的 commit 记录
```

## ⚠️ 不要修改本包代码

heyta 自己的逻辑**不应该写在这里**。集成代码请放在 `packages/domain/` 或应用层，
通过 `src/ports.ts` 里的 7 个 host Port 接入。

改动本包会让"跟随上游更新"变得昂贵。
