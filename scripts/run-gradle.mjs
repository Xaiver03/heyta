#!/usr/bin/env node
/**
 * 跨平台 Gradle wrapper 启动器
 * ============================
 *
 * 为什么需要它：`apps/mobile` 的 Android 脚本原本写的是
 * `cd android && ./gradlew assembleDebug`。这在 macOS / Linux 上没问题，
 * 在 Windows 上**必然失败**——cmd 里没有 `./gradlew` 这个可执行文件，
 * 只有 `gradlew.bat`（无扩展名的 `gradlew` 是给 sh 用的）。
 * 实测报错：
 *
 *     '.' 不是内部或外部命令，也不是可运行的程序或批处理文件。
 *
 * 而 pnpm 在 Windows 上是用 cmd 执行 script 的，所以这不是"换个写法"能绕过去的：
 *   `./gradlew`  → POSIX 行，cmd 不行
 *   `gradlew`    → cmd 靠 PATHEXT 找到 `gradlew.bat`，POSIX 不行（当前目录不在 PATH）
 *   `sh gradlew` → Windows 没有 sh
 *
 * 三种写法各挂一边，所以只能由 Node 来判断平台。额外好处：Gradle 的退出码
 * 原样透传，`pnpm build:android` 的成败不会再被 shell 吃掉。
 *
 * 用法（cwd 必须是 apps/mobile）：
 *   node ../../scripts/run-gradle.mjs assembleDebug
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const androidDir = join(here, '..', 'apps', 'mobile', 'android');

const isWindows = process.platform === 'win32';
// Windows 上必须显式走 `gradlew.bat`，且 Node 18+ 出于安全考虑要求
// 用 shell 才能启动 .bat/.cmd。
const command = isWindows ? 'gradlew.bat' : './gradlew';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('run-gradle: 需要至少一个 Gradle 任务名，例如 assembleDebug');
  process.exit(2);
}

const result = spawnSync(command, args, {
  cwd: androidDir,
  stdio: 'inherit',
  shell: isWindows,
});

if (result.error) {
  console.error(`run-gradle: 无法启动 ${command}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
