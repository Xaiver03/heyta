/**
 * 测试草稿 · 视图可达性门禁（补 `check:reachability` 明说的盲区）
 * ==================================================================
 *
 * 🔴 这是**草稿**，不是已入库的判据。放这里等白天评审后再决定放哪。
 *
 * 建议落点：`apps/web/tests/view-reachability.spec.tsx`
 *   —— 理由：它读的是 `apps/web/src` 的源码，与被测对象同包；
 *   而且 `rail-more-menu.spec.ts` / `keyboard-cursor.spec.tsx` 已经在这个目录里
 *   做同类"从源码推导事实"的判据。
 *
 * ─────────────────────────────────────────────────────────────────
 * 它要挡的缺陷（F-01，现量）
 *
 *   kanban 视图：`view-tabs.ts` 里有定义、`App.tsx` 里有渲染分支，
 *   但**三条入口路径全断** ⇒ 用户永远打不开它。
 *   这个缺陷存在了很久，而**没有任何一道门禁看得见** —— 因为：
 *     · `check:reachability` 只管**数据实体**（脚本头 26-28 行明说）
 *     · `mockup-shell-shape.spec.tsx` #5 的默认 rail 推导把
 *       "不在 SHELL_MODULES 里" 与 "defaultOn: false" 都当"不该出现"，
 *       于是两边都不含它 ⇒ 照绿（这就是 F-03）
 *
 * ─────────────────────────────────────────────────────────────────
 * 判据
 *
 *   `VIEW_TABS` 的每一项，必须至少满足下面**四条之一**：
 *     ① 常驻：`v.key === 'tasks' || v.key === 'search'`
 *     ② 可开关：`v.key ∈ FEATURE_MODULE_KEYS`（且真的登记在 SHELL_MODULES 里）
 *     ③ 用户可固定：`rail-pref.isViewKey(v.key)` 通过
 *     ④ 显式排除但另有入口：`v.key ∈ {'settings','trash'}`
 *
 * ⚠️ 第 ④ 条是**豁免名单**，不是垃圾篓。往里加东西必须同时说明
 * "这个视图从哪儿进" —— 否则这条门禁就退化成"漏了就有个名字"，
 * 那正是 `keyboard-cursor.spec.tsx` 的 `ACCOUNTED_OUT` 已经犯过的错
 *（它自己对这条的告诫写在那个数组上方）。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { VIEW_TABS } from '../src/features/shell/view-tabs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');

/**
 * `rail-pref.isViewKey` 的白名单。
 *
 * ⚠️ 这里**从源码文本读**，不 import —— 因为 `isViewKey` 目前没有 export
 * （它是模块私有的）。两条路可选：
 *   ① 草稿阶段：读源码文本（现在这样，零侵入）
 *   ② 正式入库时：把白名单提成 `export const RAIL_VIEW_KEYS: readonly ViewKey[]`，
 *      由 `ViewKey` 派生，然后这里直接 import —— 那同时把 F-04 一起修了
 *      （F-04 = 这份手抄白名单与 `ViewKey` 之间没有任何对账）。
 */
function railPreferenceAccepts(key: string): boolean {
  const src = readFileSync(resolve(REPO, 'apps/web/src/features/shell/rail-pref.ts'), 'utf8');
  const start = src.indexOf('function isViewKey');
  if (start < 0) throw new Error('rail-pref.ts 里找不到 isViewKey —— 判据锚点已失效');
  const end = src.indexOf('].includes', start);
  if (end < 0) throw new Error('isViewKey 的白名单没有 `].includes` 收尾 —— 判据锚点已失效');
  const allowed = new Set(
    [...src.slice(start, end).matchAll(/'([a-zA-Z][a-zA-Z-]*)'/g)].map((m) => m[1] ?? ''),
  );
  return allowed.has(key);
}

/** 从源码抠一个数组字面量里的 key。**源码文本**判据，理由同 mockup-shell-shape。 */
function keysOf(file: string, declaration: string): string[] {
  const src = readFileSync(resolve(REPO, file), 'utf8');
  const start = src.indexOf(declaration);
  if (start < 0) throw new Error(`${file} 里找不到 ${declaration} —— 判据锚点已失效`);
  const end = src.indexOf('] as const', start) >= 0 && src.indexOf('] as const', start) < src.indexOf('];', start)
    ? src.indexOf('] as const', start)
    : src.indexOf('];', start);
  return [...src.slice(start, end).matchAll(/'([a-zA-Z][a-zA-Z-]*)'/g)].map((m) => m[1] ?? '');
}

function featureModuleKeys(): string[] {
  return keysOf('packages/domain/src/feature-modules.ts', 'export const FEATURE_MODULE_KEYS');
}

/** `SHELL_MODULES` 里真正登记了的 key（不是"domain 层允许的 key"）。 */
function registeredShellModuleKeys(): string[] {
  const src = readFileSync(resolve(REPO, 'apps/web/src/features/shell/modules.ts'), 'utf8');
  const start = src.indexOf('const SHELL_MODULES');
  const end = src.indexOf('];', start);
  return [...src.slice(start, end).matchAll(/key:\s*'([a-zA-Z][a-zA-Z-]*)'/g)].map((m) => m[1] ?? '');
}

