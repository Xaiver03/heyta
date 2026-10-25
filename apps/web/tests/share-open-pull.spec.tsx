/**
 * web 的「打开一份共享清单 ⇒ 拉一次既有下行」——**接线**判据
 * ==========================================================
 *
 * 判据本体（该不该拉、拉不到怎么办）在 `@heyta/app-host/tests/share-signals.spec.ts`。
 * 这里钉的是壳那一侧：这一枚有调用点、只由"停在哪个清单行"驱动、不会变成自循环。
 *
 * 🔴 为什么值得单独一枚：这一格洞（成员刚加入一份**早就写了东西**的清单 ⇒ 界面是空的）
 *    是 2026-10-25 在 iOS 设备腿 L2 抓出来的，而它**两壳同形** —— 源码级读数与
 *    app-host 那 14 枚单测当时全绿。装配存在但没有调用点，正是"第 10 项幻觉"的形状。
 *
 * mock 的只有**边**（那一份共享实例），判断本体 `pullSharedListOnOpen` 走真实代码。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../../..');

const rig = vi.hoisted(() => ({
  pulls: [] as string[],
  noSession: false,
  fail: false,
  added: 1,
}));

vi.mock('../src/features/share/share-session.js', () => ({
  ensureWebShareSession: async () => {
    if (rig.noSession) return undefined;
    return {
      channel: { dispatch: async () => undefined, stateFor: () => ({}) },
      pullShareOps: async (shareId: string) => {
        rig.pulls.push(shareId);
        if (rig.fail) throw new Error('share pull failed');
        return { fetched: rig.added, added: rig.added, cursor: 3, pages: 1 };
      },
      signatureRejections: () => [] as const,
    };
  },
}));

import { useShareOpenPull } from '../src/features/share/use-share-open-pull.js';

function Probe({ shareId }: { shareId: string | undefined }): null {
  useShareOpenPull(shareId);
  return null;
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

/** 把 `void (async …)()` 那一串 await 走完（不等它会假阴性）。 */
const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const render = async (shareId: string | undefined): Promise<void> => {
  await act(async () => {
    root?.render(<Probe shareId={shareId} />);
  });
  await settle();
};

beforeEach(() => {
  rig.pulls = [];
  rig.noSession = false;
  rig.fail = false;
  rig.added = 1;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
});

describe('打开一份共享清单 ⇒ 拉一次既有下行（web 接线）', () => {
  it('停在一份共享清单上 ⇒ 拉一次，且拉的是那一份', async () => {
    await render('s-7');
    expect(rig.pulls, '打开共享没接上下行出口 —— 加入之前就在清单里的东西永远看不见').toEqual(['s-7']);
  });

  it('🔴 反复重渲染（停在同一份）⇒ 仍然只拉一次（不许变成自循环）', async () => {
    await render('s-1');
    await render('s-1');
    await render('s-1');
    expect(rig.pulls, '拉到 ⇒ 状态动 ⇒ 再拉，这一枚一旦挂到会自己转起来').toEqual(['s-1']);
  });

  it('换到另一份共享 ⇒ 那一份也拉一次（每份各一条自己的下行）', async () => {
    await render('s-1');
    await render('s-2');
    expect(rig.pulls).toEqual(['s-1', 's-2']);
  });

  it('停在非共享的清单行 ⇒ 一条请求都不发', async () => {
    await render(undefined);
    expect(rig.pulls).toEqual([]);
  });

  it('这一刻建不出会话（未登录 / 保险库锁着）⇒ 零请求，且不把"这次没成"折成出错', async () => {
    rig.noSession = true;
    await render('s-1');
    expect(rig.pulls).toEqual([]);
  });

  it('🔴 拉不成不许抛穿渲染（未处理的 rejection 会让"没拉到"和"崩了"同形）', async () => {
    rig.fail = true;
    await expect(render('s-1')).resolves.toBeUndefined();
    expect(rig.pulls).toEqual(['s-1']);
  });

  it('🔴 调用点全壳唯一，且钩子只按 shareId 触发', () => {
    const srcRoot = join(REPO, 'apps/web/src');
    const walk = (dir: string, acc: string[]): string[] => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== 'node_modules') walk(full, acc);
        } else if (/\.tsx?$/.test(name)) acc.push(relative(REPO, full));
      }
      return acc;
    };
    const callSites = walk(srcRoot, [])
      .filter((file) => !file.endsWith('features/share/use-share-open-pull.ts'))
      .filter((file) => readFileSync(join(REPO, file), 'utf8').includes('useShareOpenPull('));
    expect(callSites, '判据装配了却没人调 = 空清单，app-host 那 14 枚照样全绿').toEqual(['apps/web/src/App.tsx']);

    const hook = readFileSync(join(REPO, 'apps/web/src/features/share/use-share-open-pull.ts'), 'utf8');
    const at = hook.indexOf('useEffect(');
    const depsAt = hook.indexOf('}, [', at);
    const deps = hook.slice(depsAt + 4, hook.indexOf(']', depsAt)).trim();
    expect(deps, '并进来的依赖只要有一枚随登录态/引用变，就会把"换一次凭据"变成"多拉一次"').toBe('shareId');
  });
});
