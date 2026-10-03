#!/usr/bin/env node
/**
 * `check:mobile-first-run-gate` —— 安卓验收脚本必须处置**首启隐私同意面板**，
 * 而且处置只能有一份实现。
 *
 * ## 它钉的是哪件事（2026-10-03 实测）
 *
 * `apps/mobile/src/privacy/startup.ts` 在冷启动且"从没被问过"时会弹一块
 * `accessibilityViewIsModal` 的 RN Modal（标题「在使用联网功能之前」）。
 * 它立着的时候，**欢迎页与主界面的节点根本不在无障碍树里**。
 *
 * 而 `pm clear` = 全新设备 = 从没被问过 ⇒ 每个"清数据再冷启动"的验收
 * 都会撞上它。这块面板 2026-10-01 落地时，五个安卓脚本各抄了一份处置，
 * `verify-mobile-auth.sh` **谁也没抄到** —— 那一轮 17 条判据全红，
 * 报出来的是「冷启动第一屏没有注册 / 登录」「找不到输入框：邮箱」「找不到新建按钮」，
 * 读起来像产品坏了，实际一条都没坏。
 *
 * ## 为什么这条要成门禁而不是纪律
 *
 * 「抄一份处置」这件事的正确版本是**共享库里那一份**（`handle_privacy_consent`）。
 * 少抄一份 = 整轮假红；多抄一份 = 五份会漂（等待时长、按哪颗按钮、
 * 要不要复验面板真的走了，三份各不相同）。两种失效都不会自己说话，
 * 所以只能由门禁说话。
 *
 * ## 判据（任一不成立即红）
 *
 * 1. **处置在位**：凡 `pm clear` 之后还要靠无障碍树驱动界面的脚本，必须能
 *    走到共享实现 —— 自己调 `handle_privacy_consent`，或调
 *    `dismiss_welcome_if_present`（它第一件事就是收这块面板）。
 * 2. **只能有一份实现**：任何脚本里名字含 `consent` 的函数**不得**自己
 *    `$ADB shell input tap` —— 那是第二份实现，正是漂移的起点。
 *    唯一允许带点击动作的地方是 `scripts/lib/mobile-e2e.sh`。
 * 3. 🔴 判据 1 的成立方式必须**打印出来**（直接调 / 经欢迎页 helper），
 *    否则"它满足了判据"和"它其实什么都没做"在输出上长得一样。
 *
 * 变异验证（两条都会红，实测过）：
 * - 从 `verify-mobile-auth.sh` 删掉 `handle_privacy_consent` 那一行 ⇒ 判据 1 报缺处置；
 * - 往任意脚本里塞一份带 `input tap` 的 `dismiss_consent_xxx()` ⇒ 判据 2 报重复实现。
 *
 * ## 范围为什么排除 `-ios.sh`
 *
 * iOS 那条走无障碍 API（`ax --pressable --press`），不是 `uiautomator` dump +
 * 坐标点击，它的 `grant_network_consent_if_asked()` 是**另一套技术**下的同级实现，
 * 不能共用这个探针。它自己的判据在 `verify-mobile-ios.sh` 里。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const LIB = 'scripts/lib/mobile-e2e.sh';
const SHARED = 'handle_privacy_consent';
const WELCOME_HELPER = 'dismiss_welcome_if_present';

const files = execFileSync('git', ['ls-files', 'scripts/verify-mobile-*.sh'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.sh') && !f.endsWith('-ios.sh'))
  .sort();

/** 取出名字含 consent 的函数体（从定义行到下一个只含 `}` 的行）。 */
function consentFunctionBodies(src) {
  const lines = src.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^\s*([A-Za-z0-9_]*consent[A-Za-z0-9_]*)\s*\(\)\s*\{/.exec(lines[i]);
    if (!m) continue;
    const body = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^\}/.test(lines[j])) break;
      body.push(lines[j]);
    }
    out.push({ name: m[1], line: i + 1, body: body.join('\n') });
  }
  return out;
}

/**
 * 「`pm clear` 之后**靠无障碍树驱动界面**」的形状。
 *
 * ⚠️ 调用写法是 `$(xy_desc "邮箱")` —— 名字后面跟的是**空格和引号**，不是 `(`。
 *    第一版这里写成 `(xy_desc|xy_text|xy_edit|has_text)\s*\(`，于是**一个脚本都没被
 *    认出来**：门禁打印"冷启动驱动界面 0 个"然后 ✅ 通过。恒过的判据比没有判据更糟
 *    （§7 元规则二）—— 这次是它**自己的第一跑**照出来的，所以这条注释留在这里。
 */
const UI_DRIVE =
  /\b(xy_desc|xy_text|xy_edit|xy_edit_any|xy_edit_sane|has_text|has_desc|has_sub|scroll_to_desc|scroll_to_edit|edit_value)\b/;

