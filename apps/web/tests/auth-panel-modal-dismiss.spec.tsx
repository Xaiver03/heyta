/**
 * 认证面板的模态键盘出口（§8.2 第 6 条）
 * ======================================
 *
 * 登记的缺陷：`AuthPanel` 自报 `role="dialog" aria-modal="true"`，
 * 却**没有 Esc、焦点也不入内** —— 键盘用户在面板里按 Tab 会走进背后那层
 * "屏幕阅读器已经宣布不存在"的界面，而按 Esc 什么也不发生。
 *
 * 分成两组，因为它们各证一半：
 *
 * · **A 组打的是装置本身**（`useModalDismiss`）。这一组里有一条是**关键**的：
 *   中间节点把 keydown 的冒泡吞掉之后，面板还得能关。理由不是假设 ——
 *   `@heyta/ui` 的输入框是 react-native-web 的 `TextInput`，它在 keydown 里
 *   无条件 `stopPropagation()`（AGENTS §7 第 80 条，实测"keyup 能到 window、
 *   keydown 到不了"）。**所以监听必须挂捕获阶段**；挂冒泡的那一份写出来就像能用，
 *   实际永远收不到事件 —— 而那正是"界面按了没反应"的形状。
 * · **B 组打的是真接线**：挂完整 App、走真实入口（头像 → 菜单第一项），
 *   不自己拼一份接线（同 `signin-entry.spec.tsx` 文件头那条纪律）。
 *
 * 🔴 **jsdom 证不到的那一半写清楚**：这里用"手工挂一个吞冒泡的监听"来代表 RNW 的行为。
 * 真浏览器里 RNW 是否真的走到那一步，由 `e2e/auth-panel-esc.spec.ts` 用真键盘 Esc 验，
 * 不在这一份里冒充。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __resetAuthForTests,
} from '../src/features/auth/store.js';
import { __resetOpLogForTests, initOpLog } from '../src/lib/oplog.js';
import { privacyConsentActions } from '../src/features/privacy/consent-gate.js';
import { useSyncStore } from '../src/features/sync/store.js';
import { useTaskStore } from '../src/features/tasks/store.js';
import { emptyState } from '@heyta/op-log';
import { useRef } from 'react';
import { useModalDismiss } from '../src/lib/use-modal-dismiss.js';
import type { ReactNode } from 'react';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
import { LocaleHost } from '../src/lib/locale-host.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function mountApp(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleHost>
        <App />
      </LocaleHost>,
    );
  });
  return container;
}

function unmount(): void {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
}

beforeEach(async () => {
  __resetAuthForTests();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  __resetOpLogForTests();
  useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' } });
  await initOpLog(`auth-modal-${Math.random().toString(36).slice(2)}`);
  useSyncStore.setState({
    baseUrl: '',
    token: undefined,
    password: undefined,
    syncSettingsRequested: false,
    signInOpen: false,
  });
  privacyConsentActions.accept();
});

afterEach(unmount);

/* ══ A 组：装置本身 ══════════════════════════════════════════════════ */

function Fixture({
  onDismiss,
  swallowBubblingKeydown = false,
}: {
  onDismiss: () => void;
  swallowBubblingKeydown?: boolean;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalDismiss(dialogRef, onDismiss);
  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1} data-testid="fx-dialog">
      <input
        data-testid="fx-input"
        // 这一行代表 react-native-web 的 TextInput（§7 第 80 条）：
        // 它在 keydown 里无条件 stopPropagation()，冒泡阶段的监听因此收不到事件。
        onKeyDown={swallowBubblingKeydown ? (e) => e.stopPropagation() : undefined}
      />
    </div>
  );
}

async function mountFixture(node: ReactNode): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<LocaleHost>{node}</LocaleHost>);
  });
}

/**
 * `target` 是 `EventTarget` 而不是 `Element`：B 组那三条从 `window` 起事件 ——
 * `useModalDismiss` 把监听挂在 **window 的捕获阶段**（§7 第 80 条），
 * 而从面板元素起的那条路要留给 A 组那个"输入框吞掉冒泡"的夹具。
 */
