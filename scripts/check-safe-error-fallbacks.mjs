#!/usr/bin/env node
/**
 * 静态尺：**一句话既被 `throw` 出来、又被某条路当兜底句用 ⇒ 它必须在 `SAFE_ERROR_MESSAGES` 里。**
 *
 * 为什么是这一条（本线计划 §5 第 18 条那一半，起因读数在 §6.71）：
 * `getSafeErrorMessage(err, 兜底)` 的机制是"抛出的句子不在白名单里就用兜底句顶掉"，
 * **顶掉这件事不报错、不留日志**。10-10 那次照出来的正是这一型：legacy 那路的兜底句与
 * 唯一入口不一样，两条路回给用户的句子就分叉了，而四层判据里只有真库那一层看得见。
 * 修完之后那句 `'Invalid or expired link'` 仍然不在白名单里 —— 也就是同一个洞还开着，
 * 只是恰好被"兜底句写得一模一样"遮着；谁改兜底句，它就再来一遍。
 *
 * 为什么不写成"所有兜底句都必须在白名单里"（现量：那样会一次红 **17** 处）：
 * 白名单管的是**允许原样透出的句子**，而 `'Password change failed. Please try again.'`
 * 这类兜底句本来就**不该**被任何 `throw` 抛出 —— 它们不是同一件事，把它们一并纳入是给封闭词表灌水。
 * 交集这条尺命中的是这个洞本身：当前全仓命中 **2** 枚，一枚已在表里，另一枚就是这一格。
 *
 * 用法：
 *   node scripts/check-safe-error-fallbacks.mjs             # 扫当前产物
 *   node scripts/check-safe-error-fallbacks.mjs --self-test # 逐臂证明它能红
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SELF_TEST = process.argv.includes('--self-test');

/** 本尺的三个下限：解析器要是空转，读数会长得像"全绿"，所以先立前提。 */
const MIN_ALLOWLIST = 10;
const MIN_THROWN = 40;
const MIN_FALLBACKS = 8;

const walkTs = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkTs(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
};

/** `const SAFE_ERROR_MESSAGES = new Set([...])` 的成员（跳过注释行）。 */
export const parseAllowlist = (apiSource) => {
  const marker = 'SAFE_ERROR_MESSAGES = new Set([';
  const start = apiSource.indexOf(marker);
  if (start < 0) throw new Error('解析失败：找不到 SAFE_ERROR_MESSAGES 的声明');
  const body = apiSource.slice(start + marker.length);
  const end = body.indexOf('])');
  if (end < 0) throw new Error('解析失败：SAFE_ERROR_MESSAGES 没有闭合');
  const set = new Set();
  for (const line of body.slice(0, end).split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue;
    const m = t.match(/^'((?:[^'\\]|\\.)*)'\s*,?\s*$/);
    if (m) set.add(m[1]);
  }
  return set;
};

/** 注释行里的提及不算调用点/抛出点。 */
const isComment = (source, index) => {
  const lineStart = source.lastIndexOf('\n', index) + 1;
  return /^\s*(\/\/|\*|\/\*)/.test(source.slice(lineStart, index));
};
const lineOf = (source, index) => source.slice(0, index).split('\n').length;

/** 抛出点：`throw new Error('...')` 与 `throw new Error(CONST_NAME)`（常量按 corpus 解析成字面量）。 */
export const parseThrown = (texts, resolve) => {
  const out = [];
  for (const [path, src] of texts) {
    for (const m of src.matchAll(/throw\s+new\s+Error\(\s*('((?:[^'\\]|\\.)*)'|([A-Za-z_$][\w$.]*))\s*\)/g)) {
      if (isComment(src, m.index)) continue;
      const value = m[2] ?? (m[3] ? resolve(m[3]) : null);
      if (value === null || value === undefined) continue;
      out.push({ value, via: m[2] ? 'literal' : m[3], at: `${path}:${lineOf(src, m.index)}` });
    }
  }
  return out;
};

