#!/usr/bin/env node
/**
 * G-3 门禁：可见消息禁 2xs（11px）。
 *
 * 判据：apps/web/src/styles/app/ai-panels.css 里，
 *   `.ht-settings__danger` / `.ht-settings__notice` / `.ht-settings__hint`
 *   的 font-size 声明不许用 `--ht-font-size-2xs`。
 * 违反 ⇒ 用户最需要看清的字（成功/失败/时间/风险）字号是最小的一档。
 *
 * 用法：node scripts/check-font-size-discipline.mjs [--self-test]
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';

const exec = promisify(execFile);

const TARGET_FILE = 'apps/web/src/styles/app/ai-panels.css';
const GUARDED_CLASSES = ['ht-settings__danger', 'ht-settings__notice', 'ht-settings__hint'];
const BANNED_TOKEN = '--ht-font-size-2xs';

function findViolations(content) {
  const violations = [];
  const lines = content.split('\n');
  const guardedPattern = new RegExp(`^\\.(${GUARDED_CLASSES.join('|')})\\s*[{,]`);
  const blockEnd = /^}/;

  let inGuarded = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (guardedPattern.test(line)) { inGuarded = true; continue; }
    if (inGuarded && blockEnd.test(line)) { inGuarded = false; continue; }
    if (inGuarded && line.includes(BANNED_TOKEN) && line.includes('font-size')) {
      violations.push({ line: i + 1, text: line.trim() });
    }
  }
  return violations;
}

async function main() {
  const selfTest = process.argv.includes('--self-test');

  if (selfTest) {
    const original = readFileSync(TARGET_FILE, 'utf-8');
    const mutated = original.replace(
      'font-size: var(--ht-font-size-xs);\n}\n\n.ht-settings__toggle',
      'font-size: var(--ht-font-size-2xs);\n}\n\n.ht-settings__toggle',
    );
    if (mutated === original) {
      console.error('self-test: 找不到可注入的 __notice font-size 行');
      process.exit(1);
    }
    const { writeFileSync } = await import('node:fs');
    writeFileSync(TARGET_FILE, mutated);
    try {
      const { code } = await exec('node', ['scripts/check-font-size-discipline.mjs']).then(
        () => ({ code: 0 }),
        (e) => ({ code: e.code ?? 1 }),
      );
      if (code === 0) {
        console.error('self-test: 注入 2xs 后门仍绿 ⇒ 这把尺不能失败');
        process.exit(1);
      }
      console.log('self-test: ✅ 变异臂红（注入 2xs 到 __notice 后门禁正确拒绝）');
    } finally {
      writeFileSync(TARGET_FILE, original);
    }
    return;
  }

  const content = readFileSync(TARGET_FILE, 'utf-8');
  const violations = findViolations(content);

  if (violations.length > 0) {
    console.error(`G-3 字号纪律：${violations.length} 处消息类用了 2xs（11px）`);
    for (const v of violations) {
      console.error(`  ${TARGET_FILE}:${v.line} → ${v.text}`);
    }
    process.exit(1);
  }

  console.log(`G-3 字号纪律：✅ ${GUARDED_CLASSES.length} 个消息类均 ≥ xs（12px）`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
