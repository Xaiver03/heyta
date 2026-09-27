/**
 * 复用而非复制：桌面壳的**依赖面**就是证明
 * ==========================================
 *
 * 目标里那句"证明它复用共享层而非复制代码"，如果只靠人读代码，就等于没证明 ——
 * 下一个人加一行 `import { ... } from '@heyta/domain'` 不会有任何东西变红。
 *
 * 所以这里把**依赖面本身**变成断言：
 *
 * > 桌面壳的每一个 import，要么是 Electron / Node 内建（平台自身的关注点），
 * > 要么是 `@heyta/node-host`（共享宿主的**唯一**入口），要么是自己人。
 *
 * 🔴 **为什么 `@heyta/node-host` 之外的 `@heyta/*` 一律不许**：
 * 一旦桌面壳能直接 import `@heyta/domain` 或 `@heyta/app-host`，它就有了
 * "自己接一遍业务"的能力 —— 而 `host.ts` 文件头那句判据
 * （"有没有任何一行在决定业务上该怎么做？"）就开始失效了。
 * 让它只能从**一个**入口进来，这个约束才是结构性的，而不是靠自觉。
 *
 * 对照组：`apps/node-host` 是**允许**直接 import 那些包的 —— 因为它就是宿主，
 * 那些接线正是它的职责。桌面壳是宿主的**用户**，不是另一个宿主。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');

/** 允许出现的外部来源。每条都要有 why —— 没有理由的例外会繁殖。 */
const ALLOWED_EXTERNAL: { re: RegExp; why: string }[] = [
  { re: /^electron$/, why: '桌面壳的平台运行时（窗口、IPC、生命周期）' },
  { re: /^node:/, why: 'Node 内建，属平台关注点（路径拼接等），不是业务逻辑' },
  {
    re: /^@heyta\/node-host$/,
    why: '共享宿主的唯一入口 —— 桌面壳的**全部**业务能力必须从这里来',
  },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    // `.tsx` 也要 —— 渲染进程是 React 组件（见下面那条"渲染进程也不是第二个宿主"）。
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(path);
  }
  return out;
}

/** 抽出所有 `from '<spec>'` 与裸 `import '<spec>'`。 */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  for (const match of source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
    const spec = match[1];
    if (spec !== undefined) specs.push(spec);
  }
  return specs;
}