/** 兜底句：`getSafeErrorMessage(err, X)` 的第二个实参，按括号与引号深度切（跨行也算）。 */
export const parseFallbacks = (texts, resolve) => {
  const out = [];
  for (const [path, src] of texts) {
    const needle = 'getSafeErrorMessage(';
    let from = 0;
    for (;;) {
      const at = src.indexOf(needle, from);
      if (at < 0) break;
      from = at + needle.length;
      if (isComment(src, at)) continue;
      let depth = 1;
      let quote = '';
      const args = [''];
      for (let i = at + needle.length; i < src.length; i += 1) {
        const ch = src[i];
        if (quote) {
          args[args.length - 1] += ch;
          if (ch === '\\') {
            args[args.length - 1] += src[(i += 1, i)];
            continue;
          }
          if (ch === quote) quote = '';
          continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
          quote = ch;
          args[args.length - 1] += ch;
          continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') depth += 1;
        else if (ch === ')' || ch === ']' || ch === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
        if (ch === ',' && depth === 1) {
          args.push('');
          continue;
        }
        args[args.length - 1] += ch;
      }
      const arg = (args[1] ?? '').trim();
      if (arg === '') continue;
      const lit = arg.match(/^'((?:[^'\\]|\\.)*)'$/);
      const value = lit ? lit[1] : /^[A-Za-z_$][\w$]*$/.test(arg) ? resolve(arg) : null;
      if (value === null) continue;
      out.push({ value, via: lit ? 'literal' : arg, at: `${path}:${lineOf(src, at)}` });
    }
  }
  return out;
};

/** 把 `NAME` 解析成字面量（`const NAME = '...'` 或对象里的 `NAME: '...'`）。 */
export const makeResolver = (texts) => (name) => {
  const bare = name.split('.').pop();
  for (const [, src] of texts) {
    const m = src.match(new RegExp(`(?:const|let|var)\\s+${bare}\\s*(?::[^=]+)?=\\s*'([^']*)'`));
    if (m) return m[1];
    const n = src.match(new RegExp(`\\b${bare}\\s*:\\s*'([^']*)'`));
    if (n) return n[1];
  }
  return null;
};

export const judge = ({ apiSource, serverTexts, corpusTexts }) => {
  const allow = parseAllowlist(apiSource);
  const resolve = makeResolver([...serverTexts, ...corpusTexts]);
  const thrown = parseThrown(serverTexts, resolve);
  const fallbacks = parseFallbacks(serverTexts, resolve);

  const thrownByValue = new Map();
  for (const t of thrown) if (!thrownByValue.has(t.value)) thrownByValue.set(t.value, t);
  const violations = [];
  for (const f of fallbacks) {
    const t = thrownByValue.get(f.value);
    if (!t) continue;
    if (allow.has(f.value)) continue;
    violations.push({ value: f.value, thrownAt: t.at, via: t.via, fallbackAt: f.at });
  }
  return { allow, thrown, fallbacks, violations };
};

