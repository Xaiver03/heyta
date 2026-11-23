#!/usr/bin/env node
/**
 * 样式分层门禁（`apps/web/src/styles/LAYERS.md` 的机械执行者）
 * ============================================================
 *
 * ## 它防的是哪次真实事故
 *
 * 2026-09-30：`narrow.css` 的 ≤768px 媒体块被写在基础规则**之前** ⇒ 同特异性、源序
 * 后者胜 ⇒ 整块塌缩规则被覆盖，**一条都没生效**，而当时所有检查全绿。
 * CSS 没有作用域，"谁覆盖谁"只由**源序**决定 ⇒ 源序必须成为被机器守着的契约。
 *
 * ## 它查什么
 *
 * 1. `apps/web/src/styles/app.css` 的 `@import` 序列**逐项等于** `EXPECTED_ORDER`
 *    （多一个、少一个、换位置都红）—— 新增模块必须同时改本文件与 LAYERS.md；
 * 2. 三条硬约束（它们是"为什么会出事故"的形状）：
 *    · `borderless-controls.css` 必须在**末位**（焦点环/无描边裁决要能落到一切控件上）；
 *    · `narrow.css` 必须晚于所有基础规则（L1–L3 全部）；
 *    · `menu.css` 晚于 `controls.css`、`form.css` 晚于 `controls.css`。
 * 3. 功能级样式（features 下与组件同址的 css）**不许**被 app.css import（层要分清）。
 *
 * ## 自检（`--self-test`）
 *
 * 夹具树里放三份 app.css：正确序 ⇒ 绿；交换两项 ⇒ 红；删一项 ⇒ 红。
 * 另有一份把 features 的 css 塞进 app.css ⇒ 红（反向依赖）。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.HEYTA_CHECK_ROOT === undefined ? resolve(HERE, '..') : resolve(process.env.HEYTA_CHECK_ROOT);

/**
 * 契约清单（顺序即级联顺序）。改这里必须同步 `apps/web/src/styles/LAYERS.md`。
 * 每一项是 `styles/app/` 下的文件名（不含路径）。
 */
export const EXPECTED_ORDER = [
  'base.css',
  'sidebar.css',
  'main-area.css',
  'sheets.css',
  'profile.css',
  'material.css',
  'controls.css',
  'menu.css',
  'form.css',
  'rail.css',
  'inbox.css',
  'ai-panels.css',
  'settings-account.css',
  'growth.css',
  'trash.css',
  'danger-confirm.css',
  'admin.css',
  'habits.css',
  'narrow.css',
  'assistant-layout.css',
  'scope-drawer.css',
  'borderless-controls.css',
];

/** 从 app.css 文本里抽出 @import 的文件名序列；非 ./app/ 的 import 单独返回。 */
export function parseImports(cssText) {
  const imports = [];
  const foreign = [];
  for (const m of cssText.matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    const mm = /^\.\/app\/([^/]+\.css)$/.exec(spec);
    if (mm === null) foreign.push(spec);
    else imports.push(mm[1]);
  }
  return { imports, foreign };
}

