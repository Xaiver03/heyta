/**
 * 判据：详情列的收起是**宿主接的一段真实状态**（工单 W4 ②③的应用侧半边）
 * =====================================================
 *
 * 对应 `docs/plans/detail-pane-alignment.md` W4：
 * - ②「三条恢复路径各自都能恢复」—— 页头开关 / 设置里那一项 / ⌘/Ctrl+Shift+`\`，
 *   这里各走**一条独立的**用例，而不是"点三次同一个按钮"。
 *   写成一条的代价是这个形状：三条路径其实共用一个 `onClick`，
 *   其中一条根本没接（四象限那次就是这么漏的，见 §8 的 W1 行 #179）。
 * - ③「收起态持久化在设备本地」—— jsdom 这边证的是**读写两端**
 *   （挂载时从存储读回 + 改完立刻落盘），"刷新之后还在"那一半只能由真浏览器证
 *   （`e2e/tests/detail-pane-collapse.spec.ts` 里 `page.reload()` 那条）。
 *
 * ⚠️ 这里**证不了几何**：jsdom 不跑布局、也不加载应用的 CSS bundle，
 * 所以"窗口太窄/太矮时那一栏不出现"和"开关跟着藏起来"在这里一律看不见 ——
 * 那两条判据只在 e2e 层有。别把本文件的绿读成"塌缩做完了"。
 *
 * 🔴 两处防作弊的设置，说明在白送：
 * 1. 每条翻转判据都**同时**断 DOM 属性与存储值。只断 DOM 的话，
 *    把 `saveDetailPane` 摘掉这条仍然绿（那就是 ③ 的洞）；
 *    只断存储的话，界面可以不跟着动。
 * 2. 快捷键那条用**真 `KeyboardEvent` 打在 window 上**，不直接调 handler。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emptyState } from '@heyta/op-log';
import { __resetOpLogForTests, initOpLog } from '../src/lib/oplog.js';
import { openSettingsViaAvatar } from './open-settings-via-avatar.js';
import { translate } from '@heyta/i18n';
import { LocaleHost } from '../src/lib/locale-host.js';
import { loadDetailPane, saveDetailPane } from '../src/features/shell/detail-pane-pref.js';
import { useTaskStore } from '../src/features/tasks/store.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');

const STORAGE_KEY = 'heyta.detailPane';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(async () => {
  localStorage.clear();
  __resetOpLogForTests();
  await initOpLog();
  useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' } });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = undefined;
  root = undefined;
});

async function mountApp(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <LocaleHost>
        <App />
      </LocaleHost>,
    );
  });
  return container;
}

/** `.ht-app` 上的那段状态 —— 它是 CSS 唯一的钩子，所以它本身就是判据对象。 */
function detailAttrOf(el: HTMLElement): string | null {
  return el.querySelector<HTMLElement>('.ht-app')?.getAttribute('data-detail') ?? null;
}

/** 头像菜单 → 设置（`app-mount.spec.tsx` 里那条路的同一写法，不另发明一条）。 */
describe('A. 详情列 pref 模块：缺省、词表、永不抛', () => {
  it('没有存过 ⇒ 默认 open（"即使没东西也空在那里"是产品原话，收起必须是用户主动）', () => {
    expect(loadDetailPane()).toBe('open');
  });

  it('写入与读回是同一个词表：collapsed / open 各走一次', () => {
    saveDetailPane('collapsed');
    expect(loadDetailPane()).toBe('collapsed');
    saveDetailPane('open');
    expect(loadDetailPane()).toBe('open');
  });

  it('🔴 非法值（手改存储 / 旧版本残留）退回默认档，而不是让界面进一个说不清的状态', () => {
    for (const bad of ['"shut"', '"hidden"', 'null', 'not json', '"', '"OPEN"', '42']) {
      localStorage.setItem(STORAGE_KEY, bad);
      expect(loadDetailPane(), `存储里躺着 ${bad} 时不许照单全收`).toBe('open');
    }
  });

  it('🔴 隐私模式下读写都不许抛（访问 localStorage 本身就会抛）', () => {
    // 只替换访问器，不整体删掉 localStorage —— 别的用例还要用它。
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    expect(descriptor, '这台 jsdom 没有 localStorage，这条判据就没法做').not.toBeUndefined();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: localStorage 不可访问');
      },
    });
    try {
      expect(loadDetailPane()).toBe('open');
      expect(() => saveDetailPane('collapsed')).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    }
    // 阳性对照：恢复后确实还能读 —— 否则上面那两条可以建立在"读永远失败"上。
    localStorage.setItem(STORAGE_KEY, '"collapsed"');
    expect(loadDetailPane()).toBe('collapsed');
  });

  it('存的是 JSON 字符串而不是裸串（与 sort-pref / due-display-pref 同一种形状）', () => {
    saveDetailPane('collapsed');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('"collapsed"');
  });
});