/**
 * 显式豁免：这些视图**不在** rail 上，但另有入口。
 *
 * 🔴 往这里加一项 = 声明"它从别处进得来"，**必须写清从哪儿进**：
 *   · `settings` —— 顶部头像菜单（`App.tsx` 的 `SETTINGS_ANCHORS`）
 *   · `trash`    —— 侧栏底部那一组（`view-tabs.ts` 的 `SIDEBAR_TOOL_TABS`）
 */
const REACHABLE_ELSEWHERE: Readonly<Record<string, string>> = {
  settings: '顶部头像菜单',
  trash: '侧栏底部 SIDEBAR_TOOL_TABS',
};

describe('视图可达性：每个 ViewKey 都必须至少有一条到达路径', () => {
  it('核心判据：VIEW_TABS 里没有"进不去"的视图', () => {
    const featureKeys = new Set(featureModuleKeys());
    const registered = new Set(registeredShellModuleKeys());
    const unreachable: string[] = [];

    for (const tab of VIEW_TABS) {
      const alwaysOn = tab.key === 'tasks' || tab.key === 'search';
      // ⚠️ 两个条件**都要**：在 domain 的词表里 **且** 真的被 SHELL_MODULES 登记。
      // 只看前者会漏掉 F-01 那种"key 合法但没人登记"的情形。
      const toggleable = featureKeys.has(tab.key) && registered.has(tab.key);
      const pinnable = railPreferenceAccepts(tab.key);
      const elsewhere = tab.key in REACHABLE_ELSEWHERE;
      if (!alwaysOn && !toggleable && !pinnable && !elsewhere) unreachable.push(tab.key);
    }

    expect(
      unreachable,
      `这些视图没有任何入口（既不可常驻、不可开关、不可固定，也不在豁免名单里）：${unreachable.join(', ')}\n` +
        '修法三选一：加进 FEATURE_MODULE_KEYS + SHELL_MODULES / 设成常驻 / 删掉它。',
    ).toEqual([]);
  });

  /**
   * 阳性对照：这条判据在"真有一个不可达视图"时**真的会红**。
   *
   * 做法不是在真源码上改（那是共享工作区，见 AGENTS.md 并发协作那节），
   * 而是把上面的逻辑抽成一个纯函数、喂一个**人造的** VIEW_TABS。
   * 这样"判据能失败"这件事本身是可验的 —— 一条永远绿的判据比没有判据更糟。
   */
  it('阳性对照：人造一个不可达视图时，判据必须报出来', () => {
    const fake = [
      { key: 'tasks' },
      { key: 'calendar' },
      { key: 'kanban' }, // ← 不在 featureKeys、不在 registered、不在白名单、不在豁免
    ];
    const featureKeys = new Set(featureModuleKeys());
    const registered = new Set(registeredShellModuleKeys());
    const bad = fake
      .map((t) => t.key)
      .filter(
        (k) =>
          !(k === 'tasks' || k === 'search') &&
          !(featureKeys.has(k) && registered.has(k)) &&
          !railPreferenceAccepts(k) &&
          !(k in REACHABLE_ELSEWHERE),
      );
    expect(bad).toEqual(['kanban']);
  });

  it('豁免名单里每一项都写清了"从哪儿进"', () => {
    for (const [key, how] of Object.entries(REACHABLE_ELSEWHERE)) {
      expect(how.trim().length, `豁免 ${key} 没写入口`).toBeGreaterThan(0);
    }
  });

  /**
   * 顺带把 F-03 钉住：`MODULE_VIEW_TABS` 里每一项都必须**登记在** `SHELL_MODULES`。
   *
   * 这是那个"静默失败"的另一半 —— 判据见 03-findings.md F-03。
   * 现在它红（kanban 没登记）；F-01 修好之后它应该一起绿。
   */
  it('🔴 F-03：MODULE_VIEW_TABS 的每一项都必须在 SHELL_MODULES 里登记', () => {
    const src = readFileSync(resolve(REPO, 'apps/web/src/features/shell/view-tabs.ts'), 'utf8');
    const start = src.indexOf('const MODULE_VIEW_TABS');
    const end = src.indexOf('];', start);
    const moduleTabKeys = [
      ...src.slice(start, end).matchAll(/\{\s*key:\s*'([^']+)'/g),
    ].map((m) => m[1] ?? '');
    const registered = new Set(registeredShellModuleKeys());

    const missing = moduleTabKeys.filter((k) => !registered.has(k));
    expect(
      missing,
      `这些视图在 MODULE_VIEW_TABS 里但没登记进 SHELL_MODULES ⇒ ` +
        `enabledModules.has() 恒 false ⇒ 不可达：${missing.join(', ')}`,
    ).toEqual([]);
  });
});
