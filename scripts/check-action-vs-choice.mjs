#!/usr/bin/env node
/**
 * 动作 vs 选项门禁（2026-11-14）
 * ==============================
 *
 * ## 它挡的是什么（实测标本，不是假想）
 *
 * 「账号与安全 → 通行密钥」那一屏，五个**动作**全部用 `Chip` 画，靠 `selected`
 * 字面量冒充状态：
 *
 * | 按钮 | 当时的写法 | 屏幕上读成 |
 * |---|---|---|
 * | 重命名 | `<Chip selected={false}>` | 一枚永远选不中的选项 |
 * | 取消 | `<Chip selected={false}>` | 同上 |
 * | 删除 | `<Chip selected={false}>` | 同上 |
 * | 保存 | `<Chip selected={true}>` | **"这个已选中"** |
 * | 确认删除 | `<Chip selected={true}>` | **"这个已选中"** |
 *
 * 用户看到一排圆角片，有的亮有的暗，既不是互斥选项、也读不出哪个是按钮。
 * 同一屏的「任务详情」里还有三枚同样的（新建清单 / 添加子任务 / 添加附件）。
 *
 * ## 为什么这条判据是精确的
 *
 * **真选项的 `selected` 一定是表达式**（`selected={view === 'list'}`）——
 * 它的值会随状态变。写死 `true` / `false` 的只可能是"拿 Chip 当按钮用"，
 * 因为一个恒定不变的 `selected` 在语义上不存在：选项总是可选可不选。
 *
 * 所以判据不看文案、不看上下文、不看文件名，只看一个字面量：
 *
 *   `<Chip … selected={true}>` 或 `<Chip … selected={false}>` ⇒ 红
 *
 * ## 修法
 *
 * 动作走 `Button`：主要 `tone="primary"`、次要 `tone="secondary"`、
 * 破坏性 `tone="danger"`。真要表达开关态，用 `Checkbox` 或带 `onPress` 切换的
 * `ChoiceRows` 单行 —— 两者都有自己的契约（`docs/agents/ux-principles.md` §6b）。
 *
 * ## 它**故意不**管什么
 *
 * · 不管 `selected={someBoolean}`（变量形态）：那可能真是选项，静态判不了；
 * · 不管 `Button` 用得好不好（那是 `check:control-semantics` 的射程）；
 * · 不管间距与形态并存（那是 `check:choice-surface` 的射程）。
 *
 * ## 用法
 *
 *   node scripts/check-action-vs-choice.mjs             # 判定
 *   node scripts/check-action-vs-choice.mjs --self-test # 先用夹具自检判据能红
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 移动端 + 共享层 + web 都在射程内：这条与端无关，是"按钮 ≠ 选项"的语义。 */
const SCAN_DIRS = ['apps/mobile/src', 'apps/web/src', 'packages/ui/src'];

/** `<Chip … selected={true}>` / `<Chip … selected={false}>`（写成字面量）。 */
const LITERAL_SELECTED = /<Chip\b[\s\S]{0,400}?\bselected=\{(?:true|false)\}/g;

/** @returns {{file: string, line: number, snippet: string}[]} */
export function findActionShapedChips(sources) {
  const hits = [];
  for (const { file, text } of sources) {
    const re = new RegExp(LITERAL_SELECTED.source, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split('\n').length;
      const snippet = m[0].replace(/\s+/g, ' ').slice(0, 80);
      hits.push({ file, line, snippet });
    }
  }
  return hits;
}

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walk(full, acc);
    } else if (/\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

function collectSources() {
  const out = [];
  for (const rel of SCAN_DIRS) {
    for (const file of walk(join(ROOT, rel))) {
      out.push({ file: relative(ROOT, file), text: readFileSync(file, 'utf8') });
    }
  }
  return out;
}

function selfTest() {
  const fixture = [
    {
      file: 'fixture/action-as-chip.tsx',
      text: `<Chip label="重命名" selected={false} onPress={f} />`,
    },
    {
      file: 'fixture/action-as-chip-selected.tsx',
      text: `<Chip label="保存" selected={true} onPress={f} />`,
    },
    {
      file: 'fixture/real-option.tsx',
      text: `<Chip label="列表" selected={view === 'list'} onPress={f} />`,
    },
    {
      file: 'fixture/variable.tsx',
      text: `<Chip label={face} selected={assigned} onPress={f} />`,
    },
  ];
  const hits = findActionShapedChips(fixture);
  const files = hits.map((h) => h.file).sort();
  const want = ['fixture/action-as-chip-selected.tsx', 'fixture/action-as-chip.tsx'];
  if (JSON.stringify(files) !== JSON.stringify(want)) {
    console.error('[self-test] 判据红了不该红的 / 漏了该红的：', files);
    process.exit(1);
  }
  console.log('[self-test] 判据自检通过（字面量红；表达式与变量形态不误伤）');
}

function main() {
  if (process.argv.includes('--self-test')) selfTest();

  const sources = collectSources();
  const hits = findActionShapedChips(sources);

  if (hits.length === 0) {
    console.log(
      `[action-vs-choice] 通过：扫 ${sources.length} 个文件，没有把 ` +
        '`selected={true|false}` 写死的 Chip（动作没有伪装成选项）。',
    );
    return;
  }

  console.error('[action-vs-choice] 有动作被画成了"选项"（`selected` 恒定不变 ⇒ 它不可能是选项）：\n');
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}`);
    console.error(`    ${h.snippet}`);
  }
  console.error(
    '\n修法：动作改用 `Button`（primary / secondary / danger）；' +
      '真要表达开关态用 `Checkbox` 或 `ChoiceRows`。\n' +
      '规则与标本读数见 docs/agents/ux-principles.md §6b。',
  );
  process.exit(1);
}

main();
