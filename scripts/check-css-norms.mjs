#!/usr/bin/env node
/**
 * CSS 静态规范门禁（stylelint 封装）
 * ==================================
 *
 * 与既有门禁的分工（见 `.stylelintrc.cjs` 文件头）：`check:design` /
 * `check:control-semantics` / `check:row-single-source` / `check:l4-no-style` 管的是
 * **设计纪律**；这一道管 **CSS 本身对不对** —— 重复选择器、重复声明、非法色值、
 * 零值带单位、空块。2026-11-23 立项时实测：**15 个文件**里同一个选择器写了两遍
 * 甚至三遍，后一条静默覆盖前一条，而此前没有任何一层会报。
 *
 * ## 为什么要一层封装而不是直接 `stylelint ...`
 *
 * 1. **可失败的自检**（AGENTS §7 元规则 2：不能失败的检查没有价值）。`--self-test`
 *    会往临时目录写三份夹具：一份重复选择器、一份零值带单位 + 非法 hex + 空块、
 *    一份干净文件；断言前两份**必红**、第三份**必绿**，再对真实树跑一次。
 *    这样"门禁变绿"有两种可能（真干净 / 判据失效）时，这一臂能分开它们。
 * 2. **汇总口径统一**：本仓门禁都打一句可复读的读数（扫描多少文件、几条），
 *    直接裸跑 stylelint 的输出形状随版本变化。
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import stylelint from 'stylelint';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.HEYTA_CHECK_ROOT === undefined ? resolve(HERE, '..') : resolve(process.env.HEYTA_CHECK_ROOT);

/** 与 `.stylelintrc.cjs` 的 `rules` 保持同一份（自检用内联 config，避免受 ignoreFiles 影响）。 */
const RULES = {
  'no-duplicate-selectors': true,
  'declaration-block-no-duplicate-properties': [true, { ignore: ['consecutive-duplicates-with-different-syntaxes'] }],
  'shorthand-property-no-redundant-values': true,
  'color-no-invalid-hex': true,
  'length-zero-no-unit': true,
  'block-no-empty': true,
};

const GLOBS = ['apps/web/src/**/*.css', 'packages/design-system/src/**/*.css'];

async function lintFiles(files, { config } = {}) {
  const options = { files, allowEmptyInput: true };
  if (config !== undefined) options.config = config;
  return stylelint.lint(options);
}

function summarize(results, errored) {
  let warnings = 0;
  let files = 0;
  for (const r of results) {
    if (r.warnings.length > 0) files += 1;
    for (const w of r.warnings) {
      warnings += 1;
      if (!errored) break;
      console.error(`  ${r.source.replace(ROOT + '/', '')}:${w.line}:${w.column}  ${w.text}  (${w.rule})`);
    }
  }
  return { warnings, files };
}

async function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'heyta-css-norms-'));
  const config = { rules: RULES };
  let failed = 0;
  const arm = (name, ok) => {
    console.log(`${ok ? '✓' : '🔴'} ${name}`);
    if (!ok) failed += 1;
  };
  try {
    mkdirSync(join(tmp, 'bad-dup'), { recursive: true });
    writeFileSync(join(tmp, 'bad-dup/a.css'), '.x { color: red; }\n.x { color: blue; }\n');
    const r1 = await lintFiles([join(tmp, 'bad-dup/*.css')], { config });
    arm('重复选择器 ⇒ 必须红', r1.errored === true);

    mkdirSync(join(tmp, 'bad-vals'), { recursive: true });
    writeFileSync(
      join(tmp, 'bad-vals/b.css'),
      '.y { margin: 0px; color: #GGG; }\n.z {}\n',
    );
    const r2 = await lintFiles([join(tmp, 'bad-vals/*.css')], { config });
    arm('零值带单位 / 非法 hex / 空块 ⇒ 必须红', r2.errored === true);

    mkdirSync(join(tmp, 'good'), { recursive: true });
    writeFileSync(join(tmp, 'good/c.css'), '.a { margin: 0; color: #ffffff; }\n.b { padding: 0 0 0 0; }\n');
    const r3 = await lintFiles([join(tmp, 'good/*.css')], { config });
    // `.b` 的 `0 0 0 0` 是冗余简写 ⇒ 这条也该红；换成真正干净的：
    writeFileSync(join(tmp, 'good/c.css'), '.a { margin: 0; color: #ffffff; }\n.b { padding: 0; }\n');
    const r4 = await lintFiles([join(tmp, 'good/*.css')], { config });
    arm('干净文件 ⇒ 必须绿（否则判据过严）', r3.errored === true && r4.errored === false);

    // 真实树：自检里也跑，读数是"当前仓库状态"，不是夹具状态。
    const real = await lintFiles(GLOBS);
    const { warnings } = summarize(real.results, true);
    arm(`真实树当前 ${String(warnings)} 条违规（自检不判红，只看能否读到）`, typeof warnings === 'number');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`self-test：${String(5 - failed)}/5 臂通过。`);
  return failed === 0;
}

async function main() {
  if (process.argv.includes('--self-test')) {
    const ok = await selfTest();
    process.exit(ok ? 0 : 1);
  }
  const res = await lintFiles(GLOBS);
  const { warnings, files } = summarize(res.results, res.errored === true);
  console.log(`CSS 规范（stylelint）：${String(files)} 个文件有违规，共 ${String(warnings)} 条。`);
  if (res.errored) {
    console.error('\n🔴 CSS 规范门禁未通过。修法见 `.stylelintrc.cjs` 文件头；');
    console.error('   ⚠️ 不许加 ignore/放宽规则来变绿 —— 那是把红色关掉，不是修问题。');
    process.exit(1);
  }
  console.log('✅ 没有重复选择器 / 重复声明 / 冗余简写 / 非法色值 / 零值带单位 / 空块。');
}

await main();
