#!/usr/bin/env node
/**
 * 把 **TS 门面**打成原生壳要加载的那一个 JS 文件。
 *
 *   node packages/app-host/scripts/build-native-bridge.mjs
 *   → packages/app-host/bridge-bundle/native-bridge.js
 *
 * ## 为什么它住在 `packages/app-host`，而不是某个 app 里
 *
 * 现在有**多个**原生壳要加载同一份东西了（Windows 的 WinUI 3、macOS 的 SwiftUI，
 * Linux 的 GTK4 也是同一份）。所以：
 *
 *   · 门面源码在 `src/native-bridge.ts` —— 放在这个包里才能解析 `@heyta/*`，
 *     而且**自动进入本包既有的 typecheck**（放在 `apps/xxx/bridge/` 就不会有人管它）。
 *   · 产物在 `bridge-bundle/` —— **一个**构建产物，几个壳各自拷到自己二进制旁边。
 *     每个壳自己打一份的话，就是"N 份产物可能漂移"的老问题。
 *
 * ⚠️ 产物**不入库**（构建产物）。各壳的构建会在缺它时**明确报错**，而不是等运行时白屏。
 *
 * ## 谁在用它
 *
 * | 壳 | 加载方式 |
 * |---|---|
 * | `apps/desktop-windows`（WinUI 3） | Jint 直接执行这个文件；驱动由 C# 注入 |
 * | `apps/desktop-macos`（SwiftUI） | JavaScriptCore 直接执行这个文件；驱动由 Swift 注入 |
 *
 * 两边都靠 `globalThis.__heytaDriverFactory` 拿到**同步** `SqliteDriver` ——
 * 契约只有这一条（见 `src/native-bridge.ts` 头部）。
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, '..');
const ROOT = join(PACKAGE_ROOT, '..', '..');
const ENTRY = join(PACKAGE_ROOT, 'src/native-bridge.ts');
const OUT = join(PACKAGE_ROOT, 'bridge-bundle/native-bridge.js');

const result = spawnSync(
  process.execPath,
  [
    join(ROOT, 'research/tools/bundle-spike.mjs'),
    '--entry', ENTRY,
    '--out', OUT,
    '--global', 'HeytaApp',
  ],
  { stdio: 'inherit', cwd: ROOT },
);

if (result.error) {
  console.error(`❌ 打包失败：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