describe('B. 页头开关（恢复路径①）', () => {
  it('默认渲染成 open，并且开关带着"收起"那个方向的名字', async () => {
    const el = await mountApp();
    expect(detailAttrOf(el)).toBe('open');
    const toggle = el.querySelector<HTMLButtonElement>('[data-testid="detail-pane-toggle"]');
    expect(toggle, '页头没有详情列开关').not.toBeNull();
    // 🔴 名字说的是"点下去会怎样"，所以它必须随状态**翻转**（恒一个「详情面」的按钮
    //    在两种状态下听起来一样，那是读屏用户的灾难）。
    //    这里不抄词条全文（抄了就成了第二份事实源），只量方向性动词 ——
    //    它挡得住"两个分支写反"和"忘了随状态改"。
    expect(toggle!.getAttribute('aria-label'), '当前是展开态，名字必须是"收下去"').toContain('收起');
    // aria-pressed 报的是"这一栏现在在不在"，与名字必须互相自洽。
    expect(toggle!.getAttribute('aria-pressed')).toBe('true');
  });

  it('🔴 点一下 ⇒ DOM 属性翻 + 立刻落盘（只断属性的话，摘掉 save 这条仍然绿）', async () => {
    const el = await mountApp();
    const toggle = el.querySelector<HTMLButtonElement>('[data-testid="detail-pane-toggle"]');
    await act(async () => {
      toggle!.click();
    });
    expect(detailAttrOf(el)).toBe('collapsed');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('"collapsed"');
    expect(toggle!.getAttribute('aria-label'), '已经收起了，名字必须换成"叫回来"').toContain('展开');
    expect(toggle!.getAttribute('aria-pressed')).toBe('false');
  });

  it('再点一下回到 open，落盘也跟着翻回来（不是单向开关）', async () => {
    const el = await mountApp();
    const toggle = el.querySelector<HTMLButtonElement>('[data-testid="detail-pane-toggle"]');
    await act(async () => {
      toggle!.click();
    });
    await act(async () => {
      toggle!.click();
    });
    expect(detailAttrOf(el)).toBe('open');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('"open"');
  });
});

describe('C. 设置里那一项（恢复路径②）', () => {
  it('🔴 从"收起"状态进设置，选「常驻」⇒ 属性翻回 open 且落盘', async () => {
    localStorage.setItem(STORAGE_KEY, '"collapsed"');
    const el = await mountApp();
    expect(detailAttrOf(el), '挂载时没把存储里的收起读回来').toBe('collapsed');
    await openSettingsViaAvatar(el);

    const group = el.querySelector('[data-testid="detail-pane-pref"]');
    expect(group, '设置里没有详情面那一组').not.toBeNull();
    const radios = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"][name="detail-pane-pref"]')];
    expect(radios, '常驻/收起两个档都要在').toHaveLength(2);
    // 正对照：当前选中的一定是"收起"那一只，否则"点常驻"可能点的就是它自己。
    expect(radios.find((r) => r.checked)?.nextElementSibling?.textContent).toBe('收起');

    const openRadio = radios[0]!;
    await act(async () => {
      openRadio.click();
    });
    expect(detailAttrOf(el)).toBe('open');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('"open"');
  });

  it('反方向也走一次：从 open 选「收起」⇒ collapsed', async () => {
    const el = await mountApp();
    await openSettingsViaAvatar(el);
    const radios = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"][name="detail-pane-pref"]')];
    expect(radios).toHaveLength(2);
    await act(async () => {
      radios[1]!.click();
    });
    expect(detailAttrOf(el)).toBe('collapsed');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('"collapsed"');
  });

  it('🔴 说明句与当前显示策略一致，并给出页头恢复入口', async () => {
    const el = await mountApp();
    await openSettingsViaAvatar(el);
    const note = el
      .querySelector('[data-testid="detail-pane-pref"]')!
      .previousElementSibling!
      .querySelector('.ht-settings__hint')!
      .textContent!
      .trim();
    expect(note).toBe(translate('zh-CN', 'web.settings.display.detailNote'));
    expect(note).toContain('窄窗');
    expect(note, '说明里必须给出恢复路径，否则用户收起后找不到回来的门').toContain('页头');
  });
});