/** 判据本体。返回 problems 数组（空 = 通过）。 */
export function judge(cssText) {
  const problems = [];
  const { imports, foreign } = parseImports(cssText);

  if (foreign.length > 0) {
    problems.push(
      `app.css 只许 @import \`./app/<模块>.css\`；出现了越界的：${foreign.join(', ')}\n` +
        '      （功能级样式归组件自己 import，不许从外壳反向依赖 —— 见 LAYERS.md「禁区」）',
    );
  }
  if (imports.length === 0) {
    problems.push('app.css 里一个 ./app/ 模块都扫不到 ⇒ 判据锚点失效（不是"通过"）。');
    return problems;
  }

  // 1) 逐项相等
  const same =
    imports.length === EXPECTED_ORDER.length && imports.every((v, i) => v === EXPECTED_ORDER[i]);
  if (!same) {
    const missing = EXPECTED_ORDER.filter((x) => !imports.includes(x));
    const extra = imports.filter((x) => !EXPECTED_ORDER.includes(x));
    const firstDiff = imports.findIndex((v, i) => v !== EXPECTED_ORDER[i]);
    problems.push(
      'app.css 的 @import 顺序与 LAYERS.md 的契约不一致：\n' +
        (missing.length ? `      缺：${missing.join(', ')}\n` : '') +
        (extra.length ? `      多：${extra.join(', ')}\n` : '') +
        (firstDiff >= 0
          ? `      第一个不同在第 ${String(firstDiff + 1)} 项：实际 ${imports[firstDiff]}，契约 ${EXPECTED_ORDER[firstDiff]}\n`
          : '') +
        '      ⇒ 新增/删除模块必须同时改 LAYERS.md 与 scripts/check-css-layers.mjs 的 EXPECTED_ORDER。',
    );
  }

  // 2) 三条硬约束（即便清单被同步改过，也不许破）
  const idx = (f) => imports.indexOf(f);
  if (idx('borderless-controls.css') !== imports.length - 1) {
    problems.push('borderless-controls.css 必须在**末位**（焦点环/无描边裁决要压过一切）。');
  }
  if (idx('narrow.css') >= 0) {
    const lastBase = Math.max(
      ...['base.css', 'sidebar.css', 'main-area.css', 'sheets.css', 'profile.css', 'material.css', 'controls.css', 'menu.css', 'form.css', 'rail.css', 'inbox.css', 'ai-panels.css', 'settings-account.css', 'growth.css', 'trash.css', 'danger-confirm.css', 'admin.css', 'habits.css'].map(idx),
    );
    if (idx('narrow.css') < lastBase) {
      problems.push('narrow.css（响应式）必须晚于全部基础规则 —— 2026-09-30 的事故就是它被前移。');
    }
  }
  if (idx('menu.css') >= 0 && idx('controls.css') >= 0 && idx('menu.css') < idx('controls.css')) {
    problems.push('menu.css 必须晚于 controls.css（菜单项继承按钮基类）。');
  }
  if (idx('form.css') >= 0 && idx('controls.css') >= 0 && idx('form.css') < idx('controls.css')) {
    problems.push('form.css 必须晚于 controls.css。');
  }
  return problems;
}

function runSelfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'heyta-css-layers-'));
  let failed = 0;
  const arm = (name, ok) => {
    console.log(`${ok ? '✓' : '🔴'} ${name}`);
    if (!ok) failed += 1;
  };
  const css = (order) => order.map((f) => `@import './app/${f}';`).join('\n');
  try {
    mkdirSync(join(tmp, 'ok'), { recursive: true });
    arm('正确顺序 ⇒ 绿', judge(css(EXPECTED_ORDER)).length === 0);

    const swapped = [...EXPECTED_ORDER];
    const a = swapped.indexOf('narrow.css');
    const b = swapped.indexOf('assistant-layout.css');
    [swapped[a], swapped[b]] = [swapped[b], swapped[a]];
    arm('交换 narrow 与 assistant-layout ⇒ 红', judge(css(swapped)).length > 0);

    const dropped = EXPECTED_ORDER.filter((f) => f !== 'menu.css');
    arm('删掉 menu.css ⇒ 红', judge(css(dropped)).length > 0);

    const foreignCss = css(EXPECTED_ORDER) + "\n@import '../features/x.css';";
    arm('从 app.css 反向 import 功能样式 ⇒ 红', judge(foreignCss).length > 0);

    const border = [...EXPECTED_ORDER.filter((f) => f !== 'borderless-controls.css'), 'borderless-controls.css'];
    arm('borderless-controls 不在末位 ⇒ 红', judge(css([...border.slice(0, -1), ...['base.css'], 'borderless-controls.css'])).length > 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`self-test：${String(5 - failed)}/5 臂通过。`);
  return failed === 0;
}

const APP_CSS = join(ROOT, 'apps/web/src/styles/app.css');

if (process.argv.includes('--self-test')) {
  process.exit(runSelfTest() ? 0 : 1);
}
if (!existsSync(APP_CSS)) {
  console.error(`🔴 找不到 ${APP_CSS} —— 判据锚在它上面，改名/搬家必须报错而不是"通过"。`);
  process.exit(1);
}
const problems = judge(readFileSync(APP_CSS, 'utf8'));
if (problems.length > 0) {
  console.error(`🔴 样式分层门禁未通过（${String(problems.length)} 条）：\n`);
  for (const p of problems) console.error(`  · ${p}\n`);
  console.error('判据正文：apps/web/src/styles/LAYERS.md');
  process.exit(1);
}
console.log(`✅ 样式分层：${String(EXPECTED_ORDER.length)} 个模块的顺序与 LAYERS.md 契约一致（borderless-controls 末位、narrow 压轴基础之后）。`);
