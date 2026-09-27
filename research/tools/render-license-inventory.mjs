#!/usr/bin/env node
/**
 * 把许可证盘点渲染成 `research/licenses-inventory.generated.md`
 * ============================================================
 *
 *   node research/tools/render-license-inventory.mjs            # 生成
 *   node research/tools/render-license-inventory.mjs --check    # 只校验是否最新
 *   node research/tools/render-license-inventory.mjs --date=2026-09-27
 *
 * ## 为什么需要这个文件
 *
 * `licenses-inventory.generated.md` 的头部一直写着「本文件由工具生成，请勿手工编辑」，
 * 但**那个工具并不存在** —— 上一版 md 是手工/半手工拼出来的，于是漂了：
 *
 * - 摘要写「白名单外已登记 **1**」（那是对的，就是 `caniuse-lite`），
 *   可底下那张表却挂了 **908 行**全部依赖；
 * - 章节标题写「☑️ 白名单外、已逐项登记的包」，正文说「这些包的许可证不在白名单里」，
 *   而表里绝大多数就是普通的 MIT 包。
 *
 * 一份**合规证据**自相矛盾，比没有这份文件更糟：读的人无法判断该信哪一半。
 * 所以这里把「生成」这件事真正工具化，让标题、摘要、表格出自**同一份数据**。
 *
 * ## 🔴 为什么不把 `--check` 挂进 `pnpm check`
 *
 * 因为依赖树**天生是平台相关的**（可选依赖、平台二进制，如 `@esbuild/darwin-arm64`
 * 与 `@esbuild/win32-x64` 只会二选一）。同一份 lockfile 在 macOS 与本仓库的
 * Linux CI 上装出来的树并不相同 —— 把「md 必须与当前树逐字节一致」设成门禁，
 * 会造成**必然的**跨平台红灯。
 *
 * 一门禁能长期活着的前提是它**不会误报**（见 `docs-link-check.mjs` 里同样的判断）。
 * 所以 `--check` 保留为**本地工具**：想确认自己这棵树有没有让清单过期时跑它，
 * 而不是让它去卡 CI。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'research', 'licenses-inventory.generated.md');

/**
 * 生成日期。
 *
 * 用**本地日期**而不是 `toISOString()`：后者是 UTC，在东八区会导致
 * 白天生成的清单标着前一天的日期 —— 这种"看起来对、其实差一天"的元数据
 * 正是审计时最容易被追问的地方。
 */
function localDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const dateArg = process.argv.find((a) => a.startsWith('--date='));
const DATE = dateArg ? dateArg.slice('--date='.length) : localDate();
const checkOnly = process.argv.includes('--check');

