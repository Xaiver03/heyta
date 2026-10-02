#!/usr/bin/env node
/**
 * AI 工具路径门禁
 * ==================
 *
 * 钉住「AI 调工具」这条链上**最贵的那条不变量**：
 *
 *   🔴 **确认之前，一个 op 都不能落地。**
 *
 * 这条约束无法靠类型系统表达 —— `LocalApiWriteIntent` 只是"形状像 dispatch"，
 * 谁都可以顺手写一行 `host.submit(...)` 把它落库。而**没有任何既有门禁会红**：
 *
 *   - `check:layering` 只扫 `apps/*`，这两个文件在 `packages/app-host`；
 *   - `check:ui-language` 只管文案；
 *   - 单测能抓"这次跑没写"，抓不住"以后有人在别处加了一行写"。
 *
 * 所以这里做一件**可失败、且能证明会失败**的事：**数 `submit(` 出现了几次、
 * 出现在哪个函数里**。故意在错误的位置加一次写，它必须红。
 *
 * ## 七条规则，每条都对应一个真实会被写出来的错
 *
 * | # | 规则 | 拦住的是 |
 * |---|---|---|
 * | 1 | 选择阶段不得写 | 在"该调哪个工具"里顺手把结果落库 |
 * | 2 | 写只能出现在确认函数里，且只有一处 | 绕过用户确认直接执行 |
 * | 3 | 不得构造 op（`entityType: '…'` 字面量） | 在这里自己拼 op，绕过 op-log 语义 |
 * | 4 | 不得直连模型端点 / 不得有 fetch | 绕过 `@heyta/ai` 的出境闸门 |
 * | 5 | 不得 import `@heyta/op-log` | 让"造不出 op"在类型上失效 |
 * | 6 | W7 删掉的冗余前门不得回来；`describeRoutedFailure()` 只许有一个定义点 | 「同一个判断再写一遍」 |
 * | 7 | 能力清单产物必须与上游一致（调生成器的 `--check`） | 给模型看的语料和真实目录漂了 |
 *
 * ⚠️ 规则 2 的"恰好一处"是**承重**的，不是洁癖：只检查"有没有在确认函数里"
 * 的话，同时留着另一处直接 `submit` 仍然会绿。
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 仓库根。默认脚本上一级。
 *
 * 🔴 `HEYTA_CHECK_ROOT` 只为**故障注入探针**存在：让"故意改坏一处"
 * 落在副本里，而不是共享工作区的真实文件上（与 `check-layering.mjs` 同一约定）。
 */
const ROOT =
  process.env.HEYTA_CHECK_ROOT === undefined
    ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    : path.resolve(process.env.HEYTA_CHECK_ROOT);

/** 被检查的目录。**只扫这几个文件**，不搞全仓 grep（那会有太多假阳性）。 */
const WATCH_DIR = path.join(ROOT, 'packages', 'app-host', 'src');
const WATCH_PREFIX = 'ai-tool-';
const SELECTION_FILE = 'ai-tool-selection.ts';
const RUN_FILE = 'ai-tool-run.ts';

/** 确认函数的声明。写只允许出现在它后面。 */
const CONFIRM_MARKER = 'export async function confirmAiToolProposal';

/**
 * 去掉注释，只留代码。
 *
 * 🔴 必须有这一步：这两个文件的注释里大量提到 `host.submit`，
 * 不剥注释的话门禁会对**正确的代码**报红 —— 而"永远失败的检查"
 * 会教人忽略它，比没有检查更坏。
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/[^\n]*$/gm, '');
}

/** 该行是否在注释里（供逐行规则用）。 */
function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function listWatchedFiles() {
  let entries;
  try {
    entries = readdirSync(WATCH_DIR);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.startsWith(WATCH_PREFIX) && name.endsWith('.ts'))
    .filter((name) => !/\.(spec|test)\.ts$/.test(name))
    .map((name) => path.join(WATCH_DIR, name))
    .sort();
}

const violations = [];

function violate(rel, line, what, why, fix) {
  violations.push({ rel, line, what, why, fix });
}

const files = listWatchedFiles();

