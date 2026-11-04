#!/usr/bin/env node
/**
 * G-5 门禁：设置面板的 Loader2 必须带 ht-spin。
 *
 * 判据：apps/web/src/features/settings/ 下的 .tsx 里，
 *   `<Loader2` 同一行必须含 `ht-spin`。
 * 违反 ⇒ 忙态图标是静态残月，用户以为界面卡住了（apple-design F-01）。
 *
 * 用法：node scripts/check-spinner-discipline.mjs [--self-test]
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function main() {
  const selfTest = process.argv.includes('--self-test');

  if (selfTest) {
    // 变异臂：临时注入一个不带 ht-spin 的 Loader2，门禁必须红。
    const target = 'apps/web/src/features/settings/ProfilePanel.tsx';
    const { stdout: original } = await exec('git', ['show', `HEAD:${target}`]);
    const mutated = original.replace(
      '<Loader2 size={ICON_SIZE.xs} className="ht-spin" aria-hidden="true" />',
      '<Loader2 size={ICON_SIZE.xs} aria-hidden="true" />',
    );
    if (mutated === original) {
      console.error('self-test: 找不到可注入的 Loader2 行，夹具失效');
      process.exit(1);
    }
    const fs = await import('node:fs');
    fs.writeFileSync(target, mutated);
    try {
      const { code } = await exec('node', ['scripts/check-spinner-discipline.mjs']).then(
        () => ({ code: 0 }),
        (e) => ({ code: e.code ?? 1 }),
      );
      if (code === 0) {
        console.error('self-test: 注入违规后门仍绿 ⇒ 这把尺不能失败，没有价值');
        process.exit(1);
      }
      console.log('self-test: ✅ 变异臂红（注入不带 ht-spin 的 Loader2 后门禁正确拒绝）');
    } finally {
      fs.writeFileSync(target, original);
    }
    return;
  }

  const { stdout } = await exec('grep', [
    '-rn', '<Loader2',
    'apps/web/src/features/settings/',
    '--include=*.tsx',
  ]);

  const lines = stdout.split('\n').filter((l) => l.trim() !== '');
  const violations = lines.filter((l) => !l.includes('ht-spin'));

  if (violations.length > 0) {
    console.error(`G-5 spinner 纪律：${violations.length} 处 Loader2 缺 className="ht-spin"`);
    for (const v of violations) {
      console.error(`  ${v.trim()}`);
    }
    process.exit(1);
  }

  console.log(`G-5 spinner 纪律：✅ ${lines.length} 处 Loader2 全部带 ht-spin`);
}

main().catch((e) => {
  if (e.code === 1 && e.stdout === undefined) process.exit(0);
  console.error(e.message);
  process.exit(1);
});
