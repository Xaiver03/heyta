#!/usr/bin/env node
/**
 * 单选面（choice surface）门禁
 * =============================
 *
 * ## 为什么需要它（2026-11-14）
 *
 * 「视图选项」面板里，**同一个语义（从 N 个里选 1 个）长出了两种控件**：
 *
 *   · 视图 / 日期显示 —— 圆形 `Chip`（`selected=` 换底色）
 *   · 排序方式      —— 四条通栏 `Button`（`tone={x === y ? 'primary' : 'ghost'}`）
 *
 * 两组行高都是 44、都只用 token、都过 `check:design`，但屏幕上：
 * 一组是贴着左缘的圆角小片、文字居中；另一组是通栏横杠、文字居中在
 * 353dp 的宽度里。**用户的读数不是"两种控件"，是"这一块没排版"。**
 *
 * 三层既有门禁没有一层看得见它：
 *   · `check:design` 只问"值是不是 token"（两种控件都是）；
 *   · `check:l4` 只问"样式是不是内联"（RN 端本来就全内联）；
 *   · `check:control-semantics` 只比"同一档按钮在两端画得一样不一样"。
 *
 * 于是这条规则只能新开一把尺：**一个界面文件里，"选 1 个"只许有一种渲染控件。**
 *
 * ## 判什么
 *
 * 对 `apps/mobile/src/**` 的每个 `.tsx`：
 *
 *   A 形态 = 出现了 `<Chip … selected={…}>`（Chip 自带选中态）
 *   B 形态 = 出现了 `<Button … tone={… 'primary' … 'ghost' …}>`（用色调冒充选中态）
 *
 *   A 和 B **同时**出现 ⇒ 红。文件名 + 两种形态各自的出现次数都会被打印。
 *
 * ## 它**故意不**管什么
 *
 * · 不管"用 Chip 还是 ChoiceRows"（那是设计选择，`ChoiceRows` 只是给了个默认答案）；
 * · 不管间距节奏（静态读不出"组内/组间"的语义，硬判会得到一条永远通过的正则，
 *   比没有更糟 —— §7 元规则 2）；那一条由
 *   `packages/design-system/tests/choice-row-shape.spec.ts` 断言**关系**来钉。
 *
 * ## 用法
 *
 *   node scripts/check-choice-surface.mjs             # 判定
 *   node scripts/check-choice-surface.mjs --self-test # 先用夹具自检判据能红
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIR = join(ROOT, 'apps/mobile/src');

/** `<Chip … selected={…}>` */
const FORM_A = /<Chip\b[\s\S]{0,500}?\bselected=/g;
/** `<Button … tone={ … 'primary' … 'ghost' … }>` */
const FORM_B = /<Button\b[\s\S]{0,500}?\btone=\{[^}]*'primary'[^}]*'ghost'[^}]*\}/g;

function count(re, text) {
  const m = text.match(re);
  return m === null ? 0 : m.length;
}

/** @returns {{file: string, a: number, b: number}[]} */
export function findMixedChoiceSurfaces(files) {
  const out = [];
  for (const { file, text } of files) {
    const a = count(FORM_A, text);
    const b = count(FORM_B, text);
    if (a > 0 && b > 0) out.push({ file, a, b });
  }
  return out;
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (entry.endsWith('.tsx')) acc.push(full);
  }
  return acc;
}

function collectSources() {
  return walk(SCAN_DIR).map((file) => ({
    file: relative(ROOT, file),
    text: readFileSync(file, 'utf8'),
  }));
}

function selfTest() {
  const fixture = [
    {
      file: 'fixture/mixed.tsx',
      text: `
        <Chip label="列表" selected={view === 'list'} onPress={f} />
        <Button label="默认" tone={option === sort ? 'primary' : 'ghost'} onPress={g} />
      `,
    },
    {
      file: 'fixture/clean-chip-only.tsx',
      text: `<Chip label="全部" selected={tag === undefined} onPress={f} />`,
    },
    {
      file: 'fixture/clean-rows.tsx',
      text: `
        <ChoiceRows options={viewOptions} value={view} onChange={setView} />
        <Chip label="全部" selected={tag === undefined} onPress={f} />
      `,
    },
  ];
  const found = findMixedChoiceSurfaces(fixture).map((r) => r.file);
  const ok =
    found.length === 1 && found[0] === 'fixture/mixed.tsx';
  if (!ok) {
    console.error('[self-test] 判据没红/红错地方 ⇒ 这条门禁不会拦任何东西：', found);
    process.exit(1);
  }
  console.log('[self-test] 判据自检通过（混合夹具红、单一形态夹具绿）');
}

function main() {
  if (process.argv.includes('--self-test')) selfTest();

  const sources = collectSources();
  const bad = findMixedChoiceSurfaces(sources);

  if (bad.length === 0) {
    console.log(
      `[choice-surface] 通过：扫 ${sources.length} 个 .tsx，没有文件同时用 Chip 与"色调按钮"表达单选。`,
    );
    return;
  }

  console.error('[choice-surface] 同一个文件里有两种"选 1 个"的渲染控件：\n');
  for (const { file, a, b } of bad) {
    console.error(`  ${file}`);
    console.error(`    · <Chip … selected=>            ${a} 处`);
    console.error(`    · <Button … tone={primary|ghost}> ${b} 处`);
  }
  console.error(
    '\n修法：让这一组的 N 个选项都走同一个渲染件。移动端默认答案是 `ChoiceRows`' +
      '（`apps/mobile/src/ui/kit.tsx`，形状见 `packages/design-system/src/choice-row-shape.ts`）。',
  );
  process.exit(1);
}

main();
