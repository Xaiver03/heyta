#!/usr/bin/env node
/**
 * G-5 门禁：设置面板的 Loader2 必须带忙态标记。
 *
 * 判据：apps/web/src/features/settings/ 下的 .tsx 里，
 *   `<Loader2` 同一行必须含 `ht-settings__busy`。
 * 违反 ⇒ 忙态图标是静态残月，用户以为界面卡住了（apple-design F-01）。
 *
 * ⚠️ 类名挂在 `.ht-settings` 这一族里，**不自成一族**：动画定义在
 *   `apps/web/src/styles/app/ai-panels.css`，`check:row-single-source` 的棘轮
 *   管的是"不许长出一个新的顶层前缀族"（原先那枚 `.ht-spin` 就是被它抓红的，
 *   而这一族今天的全部调用点都在设置面板内）。改名时**两处要一起动**：
 *   这里的字符串与 CSS 里那条规则。
 *
 * 用法：node scripts/check-spinner-discipline.mjs [--self-test]
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';

const exec = promisify(execFile);

const SPINNER_CLASS = 'ht-settings__busy';

async function main() {
  const selfTest = process.argv.includes('--self-test');

  if (selfTest) {
    // 变异臂：把一处 Loader2 的忙态标记摘掉，门禁必须红。
    const target = 'apps/web/src/features/settings/ProfilePanel.tsx';
    // 🔴 读**当前工作树**而不是 `git show HEAD:` —— 后者会把未提交的改动当成
    //    "原始内容"，finally 里写回去就等于悄悄抹掉别人（或本线）没入库的那一手。
    const original = readFileSync(target, 'utf8');
    const mutated = original.replace(
      `<Loader2 size={ICON_SIZE.xs} className="${SPINNER_CLASS}" aria-hidden="true" />`,
      '<Loader2 size={ICON_SIZE.xs} aria-hidden="true" />',
    );
    if (mutated === original) {
      console.error('self-test: 找不到可注入的 Loader2 行，夹具失效');
      process.exit(1);
    }
    writeFileSync(target, mutated);
    try {
      const { code } = await exec('node', ['scripts/check-spinner-discipline.mjs']).then(
        () => ({ code: 0 }),
        (e) => ({ code: e.code ?? 1 }),
      );
      if (code === 0) {
        console.error('self-test: 注入违规后门仍绿 ⇒ 这把尺不能失败，没有价值');
        process.exit(1);
      }
      console.log(`self-test: ✅ 变异臂红（注入不带 ${SPINNER_CLASS} 的 Loader2 后门禁正确拒绝）`);
    } finally {
      writeFileSync(target, original);
    }
    return;
  }

  const { stdout } = await exec('grep', [
    '-rn', '<Loader2',
    'apps/web/src/features/settings/',
    '--include=*.tsx',
  ]);

  const lines = stdout.split('\n').filter((l) => l.trim() !== '');
  const violations = lines.filter((l) => !l.includes(SPINNER_CLASS));

  if (violations.length > 0) {
    console.error(`G-5 spinner 纪律：${violations.length} 处 Loader2 缺 className="${SPINNER_CLASS}"`);
    for (const v of violations) {
      console.error(`  ${v.trim()}`);
    }
    process.exit(1);
  }

  console.log(`G-5 spinner 纪律：✅ ${lines.length} 处 Loader2 全部带 ${SPINNER_CLASS}`);
}

main().catch((e) => {
  if (e.code === 1 && e.stdout === undefined) process.exit(0);
  console.error(e.message);
  process.exit(1);
});
