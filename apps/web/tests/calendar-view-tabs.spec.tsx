/**
 * `CalendarViewTabs`（R11 批三·补）—— 档位入口本身的行为
 * =======================================================
 *
 * 这一档的**移动端**入口就是这个组件（Web 用的是页头 `<select>`）。
 * 所以这里测的是共享组件本体，不是哪个宿主的接线 —— 接线在
 * `apps/mobile/tests/calendar-view-entry.spec.ts`（源码形状）与
 * `apps/web/tests/calendar-view-family.spec.tsx`（Web 的下拉里有哪些档）。
 *
 * ## 为什么值得单独钉
 *
 * 1. 🔴 **"只放真的能用的档位"是这条线的立场**（§9.3 拒绝"点了没反应的菜单项"）。
 *    组件必须**照 `options` 渲染、不自己补全** —— 一补全就会把宿主明确没给的档
 *    （功能模块关掉的那一档）画出来。
 * 2. 🔴 **选中态必须走平铺 `aria-selected`**：对象形态的 `accessibilityState` 在
 *    react-native-web 上会被整个丢掉（`check:rn-aria` 拦的就是这个），
 *    于是"哪一档是当前档"对读屏用户**在 web 上完全不存在**。
 *    这里断言的是**渲染出来的 DOM 属性**，不是 props —— 后者换一种写法就测不到了。
 * 3. 只有一个当前档：两个 `aria-selected="true"` 是"界面在说谎"那一类。
 * 4. 一个选项时整组不渲染：那不是导航，是噪音。
 *
 * ⚠️ 不测视觉（颜色/圆角）—— 那由 `check:design` 与对比度测试管。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate, type I18nValue } from '@heyta/i18n';
import {
  CALENDAR_VIEW_LABEL_KEYS,
  CALENDAR_VIEW_ORDER,
  HeytaUiProvider,
  CalendarViewTabs,
  type CalendarViewKind,
} from '@heyta/ui';

const t: I18nValue['t'] = (key, vars) => translate('zh-CN', key, vars);

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(props: {
  view: CalendarViewKind;
  options: readonly CalendarViewKind[];
  onViewChange: (view: CalendarViewKind) => void;
}): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container!);
    root.render(
      <HeytaUiProvider>
        <CalendarViewTabs
          view={props.view}
          options={props.options}
          onViewChange={props.onViewChange}
          labels={{
            group: t('common.calendar.view.aria'),
            /*
              🔴 这张表 R17 起来自共享层，**不再是这里自己的一份映射**（原先这里抄了一份
              档位→键，与 web 下拉、移动端切换器并成三处，加一档要记着改三遍）。
              守卫本来有两层，现在合成一层：`Record<CalendarViewKind, …>` 少一条编译不过，
              而下面「档位名来自词条表」那条用例把**共享表里的每一档**都跑一遍行为对照。
            */
            name: (kind) => t(CALENDAR_VIEW_LABEL_KEYS[kind]),
          }}
          testID="tabs"
        />
      </HeytaUiProvider>,
    );
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

const tab = (kind: CalendarViewKind): HTMLElement | null =>
  container!.querySelector<HTMLElement>(`[data-testid="tabs-${kind}"]`);

