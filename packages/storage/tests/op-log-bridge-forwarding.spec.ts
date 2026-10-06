/**
 * 桥上的转发列表必须跟上 `OpLogStore` 接口
 * ========================================
 *
 * `oplog-worker-bridge.ts` 的转发列表是**逐条手写**的，而 worker 侧按
 * `store[request.method]` 动态派发。于是接口加一个方法、忘了在桥上补一行时：
 * 编译**不会**报错（`createWorkerOpLogStore` 那个对象字面量满足接口，
 * 因为缺的方法在运行时才要），界面也不会有任何提示 —— 只在真跑 SQLite-over-worker
 * 那条路上，调用点收到一句
 * `OpLogStore 上没有方法 "xxx"。请核对 OpLogStore 是否改名、以及桥上的转发列表是否跟上。`
 * 而那已经是用户点"立即同步"之后的事了。
 *
 * 🔴 这正是本仓库反复栽的那个形状：**每一段都绿、接起来断**（AGENTS §7）。
 * `op-log-store.ts` 的注释里本来就写着这句警告 —— 只在注释里的纪律没有保质期，
 * 所以这里把它做成一条能失败的判据。
 *
 * ## 这条判据怎么才会红
 *
 * 在 `OpLogStore` 上加一个必需方法、不在桥里转发 ⇒ 本文件当场报出方法名。
 * 反向也验过：把桥里 `countPendingUpload` 那一行删掉 ⇒ 它出现在差集里。
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const IFACE = readFileSync(new URL('../src/op-log-store.ts', import.meta.url), 'utf8');
const BRIDGE = readFileSync(new URL('../src/sqlite/oplog-worker-bridge.ts', import.meta.url), 'utf8');

/**
 * 从接口声明里取**必需**方法名。
 *
 * 只认 `^··name(` 这一种形状：带 `?` 的可选成员是另一种写法，
 * 而可选成员缺转发**不是** bug（调用方本来就要处理它不存在）。
 * 注释行不算 —— `/** … ` 里的 `(` 前不会有 `^··name(` 的行首两空格形状，
 * 但 `getOpsSince(` 这类词会出现在散文里，所以按**行首两空格 + 小写标识符 + 左括号**收。
 */
function requiredInterfaceMethods(): string[] {
  const start = IFACE.indexOf('export interface OpLogStore<');
  expect(start, '没找到 OpLogStore 接口声明 ⇒ 探针坏了').toBeGreaterThanOrEqual(0);
  // 🔴 必须**截到接口的收尾大括号**为止。第一次写这版时切片切到了文件末尾，
  // 于是把下一个顶层声明 `export class OpLogStoreError` 的
  // `constructor(`（同样是行首两空格 + 小写标识符 + 左括号）当成了接口方法，
  // 判据当场报「桥少了 1 个转发：constructor」。假红，但报得对 ——
  // 差集里有名字就说明解析出的集合不干净。
  const end = IFACE.indexOf('\n}', start);
  expect(end, '接口体没有顶格的收尾大括号 ⇒ 解析形状变了').toBeGreaterThan(start);
  const body = IFACE.slice(start, end);
  const names = new Set<string>();
  for (const match of body.matchAll(/^ {2}([a-z][A-Za-z0-9]*)\(/gm)) names.add(match[1]!);
  return [...names].sort();
}

/** 桥上实际转发的方法名（`call('name', …)`）。 */
function forwardedMethods(): string[] {
  const names = new Set<string>();
  for (const match of BRIDGE.matchAll(/call\('([a-zA-Z0-9]+)'/g)) names.add(match[1]!);
  return [...names].sort();
}

describe('OpLogStore 接口 ↔ worker 桥转发列表', () => {
  it('🔴 每个必需方法都在桥上有转发（加方法忘了桥上补一行会当场报出方法名）', () => {
    const iface = requiredInterfaceMethods();
    const forwarded = new Set(forwardedMethods());
    const missing = iface.filter((name) => !forwarded.has(name));

    // 前提：两边的读数都**非空** —— 空集会让上面的差集恒成立（假绿）。
    // 阈值从接口自己推导（不写死"至少 15 个"这种数，它三天就漂）。
    expect(iface.length, '接口方法一个都没解析出来 ⇒ 探针坏了').toBeGreaterThan(5);
    expect(forwarded.size, '桥上一个方法都没解析出来 ⇒ 探针坏了').toBeGreaterThan(5);
    expect(
      missing,
      `桥少了 ${String(missing.length)} 个转发：${missing.join(', ')} —— ` +
        'worker 侧会在运行时才报"OpLogStore 上没有方法"',
    ).toEqual([]);
  });

  it('🔴 P1-10 那三个计数方法确实上了接口（不是只写在实现里）', () => {
    const iface = new Set(requiredInterfaceMethods());
    for (const name of ['countAllOps', 'countPendingApply', 'countPendingUpload']) {
      expect(iface.has(name), `${name} 必须是接口成员，否则上层拿不到它`).toBe(true);
    }
  });
});