const libSrc = readFileSync(LIB, 'utf8');

// 🔴 判据 0：共享实现**必须在**，而且"经欢迎页 helper 就算处置过"这条推定必须成立。
// 下面判据 1 有 15 个脚本是靠"它调了 dismiss_welcome_if_present"通过的 ——
// 哪天那块被从欢迎页 helper 里摘出去，这 15 个"已处置"会全部变成假绿，
// 而门禁自己不会有任何反应。所以这里把它钉成一条判据。
if (!new RegExp(`^${SHARED}\\(\\)`, 'm').test(libSrc)) {
  console.error(`❌ ${LIB} 里找不到 ${SHARED}() —— 共享实现没了，下面两条判据都无从谈起`);
  process.exit(1);
}
const welcomeBody = new RegExp(`^${WELCOME_HELPER}\\(\\)\\s*\\{([\\s\\S]*?)^\\}`, 'm').exec(libSrc);
if (!welcomeBody || !callsFunction(codeOnly(welcomeBody[1]), SHARED)) {
  console.error(`❌ ${LIB} 的 ${WELCOME_HELPER}() 里不再调用 ${SHARED}()`);
  console.error('   而本门禁把"调了欢迎页 helper"当作**已经处置首启隐私面板**的凭据 ——');
  console.error('   那块面板是一块盖住整屏的 Modal，它立着的时候欢迎页的节点不在无障碍树里，');
  console.error('   这个推定一旦不成立，靠它通过的脚本会全部变成假绿。');
  process.exit(1);
}

/**
 * 从源码里**剥掉注释行**，只留可执行的部分。
 *
 * 🔴 为什么：第一版这里用 `src.includes('handle_privacy_consent')` 判"处置在位"，
 * 而每个脚本的文件头都**用文字提到**那个函数名（正是我为了让下一个人看懂为什么
 * 必须有它而写的注释）。于是把真正的调用整行删掉，门禁仍然 ✅ 通过 ——
 * 一条永远过的判据（§7 元规则二）。注释提到 ≠ 调用了，必须按**调用形状**匹配。
 */
function codeOnly(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/** 有没有**调用**某个 shell 函数（行首的裸名字，允许前面缩进、后面带参数）。 */
function callsFunction(text, name) {
  return new RegExp(`^\\s*${name}\\b`, 'm').test(text);
}

const missing = [];
const duplicated = [];
const ok = [];
let cleared = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const drivesUiAfterClear = /pm clear/.test(src) && UI_DRIVE.test(src);
  const fns = consentFunctionBodies(src);
  for (const fn of fns) {
    if (/\$ADB shell input tap|adb .*shell input tap/.test(fn.body)) {
      duplicated.push(`${file}:${fn.line}  ${fn.name}() 自己点了按钮 —— 共享实现是 ${LIB} 的 ${SHARED}()`);
    }
  }
  if (!drivesUiAfterClear) continue;
  cleared += 1;
  const code = codeOnly(src);
  const direct = callsFunction(code, SHARED);
  const viaWelcome = callsFunction(code, WELCOME_HELPER);
  if (direct && viaWelcome) ok.push(`${file}  直接调 ${SHARED} + 经 ${WELCOME_HELPER}`);
  else if (direct) ok.push(`${file}  直接调 ${SHARED}`);
  else if (viaWelcome) ok.push(`${file}  经 ${WELCOME_HELPER}（它第一件事就是收面板）`);
  else missing.push(`${file}  ${'冷启动后驱动界面，却没有任何一处走到隐私面板的共享处置'}`);
}

console.log(`扫描 ${files.length} 个安卓验收脚本（排除 -ios：另一套无障碍技术），其中冷启动驱动界面 ${cleared} 个`);
for (const line of ok) console.log(`  ✅ ${line}`);
if (duplicated.length) {
  console.log(`\n❌ 判据 2 —— 出现了第二份实现（${duplicated.length} 处）：`);
  for (const line of duplicated) console.log(`  ${line}`);
}
if (missing.length) {
  console.log(`\n❌ 判据 1 —— 没走到共享处置（${missing.length} 个）：`);
  for (const line of missing) console.log(`  ${line}`);
}
if (duplicated.length || missing.length) {
  console.log('\n处置：调用 scripts/lib/mobile-e2e.sh 的 handle_privacy_consent <按钮优先级…>，');
  console.log('      或在冷启动后调 dismiss_welcome_if_present（它会先收这块面板）。');
  console.log('      不要在这里再抄一份 —— 抄漏一个脚本的代价是那一轮整片假红。');
  process.exit(1);
}
console.log('\n✅ 首启隐私同意面板：处置只有一份，每个冷启动脚本都走得到它');
