/**
 * 门禁：**macOS 原生壳的跨语言那一层**。
 *
 * 与 `check-windows-shell.mjs` 同构：打包 TS 门面 → 跑那个平台上的无头冒烟。
 * 两个壳加载的是**同一个** bundle，所以这里顺带证明了"一份产物、多个原生壳"。
 *
 * ⚠️ 如实标注的三条边界：
 *   · 不是 macOS、或没有 `swift` → **显式报告"已跳过"**，不是假装通过；
 *   · 它**不验**窗口（窗口要图形会话；那条路由 `HEYTA_SELF_CAPTURE` 单独验）；
 *   · macOS 侧目前只有 14 条冒烟，**还没有**把 Windows 那条 50 条的
 *     原样契约在 JavaScriptCore 上重放。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_DIR = join(ROOT, 'apps/desktop-macos');
const BUNDLE_SCRIPT = join(ROOT, 'packages/app-host/scripts/build-native-bridge.mjs');
const BUNDLE = join(ROOT, 'packages/app-host/bridge-bundle/native-bridge.js');

const has = (command, args = ['--version']) => {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

if (process.platform !== 'darwin') {
  console.log(`⚠️  当前平台是 ${process.platform} —— macOS 原生壳的冒烟**已跳过**。`);
  console.log('    （Package.swift 声明的是 macOS 14+；其它平台本来就构建不了。）');
  process.exit(0);
}

if (!has('swift')) {
  console.log('⚠️  未找到 `swift` —— macOS 原生壳的冒烟**已跳过**。');
  console.log('    ⇒ Swift ↔ TS 那一层这一轮**没有被验过**，不要当成"壳已经能跑"。');
  process.exit(0);
}

// ① 打包门面（与 Windows 门禁共用同一个脚本与产物）
const bundled = spawnSync(process.execPath, [BUNDLE_SCRIPT], { stdio: 'inherit', cwd: ROOT });
if (bundled.error || bundled.status !== 0) {
  console.error('❌ 打包 TS 门面失败');
  process.exit(bundled.status ?? 1);
}
if (!existsSync(BUNDLE)) {
  console.error(`❌ 打包脚本跑完了但产物不存在：${BUNDLE}`);
  process.exit(1);
}

// ② 同步设计系统 token 生成物（G3）。
//
// 🔴 为什么门禁要负责同步：`Sources/HeytaMac/Generated/HeytaTokens.swift`
// 是**派生物**（已 gitignore），从 `tokens.css` 的产物复制而来。
// 让门禁来同步 ⇒ 干净检出也能构建 UI 目标。
//
// ⚠️ **"真源一致性"不在这里验** —— 那是 `check:tokens`
// （`design-system` 的 `generate:check`）的职责，它比对的是**入库的**生成物
// 与 `tokens.css`。这里若也去比对本机那份派生物，只会得到
// "报一句 ❌ 然后自己覆盖掉、最后 exit 0" 这种**看着在跑其实没验**的形状
// （本门禁第一版就是那样，被反假通过当场抓出来）。
const tokens = spawnSync('bash', [join(PACKAGE_DIR, 'scripts/sync-tokens.sh')], {
  stdio: 'inherit',
  cwd: ROOT,
});
if (tokens.error || tokens.status !== 0) {
  console.error('❌ 同步设计系统 token 生成物失败');
  process.exit(tokens.status ?? 1);
}

// ②b 🔴 **断言壳真的在消费 token，而不是又写回了裸值。**
//
// 这是 G3 的实质判据：`HeytaTokens.swift` 生成出来**没人用**，
// 和它不存在是一回事（那正是本轮之前的状态 —— 生成 19,331 B、0 消费者）。
// 所以这里数**消费点**，不数"文件在不在"。
// ⚠️ 门槛设得低（≥5）是故意的：它防的是"整片写回裸值"，
//    不是防"少用了两个 token"。设高了会变成一动就红的假门禁。
const UI_SOURCE = join(PACKAGE_DIR, 'Sources/HeytaMac/HeytaMacApp.swift');
const TOKEN_USAGES = ['space1', 'space2', 'space3', 'space6', 'fontSize3xl', 'fontSizeSm', 'fontSizeXs'];
const uiSrc = readFileSync(UI_SOURCE, 'utf8');
const used = TOKEN_USAGES.filter((name) => uiSrc.includes(`HeytaTokens.Light.${name}`));
if (used.length < 5) {
  console.error('❌ macOS 壳没有在消费设计系统生成物 —— 那是 P4（设计变量单源）的违约。');
  console.error(`   期望至少 5 个 \`HeytaTokens.Light.*\` 消费点，实际命中 ${used.length} 个（${used.join(', ') || '无'}）。`);
  console.error('   ⇒ 别把尺寸/字号写回裸值；改用生成物，见 apps/desktop-macos/scripts/sync-tokens.sh。');
  process.exit(1);
}
console.log(`✅ macOS 壳消费设计系统生成物：命中 ${used.length}/${TOKEN_USAGES.length} 个断言项。`);

// ③ 无头冒烟。**继承 stdio**，让每条断言直接出现在门禁输出里。
const smoke = spawnSync('swift', ['run', 'heyta-smoke'], {
  stdio: 'inherit',
  cwd: PACKAGE_DIR,
  env: { ...process.env, HEYTA_BRIDGE_BUNDLE: BUNDLE },
});
if (smoke.error) {
  console.error(`❌ 冒烟没能启动：${smoke.error.message}`);
  process.exit(1);
}
process.exit(smoke.status ?? 1);
