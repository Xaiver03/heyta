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
 * ## 五条规则，每条都对应一个真实会被写出来的错
 *
 * | # | 规则 | 拦住的是 |
 * |---|---|---|
 * | 1 | 选择阶段不得写 | 在"该调哪个工具"里顺手把结果落库 |
 * | 2 | 写只能出现在确认函数里，且只有一处 | 绕过用户确认直接执行 |
 * | 3 | 不得构造 op（`entityType: '…'` 字面量） | 在这里自己拼 op，绕过 op-log 语义 |
 * | 4 | 不得直连模型端点 / 不得有 fetch | 绕过 `@heyta/ai` 的出境闸门 |
 * | 5 | 不得 import `@heyta/op-log` | 让"造不出 op"在类型上失效 |
 *
 * ⚠️ 规则 2 的"恰好一处"是**承重**的，不是洁癖：只检查"有没有在确认函数里"
 * 的话，同时留着另一处直接 `submit` 仍然会绿。
 */

import { readFileSync, readdirSync } from 'node:fs';
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
          '把写挪进 `confirmAiToolProposal()`，并让 `runAiTool()` 只产出提案。',
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
  `✅ AI 工具路径门禁通过：${String(files.length)} 个文件；` +
    '写只出现在确认函数里、无 op 构造、无网络调用、未 import op-log。',
);