function pressKey(target: EventTarget, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

describe('A：useModalDismiss 的键盘出口', () => {
  it('焦点落进输入框、且中间层吞掉冒泡时，Esc 仍然关掉这一层', async () => {
    let dismissed = 0;
    await mountFixture(
      <Fixture onDismiss={() => { dismissed += 1; }} swallowBubblingKeydown />,
    );

    const input = container!.querySelector('[data-testid="fx-input"]')!;
    act(() => { input.dispatchEvent(new FocusEvent('focus', { bubbles: true })); });
    pressKey(input, 'Escape');

    // 🔴 摘掉捕获（改成 `addEventListener('keydown', fn)`）这一条就会红 ——
    // 事件被中间层吞在冒泡阶段，窗口的冒泡监听永远等不到。
    expect(dismissed).toBe(1);
  });

  it('非 Escape 的键不做任何事（挡"任何 keydown 都关"）', async () => {
    let dismissed = 0;
    await mountFixture(<Fixture onDismiss={() => { dismissed += 1; }} />);
    pressKey(container!.querySelector('[data-testid="fx-dialog"]')!, 'a');
    pressKey(container!.querySelector('[data-testid="fx-dialog"]')!, 'Enter');
    expect(dismissed).toBe(0);
  });

  it('挂载时焦点进入面板，卸载时还给触发者', async () => {
    const trigger = document.createElement('button');
    trigger.setAttribute('data-testid', 'fx-trigger');
    document.body.appendChild(trigger);
    act(() => { trigger.focus(); });
    expect(document.activeElement).toBe(trigger);

    await mountFixture(<Fixture onDismiss={() => {}} />);
    const dialog = container!.querySelector('[data-testid="fx-dialog"]')!;
    // 面板自己拿到焦点 ⇒ 读屏用户的 Tab 从面板内部开始，而不是从背后那层开始。
    expect(dialog.contains(document.activeElement) || document.activeElement === dialog).toBe(true);

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('用的是最后一次传入的 dismiss，不是挂载那一刻那一份', async () => {
    const seen: string[] = [];
    let first = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const renderWith = (): void => {
      act(() => {
        root!.render(
          <LocaleHost>
            <Fixture onDismiss={() => { seen.push(first ? 'first' : 'second'); }} />
          </LocaleHost>,
        );
      });
    };
    renderWith();
    first = false;
    // 再渲染一次（面板里开了法务文书卡时就是这种情况：回调换了一份，监听没重挂）。
    renderWith();

    pressKey(container.querySelector('[data-testid="fx-dialog"]')!, 'Escape');
    expect(seen).toEqual(['second']);
  });
});

/* ══ B 组：真接线（挂完整 App，走真实入口）════════════════════════════ */

describe('B：认证面板在真入口下的模态行为', () => {
  async function openPanel(): Promise<HTMLDivElement> {
    const el = await mountApp();
    click(el.querySelector('[data-testid="account-menu-avatar"]')!);
    click(document.querySelector('[data-testid="sync-signin-entry"]')!);
    return el;
  }

  it('打开后面板在场，且焦点在面板内部', async () => {
    await openPanel();
    const dialog = document.querySelector('.ht-sheet__auth');
    expect(dialog, '点头像→「登录 / 注册」要真的把面板挂出来').not.toBeNull();
    expect(dialog!.contains(document.activeElement)).toBe(true);
  });

  it('🔴 一次 Esc 关掉面板（此前按了没反应）', async () => {
    await openPanel();
    expect(document.querySelector('.ht-sheet__auth')).not.toBeNull();

    pressKey(window, 'Escape');

    expect(document.querySelector('.ht-sheet__auth')).toBeNull();
  });

  it('关面板只是关面板：已保存的同步凭据一个字都不动', async () => {
    // 这一条钉的是同族的下一次事故（工单 W1 那一类：登录后保存会用空地址覆盖内存配置）：
    // 认证面板的卸载会 `invalidatePendingAuth()`，它**只该作废在途请求**，
    // 不该碰已经落进同步配置的那一份。
    await openPanel();
    useSyncStore.setState({ baseUrl: 'https://heyta.example.test', token: 'a-token' });
    pressKey(window, 'Escape');
    expect(document.querySelector('.ht-sheet__auth')).toBeNull();
    expect(useSyncStore.getState().baseUrl).toBe('https://heyta.example.test');
    expect(useSyncStore.getState().token).toBe('a-token');
  });

  it('Esc 只关面板，不会把底下的任务视图切走（阴性对照：filter 不变）', async () => {
    const before = useTaskStore.getState().filter;
    await openPanel();
    pressKey(window, 'Escape');
    expect(useTaskStore.getState().filter).toEqual(before);
  });
});
