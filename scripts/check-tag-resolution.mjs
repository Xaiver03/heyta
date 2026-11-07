#!/usr/bin/env node
/**
 * 「标签解析只有一个入口」—— 形状门禁
 * ======================================
 *
 * 判据出处：`packages/domain/src/tags.ts` 文件头那三条不变量之后那句话：
 *
 * > 任何地方自己写 `task.tagIds.includes(id)` 都会漏掉别名，而漏掉的表现
 * > **不是报错**，是"合并之后我的任务不见了"（按 B 筛不到只挂着 A 的任务）。
 * > 这条设计的失败方式就是"漏一处、不报错"，所以它有两条判据盯着：
 * > `packages/domain/tests/tags.spec.ts`（行为）与
 * > **`scripts/check-tag-resolution.mjs`（形状：别处不许直接判 `tagIds`）**。
 *
 * 🔴 这份文件是**补写**的（2026-11-07）：那句引用在 `tags.ts` 里挂了一轮，
 * 而脚本本身**不存在** —— 也就是说那条形状判据从来没落地过。同一轮里正好在
 * 三个读点上犯了它要防的错（移动端筛标签 / 桌面端筛标签 / 导出标签名），
 * 三次都是"读原始 tagIds、不报错、结果少"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 它查什么（刻意窄：只查"拿原始 tagIds 自己判"）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 允许直接出现 `tagIds` 的地方（每一条都有理由，不是"暂时放过"）：
 *   · `packages/domain/src/tags.ts`      —— 解析器本身
 *   · `packages/domain/src/entities.ts`  —— 字段定义
 *   · `packages/domain/src/export-dump*` —— 完整保真那份**按设计**原样导出原始 id
 *   · `packages/shared-schema/**`        —— 线协议契约
 *   · 任何 `*.spec.ts(x)` / `tests/**`   —— 测试可以造任意形状
 *   · `packages/op-log/**`、`packages/storage/**` —— 持久化层搬运字段，不做语义
 *
 * 除上述之外，源码里出现下面三种形状就红：
 *   R1 `tagIds.includes(`            —— 拿原始 id 判"有没有某个标签"
 *   R2 `tagIds.filter(` / `.map(`    —— 拿原始 id 派生集合（与 R1 同源）
 *   R3 `[tagId][.  ]includes(`        —— 反向写法：`tagIds` 在某处的局部别名也算
 *                                       （只查名为 `tagIds` / `tagId` 的标识符，
 *                                        因为本仓没有别的 naming 约定能钉住它）
 *
 * 用法：
 *   node scripts/check-tag-resolution.mjs              # 检查
 *   node scripts/check-tag-resolution.mjs --self-test  # 四条臂（真源 0 违规 / 三种违规各一）
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();

/** 允许直接碰 `tagIds` 的路径前缀（每条的理由见文件头）。 */
const ALLOWED = [
  'packages/domain/src/tags.ts',
  'packages/domain/src/entities.ts',
  'packages/domain/src/export-dump.ts',
  'packages/shared-schema/',
  'packages/op-log/',
  'packages/storage/',
  /*
    `task-filter.ts`：`context.tags` 缺席时**按设计**退化成精确匹配（那是"这一端还没接线"
    的既有语义，`packages/ui/tests/projects-model.spec.ts` 与
    `apps/mobile/tests/task-tag-alias-filter.spec.ts` 都钉着"不传 = 旧行为"）。
    换句话说这两处不是"绕过解析器"，是**解析器的降级分支本身**。
    ⚠️ 它们都在 `context.tags === undefined ?` 的三元里 —— 若哪天有人把这条三元
    删掉、只留原始匹配，本门禁不会红；那一格由上面那两个 spec 兜着。
  */
  'packages/domain/src/task-filter.ts',
];

/**
 * 逐行放行：抓法比"整文件白名单"细一档，用在"这一处不是语义判断"的地方。
 * 每一行都必须写清理由 —— 这张表只许变短，不许变成第二个白名单。
 */
const ALLOWED_LINES = [
  {
    file: 'packages/domain/src/ticktick-import.ts',
    needle: 'existing.tags.map((draft) => draft.id)',
    why: '导入时建的是"已有标签 id 的集合"，用来查重；不是判断某条任务有哪些标签。',
  },
];

/** 扫这些目录（只要源码）。 */
const SCAN_ROOTS = ['packages', 'apps'];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'Pods', '.git', '.worktrees']);

