/**
 * 视图可达性：每个 `ViewKey` 都必须至少有一条到达路径
 * ======================================================
 *
 * ## 它挡的是什么（F-01，2026-11-10 现量）
 *
 * `kanban` 视图曾经：定义在 `view-tabs.ts` 的 `MODULE_VIEW_TABS` 里、
 * `App.tsx` 里有渲染分支、中英词条齐全 —— 但**两条入口路径全断**：
 *
 *   · 路径 A（默认 rail）：`visibleMainTabs` 要求 `enabledModules.has('kanban')`，
 *     而 `ShellModuleKey` = `FeatureModuleKey` 是闭集，`kanban` **不在里面**
 *     ⇒ `has()` 恒 false；
 *   · 路径 B（用户手动固定）：`rail-pref.isViewKey` 的白名单里**也没有它**
 *     ⇒ 就算手写进 `localStorage`，`readKeys()` 也会过滤掉。
 *
 * ⇒ 一个**已完整实现**的功能，用户永远打不开。而它不会被任何既有判据发现：
 *   · `check:reachability` 管的是**数据实体**的可达性（脚本头明说），不是视图；
 *   · `apps/landing` 的 `mockup-shell-shape` 默认 rail 推导把"没登记"与
 *     "默认关"一起当"不该出现"，两边都不含它 ⇒ 那条双向等集判据照样绿。
 *
 * 修法：把 `kanban` 登记进 `SHELL_MODULES`（`defaultOn: true`）并加进共享词表
 * `FEATURE_MODULE_KEYS`。本文件是**防它再发生**的那道门禁。
 *
 * ## 判据
 *
 * `VIEW_TABS` 的每一项，必须至少满足下面四条之一：
 *   ① 常驻：`tasks` / `search`（不给关）
 *   ② 可开关：`key ∈ FEATURE_MODULE_KEYS` **且**真的登记在 `SHELL_MODULES` 里
 *   ③ 用户可固定：在 `rail-pref` 的运行时白名单里
 *   ④ 显式豁免：另有入口的视图（见 `REACHABLE_ELSEWHERE`，**必须写清从哪儿进**）
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FEATURE_MODULE_KEYS } from '@heyta/domain';
import { describe, expect, it } from 'vitest';

import { RAIL_VIEW_KEYS } from '../src/features/shell/rail-pref.js';
import { VIEW_TABS } from '../src/features/shell/view-tabs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');

/** `SHELL_MODULES` 里真正登记了的 key（不是"domain 层允许的 key"）。 */
function registeredShellModuleKeys(): string[] {
  const src = readFileSync(resolve(REPO, 'apps/web/src/features/shell/modules.ts'), 'utf8');
  const start = src.indexOf('const SHELL_MODULES');
  if (start < 0) throw new Error('modules.ts 里找不到 SHELL_MODULES —— 判据锚点已失效');
  const end = src.indexOf('];', start);
  return [...src.slice(start, end).matchAll(/key:\s*'([a-zA-Z][a-zA-Z-]*)'/g)].map((m) => m[1] ?? '');
}

/** `MODULE_VIEW_TABS` 的 key（声明顺序，不做集合去重 —— 顺序本身是产品语义）。 */
function moduleViewTabKeys(): string[] {
  const src = readFileSync(resolve(REPO, 'apps/web/src/features/shell/view-tabs.ts'), 'utf8');
  const start = src.indexOf('const MODULE_VIEW_TABS');
  if (start < 0) throw new Error('view-tabs.ts 里找不到 MODULE_VIEW_TABS —— 判据锚点已失效');
  const end = src.indexOf('];', start);
  return [...src.slice(start, end).matchAll(/\{\s*key:\s*'([^']+)'/g)].map((m) => m[1] ?? '');
}

/**
 * 显式豁免：这些视图**不在** rail 上，但另有入口。
 *
 * 🔴 往这里加一项 = 声明"它从别处进得来"，**值必须写清从哪儿进**：
 *   · `settings` —— 顶部头像菜单（`App.tsx` 的 `SETTINGS_ANCHORS`）
 *   · `trash`    —— 侧栏底部那一组（`view-tabs.ts` 的 `SIDEBAR_TOOL_TABS`）
 */
const REACHABLE_ELSEWHERE: Readonly<Record<string, string>> = {
  settings: '顶部头像菜单',
  trash: '侧栏底部 SIDEBAR_TOOL_TABS',
};

/** 判定一个 key 是否有到达路径。抽成纯函数，好让阳性对照能喂人造输入。 */
function unreachableKeys(keys: readonly string[]): string[] {
  const featureKeys = new Set<string>(FEATURE_MODULE_KEYS);
  const registered = new Set(registeredShellModuleKeys());
  const pinnable = new Set<string>(Object.keys(RAIL_VIEW_KEYS));
  return keys.filter(
    (k) =>
      !(k === 'tasks' || k === 'search') &&
      // ⚠️ 两个条件都要：在词表里 **且** 真的被 SHELL_MODULES 登记。
      // 只看前者会漏掉 F-01 那种"key 合法但没人登记"的情形。
      !(featureKeys.has(k) && registered.has(k)) &&
      !pinnable.has(k) &&
      !(k in REACHABLE_ELSEWHERE),
  );
}

describe('视图可达性：每个 ViewKey 都必须至少有一条到达路径', () => {
  it('核心判据：VIEW_TABS 里没有"进不去"的视图', () => {
    const unreachable = unreachableKeys(VIEW_TABS.map((tab) => tab.key));
    expect(
      unreachable,
      `这些视图没有任何入口（既不可常驻、不可开关、不可固定，也不在豁免名单里）：${unreachable.join(', ')}\n` +
        '修法三选一：加进 FEATURE_MODULE_KEYS + SHELL_MODULES / 设成常驻 / 删掉它。',
    ).toEqual([]);
  });

  /**
   * 阳性对照：判据在"真有一个不可达视图"时**真的会红**。
   *
   * 做法是喂**人造输入**给纯函数，而不是去改真源码（那是共享工作区，
   * 见 AGENTS.md 并发协作那节）。一条永远绿的判据比没有判据更糟。
   */
  it('阳性对照：人造一个不可达视图时，判据必须报出来', () => {
    // `kanban` 现在**是可达的**，所以直接拿它当"应该报出来"的反例已经不成立 ——
    // 用一个真源码里不存在的 key，它必然四条全不满足。
    expect(unreachableKeys(['tasks', 'calendar', 'definitely-not-a-real-view'])).toEqual([
      'definitely-not-a-real-view',
    ]);
  });

  it('豁免名单里每一项都写清了"从哪儿进"', () => {
    for (const [key, how] of Object.entries(REACHABLE_ELSEWHERE)) {
      expect(how.trim().length, `豁免 ${key} 没写入口 —— 豁免名单不许退化成垃圾篓`).toBeGreaterThan(0);
    }
  });

  it('🔴 MODULE_VIEW_TABS 的每一项都必须在 SHELL_MODULES 里登记', () => {
    const registered = new Set(registeredShellModuleKeys());
    const missing = moduleViewTabKeys().filter((k) => !registered.has(k));
    expect(
      missing,
      `这些视图在 MODULE_VIEW_TABS 里但没登记进 SHELL_MODULES ⇒ ` +
        `enabledModules.has() 恒 false ⇒ 不可达：${missing.join(', ')}`,
    ).toEqual([]);
  });
});
