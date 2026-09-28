/**
 * W0-4 spike（D2 路线）· 第一台引擎：**裸 V8 上下文**。
 *
 * 把 `@heyta/domain` 的**同一份 bundle 字节**放进一个只有 ECMAScript 内建、
 * 没有任何宿主全局的上下文里执行，跑 `cases.json` 里的用例。
 *
 * 为什么这是 D2 的判据：
 *   D2 的前提是"C# 侧内嵌一个 JS 引擎，跑的还是同一份 TS bundle"。
 *   内嵌引擎（Jint / ClearScript）提供的就是这个环境：没有 process / require /
 *   window / fetch / Buffer。如果 bundle 在这里跑不通，D2 不成立 ——
 *   与选哪个引擎无关。
 *
 * 🔴 所以这里**不注入任何宿主全局**，并把常见宿主全局定义成
 * **一访问就抛错**的 getter：让"偷偷用了宿主能力"当场炸掉，
 * 而不是静默拿到 undefined、然后在别处出怪结果。
 *
 * 用法：TZ=UTC node harness.mjs <bundle> <cases.json> <输出 json>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const [, , BUNDLE_PATH, CASES_PATH, OUT_PATH] = process.argv;
if (!BUNDLE_PATH || !CASES_PATH || !OUT_PATH) {
  throw new Error('用法：node harness.mjs <bundle> <cases.json> <输出 json>');
}

const bundle = readFileSync(BUNDLE_PATH, 'utf8');
const { cases } = JSON.parse(readFileSync(CASES_PATH, 'utf8'));

const FORBIDDEN = [
  'process',
  'require',
  'module',
  'exports',
  '__dirname',
  '__filename',
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'XMLHttpRequest',
  'Buffer',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'queueMicrotask',
  'structuredClone',
  'performance',
  'Deno',
  'Bun',
];

const sandbox = Object.create(null);
const violations = [];
for (const name of FORBIDDEN) {
  Object.defineProperty(sandbox, name, {
    configurable: true,
    get() {
      violations.push(name);
      throw new Error(`bundle 访问了宿主全局：${name}`);
    },
  });
}

const context = vm.createContext(sandbox);
vm.runInContext(bundle, context, { filename: 'domain.iife.js' });

const D = context.HeytaDomain;
if (D === undefined || D === null) {
  throw new Error('HeytaDomain 未定义 —— bundle 不是 IIFE 或 global-name 不对');
}
context.D = D;

const results = {};
for (const [name, source] of Object.entries(cases)) {
  try {
    // 🔴 两侧都用 **同一段 JS 源码**（`JSON.stringify(<expr>)`）产出一个字符串。
    // 这样比对的是"两台引擎对同一份 bundle 的求值结果"，
    // 而不是两台宿主的序列化器谁更像谁。
    const json = vm.runInContext(`JSON.stringify(${source})`, context, { filename: `${name}.js` });
    results[name] = { ok: true, value: json === undefined ? '__undefined__' : json };
  } catch (error) {
    results[name] = { ok: false, error: String(error?.message ?? error) };
  }
}

const report = {
  engine: `node ${process.version} / vm.createContext(空沙箱)`,
  tz: process.env.TZ ?? '(未设置)',
  bundle: BUNDLE_PATH,
  bundleBytes: Buffer.byteLength(bundle),
  exportCount: Object.keys(D).length,
  forbiddenGlobalsTouched: violations,
  caseCount: Object.keys(cases).length,
  results,
};

writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
const failed = Object.entries(results).filter(([, r]) => !r.ok);
process.stdout.write(
  `engine=${report.engine}\n` +
    `bundle 字节=${report.bundleBytes} 导出=${report.exportCount}\n` +
    `用例 ${report.caseCount} 条，失败 ${failed.length} 条，触碰宿主全局 ${violations.length} 次\n` +
    `→ ${OUT_PATH}\n`,
);
if (failed.length > 0) {
  for (const [name, r] of failed) process.stdout.write(`  ✗ ${name}: ${r.error}\n`);
  process.exitCode = 1;
}
