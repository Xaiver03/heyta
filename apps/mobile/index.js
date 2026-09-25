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