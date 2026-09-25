/**
 * 生成器 CLI
 * ==========
 *
 *   pnpm --filter @heyta/design-system run generate
 *
 * 读取 `src/tokens.css`（唯一事实源），写出：
 *   - generated/HeytaTokens.swift
 *   - generated/HeytaTokens.ets
 *   - generated/tokens.json
 *
 * `--check` 只校验已提交的产物是否与当前 tokens.css 一致（CI 用），
 * 不一致则非零退出，不写文件。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateAll } from './generate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** dist/ 或 src/ 的上一级都是包根目录。 */
const PACKAGE_ROOT = resolve(HERE, '..');
const SOURCE = join(PACKAGE_ROOT, 'src', 'tokens.css');
const OUT_DIR = join(PACKAGE_ROOT, 'generated');

const checkOnly = process.argv.includes('--check');

const css = readFileSync(SOURCE, 'utf8');
const { swift, arkts, json, tokens } = generateAll(css);

const targets: Array<[string, string]> = [
  ['HeytaTokens.swift', swift],
  ['HeytaTokens.ets', arkts],
  ['tokens.json', json],
];

if (checkOnly) {
  const drifted = targets.filter(([name, content]) => {
    let existing: string;
    try {
      existing = readFileSync(join(OUT_DIR, name), 'utf8');
    } catch {
      return true;
    }
    return existing !== content;
  });
  if (drifted.length > 0) {
    console.error(
      `🔴 生成产物与 tokens.css 不一致（已过期或缺失）：${drifted.map(([n]) => n).join(', ')}`,
    );
    console.error('   跑 `pnpm --filter @heyta/design-system run generate` 后提交产物。');
    process.exit(1);
  }
  console.log(`✅ 生成产物与 tokens.css 一致（${targets.length} 个文件，${tokens.length} 个 token）。`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, content] of targets) {
  writeFileSync(join(OUT_DIR, name), content, 'utf8');
}

const darkCount = tokens.filter((t) => t.dark !== null).length;
const rmCount = tokens.filter((t) => t.reducedMotion !== null).length;
console.log(
  `✅ 已生成 ${targets.length} 个文件（${tokens.length} 个 token；暗色覆盖 ${darkCount}；减少动效 ${rmCount}）→ ${OUT_DIR}`,
);
for (const [name] of targets) console.log(`   - generated/${name}`);