if (SELF_TEST) {
  const API = (entries) => `const SAFE_ERROR_MESSAGES = new Set([\n${entries.map((e) => `  '${e}',`).join('\n')}\n]);`;
  const S = (body) => [['a.ts', body]];
  const pair = (name) => ({
    serverTexts: S(`throw new Error(${name});\nx: getSafeErrorMessage(err, ${name}),`),
  });
  const ARMS = [
    {
      name: 'A0 阳性对照：抛出的那句就在白名单里',
      api: API(['Good sentence']),
      ...pair("'Good sentence'"),
      corpus: S(''),
      expect: 0,
    },
    {
      name: 'A1 就是 10-10 那次的形状：抛出与兜底同句，而白名单没它',
      api: API(['Other']),
      ...pair("'Invalid or expired link'"),
      corpus: S(''),
      expect: 1,
    },
    {
      name: 'A2 白名单里那一行被摘掉 ⇒ 同一段代码变违规',
      api: API(['Other']),
      ...pair("'Good sentence'"),
      corpus: S(''),
      expect: 1,
    },
    {
      name: 'A3 两边都走常量名（值相同、白名单没它）',
      api: API(['Other']),
      serverTexts: S(`throw new Error(MSG_TWO);\nx: getSafeErrorMessage(err, MSG_TWO),`),
      corpus: S(`export const MSG_TWO = 'Const sentence';`),
      expect: 1,
    },
    {
      name: 'A4 只被抛出、从没当过兜底句 ⇒ 不该被这条尺打到',
      api: API(['Other']),
      serverTexts: S(`throw new Error('Only thrown');`),
      corpus: S(''),
      expect: 0,
    },
    {
      name: 'A5 只当兜底句、从没被抛出 ⇒ 同样不该命中（这条尺不是"全部兜底句进表"）',
      api: API(['Other']),
      serverTexts: S(`x: getSafeErrorMessage(err, 'Generic failure'),`),
      corpus: S(''),
      expect: 0,
    },
    {
      name: 'A6 注释里写着一模一样的一句 ⇒ 不算抛出点',
      api: API(['Other']),
      serverTexts: S(`// throw new Error('Commented');\nx: getSafeErrorMessage(err, 'Commented'),`),
      corpus: S(''),
      expect: 0,
    },
    {
      name: 'A7 跨三行的调用点也要认出来',
      api: API(['Other']),
      serverTexts: S(`throw new Error('Multi line');\nx: getSafeErrorMessage(\n  err,\n  'Multi line',\n),`),
      corpus: S(''),
      expect: 1,
    },
  ];
  let failed = 0;
  for (const arm of ARMS) {
    const r = judge({ apiSource: arm.api, serverTexts: arm.serverTexts, corpusTexts: arm.corpus });
    const ok = r.violations.length === arm.expect;
    if (!ok) failed += 1;
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${arm.name} ⇒ 违规 ${r.violations.length}（期望 ${arm.expect}）` +
        (r.violations[0] ? ` 命中: ${JSON.stringify(r.violations[0].value)}` : ''),
    );
  }
  console.log(`SELFTEST_ARMS=${ARMS.length} FAILED=${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

const serverTexts = walkTs(join(ROOT, 'server', 'src')).map((p) => [relative(ROOT, p), readFileSync(p, 'utf8')]);
const corpusTexts = walkTs(join(ROOT, 'packages', 'shared-schema', 'src')).map((p) => [
  relative(ROOT, p),
  readFileSync(p, 'utf8'),
]);
const apiSource = readFileSync(join(ROOT, 'server/src/api.ts'), 'utf8');

const { allow, thrown, fallbacks, violations } = judge({ apiSource, serverTexts, corpusTexts });

const broken = [];
if (allow.size < MIN_ALLOWLIST) broken.push(`白名单只解析出 ${allow.size} 句（下限 ${MIN_ALLOWLIST}）`);
if (thrown.length < MIN_THROWN) broken.push(`抛出点只解析出 ${thrown.length} 处（下限 ${MIN_THROWN}）`);
if (fallbacks.length < MIN_FALLBACKS) broken.push(`兜底句只解析出 ${fallbacks.length} 处（下限 ${MIN_FALLBACKS}）`);
if (broken.length > 0) {
  console.log('🔴 尺自己坏了（解析出来的数远低于现实 ⇒ 判"没有违规"没有意义）：');
  broken.forEach((b) => console.log(`   ${b}`));
  process.exit(2);
}

const distinctThrown = new Set(thrown.map((t) => t.value)).size;
const distinctFallbacks = new Set(fallbacks.map((f) => f.value)).size;
console.log(
  `分母：白名单 ${allow.size} 句 / 抛出点 ${thrown.length} 处（去重 ${distinctThrown}）/ ` +
    `兜底句 ${fallbacks.length} 处（去重 ${distinctFallbacks}）/ 交集命中 ${violations.length}`,
);
for (const v of violations) {
  console.log(`🔴 ${JSON.stringify(v.value)}`);
  console.log(`     抛出：${v.thrownAt}（${v.via}）`);
  console.log(`     兜底：${v.fallbackAt}`);
  console.log('     为什么有害：这句话**被抛出过**，而白名单认不出它 ⇒ 它永远不会原样到达用户，');
  console.log('     只会把所在那条路的兜底句顶上去。两条路的兜底句不一致时，用户就从这两个字读出差别（§6.71 那次就是这一型）。');
}
if (violations.length > 0) {
  console.log(`结论：${violations.length} 处"既被抛出又被当兜底句"的句子不在对外清单里`);
  process.exit(1);
}
console.log('✅ 每一句"既被抛出又被某条路当兜底句"的话都在 SAFE_ERROR_MESSAGES 里');