describe('桌面壳的依赖面', () => {
  const files = sourceFiles(SRC);

  it('确实扫到了源文件（空集合会让下面的断言永远通过）', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('🔴 每一个 import 都在白名单里 —— 没有第二个业务入口', () => {
    const violations: string[] = [];

    for (const file of files) {
      const rel = file.slice(SRC.length + 1);
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
        // 自己人（同目录相对 import）不算外部依赖。
        if (spec.startsWith('./') || spec.startsWith('../')) continue;
        if (ALLOWED_EXTERNAL.some((allowed) => allowed.re.test(spec))) continue;
        violations.push(`${rel} → ${spec}`);
      }
    }

    expect(
      violations,
      `桌面壳出现了白名单外的依赖。若它确实需要新的外部能力，` +
        `先问：这件事是不是该在 @heyta/node-host 或 packages/ 里做？\n` +
        violations.join('\n'),
    ).toEqual([]);
  });

  it('🔴 没有直接 import 任何领域/接线包（那是宿主的职责，不是壳的）', () => {
    const forbidden = [
      '@heyta/domain',
      '@heyta/app-host',
      '@heyta/storage',
      '@heyta/op-log',
      '@heyta/shared-schema',
      '@heyta/sync-client',
      '@heyta/sync-core',
      '@heyta/ai',
      '@heyta/local-api',
    ];

    const found: string[] = [];
    for (const file of files) {
      const rel = file.slice(SRC.length + 1);
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (forbidden.includes(spec)) found.push(`${rel} → ${spec}`);
      }
    }

    expect(found, `桌面壳绕过了 @heyta/node-host：\n${found.join('\n')}`).toEqual([]);
  });

  /**
   * 运行时依赖按**层**分成两份，每一份都要有 why —— 没有理由的例外会繁殖。
   *
   * 🔴 2026-09-27 架构变更：桌面从"只有一个窗口的壳"变成"壳 + 真渲染进程"
   * （`renderer/`，见 `vite.config.ts` 的 `rnwResolve()`）。这条断言因此从
   * "恰好 1 个运行时依赖"改成"恰好这些，且每一个都说得清属于哪一层"。
   *
   * ⚠️ **主进程那一侧的不变量没有放松**：它仍然只能经 `@heyta/node-host` 接业务，
   * 这条由上面两条 import 检查继续守着（它们只扫 `src/`）。
   * 渲染进程是新的一层，它有自己的 UI 依赖，但同样不许自己去接线 —— 见最后一条。
   */
  const RUNTIME_DEPS: { layer: 'main' | 'renderer'; name: string; why: string }[] = [
    {
      layer: 'main',
      name: '@heyta/node-host',
      why: '共享宿主的唯一入口 —— 主进程的全部业务能力必须从这里来',
    },
    { layer: 'renderer', name: 'react', why: '渲染进程的 UI 运行时' },
    { layer: 'renderer', name: 'react-dom', why: '渲染进程挂载到 DOM' },
    {
      layer: 'renderer',
      name: 'react-native-web',
      why: '@heyta/ui 写的是 react-native，靠 vite 别名渲到 Web（scripts/vite-rnw-resolve.mjs）',
    },
    {
      layer: 'renderer',
      name: 'react-native-svg',
      why: '@heyta/ui 的图标走 react-native-svg',
    },
    { layer: 'renderer', name: '@heyta/ui', why: '共享组件库 —— 复用而不是复制' },
    {
      layer: 'renderer',
      name: '@heyta/design-system',
      why: '设计令牌；@heyta/ui 依赖它，渲染进程显式声明',
    },
    {
      layer: 'renderer',
      name: '@heyta/domain',
      why: '展示领域模型（类型与纯函数）—— 只读消费，不接线',
    },
  ];

  it('🔴 package.json 的运行时依赖恰好是这份清单 —— 多一个都要先说明它属于哪一层', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    const actual = Object.keys(pkg.dependencies ?? {}).sort();
    const declared = RUNTIME_DEPS.map((dep) => dep.name).sort();

    /**
     * 🔴 这一条比 import 检查更强：import 可以骗过（用动态导入），
     * 但 `dependencies` 是打包与安装的事实。
     *
     * 判据是**"没有清单外的依赖"**，不是"数量恰好相等"：
     * `apps/desktop/package.json` 正被另一条工作线改动（渲染进程要加的
     * `@heyta/design-system` 还没提交），写成全等会立刻再红一次。
     * 而"少一个"本来就不是这条要防的事 —— 要防的是**悄悄多一个**。
     */
    const unexpected = actual.filter((name) => !declared.includes(name));
    expect(
      unexpected,
      '运行时依赖出现了清单外的包。加之前先问：它属于主进程还是渲染进程？' +
        '主进程只该有 @heyta/node-host；渲染进程的东西真的进得来吗？',
    ).toEqual([]);

    // 主进程的宿主入口不能少 —— 少了它，壳就没有接业务的路了。
    expect(actual, '主进程的宿主入口 @heyta/node-host 不能缺席').toContain('@heyta/node-host');

    // 清单自己也要自查：每条都得有说得出口的理由。
    for (const dep of RUNTIME_DEPS) {
      expect(dep.why.length, `${dep.name} 缺一条 why`).toBeGreaterThan(8);
    }
  });

  it('🔴 渲染进程也不是第二个宿主：不许直接 import 接线包', () => {
    const RENDERER = join(import.meta.dirname, '..', 'renderer');

    // 这些包的职责是"接线"（存储、op-log、同步、AI、本地 API），
    // 归 `@heyta/node-host`。渲染进程要走 preload/IPC 找主进程，不能自己接一遍。
    // 注意 `@heyta/domain` 与 `@heyta/ui` **不在此列** —— 它们是只读消费。
    const wiring = [
      '@heyta/app-host',
      '@heyta/storage',
      '@heyta/op-log',
      '@heyta/shared-schema',
      '@heyta/sync-client',
      '@heyta/sync-core',
      '@heyta/ai',
      '@heyta/local-api',
    ];

    const found: string[] = [];
    for (const file of sourceFiles(RENDERER)) {
      const rel = file.slice(RENDERER.length + 1);
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (wiring.includes(spec)) found.push(`${rel} → ${spec}`);
      }
    }

    expect(
      found,
      `渲染进程绕过了 IPC 直接接线。它该经 preload/IPC 找主进程，而不是自己接一遍：\n${found.join('\n')}`,
    ).toEqual([]);
  });
});
