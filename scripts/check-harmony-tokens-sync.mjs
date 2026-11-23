#!/usr/bin/env node
/**
 * 鸿蒙设计资源 ↔ 设计系统 token 的**同源门禁**（+ 引用完整性）
 * ================================================================
 *
 * 背景
 * ----
 * 鸿蒙端最地道的做法是用**原生资源引用** `$r('app.color.…')` / `$r('app.float.…')`：
 * 颜色走 `resources/base/element/color.json`（亮）+ `dark/element/color.json`（暗），
 * 系统切深色时**自动**换成暗色值 —— 这是 HarmonyOS 的深色模式机制，也是"鸿蒙特征"里
 * 最实的一条。尺寸/字号走 `float.json`（vp / fp，fp 随系统字体缩放）。
 *
 * 但资源文件是**手写/投影**的第二份表。一旦它和设计系统
 * （唯一事实源 `packages/design-system/src/tokens.css` 的产物
 * `generated/HeytaTokens.ets`）漂移，鸿蒙卡片显示的颜色就和 web / iOS / Android 对不上，
 * 而**没有任何一处会报错** —— 用户看到的是"鸿蒙上的绿勾是另一个绿"。
 *
 * 本门禁做两件事：
 *
 *   1. **同源**：`color.json`（亮/暗）与 `float.json` 里 `heyta_*` 的每一项，
 *      必须与 `HeytaTokens.ets` 的对应常量**逐值相等**（颜色忽略大小写；尺寸忽略 fp/vp 单位）。
 *   2. **引用完整性**：`apps/mobile/harmony/entry/src` 下所有 `.ets` 里
 *      `$r('app.color.X')` / `$r('app.float.X')` 的 `X` 必须真的在对应 json 里定义
 *      （否则运行时空指针 / 白屏），且鸿蒙小组件与页面 `.ets` 里**不得再出现裸 hex 字面量**
 *      （设计系统"组件禁裸值"在鸿蒙端的对应物）。
 *
 * 诚实边界
 * --------
 * - 它**不**编译 ArkTS（本机无 DevEco 时无法编译；那一步靠 `pnpm check:arkts-widgets`
 *   在装有 DevEco 的机器上跑，或 `verify:harmony-*` 出 HAP）。
 * - 它**不**证明颜色对比度 —— 那是 `packages/design-system/tests` 的事（同源即继承那套保证）。
 *
 * 用法：
 *   node scripts/check-harmony-tokens-sync.mjs
 *   node scripts/check-harmony-tokens-sync.mjs --self-test   # 证明它真的会红
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const ETS_TOKENS = join(REPO, 'packages/design-system/generated/HeytaTokens.ets');
const RES = join(REPO, 'apps/mobile/harmony/entry/src/main/resources');
const BASE_COLOR = join(RES, 'base/element/color.json');
const DARK_COLOR = join(RES, 'dark/element/color.json');
const BASE_FLOAT = join(RES, 'base/element/float.json');
const ETS_SRC = join(REPO, 'apps/mobile/harmony/entry/src');

/**
 * 颜色映射：鸿蒙资源名 → { light: HeytaTokens 常量, dark: HeytaTokens 常量 }。
 * **加一项资源就必须在这里登记**，否则它不在同源校验范围内（= 可以是漂的）。
 */
