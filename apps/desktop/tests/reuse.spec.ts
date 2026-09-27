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
    else if (entry.name.endsWith('.ts')) out.push(path);
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

  it('package.json 里运行时依赖**只有** @heyta/node-host 一个', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    /**
     * 🔴 这一条比 import 检查更强：import 可以骗过（用动态导入），
     * 但 `dependencies` 是打包与安装的事实。
     * 而且它把"桌面壳很薄"变成一个**可读的数字** —— 1 个运行时依赖。
     */
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['@heyta/node-host']);
  });
});
