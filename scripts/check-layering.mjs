#!/usr/bin/env node
/**
 * 分层门禁：`apps/*` 不得重新长出"业务上该怎么做"的代码。
 * =====================================================
 *
 * AGENTS.md §3.5 定的判据是：**这段代码里有没有任何一行在决定"业务上该怎么做"？**
 * 有就说明它该在 `packages/` 里，不在 `apps/` 里。
 *
 * 但那条判据是**靠人读的**，而人读过一次之后就不再看第二遍。本文件把它变成
 * 四条机器可查的具体形状 —— 全部来自**已经真实发生过**的漂移：
 *
 *   1. `new SyncClient(` —— 12 个回调的接线。曾在 `packages/app-host` 与
 *      `apps/web` 里各有一份，**逐字相同，连注释都是复制的**。
 *   2. 自己定义 `resolveClientId` —— 曾在 `apps/web/src/lib/oplog.ts` 里有一份，
 *      回退逻辑与 `app-host` 的那份已经不同（`Math.random()` vs `randomId()`）。
 *      clientId 是 LWW 冲突的**决胜依据**，两份实现等于两套裁决标准。
 *   3. 直接 `crypto.randomUUID(` —— 外壳里这么写就是假定它在。
 *      `ids.ts` 记着实测事故：Hermes 上 `globalThis.crypto` 整个不存在，
 *      应用**启动即崩**在解析 clientId 那一步。必须走 `randomId()`。
 *   4. `OpLogStore` 的游标键名（`lastServerSeq` 字面量）—— 键名只该定义在
 *      `packages/storage` 的 `META_KEYS` 里。外壳自己拼字面量，
 *      换键名时就会有一端悄悄读到 0（= 每次全量重下，或者更糟）。
 *
 * 前两条是本文件写出来时**刚刚修掉的**；后两条是仓库里已经记录过的同形状事故。
 * 把它们一起钉住，是因为修复一个具体 bug 的正确收尾方式是
 * **让它再也回不来**，而不是相信下次不会有人再写一遍。
 *
 * 用法：node scripts/check-layering.mjs
 *   非零退出 = 有违规。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPS = join(ROOT, 'apps');

/** 不扫的目录：产物与第三方源码，不是我们写的。 */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-types',
  'build',
  'coverage',
  'Pods',
  '.gradle',
  '.cxx',
  'ios',
  'android',
  '.expo',
]);

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

/** 每条规则：一个正则 + 为什么它有害 + 正确做法。 */
const RULES = [
  {
    id: 'no-sync-client-construction',
    pattern: /\bnew\s+SyncClient\s*\(/,
    what: '直接构造 SyncClient',
    why: '它的 12 个回调是宿主无关的接线，复制一份就会与 packages/app-host 的那份漂移。',
    fix: '用 `createSyncClient({ engine, store, baseUrl, getToken, getPassword, applyRemote })`（@heyta/app-host）。宿主只该注入这 5 样。',
  },
  {
    id: 'no-local-resolve-client-id',
    pattern: /(?:async\s+)?function\s+resolveClientId\s*\(|const\s+resolveClientId\s*[:=]/,
    what: '自己定义 resolveClientId',
    why: 'clientId 是 LWW 冲突的确定性决胜依据。两份实现 = 两套裁决标准，而两台设备撞 id 会让冲突处理失去确定性。',
    fix: '从 `@heyta/app-host` 导入 `resolveClientId(adapter)`。它存在 `META_KEYS.CLIENT_ID`，与所有宿主同一个键。',
  },
  {
    id: 'no-direct-random-uuid',
    pattern: /\bcrypto\s*\.\s*randomUUID\s*\(/,
    what: '直接调用 crypto.randomUUID()',
    why: 'Hermes 上 `globalThis.crypto` 可能整个不存在（实测：应用启动即崩在解析 clientId 那一步，停在错误页）。',
    fix: '用 `randomId()` / `newTaskId()`（@heyta/app-host）。它们带完整回退，且回退的强度代价已在 ids.ts 里写清。',
  },
  {
    id: 'no-literal-cursor-key',
    pattern: /['"]lastServerSeq['"]/,
    what: '外壳里硬写游标键名',
    why: '键名只该定义在 packages/storage 的 META_KEYS 里。外壳自己拼字面量，改键名时会有一端静默读到 0。',
    fix: '用 `OpLogStore` 的 `getLastServerSeq()` / `setLastServerSeq()`，或 `META_KEYS.LAST_SERVER_SEQ`。',
  },
];

/** 该行是否在注释里（粗略但足够：只看行首 token）。 */
function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (EXTENSIONS.some((e) => name.endsWith(e))) {
      // 测试文件不在此列：它们**可以**直接构造被测对象。
      if (/\.(spec|test)\.[cm]?tsx?$/.test(name)) continue;
      yield full;
    }
  }
}

const violations = [];
let scanned = 0;

for (const file of walk(APPS)) {
  scanned += 1;
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split('\n');

  for (const rule of RULES) {
    lines.forEach((line, i) => {
      // 注释里提到这些名字是**解释**，不是违规。
      // （本门禁自己的文档、以及各文件头解释"为什么不再这么写"都靠这条。）
      if (isCommentLine(line)) return;
      if (rule.pattern.test(line)) {
        violations.push({ rel, line: i + 1, rule, text: line.trim() });
      }
    });
  }
}

if (violations.length === 0) {
  console.log(`✅ apps/* 分层边界完好（扫描 ${String(scanned)} 个文件，${String(RULES.length)} 条规则）。`);
  process.exit(0);
}

console.error(`🔴 apps/* 里有 ${String(violations.length)} 处违规：\n`);
for (const v of violations) {
  console.error(`   ${v.rel}:${String(v.line)}`);
  console.error(`      违规：${v.rule.what}`);
  console.error(`      代码：${v.text}`);
  console.error(`      为什么有害：${v.rule.why}`);
  console.error(`      正确做法：${v.rule.fix}\n`);
}
console.error('规则出处：AGENTS.md §3.5（宿主外壳的边界）。\n');
process.exit(1);