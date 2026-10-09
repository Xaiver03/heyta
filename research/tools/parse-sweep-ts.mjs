#!/usr/bin/env node
/*
 * 一次性普查：把某一棵 git 树里**全部** tracked `.ts/.tsx` 逐文件 parse 一遍，
 * 只报"parse 不过"的那些（不是类型错误 —— 类型错误是 `tsc` 的活）。
 *
 * 为什么需要它：`hunk 级入库` 把 `-` 行落进去而漏掉配对的 `+` 行时，
 * 如果删掉的正好是一行**声明**（`const f = (` / `async function g(` / `type T =`），
 * 调用点与类型标注都留着 ⇒ 整枚文件 parse 不过。这类失效三样东西都看不见：
 *   · 引用解析尺（它只问"import 指向的文件在不在"，声明不是引用）
 *   · 文本级门禁（`check:gate-wiring` 那一族）
 *   · `pnpm -r typecheck` —— 它本该抓到，但链在更上游就断了的时候它到不了这一层
 * 唯一能一眼看出的形状是**语法错误码成堆**（TS1109 / TS1005 / TS1128）。
 *
 * 用法：node research/tools/parse-sweep-ts.mjs [ref]        # ref 默认 HEAD
 * 它读的是**当前工作树**里那些路径的字节，所以 ref 与工作树必须一致，否则读数不是那棵树的。
 * 判据自己会先问这一条，不一致就拒绝跑（不是"提醒"，是退出）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const ref = process.argv[2] ?? 'HEAD';
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const head = execFileSync('git', ['rev-parse', ref], { encoding: 'utf8' }).trim();
const actual = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (head !== actual) {
  console.error(`🔴 工作树的 HEAD 是 ${actual.slice(0, 8)}，不是要扫的 ${head.slice(0, 8)} —— 读数不会是那棵树的。`);
  console.error('   要么先 `git checkout --force <那枚 ref>`（隔离副本里做），要么把 ref 换成 HEAD。');
  process.exit(2);
}

// esbuild 是传递依赖，不在根 node_modules 的顶层；按"谁装了它"的顺序找一遍。
const require = createRequire(join(root, 'noop.js'));
let esbuild;
for (const from of [join(root, 'apps/web'), root]) {
  try {
    esbuild = require(require.resolve('esbuild', { paths: [from] }));
    break;
  } catch {}
}
if (!esbuild) {
  const store = execFileSync('sh', ['-c', `ls -d ${root}/node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js 2>/dev/null | head -1`], { encoding: 'utf8' }).trim();
  if (!store) {
    console.error('🔴 找不到 esbuild（既不在 `apps/web` 也不在 pnpm store 里）。先 `pnpm install`。');
    process.exit(2);
  }
  esbuild = require(store);
}

const names = execFileSync('git', ['ls-tree', '-r', '--name-only', ref], {
  cwd: root,
  maxBuffer: 1 << 26,
  encoding: 'utf8',
})
  .split('\n')
  .filter((n) => /\.tsx?$/.test(n));

const broken = [];
let cursor = 0;
async function worker() {
  for (;;) {
    const k = cursor++;
    if (k >= names.length) return;
    const n = names[k];
    const abs = join(root, n);
    if (!existsSync(abs)) {
      broken.push(`${n}:?  在册却不在这棵工作树里（ref 与工作树不一致？）`);
      continue;
    }
    try {
      await esbuild.transform(readFileSync(abs, 'utf8'), {
        loader: n.endsWith('.tsx') ? 'tsx' : 'ts',
        format: 'esm',
        jsx: 'automatic',
      });
    } catch (e) {
      const first = e?.errors?.[0];
      broken.push(`${n}:${first?.location?.line ?? '?'}  ${first?.text ?? String(e).split('\n')[0]}`);
    }
  }
}
await Promise.all(Array.from({ length: 24 }, worker));

console.log(`扫 ${ref} 的 ${names.length} 枚 tracked .ts/.tsx ⇒ parse-broken = ${broken.length}`);
for (const b of broken) console.log(`  ${b}`);
process.exit(broken.length ? 1 : 0);
