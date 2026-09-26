/**
 * 移动端入口。
 *
 * ⚠️ 这里**故意不写任何业务逻辑** —— 只有平台补丁与根组件注册。
 * 接线与动作在 `@heyta/app-host`（见 AGENTS.md §3.5）。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 Hermes 补齐的全局量 —— **必须在任何其它 import 之前执行**
//
// 顺序不是风格问题：下面是实测的 Hermes（RN 0.84.1 / Android release）全局量，
//
//     TextEncoder       function     ✅ 有
//     TextDecoder       undefined    ❌ 没有
//     crypto            undefined    ❌ 完全没有
//     getRandomValues   undefined    ❌
//     subtle            undefined    ❌
//     randomUUID        undefined    ❌
//     atob / btoa       function     ✅ 有
//     Buffer            undefined    ❌
//     WebAssembly       undefined    ❌ 没有（见下方 🔴）
//
// 而 `@heyta/sync-core` 的加密路径要用 `getRandomValues`（生成 IV / salt）
// 和 `TextDecoder`（把明文解出来）。缺了不会降级 —— 是**点「添加任务」时直接崩**：
//
//     ReferenceError: Property 'TextDecoder' doesn't exist
//     FATAL EXCEPTION: mqt_v_native
//
// ⚠️ 这两个 polyfill 是**平台差异**，放在 `apps/*` 是对的；
// 它们没有决定任何"业务上该怎么做"。
//
// 🔴 **`WebAssembly` 这一项不是"装个 polyfill"能补上的。**
// Hermes 没有 WASM，而 Argon2id 的来源 `hash-wasm` 就是 WASM 实现。
// 真机实测：填好服务器地址与令牌后点「立即同步」，得到的是
//
//     WebAssembly is not supported in this environment!
//
// 上面那张清单原来**漏了这一项**，于是"两个 polyfill 都装齐了"看起来像
// "加密路径就绪了" —— 而 Argon2id 在 Hermes 上根本走不通。
// 教训：盘点运行时能力时**漏一项就等于得出一个假结论**，
// 而缺的那一项恰好是决定性的时候，排查方向会被带偏到同步协议上去。
// 它不是平台差异、也不该由 polyfill 掩盖：见 `AGENTS.md` §7。
//
// 许可证（AGENTS.md §3.2 两道门已逐项核过）：
//   - react-native-get-random-values  v2.0.0  MIT        LinusU/... 最后提交 2025-10-22
//   - fast-text-encoding              v1.0.6  Apache-2.0 samthor/... 最后提交 2022-08-30
//     （后者只实现 UTF-8 编解码。该编解码器是标准固化的，没有"持续改进"的余地 ——
//      仓库未归档、上游明确把 API 冻结，这里按"功能完备"而非"停滞"对待。）
// ─────────────────────────────────────────────────────────────────────────────
import 'react-native-get-random-values';
import 'fast-text-encoding';

import { AppRegistry } from 'react-native';
import { Root } from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => Root);