if (files.length === 0) {
  console.error('❌ check:ai-tools 找不到 packages/app-host/src/ai-tool-*.ts');
  console.error(
    '   这本身就是失败：一个 0 项的检查等于没有检查（AGENTS.md「检查必须能失败」）。',
  );
  process.exit(1);
}

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const raw = readFileSync(file, 'utf8');
  const code = stripComments(raw);
  const name = path.basename(file);
  const lines = raw.split('\n');

  // ── 规则 1：选择阶段不得写 ──────────────────────────────────────────
  if (name === SELECTION_FILE && code.includes('.submit(')) {
    const line = lines.findIndex((l) => l.includes('.submit(')) + 1;
    violate(
      rel,
      line,
      '工具选择阶段出现了写调用（`.submit(`）',
      '选择只回答"该调哪个工具"，它必须是纯的。在这里写库意味着"模型/规则一选中就落库"，用户看不到、也改不了。',
      '把写留给 `ai-tool-run.ts` 的 `confirmAiToolProposal()`，由用户确认后调用。',
    );
  }

  // ── 规则 2：写只能出现在确认函数里，且恰好一处 ──────────────────────
  if (name === RUN_FILE) {
    const occurrences = code.split('.submit(').length - 1;
    if (occurrences !== 1) {
      violate(
        rel,
        1,
        `写调用出现了 ${String(occurrences)} 次（必须恰好 1 次）`,
        '唯一允许的写点是"用户确认之后"。多于一处 = 有一条绕过确认的写路径；为 0 = 确认路径断了（提案永远落不了地）。',
        '只保留 `confirmAiToolProposal()` 里那一行 `host.submit(proposal.intent)`。',
      );
    } else {
      const confirmAt = code.indexOf(CONFIRM_MARKER);
      const submitAt = code.indexOf('.submit(');
      if (confirmAt === -1 || submitAt < confirmAt) {
        violate(
          rel,
          lines.findIndex((l) => l.includes('.submit(')) + 1,
          '写调用不在 `confirmAiToolProposal()` 里',
          '在它之外写 = 用户还没确认就落了库，这正是 ADR-0005 §3.1 要防的事。',
          '把写挪进 `confirmAiToolProposal()`；执行侧（`runSelectedTool()`）只产出提案。',
        );
      }
    }
  }

  // ── 规则 3：不得构造 op ────────────────────────────────────────────
  lines.forEach((line, i) => {
    if (isCommentLine(line)) return;
    if (/\bentityType:\s*['"][A-Z][A-Z_]*['"]/.test(line)) {
      violate(
        rel,
        i + 1,
        '在这里构造 op（写死了 entityType 字面量）',
        'op 的构造是产品语义，必须在 `packages/app-host` 的动作层里只有一份。在这里拼会让它和 `createTaskActions` 漂移 —— 而漂移不报错，症状是两台设备看到不同数据。',
        '用 `runReadTool()` / `toWriteIntent()` / `confirmAiToolProposal()`，op 的构造留给动作层。',
      );
    }
  });

  // ── 规则 4：不得直连模型端点 / 不得有 fetch ─────────────────────────
  lines.forEach((line, i) => {
    if (isCommentLine(line)) return;
    if (/\bfetch\s*\(|chat\/completions|https?:\/\/[^\s'"]*\/v1\b/.test(line)) {
      violate(
        rel,
        i + 1,
        '出现了直接的网络调用 / 模型端点',
        '出境必须经过 `@heyta/ai` 的闸门（授权、披露、回退不跨隐私边界）。散落在这里的 fetch 无法被审计，用户也无从撤销。',
        '模型调用走 `@heyta/ai`（P2）；本层只做工具选择与执行，不发网络请求。',
      );
    }
  });

  // ── 规则 5：不得 import op-log ──────────────────────────────────────
  lines.forEach((line, i) => {
    if (isCommentLine(line)) return;
    if (/from\s+['"]@heyta\/op-log['"]/.test(line)) {
      violate(
        rel,
        i + 1,
        'import 了 `@heyta/op-log`',
        '一旦能 import op 构造器，"本层在类型上产生不了 op"这条约束就失效了。',
        '只依赖 `@heyta/local-api` 的 `LocalApiWriteIntent`（它没有 op 构造函数）。',
      );
    }
  });
}

// ── 规则 6：W7 删掉的冗余前门与四份抄件**不得长回来** ──────────────────
//
// 为什么这条要进门禁，而不是记在文档里就算完：
// AGENTS §3.5 那条实测教训的原文是「**抽取的收尾动作是删掉旧的那份并加门禁，
// 不是写一个更好的新版本**」。2026-10-02 的 AI 审计就是在同一堆文件里查出：
//   - `runAiTool()` / `grantedToolNames()` 两个零生产调用点的前门（后者还是
//     `listAuthorizedTools()` 的**第二个投影方向** —— 同一个判断从两个方向各写一遍，
//     正是漂移的入口）；
//   - `describeRoutedFailure()` 在 `ai-{breakdown,capture,duration,prioritize}.ts`
//     里**逐字节抄了四遍**，而其中两处的文件头明写着"本轮不允许改那个文件，
//     所以只能各留一份" —— 也就是说这个重复是**被决定留下来的**，
//     没有门禁的话它会在下一次"不方便改"时变成五份。
// 三处都已收敛（2026-10-03）。这条规则的作用只有一个：让它们**不能再长回来**。
//
// ⚠️ 只匹配**声明语法**，且先剥注释 ——
// 这几个名字现在大量出现在注释里（正是在解释为什么它们没了），
// 不剥注释的话这条门禁会对**正确的代码**报红（本文件顶部那条立场）。
const DECL_PATTERN = (name) => new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`, 'm');

/** 递归列出 `WATCH_DIR` 下所有非测试 `.ts`（覆盖范围打印出来：0 项的检查等于没有检查）。 */
function listAppHostSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listAppHostSourceFiles(full));
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (/\.(spec|test)\.ts$/.test(entry.name)) continue;
    out.push(full);
  }
  return out.sort();
}

/** 不许再出现的名字（W7 删掉的冗余前门）。 */
const BANNED_NAMES = ['runAiTool', 'grantedToolNames'];
/** 必须**只有一个定义点**、且住在 owner 文件里的抄件。 */
const SINGLE_OWNER = { name: 'describeRoutedFailure', owner: 'ai-failure-fallback.ts' };

const allSourceFiles = listAppHostSourceFiles(WATCH_DIR);
if (allSourceFiles.length === 0) {
  console.error(`❌ check:ai-tools 在 ${WATCH_DIR} 递归扫到 0 个 .ts —— 规则 6 无从判断，判红。`);
  process.exit(1);
}

const definitionOwners = new Set();
for (const file of allSourceFiles) {
  const code = stripComments(readFileSync(file, 'utf8'));
  const name = path.basename(file);
  for (const banned of BANNED_NAMES) {
    if (DECL_PATTERN(banned).test(code)) {
      violate(
        path.relative(ROOT, file),
        1,
        `又出现了被删掉的冗余前门 \`${banned}()\``,
        '它零生产调用点，而它做的组合在产品里**已经有另一份**（`requestToolCall` 的规则分支）。' +
          '同一条组合有两个名字，就会慢慢长出两个版本，而漂移始于"我只改了其中一个"。',
        '需要"这句话 → 执行一步"就调 `requestToolCall`；需要单独执行就调 `runSelectedTool`。',
      );
    }
  }
  if (DECL_PATTERN(SINGLE_OWNER.name).test(code)) {
    definitionOwners.add(name);
  }
}