const COLOR_MAP = {
  heyta_surface: ['HEYTA_COLOR_SURFACE', 'HEYTA_DARK_COLOR_SURFACE'],
  heyta_surface_subtle: ['HEYTA_COLOR_SURFACE_SUBTLE', 'HEYTA_DARK_COLOR_SURFACE_SUBTLE'],
  heyta_foreground: ['HEYTA_COLOR_FOREGROUND', 'HEYTA_DARK_COLOR_FOREGROUND'],
  heyta_foreground_muted: ['HEYTA_COLOR_FOREGROUND_MUTED', 'HEYTA_DARK_COLOR_FOREGROUND_MUTED'],
  heyta_foreground_subtle: ['HEYTA_COLOR_FOREGROUND_SUBTLE', 'HEYTA_DARK_COLOR_FOREGROUND_SUBTLE'],
  heyta_border: ['HEYTA_COLOR_BORDER', 'HEYTA_DARK_COLOR_BORDER'],
  heyta_border_strong: ['HEYTA_COLOR_BORDER_STRONG', 'HEYTA_DARK_COLOR_BORDER_STRONG'],
  heyta_primary: ['HEYTA_COLOR_PRIMARY', 'HEYTA_DARK_COLOR_PRIMARY'],
  heyta_success: ['HEYTA_COLOR_SUCCESS', 'HEYTA_DARK_COLOR_SUCCESS'],
  heyta_disabled_fg: ['HEYTA_COLOR_DISABLED_FG', 'HEYTA_DARK_COLOR_DISABLED_FG'],
  heyta_warning: ['HEYTA_COLOR_WARNING', 'HEYTA_DARK_COLOR_WARNING'],
  heyta_warning_strong: ['HEYTA_COLOR_WARNING_STRONG', 'HEYTA_DARK_COLOR_WARNING_STRONG'],
  heyta_danger: ['HEYTA_COLOR_DANGER', 'HEYTA_DARK_COLOR_DANGER'],
};

/** 尺寸映射：鸿蒙资源名 → [HeytaTokens 常量, 资源单位]。 */
const FLOAT_MAP = {
  heyta_font_size_xs: ['HEYTA_FONT_SIZE_XS', 'fp'],
  heyta_font_size_md: ['HEYTA_FONT_SIZE_MD', 'fp'],
  heyta_font_size_sm: ['HEYTA_FONT_SIZE_SM', 'fp'],
  heyta_font_size_base: ['HEYTA_FONT_SIZE_BASE', 'fp'],
  heyta_font_size_lg: ['HEYTA_FONT_SIZE_LG', 'fp'],
  heyta_font_size_xl: ['HEYTA_FONT_SIZE_XL', 'fp'],
  heyta_font_size_2xl: ['HEYTA_FONT_SIZE_2XL', 'fp'],
  heyta_space_1: ['HEYTA_SPACE_1', 'vp'],
  heyta_space_2: ['HEYTA_SPACE_2', 'vp'],
  heyta_space_3: ['HEYTA_SPACE_3', 'vp'],
  heyta_space_4: ['HEYTA_SPACE_4', 'vp'],
  heyta_space_6: ['HEYTA_SPACE_6', 'vp'],
  heyta_radius_md: ['HEYTA_RADIUS_MD', 'vp'],
  heyta_radius_lg: ['HEYTA_RADIUS_LG', 'vp'],
  heyta_radius_xl: ['HEYTA_RADIUS_XL', 'vp'],
};

/** 解析 HeytaTokens.ets 的常量表：名字 → 值（string 或 number）。 */
export function parseEtsConstants(text) {
  const out = {};
  const re = /export const ([A-Z0-9_]+): (?:string|number) = (?:'([^']*)'|(-?\d+(?:\.\d+)?))/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, name, strVal, numVal] = m;
    out[name] = strVal !== undefined ? strVal : Number(numVal);
  }
  return out;
}

/** 解析鸿蒙 color.json / float.json 的 { name: value }（忽略大小写归一色，float 原样字符串）。 */
export function parseResList(jsonText) {
  const parsed = JSON.parse(jsonText);
  const arr = parsed.color ?? parsed.float ?? [];
  const out = {};
  for (const item of arr) out[item.name] = item.value;
  return out;
}

/**
 * 纯校验：返回问题数组（空 = 通过）。抽成纯函数，供 --self-test 喂篡改数据。
 * @param {object} ets  常量表
 * @param {object} cBase 亮 color.json
 * @param {object} cDark 暗 color.json
 * @param {object} fBase float.json
 */
