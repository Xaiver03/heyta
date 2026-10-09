#!/usr/bin/env node
/**
 * 相对 import 必须解析到**同一棵树里存在的文件**
 * ==============================================
 *
 * ## 为什么存在
 *
 * 2026-10-08 21:31 那笔提交（`9fa53ab9`，标题写的是 `docs(账号面)`）把
 * `packages/shared-schema/src/index.ts` 连着别人的导出块一起扫进了 HEAD，
 * 而那四枚被引用的实现文件只活在当时那棵脏工作树里。后果：**HEAD 打不出包**，
 * 而它藏了十六小时 —— 因为所有跑构建的人都站在那棵脏树上。
 * 记在 `docs/plans/account-standard-suite.md` §6.36 / §6.37。
 *
 * `pnpm check` 不含 `pnpm -r build`（构建要单独跑，AGENTS §6.1），
 * 死链检查只看 markdown 里可点的链接，所以这一型没有任何一层会失败。
 *
 * ## 它量的永远是某一枚 ref，不是工作树
 *
 * 默认 `--tree HEAD`。工作树上这题**没有意义**：并行会话的在飞改动本来就会让
 * "引用了还没提交的实现"到处成立，那不该红，也不是这枚尺要抓的东西。
 *
 * ## 用法
 *
 *   node scripts/check-imports-resolve.mjs                    # 审 HEAD
 *   node scripts/check-imports-resolve.mjs --tree <rev>       # 审任意一枚提交（取证用）
 *   node scripts/check-imports-resolve.mjs --self-test        # 三臂：两红一绿，证明它能失败
 *   node scripts/check-imports-resolve.mjs --sources-only     # 只看构建输入（测试文件那一类另算）
 *
 * ## 变异/负向已经做过什么
 *
 * - **真实事故的阳性对照**：`--tree 9fa53ab9` 报出那四枚 `shared-schema` 契约文件（它当时就是红的）。
 * - `--self-test` 用临时夹具（不碰仓库）造三臂：引用未跟踪的实现、引用根本不存在的模块、合规形状。
 */
import { execFileSync } from 'node:child_process';
import { dirname, join, posix } from 'node:path';

const git = (args, cwd) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, cwd }).trim();

/** 只扫产品与服务的源码目录；`e2e` / `research` / `docs` 不是打包输入。 */
const SOURCE_DIRS = ['packages', 'apps', 'server'];
const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
/** 这些目录里的文件不是构建输入，扫了只会造噪音。 */
const SKIP = /(^|\/)(node_modules|dist|build|\.build|Pods|DerivedData|generated|__snapshots__)(\/|$)/;
/** 测试文件：不是构建输入，但"测试 import 了没入库的主体"= `pnpm -r test` 必红，是同型的第二种病。 */
const TESTISH = /(^|\/)(tests?|__tests__)\//;

const SPEC_RE = /(?:from|import|require)\s*\(?\s*['"](\.[^'"]+)['"]/g;

/**
 * 注释里的例子不是 import。
 * 🔴 只剥"块注释"与"整行 `//` / `*` 开头"这两种：行尾 `//` 不能碰，
 *    否则 `https://…` 那一段会被吃掉，而它常常出现在被扫描的那一行的**后面**。
 */
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (/^\s*(\/\/|\*|\/\/\/)/.test(line) ? '' : line))
    .join('\n');

const resolveCandidates = (fromFile, spec) => {
  const base = posix.join(posix.dirname(fromFile), spec);
  const noExt = base.replace(/\.(js|mjs|cjs)$/, '');
  const out = [
    base,
    `${noExt}.ts`,
    `${noExt}.tsx`,
    `${noExt}.mts`,
    `${noExt}.cts`,
    `${noExt}.js`,
    `${noExt}.mjs`,
    `${noExt}.json`,
    `${noExt}.css`,
    `${noExt}.scss`,
    `${noExt}/index.ts`,
    `${noExt}/index.tsx`,
    `${noExt}/index.js`,
    `${noExt}/index.mjs`,
  ];
  return [...new Set(out)];
};

/**
 * 主判据：返回违规清单（空 = 通过）。
 * `listFiles()` 给"树里有哪些文件"，`readFile(p)` 给内容 —— 抽出来是为了让夹具能伪造一棵树。
 */