describe('档位切换器', () => {
  it('🔴 只画宿主给的档位，一个不多（组件不自己补全 —— 补全就会画出宿主没给的那一档）', () => {
    render({ view: 'month', options: ['month', 'week', 'day'], onViewChange: vi.fn() });
    const kinds = [...container!.querySelectorAll('[data-testid^="tabs-"]')];
    expect(kinds).toHaveLength(3);
    expect(tab('month')).not.toBeNull();
    expect(tab('week')).not.toBeNull();
    expect(tab('day')).not.toBeNull();
    // 只给两项时，第三项**不许**凭空出现。
    act(() => {
      root?.unmount();
    });
    render({ view: 'month', options: ['month', 'week'], onViewChange: vi.fn() });
    expect([...container!.querySelectorAll('[data-testid^="tabs-"]')]).toHaveLength(2);
    expect(tab('day'), '宿主没给的档位被组件自己补出来了').toBeNull();
  });

  it('档位名来自词条表（不是硬编码，也不是键名）—— 🔴 逐档比，且**档位清单取自共享那份**', () => {
    render({ view: 'month', options: CALENDAR_VIEW_ORDER, onViewChange: vi.fn() });
    // R17：这里不再抄一份 `['month','week','day','year']`。遍历共享那份顺序，
    // 意思是**加一档而没给它键名 ⇒ 共享层编译不过；给了键名却没实现 ⇒ 这条红**，
    // 而这两种都不需要有人记得来改测试。
    for (const kind of CALENDAR_VIEW_ORDER) {
      expect(tab(kind)?.textContent, `${kind} 档没渲染`).toBe(t(CALENDAR_VIEW_LABEL_KEYS[kind]));
    }
    expect(container!.textContent ?? '').not.toContain('common.calendar.view');
  });

  it('🔴 当前档在 DOM 上是 `aria-selected="true"`，而且**只有一个** true', () => {
    render({ view: 'week', options: ['month', 'week', 'day'], onViewChange: vi.fn() });
    // 断言的是**渲染出来的属性**：对象形态的 accessibilityState 在 RN-web 上
    // 会被整个丢掉，而那种写法在 props 层看起来一模一样（check:rn-aria 拦的就是它）。
    expect(tab('week')?.getAttribute('aria-selected')).toBe('true');
    expect(tab('month')?.getAttribute('aria-selected')).toBe('false');
    expect(tab('day')?.getAttribute('aria-selected')).toBe('false');
    expect([...container!.querySelectorAll('[aria-selected="true"]')]).toHaveLength(1);
  });

  it('点一个非当前档 ⇒ `onViewChange` 恰好收到那一个档位', () => {
    const onViewChange = vi.fn();
    render({ view: 'month', options: ['month', 'week', 'day'], onViewChange });
    act(() => {
      tab('day')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onViewChange, '点档位没反应').toHaveBeenCalledTimes(1);
    expect(onViewChange).toHaveBeenLastCalledWith('day');
  });

  it('整组有一个可读的名字（读屏先听到"视图"，再听到三个选项）', () => {
    render({ view: 'month', options: ['month', 'week', 'day'], onViewChange: vi.fn() });
    expect(container!.querySelector('[data-testid="tabs"]')?.getAttribute('aria-label')).toBe(
      t('common.calendar.view.aria'),
    );
  });

  it('🔴 选项不再叠一层 `aria-label`：文本节点就是可及名（叠了会念一套、看一套）', () => {
    render({ view: 'month', options: ['month', 'week', 'day'], onViewChange: vi.fn() });
    for (const kind of ['month', 'week', 'day'] as const) {
      expect(tab(kind)?.getAttribute('aria-label'), `${kind} 上多了一个 aria-label`).toBeNull();
    }
  });

  it('只有一个档位时**整组不渲染**（一个选项的切换器不是导航，是噪音）', () => {
    render({ view: 'month', options: ['month'], onViewChange: vi.fn() });
    expect(container!.querySelector('[data-testid="tabs"]')).toBeNull();
    expect(container!.querySelectorAll('[data-testid^="tabs-"]')).toHaveLength(0);
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────
 * R17：档位表的**单一事实源**本身
 *
 * 上面那些用例判的是"组件怎么画"。这一节判的是那件**界面上完全看不见**的事：
 * 「有哪些档、每档叫什么」这份表原来在三个地方各写一遍（web 的下拉、移动端的切换器、
 * 连这份测试的夹具都是第四个）—— 加一档要人记着改四遍，而漏改的那一遍不会报错。
 *
 * 🔴 两条腿各自抓一种坏：
 *   ① 反抄件腿：宿主源码里**不许再出现档位键字面量**（谁补一张本地表就红）。
 *      范围是按**目录**枚举的（`apps/web/src` + `apps/mobile/src` 全树），
 *      不是点名那两个文件 —— 点名清单是这种判据最常见的失明方式（换一个文件写就漏）。
 *   ② 词条腿：共享表里每个键在 **zh 与 en 两本表都取得到值**，且 zh 含汉字 / en 不含汉字。
 *      "两语都有值"挡漏翻译，"zh 含汉字、en 不含"挡的是**把英文值抄成中文**那一类漂移
 *      （双语两层判据的既有口径），两语相同那条挡的是 en 干脆照抄 zh。
 *
 * ⚠️ 每条 0 命中的腿都配了一条**同刻正向对照**（同一支正则去扫共享层那份表，必须命中 ≥4）：
 *   否则"扫到 0 个"既可能是"确实没有"，也可能是"根本没扫到东西 / 正则是空的"。
 */

const VIEW_KEY_LITERAL = /['"]common\.calendar\.view\.(?:month|week|day|year)['"]/g;

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'build') continue;
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) {
      out.push(...sourceFilesUnder(full));
    } else if (/\.(ts|tsx|js|jsx)$/u.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function countViewKeyLiterals(dir: string): { hits: number; files: number } {
  let hits = 0;
  let files = 0;
  for (const file of sourceFilesUnder(dir)) {
    const found = readFileSync(file, 'utf8').match(VIEW_KEY_LITERAL);
    if (found !== null) {
      hits += found.length;
      files += 1;
    }
  }
  return { hits, files };
}

/*
 * 工作树根：从当前工作目录**往上找** `pnpm-workspace.yaml`。
 * ⚠️ 不用 `import.meta.url` —— vitest 的 jsdom 环境里它不是 `file:` scheme，
 *   `fileURLToPath` 会当场抛（本轮实测：整套件在导入阶段就红，一条判据都没跑到，
 *   而那症状长得像"产品坏了"）。找不到根就**响亮失败**，不降级成"扫当前目录"。
 */
function findRepoRoot(): string {
  let dir = process.cwd();
  while (true) {
    if (existsSync(`${dir}/pnpm-workspace.yaml`)) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('找不到 pnpm-workspace.yaml ⇒ 这条判据的载体坏了，不是产品坏了');
    }
    dir = parent;
  }
}

const REPO_ROOT = findRepoRoot();

const WEB_SRC = `${REPO_ROOT}/apps/web/src`;
const MOBILE_SRC = `${REPO_ROOT}/apps/mobile/src`;
const SHARED_CALENDAR_SRC = `${REPO_ROOT}/packages/ui/src/calendar`;

describe('档位表只有一份（R17 反抄件判据）', () => {
  it('🔴 正向对照：共享层那份表里确实扫得到这些键（证明正则不是空的、扫描真的跑到了那一段）', () => {
    const shared = countViewKeyLiterals(SHARED_CALENDAR_SRC);
    expect(shared.files, '共享层没扫到任何文件 —— 这条判据的载体坏了，不是产品坏了').toBeGreaterThan(
      0,
    );
    // 四档各一次；写死 4 不是抄件，而是**这条对照自己的分母**（少于 4 说明表被删薄了）。
    expect(shared.hits, `共享层只命中 ${shared.hits} 处档位键`).toBeGreaterThanOrEqual(4);
  });

  it('🔴 web 宿主源码里档位键字面量必须 0 命中（补回本地表就红）', () => {
    const hits = countViewKeyLiterals(WEB_SRC);
    expect(hits.hits, `apps/web/src 里 ${hits.files} 个文件写回了档位键：${hits.hits} 处`).toBe(0);
  });

  it('🔴 mobile 宿主源码里档位键字面量必须 0 命中（同上，另一端）', () => {
    const hits = countViewKeyLiterals(MOBILE_SRC);
    expect(hits.hits, `apps/mobile/src 里 ${hits.files} 个文件写回了档位键：${hits.hits} 处`).toBe(0);
  });

  /*
    🔴 这条腿的**独立维度**是测量出来的，不是推测的（22:1x 三支臂，台账 §3 的 V4/V4b/V4c）：
    · 值层语言方向（en 抄 zh / zh 写成英文）⇒ `check:ui-language` **自己就会红**
      （V4 rc=1 指名 `common.calendar.view.year = 年`；V4b rc=1「zh-CN 词条里没有汉字」）
      ⇒ 这一半是**第二层**，不是唯一层。
    · 代码引用的**键名在词条表里根本不存在** ⇒ `check:ui-language` **rc=0**（V4c：
      给 `CalendarViewLabelKey` 联合添一条 `…view.yaar`、两本表不动）——
      红只有这里红：`translate()` 对缺键是**抛** `词条不存在：zh-CN / …`，不是返回键名
      （实测：V4c 那趟本文件红了**两条** —— 上面「逐档比」那条与这条，都是这个抛）。
      也就是说"档位能不能念出来"这件事，**没有任何一层在编译期或门禁守**，
      只有真的把每一档各取一次值的调用会撞上它。
  */
  it('每一档在中英两本词条表里都有值，且英文不是抄的中文', () => {
    for (const kind of CALENDAR_VIEW_ORDER) {
      const key = CALENDAR_VIEW_LABEL_KEYS[kind];
      const zh = translate('zh-CN', key);
      const en = translate('en', key);
      expect(zh, `${key} 在中文表里没值`).toBeTruthy();
      expect(en, `${key} 在英文表里没值`).toBeTruthy();
      expect(zh, `${key} 的中文值里没有汉字（中文表被写成英文 ⇒ 中英同值那一类漂移）`).toMatch(
        /[㐀-鿿]/u,
      );
      expect(en, `${key} 的英文值里出现汉字（英文表抄了中文）`).not.toMatch(/[㐀-鿿]/u);
      expect(en, `${key} 的英文值与中文逐字相同 ⇒ 这条"英文"根本没翻译`).not.toBe(zh);
    }
  });
});