export function diffTables(ets, cBase, cDark, fBase) {
  const issues = [];

  for (const [resName, [lightConst, darkConst]] of Object.entries(COLOR_MAP)) {
    for (const [table, constName, label] of [
      [cBase, lightConst, '亮色 color.json'],
      [cDark, darkConst, '暗色 color.json'],
    ]) {
      if (!(resName in table)) {
        issues.push(`${label} 缺少资源 "${resName}"（应由 tokens 投影生成）`);
        continue;
      }
      if (!(constName in ets)) {
        issues.push(`HeytaTokens.ets 缺少常量 ${constName}（tokens.css 改了？先重新 generate）`);
        continue;
      }
      if (String(table[resName]).toUpperCase() !== String(ets[constName]).toUpperCase()) {
        issues.push(
          `${label} 资源 ${resName}=${table[resName]} ≠ ${constName}=${ets[constName]}（漂移：鸿蒙与其它端颜色不一致）`,
        );
      }
    }
  }

  for (const [resName, [constName, unit]] of Object.entries(FLOAT_MAP)) {
    if (!(resName in fBase)) {
      issues.push(`float.json 缺少资源 "${resName}"`);
      continue;
    }
    if (!(constName in ets)) {
      issues.push(`HeytaTokens.ets 缺少常量 ${constName}`);
      continue;
    }
    const raw = String(fBase[resName]);
    const num = parseFloat(raw);
    const expectUnit = raw.match(/[a-zA-Z]+$/)?.[0];
    if (Number.isNaN(num)) {
      issues.push(`float.json 资源 ${resName} 的值 "${raw}" 不是数字`);
      continue;
    }
    if (expectUnit !== unit) {
      issues.push(`float.json 资源 ${resName} 的单位是 "${expectUnit ?? '(无)'}"，应为 "${unit}"`);
    }
    if (num !== Number(ets[constName])) {
      issues.push(`float.json 资源 ${resName}=${num} ≠ ${constName}=${Number(ets[constName])}（漂移）`);
    }
  }

  return issues;
}

/** 递归收集某目录下所有 .ets 文件。 */
function collectEts(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...collectEts(p));
    else if (name.name.endsWith('.ets')) out.push(p);
  }
  return out;
}

/** 引用完整性 + 裸 hex 检查。返回问题数组。 */
export function diffUsages(etsFiles, cBase, cDark, fBase) {
  const issues = [];
  const definedColor = new Set([...Object.keys(cBase)]);
  // 暗色资源允许与亮色同名（鸿蒙运行时按 mode 选），引用只需在二者任一存在即可。
  for (const k of Object.keys(cDark)) definedColor.add(k);
  const definedFloat = new Set(Object.keys(fBase));

  const refRe = /\$r\('app\.(color|float)\.([A-Za-z0-9_]+)'\)/g;
  const hexRe = /'#[0-9a-fA-F]{6,8}'/g;

  for (const { file, text } of etsFiles) {
    let m;
    while ((m = refRe.exec(text)) !== null) {
      const [, kind, name] = m;
      const pool = kind === 'color' ? definedColor : definedFloat;
      if (!pool.has(name)) {
        issues.push(
          `${rel(file)}: 引用了未定义的 ${kind} 资源 "app.${kind}.${name}"（运行时会拿不到值）`,
        );
      }
    }
    // 裸 hex：只针对 widget / pages 两个目录（那两处是我们本轮 token 化的面）。
    if (/[\\/](widget|pages)[\\/]/.test(file)) {
      let h;
      while ((h = hexRe.exec(text)) !== null) {
        issues.push(`${rel(file)}: 仍有裸 hex 字面量 ${h[0]}（应改用 $r('app.color.…)）`);
      }
    }
  }
  return issues;
}

function rel(p) {
  return p.replace(REPO + '/', '');
}

function loadAll() {
  const ets = parseEtsConstants(readFileSync(ETS_TOKENS, 'utf8'));
  const cBase = parseResList(readFileSync(BASE_COLOR, 'utf8'));
  const cDark = parseResList(readFileSync(DARK_COLOR, 'utf8'));
  const fBase = parseResList(readFileSync(BASE_FLOAT, 'utf8'));
  const etsFiles = collectEts(ETS_SRC).map((file) => ({ file, text: readFileSync(file, 'utf8') }));
  return { ets, cBase, cDark, fBase, etsFiles };
}