const owners = [...definitionOwners].sort();
if (owners.length !== 1 || owners[0] !== SINGLE_OWNER.owner) {
  violate(
    path.relative(ROOT, path.join(WATCH_DIR, SINGLE_OWNER.owner)),
    1,
    `\`${SINGLE_OWNER.name}()\` 的定义点是 ${JSON.stringify(owners)}（必须恰好一个，且在 ${SINGLE_OWNER.owner}）`,
    '同一句话有两个来源就一定会漂移（那四个文件的注释里就写着上一次漂移的代价：' +
      '"缺能力被说成检查地址是否合法"，于是用户去查两个根本没问题的地方）。',
    `只在 ${SINGLE_OWNER.owner} 里定义，其余模块 import 它。`,
  );
}

// ── 规则 7：能力清单必须与工具目录一致 ────────────────────────────────
//
// 🔴 为什么挂在这里而不是新开一条 `check:ai-capability`：
// 根 `package.json` 现在有别的会话的未提交改动，往那条链里插一行会在下一次
// 他们的提交里被带走。判据本身是一样的 —— 而"有守卫没接线"是这个仓库
// 反复付学费的形状（一个只能手动跑的 `--check` 等于没有）。
// 等 `package.json` 空闲时把它提成独立门禁更干净，已登记在
// `docs/plans/ai-assistant-closure.md` 的缺口清单里。
const MANIFEST_GENERATOR = path.join(ROOT, 'scripts/gen-ai-capability-manifest.mjs');
if (existsSync(MANIFEST_GENERATOR)) {
  const checked = spawnSync(process.execPath, [MANIFEST_GENERATOR, '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (checked.status !== 0) {
    violate(
      path.relative(ROOT, path.join('packages/ai/src/capability-manifest.generated.ts')),
      1,
      '能力清单与上游（工具目录 + 实体清单）不一致',
      '那份清单是**给模型看的语料**。它一旦和真实目录漂了，模型就会说"我做不到"于一个' +
        '其实做得到的动作，或者反过来编造一个不存在的工具 —— 而两种都不会编译报错。',
      '跑 `node scripts/gen-ai-capability-manifest.mjs` 重新生成，别手改产物。',
    );
    process.stderr.write(checked.stdout ?? '');
    process.stderr.write(checked.stderr ?? '');
  }
} else {
  violate(
    'scripts/gen-ai-capability-manifest.mjs',
    1,
    '能力清单生成器不存在',
    'W9 的裁决是"清单只能生成、不许手写"。生成器没了，产物就会被人手改，而那正是它要防的。',
    '恢复生成器，或把这条判据连同 W9 一起撤销 —— 不要留一个不会被跑的产物。',
  );
}

if (violations.length > 0) {
  console.error(`\n❌ AI 工具路径门禁失败：${String(violations.length)} 处\n`);
  for (const v of violations) {
    console.error(`  ${v.rel}:${String(v.line)}  ${v.what}`);
    console.error(`      为什么有害：${v.why}`);
    console.error(`      正确做法：${v.fix}\n`);
  }
  process.exit(1);
}

console.log(
  `✅ AI 工具路径门禁通过：ai-tool-* ${String(files.length)} 个文件；` +
    `规则 6 扫描范围 ${String(allSourceFiles.length)} 个 .ts；` +
    '写只出现在确认函数里、无 op 构造、无网络调用、未 import op-log、' +
    '无冗余前门、`describeRoutedFailure()` 定义点恰好一处、能力清单与上游一致。',
);
