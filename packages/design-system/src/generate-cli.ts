/**
 * 生成器 CLI
 * ==========
 *
 *   pnpm --filter @heyta/design-system run generate
 *
 * 读取 `src/tokens.css`（唯一事实源），写出：
 *   - generated/HeytaTokens.swift
 *   - generated/HeytaTokens.ets
 *   - generated/tokens.json         （裸值转储，数据流水线用）
 *   - src/generated/tokens.native.ts（React Native，带类型、暗色已合并）
 *
 * 🔴 为什么 native 产物落在 **src/** 下而不是 generated/：
 * 它是要被编译的**代码**，必须落在 tsconfig 的 `rootDir` 之内，
 * 否则 TypeScript 会以 TS6059（file is not under rootDir）拒绝。
 * 根目录的 `generated/` 只放惰性数据（swift / ets / json），不参与编译。
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
/** native 产物是代码，必须落在 rootDir 内 —— 见文件头说明。 */
const SRC_GENERATED_DIR = join(PACKAGE_ROOT, 'src', 'generated');

const checkOnly = process.argv.includes('--check');

const css = readFileSync(SOURCE, 'utf8');
const { swift, arkts, json, native, typographyCss, xaml, gtkCss, gtkHeader, tokens } = generateAll(css);

/** [写入目录, 文件名, 内容, 展示用相对路径] */
const targets: Array<[string, string, string, string]> = [
  [OUT_DIR, 'HeytaTokens.swift', swift, 'generated/HeytaTokens.swift'],
  [OUT_DIR, 'HeytaTokens.ets', arkts, 'generated/HeytaTokens.ets'],
  [OUT_DIR, 'tokens.json', json, 'generated/tokens.json'],
  [OUT_DIR, 'typography.css', typographyCss, 'generated/typography.css'],
  [OUT_DIR, 'HeytaTokens.xaml', xaml, 'generated/HeytaTokens.xaml'],
  [OUT_DIR, 'heyta.gtk.css', gtkCss, 'generated/heyta.gtk.css'],
  [OUT_DIR, 'heyta-tokens.h', gtkHeader, 'generated/heyta-tokens.h'],
  [SRC_GENERATED_DIR, 'tokens.native.ts', native, 'src/generated/tokens.native.ts'],
];

if (checkOnly) {
  const drifted: string[] = [];
  for (const [dir, name, content, label] of targets) {
    let existing: string | null = null;
    try {
      existing = readFileSync(join(dir, name), 'utf8');
    } catch {
      existing = null;
    }
    if (existing !== content) drifted.push(label);
  }
  if (drifted.length > 0) {
    console.error(`🔴 生成产物与 tokens.css 不一致（已过期或缺失）：${drifted.join(', ')}`);
    console.error('   跑 `pnpm --filter @heyta/design-system run generate` 后提交产物。');
    process.exit(1);
  }
  console.log(`✅ 生成产物与 tokens.css 一致（${targets.length} 个文件，${tokens.length} 个 token）。`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(SRC_GENERATED_DIR, { recursive: true });
for (const [dir, name, content] of targets) {
  writeFileSync(join(dir, name), content, 'utf8');
}

const darkCount = tokens.filter((t) => t.dark !== null).length;
const rmCount = tokens.filter((t) => t.reducedMotion !== null).length;
console.log(
  `✅ 已生成 ${targets.length} 个文件（${tokens.length} 个 token；暗色覆盖 ${darkCount}；减少动效 ${rmCount}）`,
);
for (const [, , , label] of targets) console.log(`   - ${label}`);