function runSelfTest() {
  // 用内存里**蓄意篡改**的数据证明 diffTables / diffUsages 会红。
  const ets = {
    HEYTA_COLOR_SURFACE: '#ffffff',
    HEYTA_DARK_COLOR_SURFACE: '#0d1526',
    HEYTA_FONT_SIZE_MD: 13,
  };
  const goodBase = { heyta_surface: '#FFFFFF' };
  const goodDark = { heyta_surface: '#0D1526' };
  const goodFloat = { heyta_font_size_md: '13fp' };

  // 只看我们喂进去的那几项：用一个最小映射集合覆写全局映射做隔离。
  const savedColor = COLOR_MAP;
  const savedFloat = FLOAT_MAP;
  for (const k of Object.keys(COLOR_MAP)) if (k !== 'heyta_surface') delete COLOR_MAP[k];
  for (const k of Object.keys(FLOAT_MAP)) if (k !== 'heyta_font_size_md') delete FLOAT_MAP[k];

  let fail = 0;
  const okCase = diffTables(ets, goodBase, goodDark, goodFloat);
  if (okCase.length !== 0) {
    console.log('  ❌ self-test: 正确输入被判为红（门禁过度严格或映射有误）', okCase);
    fail += 1;
  } else {
    console.log('  ✅ self-test: 正确输入 → 绿');
  }

  const badBase = { heyta_surface: '#000000' }; // 蓄意改错
  const badCase = diffTables(ets, badBase, goodDark, goodFloat);
  if (badCase.length === 0) {
    console.log('  ❌ self-test: 篡改后的颜色值**没有**被判红（门禁是摆设）');
    fail += 1;
  } else {
    console.log('  ✅ self-test: 篡改颜色值 → 红（证明同源校验真的能失败）');
  }

  const badFloat = { heyta_font_size_md: '14fp' };
  if (diffTables(ets, goodBase, goodDark, badFloat).length === 0) {
    console.log('  ❌ self-test: 篡改字号没有判红');
    fail += 1;
  } else {
    console.log('  ✅ self-test: 篡改字号 → 红');
  }

  const refIssues = diffUsages(
    [{ file: join(REPO, 'apps/mobile/harmony/entry/src/main/ets/widget/x.ets'),
       text: "Text('a').fontColor($r('app.color.heyta_not_exist')).backgroundColor('#ffffff')" }],
    goodBase,
    goodDark,
    goodFloat,
  );
  if (refIssues.length < 2) {
    console.log('  ❌ self-test: 未定义引用 + 裸 hex 应至少报 2 条，实际', refIssues);
    fail += 1;
  } else {
    console.log('  ✅ self-test: 未定义引用 / 裸 hex → 红');
  }

  // 复原全局映射
  for (const k of Object.keys(COLOR_MAP)) delete COLOR_MAP[k];
  Object.assign(COLOR_MAP, savedColor);
  for (const k of Object.keys(FLOAT_MAP)) delete FLOAT_MAP[k];
  Object.assign(FLOAT_MAP, savedFloat);

  console.log('');
  if (fail > 0) {
    console.log(`🔴 self-test 失败 ${fail} 项 —— 门禁不能失败，等于没有。\n`);
    process.exit(1);
  }
  console.log('✅ self-test 全绿（门禁对违规输入确实会红）。\n');
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

const { ets, cBase, cDark, fBase, etsFiles } = loadAll();
const issues = [
  ...diffTables(ets, cBase, cDark, fBase),
  ...diffUsages(etsFiles, cBase, cDark, fBase),
];

console.log('');
if (issues.length > 0) {
  console.log(`🔴 鸿蒙设计资源与设计系统不一致 / 引用有误（${issues.length} 条）：\n`);
  for (const it of issues) console.log(`   • ${it}`);
  console.log('');
  console.log('   修法：');
  console.log('   • 若是资源值漂移 → 让 color.json / float.json 与 HeytaTokens.ets 对齐（唯一事实源是 tokens.css）；');
  console.log('   • 若是裸 hex / 未定义引用 → 在 .ets 里改用 $r(\'app.color.…) / $r(\'app.float.…) 并确保已登记。\n');
  process.exit(1);
}

console.log(
  `✅ 鸿蒙设计资源与设计系统同源（${Object.keys(COLOR_MAP).length} 色 × 亮/暗、${Object.keys(FLOAT_MAP).length} 尺寸），` +
    `${etsFiles.length} 份 .ets 的 $r 引用全部命中、无裸 hex。\n`,
);
