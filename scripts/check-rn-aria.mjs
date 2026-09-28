#!/usr/bin/env node
/**
 * 「共享层不许用**对象形态**的无障碍属性」门禁
 * ============================================
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这道门禁补的是一次**已经发生、而且没有任何判据能发现**的 a11y 回归
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 起因（2026-10-05，由 web 侧一个 agent 的探针引出，我复现并扩大）：
 * `react-native-web@0.21.3` **会把对象形态的 `accessibilityState` /
 * `accessibilityValue` 整个丢掉** —— 不是渲染成错值，是**属性根本不出现**。
 *
 * 实测（`renderToStaticMarkup`，react-native-web 0.21.3，逐条可复跑）：
 *
 * ```
 * <View accessibilityState={{checked:true, busy:false}} />   → <div class="css-view-…">
 * <View accessibilityState={{disabled:true}} />              → <div class="css-view-…">
 * <View accessibilityRole="progressbar"
 *       accessibilityValue={{min:0,max:100,now:42}} />       → <div role="progressbar" class="…">
 *
 * <View aria-checked aria-busy={false} />                    → aria-busy="false" aria-checked="true"
 * <View aria-disabled />                                     → aria-disabled="true"
 * <View role="progressbar" aria-valuemin={0}
 *       aria-valuemax={100} aria-valuenow={42} />            → aria-valuenow="42" …（三个都在）
 * ```
 *
 * 源码层面的同一个事实：`react-native-web/dist/modules/createDOMProps/index.js`
 * 的 `_excluded` 清单里有**平铺**的 `aria-checked` / `accessibilityChecked` /
 * `aria-valuenow` / `accessibilityValueNow`…，而 `grep accessibilityState` 在那个
 * 文件里命中 **0 次** —— 对象形态**没有任何一条映射路径**。
 *
 * ## 为什么它落在共享层就是"四个端"的问题
 *
 * 对象形态是**原生 RN 的写法**（原生认，且一直认）。所以同一个组件：
 *   · iOS / Android：状态正常；
 *   · **web：`aria-checked` / `aria-disabled` / `aria-valuenow` 全部消失。**
 *
 * 最要命的一处是 `TaskRow` 的勾选框：**读屏用户在 web 上分不清一条任务是待办还是已完成**
 * （勾选框的**颜色**对他们完全不可见，`aria-checked` 是唯一通道）。
 *
 * ## 为什么这门禁只扫共享层
 *
 * `packages/ui/src/**` 是**四个端共用**的那一份 —— 它必须写成"两端都认"的形态。
 * `apps/*` 里各端自己的代码不扫：`apps/mobile` 用对象形态在**原生上是正确的**，
 * 把它也收进来会产生一批"合规却被报"的噪音（一条会误报的门禁会教人忽略红色）。
 *
 * ## 判据
 *
 *   · **断言 A（锚点自检）**：`packages/ui/src` 里必须真的扫到 **≥5 处平铺 `aria-*`**。
 *     扫不到 → 报错，**不是通过** —— 否则"改了写法让文件集变了"会让本门禁静默失效。
 *   · **断言 B**：`packages/ui/src/**` 里出现 `accessibilityState={` 或
 *     `accessibilityValue={`（**对象形态**）→ 红，并指名文件:行号。
 *     注释里的提及**不算**（先剥注释再判）。
 *
 * 用法：`node scripts/check-rn-aria.mjs`
 *   非零退出 = 有违规，或判据失效。
 *
 * `HEYTA_CHECK_ROOT`：与 `check-empty-state.mjs` 同一个约定 ——
 * 只给**故障注入探针**用（把门禁跑在 `/tmp` 的副本上，不动共享工作区）。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT =
  process.env.HEYTA_CHECK_ROOT === undefined
    ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.env.HEYTA_CHECK_ROOT);

const UI_SRC = 'packages/ui/src';
/** 平铺写法（正确）：`aria-checked` / `aria-disabled` / `aria-valuenow` … */
const FLAT_ARIA = /\baria-[a-z]+/g;
/** 对象写法（在 web 上失效）：`accessibilityState={` / `accessibilityValue={` */
const OBJECT_FORM = /\baccessibility(State|Value)\s*=\s*\{/;

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-types', 'build', 'coverage']);

function* walk(target) {
  let st;
  try {
    st = statSync(target);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (/\.tsx?$/.test(target)) yield target;
    return;
  }
  for (const name of readdirSync(target)) {
    if (SKIP_DIRS.has(name)) continue;
    yield* walk(join(target, name));
  }
}

/** 去掉注释，避免"注释里提到对象形态"被当成违规（本仓踩过三次）。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
}

console.log('─'.repeat(78));
console.log('共享层无障碍属性写法门禁：对象形态在 web 上会被 react-native-web 整个丢掉');
console.log(`   ROOT = ${relative(process.cwd(), ROOT) || '.'}${process.env.HEYTA_CHECK_ROOT === undefined ? '' : '（HEYTA_CHECK_ROOT 副本）'}`);
console.log(`   范围 = ${UI_SRC}/**（共享层 —— 它必须写成"四个端都认"的形态）`);
console.log('─'.repeat(78));

const srcDir = join(ROOT, UI_SRC);
if (!existsSync(srcDir)) {
  console.error(`🔴 判据失效：${UI_SRC} 不存在 —— 没有扫描面，本门禁不能做事。`);
  process.exit(1);
}

const files = [...walk(srcDir)];
if (files.length === 0) {
  console.error(`🔴 判据失效：${UI_SRC} 下一个源文件都没扫到 —— 范围缺口会静默失效。`);
  process.exit(1);
}

let flatCount = 0;
const violations = [];
for (const abs of files) {
  const rel = relative(ROOT, abs);
  const code = stripComments(readFileSync(abs, 'utf8'));
  flatCount += (code.match(FLAT_ARIA) ?? []).length;
  for (const [i, line] of code.split('\n').entries()) {
    if (OBJECT_FORM.test(line)) {
      violations.push(`   · ${rel}:${String(i + 1)} —— ${line.trim()}`);
    }
  }
}

/** 断言 A：锚点自检 —— 扫不到平铺写法说明扫描面/写法整体变了，必须报错。 */
if (flatCount < 5) {
  console.error(
    `🔴 判据失效：${UI_SRC} 里只扫到 ${String(flatCount)} 处平铺 \`aria-*\`（期望 ≥5）。\n` +
      '   ⇒ 要么扫描面没了，要么整个共享层换了一种写法。\n' +
      '      **不要**把阈值调低来"修"它 —— 先弄清为什么平铺写法不见了。',
  );
  process.exit(1);
}
console.log(`   ✅ 锚点自检：${UI_SRC} 里扫到 ${String(flatCount)} 处平铺 \`aria-*\`（${String(files.length)} 个文件）`);

if (violations.length > 0) {
  console.error(`\n🔴 断言 B 不通过：${String(violations.length)} 处**对象形态**的无障碍属性`);
  for (const v of violations) console.error(v);
  console.error(
    '\n   ⇒ 这些属性在 **web 上会被整个丢掉**（`aria-checked` / `aria-disabled` /\n' +
      '      `aria-valuenow` 都不会出现在 DOM 里），而原生两端照常 —— 也就是\n' +
      '      **同一个组件在 web 上失去无障碍状态**，且没有任何测试会红。\n' +
      '      修法：换成**平铺**写法，RN 0.71+ 与 RNW 0.21 都认：\n' +
      '        accessibilityState={{ checked: x, busy: y }}  →  aria-checked={x} aria-busy={y}\n' +
      '        accessibilityState={{ disabled: x }}           →  aria-disabled={x}\n' +
      '        accessibilityValue={{ min: 0, max: 100, now: x }} → aria-valuemin={0} aria-valuemax={100} aria-valuenow={x}\n' +
      '      ⚠️ 修完请**重启 dev server 并跑一次 `pnpm check:web-storage`** —— 它真渲染浏览器。\n',
  );
  process.exit(1);
}

console.log('\n✅ 共享层无障碍属性写法：没有对象形态 `accessibilityState` / `accessibilityValue`。');
console.log('');
