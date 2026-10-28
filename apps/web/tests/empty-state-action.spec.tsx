/**
 * 空态动作槽的真实渲染判据（全局 UX 线 P7）
 * ======================================
 *
 * `packages/ui` 那侧的模型测（`empty-state-model.spec.ts`）只能证"值传过去了"，
 * 证不到**画出来的是什么**。而 P7 这一格的判据恰好是两句关于"控件"的话：
 *
 *   · 给了动作 ⇒ 空态里必须真的有一枚**可点的控件**（不是一段长得像按钮的字）；
 *   · 没给动作 ⇒ 空态里**一枚可点控件都不许有**。
 *
 * 🔴 第二句是对照臂，也是这一格里更要紧的那半：
 * "纯无内容态不制造假动作"这条判据，如果只测第一句，那么有人给 `EmptyState`
 * 加一枚默认"刷新"按钮时**没有任何东西会红** —— 而那是本仓反复罚过的那类形状
 * （槽位自带一个没人要的控件）。所以这里断的是"不传 ⇒ `querySelectorAll` 读回 0"。
 *
 * 为什么落在 `apps/web` 而不是 `packages/ui`：那边跑 node，加载不了 RN 的渲染树
 * （`vitest.config.ts` 文件头记了理由）；组件在 Web 宿主里是 react-native-web 渲染成
 * 真 DOM 的那一枚，所以"是不是真控件"只有在这里量得到。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { EmptyState, HeytaUiProvider } from '@heyta/ui';

let container: HTMLDivElement | undefined;
let root: Root | undefined;

const render = async (node: React.ReactElement): Promise<HTMLDivElement> => {
  const host = document.createElement('div');
  document.body.append(host);
  container = host;
  root = createRoot(host);
  await act(async () => {
    root?.render(node);
  });
  return host;
};

afterEach(async () => {
  if (root !== undefined) await act(async () => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

describe('EmptyState 的动作槽', () => {
  it('给了动作 ⇒ 空态里有一枚真 `<button>`，带着宿主给的可访问名，且点得动', async () => {
    let clicks = 0;
    const host = await render(
      <HeytaUiProvider>
        <EmptyState
          title="还没有习惯"
          hint="添加一个习惯，从今天开始记录。"
          testID="habits-empty"
          action={
            <button type="button" data-testid="habits-empty-add" onClick={() => { clicks += 1; }}>
              添加习惯
            </button>
          }
        />
      </HeytaUiProvider>,
    );
    const buttons = Array.from(host.querySelectorAll('button'));
    expect(buttons, '动作槽没画成真控件 ⇒ 它只是一段字').toHaveLength(1);
    expect(buttons[0]?.textContent).toBe('添加习惯');
    await act(async () => {
      buttons[0]?.click();
    });
    expect(clicks, '画出来了但点不动（被别的层接走了事件）').toBe(1);
  });

  it('🔴 对照臂：没给动作 ⇒ 空态里零枚可点控件（不许自带一枚"刷新"之类的假动作）', async () => {
    const host = await render(
      <HeytaUiProvider>
        <EmptyState title="还没有习惯" hint="添加一个习惯，从今天开始记录。" testID="habits-empty" />
      </HeytaUiProvider>,
    );
    expect(host.querySelectorAll('button, a[href], [role="button"]').length).toBe(0);
    // 句子仍然要在：这一格去掉的是**控件**，不是"下一步"这句话本身。
    expect(host.textContent).toContain('还没有习惯');
    expect(host.textContent).toContain('添加一个习惯，从今天开始记录。');
  });

  it('动作排在标题与 hint **之后**（先说清"为什么是空的"，再给出口）', async () => {
    const host = await render(
      <HeytaUiProvider>
        <EmptyState
          title="还没有习惯"
          hint="添加一个习惯，从今天开始记录。"
          action={<button type="button">添加习惯</button>}
        />
      </HeytaUiProvider>,
    );
    const text = host.textContent ?? '';
    expect(text.indexOf('还没有习惯')).toBeLessThan(text.indexOf('添加一个习惯'));
    expect(text.indexOf('添加一个习惯')).toBeLessThan(text.lastIndexOf('添加习惯'));
  });
});
