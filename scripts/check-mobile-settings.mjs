#!/usr/bin/env node
/**
 * 「设置是独立 surface，不是『我的』滚动流里的一段」—— 结构性门禁
 * ================================================================
 *
 * 判据出处：goal [`docs/plans/goal-settings-ia.md`](../docs/plans/goal-settings-ia.md)
 * M1–M3，规律证据 `docs/research/dida-capture/INTERFACE-NOTES.md` §11.5
 * （次级表面独立成面；主计划 §7.1e）。
 *
 * 2026-09-29 把设置从 `ProfileScreen`（899 行的"什么都塞"）搬进了
 * `SettingsScreen`（RN Modal）。这道门禁钉住搬动的**结果**：
 *
 * | # | 判据 | 对应 goal |
 * |---|---|---|
 * | R1 | `SettingsScreen.tsx` 存在，且是 **RN `Modal`**（`visible` + `onRequestClose`）—— 不是"整屏替换"（那种会让「我的」卸载，违反 M2 的"下层未卸载"） | M2 |
 * | R2 | `ProfileScreen` 上有 `profile-entry-settings` 入口行，并渲染 `<SettingsScreen>`（入口 ≤1 次点击） | M1 |
 * | R3 | 凭据表单的三个词条**只**出现在 `SettingsScreen` —— 塞回「我的」滚动流即红 | M3 |
 * | R4 | 语言胶囊 / 小组件旅程的 testID **只**出现在 `SettingsScreen` | M3 |
 * | R5 | 新词条**中英两表都在**（`mobile.settings.*` / `mobile.profile.entry.settings*`） | M4 |
 *
 * 🔴 **判据锚点自检**：如果 `SettingsScreen.tsx` / `ProfileScreen.tsx`
 * 哪个不存在，**必须报错退出**，而不是"匹配不到就当通过" ——
 * 那是本仓 `check-pricing-consistency.mjs` 文件头写过的禁令：
 * 一道"文件没了就静默变绿"的门禁比没有门禁更糟。
 *
 * 🔴 **注入验证（做改动时必须能红）**：
 * 把 `SettingsScreen` 里的凭据表单搬回 `ProfileScreen` 的 JSX（R3 红）；
 * 把 `<Modal>` 改成 early-return 整屏替换（R1 红）；删掉入口行（R2 红）。
 * 全部还原后必须复绿。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const problems = [];

/* ── 判据锚点：目标文件必须存在，否则报错而不是静默通过 ── */

let settingsSrc;
let profileSrc;
try {
  settingsSrc = read('apps/mobile/src/screens/SettingsScreen.tsx');
} catch {
  problems.push('apps/mobile/src/screens/SettingsScreen.tsx 不存在 —— 设置面被删了？');
}
try {
  profileSrc = read('apps/mobile/src/screens/ProfileScreen.tsx');
} catch {
  problems.push('apps/mobile/src/screens/ProfileScreen.tsx 不存在 —— 「我的」被删了？');
}

/* ── R1：设置面必须是 RN Modal（独立 surface，下层不卸载）── */

if (settingsSrc !== undefined) {
  if (!/<Modal[\s>]/.test(settingsSrc)) {
    problems.push('R1: SettingsScreen 没有 <Modal> —— 设置面被改成了整屏替换，「我的」会被卸载（goal M2）');
  }
  if (!/visible=\{visible\}/.test(settingsSrc)) {
    problems.push('R1: SettingsScreen 的 <Modal> 没有接 visible —— 开关失灵');
  }
  if (!/onRequestClose=\{onClose\}/.test(settingsSrc)) {
    problems.push('R1: SettingsScreen 的 <Modal> 没有 onRequestClose —— Android 返回键关不掉设置面');
  }
  if (!/testID="settings-sheet"/.test(settingsSrc)) {
    problems.push('R1: SettingsScreen 缺 testID="settings-sheet" —— 验收判据没了锚点');
  }
}

/* ── R2：「我的」上必须有入口行，并渲染设置面 ── */

if (profileSrc !== undefined) {
  if (!profileSrc.includes('profile-entry-settings')) {
    problems.push('R2: ProfileScreen 缺 profile-entry-settings 入口行 —— 设置到不了 ≤1 次点击（goal M1）');
  }
  if (!/<SettingsScreen\b/.test(profileSrc)) {
    problems.push('R2: ProfileScreen 不再渲染 <SettingsScreen> —— 设置面成了孤儿');
  }
}

/* ── R3/R4：搬走的必须真的搬走了（出现在「我的」滚动流里即红）── */

const CREDENTIAL_KEYS = [
  'mobile.profile.serverUrl.label',
  'mobile.profile.token.label',
  'mobile.profile.password.label',
];
const MOVED_TEST_IDS = ['profile-language', 'widget-journey'];

if (settingsSrc !== undefined && profileSrc !== undefined) {
  for (const key of CREDENTIAL_KEYS) {
    if (!settingsSrc.includes(key)) {
      problems.push(`R3: 凭据词条 ${key} 不在 SettingsScreen 里 —— 表单被挪到别处了？`);
    }
    if (profileSrc.includes(key)) {
      problems.push(`R3: 凭据词条 ${key} 出现在 ProfileScreen —— 表单被塞回了「我的」滚动流（goal M3 注入判据）`);
    }
  }
  for (const testId of MOVED_TEST_IDS) {
    if (!settingsSrc.includes(`testID="${testId}"`)) {
      problems.push(`R4: testID "${testId}" 不在 SettingsScreen 里 —— 这一段被挪到别处了？`);
    }
    if (profileSrc.includes(`testID="${testId}"`)) {
      problems.push(`R4: testID "${testId}" 出现在 ProfileScreen —— 设置内容被塞回了「我的」滚动流（goal M3 注入判据）`);
    }
  }
}

/* ── R5：新词条中英两表都在 ── */

const NEW_KEYS = [
  'mobile.settings.title',
  'mobile.settings.close',
  'mobile.profile.entry.settings',
  'mobile.profile.entry.settings.hint',
];
let zh;
let en;
try {
  zh = read('packages/i18n/src/locales/zh-CN.ts');
} catch {
  problems.push('packages/i18n/src/locales/zh-CN.ts 读不到');
}
try {
  en = read('packages/i18n/src/locales/en.ts');
} catch {
  problems.push('packages/i18n/src/locales/en.ts 读不到');
}
for (const key of NEW_KEYS) {
  if (zh !== undefined && !zh.includes(`'${key}':`)) {
    problems.push(`R5: 词条 ${key} 缺中文（zh-CN）`);
  }
  if (en !== undefined && !en.includes(`'${key}':`)) {
    problems.push(`R5: 词条 ${key} 缺英文（en）`);
  }
}

/* ── 汇总 ── */

console.log('移动端设置面：独立 surface（RN Modal），不是「我的」滚动流里的一段');
console.log('─'.repeat(72));

if (problems.length > 0) {
  console.error('🔴 设置面的信息架构被破坏：\n');
  for (const p of problems) console.error(`  · ${p}`);
  console.error('\n🔴 check:mobile-settings 未通过。判据见 docs/plans/goal-settings-ia.md（M1–M3）。');
  process.exit(1);
}

console.log('✅ 设置面在 SettingsScreen（RN Modal）里；入口在「我的」首屏；凭据表单 / 语言 / 小组件不在「我的」滚动流里；新词条中英齐。');
console.log('ℹ️ 覆盖边界（如实说明）：这是**源码结构**判据，不证明运行时渲染 ——');
console.log('   运行时行为由真机验收覆盖（当前被 iOS 夹具阻塞，见 handoff §5.1n，如实登记）。');