describe('D. 快捷键 ⌘/Ctrl + Shift + \\（恢复路径③）', () => {
  /** 真发一个 KeyboardEvent，而不是去调组件里的某个函数 —— 挂捕获阶段这件事也要被量到。 */
  async function pressCombo(key = '\\', withMeta = true): Promise<void> {
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          code: 'Backslash',
          shiftKey: true,
          metaKey: withMeta,
          ctrlKey: !withMeta,
          bubbles: true,
        }),
      );
    });
  }

  it('按下 ⇒ open↔collapsed 翻转并落盘', async () => {
    const el = await mountApp();
    expect(detailAttrOf(el)).toBe('open');
    await pressCombo();
    expect(detailAttrOf(el)).toBe('collapsed');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('"collapsed"');
    await pressCombo();
    expect(detailAttrOf(el)).toBe('open');
  });

  it('🔴 从"收起"状态按一次就回来（这一条是工单 ② 里"快捷键那条路径"的读数）', async () => {
    localStorage.setItem(STORAGE_KEY, '"collapsed"');
    const el = await mountApp();
    expect(detailAttrOf(el)).toBe('collapsed');
    await pressCombo();
    expect(detailAttrOf(el)).toBe('open');
  });

  it('负向对照：缺 Shift / 缺 Cmd 或 Ctrl / 换了别的键，一律不许动', async () => {
    const el = await mountApp();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', metaKey: true, shiftKey: false }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', shiftKey: true }));
      window.dispatchEvent(
        // ⚠️ 用 `x` 而不是 `k`：`k` 会被上面那条 ⌘K 搜索绑定接走（它不检查 Shift），
        //    那条用例的界面上会真的开出搜索浮层 —— 与本条要量的东西无关，
        //    混进来只会让失败时看不出是哪一个坏了。
        new KeyboardEvent('keydown', { key: 'x', metaKey: true, shiftKey: true, ctrlKey: true }),
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '\\', shiftKey: true, altKey: true, metaKey: true }),
      );
    });
    expect(detailAttrOf(el)).toBe('open');
    expect(localStorage.getItem(STORAGE_KEY), '误触也不该写盘').toBeNull();
  });
});

describe('E. 存储与实现只有一份', () => {
  it('🔴 全仓只有 pref 模块碰这个 key（第二处 = 第二份事实源）', () => {
    const owners: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        // ⚠️ 软链要看 statSync(entry) 而不是 full：本检出的 node_modules 是指向主检出的软链，
        //    按 full 判断会把它当目录走进别人的树。
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-types') continue;
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/u.test(entry.name)) continue;
        const text = readFileSync(full, 'utf8');
        if (text.includes(STORAGE_KEY)) owners.push(full);
      }
    };
    walk(resolve(process.cwd(), 'src'));
    expect(owners.map((p) => p.split('/src/')[1]!)).toEqual(['features/shell/detail-pane-pref.ts']);
  });

  it('宿主必须走 pref 模块而不是自己读存储（源码级：App.tsx 里不许出现 localStorage）', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(src).toMatch(/from '\.\/features\/shell\/detail-pane-pref\.js'/u);
    expect(src).not.toMatch(/localStorage\.(getItem|setItem)\(\s*['"]heyta\.detailPane/u);
  });
});