// ── 取数据 ──────────────────────────────────────────────────────
//
// 刻意**不 import** 盘点脚本：那会把"怎么算"和"怎么排版"耦合成一个模块，
// 而 `license-inventory.mjs` 同时还是门禁命令（`pnpm check:licenses`），
// 它被 import 时不应该有任何副作用。子进程输出 JSON 是两者之间唯一、清晰的契约。
// ⚠️ `license-inventory.mjs --json` 在**存在不合格依赖时退出码是 1**
// （那是门禁的判据）。这里必须把 stdout 收下来继续渲染 ——
// 恰恰是"有失败项"的时候，这份清单最需要被生成出来给人看。
// 所以不能让它抛异常，也不能把它当成"工具坏了"。
let raw;
try {
  raw = execFileSync(
    process.execPath,
    [join(HERE, 'license-inventory.mjs'), '--json'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  );
} catch (error) {
  if (typeof error.stdout === 'string' && error.stdout.trim().startsWith('{')) {
    raw = error.stdout;
  } else {
    throw error;
  }
}

const data = JSON.parse(raw);
const { total, byKind, reviewedOther, unreviewedOther, failing, all } = data;

/** 表里包名一律用行内代码包起来，避免 `@scope/x` 被当成别的东西。 */
const row = (p, extra) =>
  `| \`${p.name}\` | ${p.version} | ${p.license} |${extra === undefined ? '' : ` ${extra} |`}`;

const lines = [];

lines.push('# 依赖许可证逐项登记（自动生成）');
lines.push('');
lines.push('> ⚠️ **本文件由工具生成，请勿手工编辑。**');
lines.push('> 重新生成：`node research/tools/render-license-inventory.mjs`');
lines.push('> 数据来源：**实际安装的依赖树**（pnpm store），不是 lockfile 的声明。');
lines.push('> 去重口径：`包名@版本`（同名多版本分别登记）。');
lines.push('');
lines.push(`生成时间：${DATE}`);
lines.push('');
lines.push(
  `**总计 ${total} 个包** —— 宽松许可 ${byKind.permissive.length}，` +
    `受限 ${byKind.restricted.length}，无许可证 ${byKind.unknown.length}，` +
    `白名单外已登记 ${reviewedOther.length}。`,
);
lines.push('');
lines.push(
  '准入门槛（见 THIRD_PARTY_LICENSES.md）：许可允许闭源商用；且 2021 年后仍在更新。',
);
lines.push('');

// ── 1. 必须为空的那一节放最前 ────────────────────────────────────
//
// 合规文档的读法是「先看结论，再看例外，最后才翻全量」。把判据埋在一张
// 900 行的表后面，等于没有判据。
lines.push('### 🔴 受限 / 未登记 —— 这一节必须为空');
lines.push('');
if (failing === 0) {
  lines.push('**无。** 这是本文件唯一的通过条件。');
} else {
  lines.push(`**有 ${failing} 个包需要处理**，它们是：`);
  lines.push('');
  lines.push('| 包 | 版本 | 许可证 |');
  lines.push('|---|---|---|');
  for (const p of byKind.restricted) lines.push(row(p));
  for (const p of byKind.unknown) lines.push(row(p));
  for (const p of unreviewedOther) lines.push(row(p));
}
lines.push('');

// ── 2. 人工确认过的例外 ──────────────────────────────────────────
lines.push('### ☑️ 白名单外、已逐项登记');
lines.push('');
if (reviewedOther.length === 0) {
  lines.push('**无。**');
} else {
  lines.push(
    '这些包的许可证**不在白名单里**，也没有被判定为受限 —— 已经人工确认过它们在产品中的角色，',
  );
  lines.push(
    '并在 `research/tools/license-inventory.mjs` 的 `REVIEWED_OTHER` 里登记了**可以接受的理由**：',
  );
  lines.push('');
  lines.push('| 包 | 版本 | 许可证 |');
  lines.push('|---|---|---|');
  for (const p of reviewedOther) lines.push(row(p));
  lines.push('');
  // 理由原文来自工具（`reviewedOther[].reason`）—— 「谁批准的、为什么」只写一处。
  for (const p of reviewedOther) {
    lines.push(`- **${p.license}**（\`${p.name}@${p.version}\`）：${p.reason}`);
  }
}
lines.push('');

// ── 3. 全量 ─────────────────────────────────────────────────────
lines.push(`### 📋 全部依赖（${total} 个）`);
lines.push('');
lines.push(
  '这一段是**全量底稿**：上面两节的所有结论都能在这里逐行核到。' +
    '严格按包名排序（`localeCompare`），同名多版本分行列出。',
);
lines.push('');
lines.push('| 包 | 版本 | 许可证 |');
lines.push('|---|---|---|');
for (const p of all) lines.push(row(p));
lines.push('');

const rendered = lines.join('\n');

// ── 写出 / 校验 ─────────────────────────────────────────────────
if (checkOnly) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    console.error('🔴 research/licenses-inventory.generated.md 不存在。');
    process.exit(1);
  }
  // 生成时间不参与比较：它每次都会变，比它就成了"永远不最新"。
  const strip = (s) => s.replace(/^生成时间：.*$/mu, '');
  if (strip(current) === strip(rendered)) {
    console.log('✅ 许可证清单与当前依赖树一致。');
    process.exit(0);
  }
  console.error(
    '🔴 许可证清单**已过期** —— 当前依赖树与文件里的登记不一致。\n' +
      '   重新生成：node research/tools/render-license-inventory.mjs',
  );
  process.exit(1);
}

writeFileSync(OUT, rendered);
console.log(
  `✅ 已写出 research/licenses-inventory.generated.md —— ` +
    `${total} 个包（宽松 ${byKind.permissive.length}，受限 ${byKind.restricted.length}，` +
    `无许可证 ${byKind.unknown.length}，白名单外已登记 ${reviewedOther.length}）。`,
);