const findViolations = ({ listFiles, readFile, label, sourcesOnly = false }) => {
  const present = new Set(listFiles());
  const violations = [];
  for (const file of present) {
    if (!SOURCE_DIRS.some((d) => file.startsWith(`${d}/`))) continue;
    if (!SOURCE_EXT.test(file) || SKIP.test(file)) continue;
    if (sourcesOnly && TESTISH.test(file)) continue;
    const text = readFile(file);
    if (text === undefined) continue;
    const code = stripComments(text);
    for (const m of code.matchAll(SPEC_RE)) {
      const spec = m[1];
      // `./dist/…` 是**构建产物**，不在版本控制里 —— 拿它当"实现没入库"是假红。
      if (/(^|\/)dist\//.test(spec)) continue;
      const hit = resolveCandidates(file, spec).find((c) => present.has(posix.normalize(c)));
      if (hit === undefined) {
        const line = code.slice(0, m.index).split('\n').length;
        violations.push({ label, file, line, spec, testish: TESTISH.test(file) });
      }
    }
  }
  return violations;
};

const fromGit = (tree, sourcesOnly) =>
  findViolations({
    label: tree,
    sourcesOnly,
    listFiles: () => git(['ls-tree', '-r', '--name-only', tree]).split('\n'),
    readFile: (p) => {
      try {
        return git(['show', `${tree}:${p}`]);
      } catch {
        return undefined;
      }
    },
  });

const report = (violations, out = console) => {
  if (violations.length === 0) {
    out.log('✅ 每一个相对 import 都解析到这棵树里存在的文件');
    return 0;
  }
  const build = violations.filter((v) => !v.testish);
  const tests = violations.filter((v) => v.testish);
  out.log(
    `🔴 ${violations.length} 条相对 import 在这棵树里解析不到文件 —— 构建输入 ${build.length} 条（干净检出打不出包），` +
      `测试文件 ${tests.length} 条（` +
      '`pnpm -r test` 必红）：',
  );
  for (const v of violations) out.log(`   ${v.testish ? '[测试] ' : '[构建] '}${v.file}:${v.line}  ->  '${v.spec}'`);
  out.log('   复取：node scripts/check-imports-resolve.mjs --tree <这枚 ref> [--sources-only]');
  return 1;
};

/** 三臂夹具：在内存里伪造一棵"树"（文件清单 + 内容），不碰仓库也不落盘。 */
const selfTest = () => {
  const arm = (name, files, expect) => {
    const list = Object.keys(files);
    const got = findViolations({ label: name, listFiles: () => list, readFile: (p) => files[p] });
    const red = got.length > 0;
    const ok = red === expect;
    console.log(`${ok ? '✅' : '🔴'} 臂 ${name}：期望${expect ? '红' : '绿'}，实得${red ? `红（${got.length} 条）` : '绿'}`);
    return ok;
  };
  let allOk = true;
  allOk = arm(
    'untracked-target（引用了树里没有的实现文件）',
    {
      'packages/x/src/index.ts': "export { a } from './a-contract';\n",
      'packages/x/src/other.ts': "export const b = 1;\n",
    },
    true,
  ) && allOk;
  allOk = arm(
    'missing-module（引用了根本不存在的模块）',
    { 'packages/x/src/index.ts': "import '../nope';\n" },
    true,
  ) && allOk;
  allOk = arm(
    'compliant（合规形状：带 .js 后缀的 NodeNext 写法 + 目录 index）',
    {
      'packages/x/src/index.ts': "export { a } from './a.js';\nexport * from './sub';\n",
      'packages/x/src/a.ts': 'export const a = 1;\n',
      'packages/x/src/sub/index.ts': 'export const s = 2;\n',
    },
    false,
  ) && allOk;
  console.log(allOk ? '✅ 自检三臂都按期望走' : '🔴 自检没过：这枚尺不能失败，就别拿它当门禁');
  return allOk ? 0 : 1;
};

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};

if (process.argv.includes('--self-test')) process.exit(selfTest());
const tree = arg('tree', 'HEAD');
process.exit(report(fromGit(tree, process.argv.includes('--sources-only'))));