const isTestFile = (rel) =>
  /(^|\/)tests\//u.test(rel) || /\.spec\.(ts|tsx)$/u.test(rel) || /\.test\.(ts|tsx)$/u.test(rel);

/** 抹掉注释，保留行数（注释里写"别直接判 tagIds"不算违规）。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (line) => line.replace(/[^\n]/g, ' '));
}

/** 收集待扫文件。 */
function collect() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      const ext = extname(name);
      if (ext !== '.ts' && ext !== '.tsx') continue;
      out.push(relative(ROOT, full));
    }
  };
  for (const root of SCAN_ROOTS) walk(join(ROOT, root));
  return out;
}

/**
 * 一条违规形状。
 * 返回 `{rule, line, text}` 数组。
 */
export function violationsIn(source) {
  const code = stripComments(source);
  const out = [];
  const rules = [
    /*
      ⚠️ 允许中间夹一层括号：`(task.tagIds ?? []).includes(id)` 是最常见的写法
      （2026-11-07 实测：第一版规则漏了它，注入一个真违规仍然绿）。
    */
    { id: 'R1', re: /\btagIds\b[^;]{0,40}?\.\s*includes\s*\(/u },
    { id: 'R2', re: /\btagIds\b[^;]{0,40}?\.\s*(?:filter|map|some)\s*\(/u },
    { id: 'R3', re: /\btagId\b[^;]{0,40}?\.\s*includes\s*\(/u },
  ];
  code.split('\n').forEach((text, index) => {
    for (const rule of rules) {
      if (rule.re.test(text)) out.push({ rule: rule.id, line: index + 1, text: text.trim() });
    }
  });
  return out;
}

const isAllowed = (rel) => ALLOWED.some((prefix) => rel.startsWith(prefix)) || isTestFile(rel);

const isAllowedLine = (rel, text) =>
  ALLOWED_LINES.some((entry) => entry.file === rel && text.includes(entry.needle));

function scan() {
  const files = collect();
  const problems = [];
  let allowedHits = 0;
  for (const rel of files) {
    const source = readFileSync(join(ROOT, rel), 'utf8');
    const hits = violationsIn(source);
    if (hits.length === 0) continue;
    if (isAllowed(rel)) {
      allowedHits += hits.length;
      continue;
    }
    for (const hit of hits) {
      if (isAllowedLine(rel, hit.text)) continue;
      problems.push({ rel, ...hit });
    }
  }
  return { files: files.length, problems, allowedHits };
}

function selfTest() {
  const arms = [];
  const cases = [
    ['真源（合法）', 'const ids = resolveTagIds(task.tagIds, tags);', 0],
    ['R1 原始 includes', 'if (task.tagIds.includes(id)) return;', 1],
    ['R2 原始 filter', 'const mine = task.tagIds.filter((t) => t === id);', 1],
    ['R3 反向 includes', 'if (raw.tagId.includes(selected)) return;', 1],
    ['R1 夹一层括号（实测漏过的那一种）', 'return (task.tagIds ?? []).includes(id);', 1],
    ['注释里提到', '// 别写 tagIds.includes(id)\n/* tagIds.filter(x) */', 0],
  ];
  let ok = true;
  for (const [name, source, expected] of cases) {
    const got = violationsIn(source).length;
    const pass = got === expected;
    arms.push(`${pass ? '✅' : '❌'} ${name} → ${got}（期望 ${expected}）`);
    if (!pass) ok = false;
  }
  console.log(arms.join('\n'));
  return ok;
}

const IS_ENTRY = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (IS_ENTRY) {
  if (process.argv.includes('--self-test')) {
    const ok = selfTest();
    process.exit(ok ? 0 : 1);
  }
  const { files, problems, allowedHits } = scan();
  if (problems.length === 0) {
    console.log(
      `✅ 没有绕过解析器直接判原始 tagIds 的地方（扫 ${files} 个文件；` +
        `白名单内命中 ${allowedHits} 处，按文件头理由放行）。`,
    );
    process.exit(0);
  }
  console.error(`🔴 有 ${problems.length} 处绕过 resolveTagIds 直接判原始 tagIds：`);
  for (const p of problems) console.error(`   ${p.rel}:${p.line} [${p.rule}] ${p.text}`);
  console.error(
    '\n判据见 packages/domain/src/tags.ts 文件头：`tagIds` 里留着被合并掉的 id，' +
      '只有 `resolveTagIds` 能回答"这条任务有哪些标签"。',
  );
  process.exit(1);
}
