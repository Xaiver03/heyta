/**
 * 入群这一侧的 PIPL 同意闸：**代码在，这里给它牙齿**
 * =================================================
 *
 * ## 这一格为什么值得单独钉
 *
 * `JoinSharedListDialog` 的初始相位由 `shouldShowConsent(loadShareConsent(localStorage))`
 * 决定（ADR-0071 裁决三：入群侧也要过闸，因为**通知路径读的就是这份本地记录** ——
 * 一台只走过「贴链接入群」的浏览器若没有同意记录，按 fail-closed 的口径它一条共享活动都收不到）。
 *
 * 既有判据各管一段，中间这一段是空的：
 *   · `packages/ui/tests/share-consent-model.spec.ts` 钉**模型**（四种记录的该不该弹），
 *     它不认识任何界面；
 *   · `e2e/tests/collab-journey.spec.ts:292` 钉**这一次旅程**：全新浏览器 ⇒ 弹 ⇒ 点确认 ⇒ 落盘。
 *     它只走"没记录"那一档，所以两种真坏法都是绿的：
 *       ① 把初始相位写死成 `consent`（永远拦路）——旅程照过；
 *       ② 把「取消」也写成同意（fail-open）——旅程只点确认，看不见。
 *
 * ## 五判据各挡一种坏法
 *
 * | 判据 | 坏法 |
 * |---|---|
 * | 没记录 ⇒ 同意面在场、凭证表单不在 | 闸被摘掉，或同意面画在旁边而表单已经能提交 |
 * | 确认+勾「不再提示」⇒ 记录落盘，**重挂直接进表单** | ①（永远拦路）与"点了同意没落盘" |
 * | 确认但没勾 ⇒ 重挂仍然弹 | "只要有任何记录就不弹"那种放松 |
 * | 🔴 取消 ⇒ 关闭，且重挂仍然弹 | ②（取消被当成同意 = fail-open） |
 * | 那枚键只由 `share-consent-store.ts` 一处读写 | 又一个读者各自 `JSON.parse` 自己的口径 ⇒ 磁盘上没有真相 |
 *
 * ⚠️ 键名在这里是**逐字硬写**的（不 import 常量）：判据要钉的就是"入群写的与通知读的是同一枚键"，
 *    跟着常量走的话换键名也永远绿。真源见 `share-consent-store.ts` 文件头。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HeytaUiProvider } from '@heyta/ui';

import { JoinSharedListDialog } from '../src/features/share/JoinSharedListDialog.js';
import { useSyncStore } from '../src/features/sync/store.js';

const CONSENT_KEY = 'heyta.share-consent.v1';
const MODAL = '[data-testid="share-consent-modal"]';
const FORM = '[data-testid="share-join-form"]';
const DONT_ASK = '[data-testid="share-consent-dont-ask"]';
const ACCEPT = '[data-testid="share-consent-accept"]';
const CANCEL = '[data-testid="share-consent-cancel"]';

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let closed = 0;

const mount = async () => {
  await act(async () => {
    root = createRoot(container!);
    // 🔴 共享组件用 `useHeytaUiTheme`，而它**必须在 Provider 里**（缺失时抛的是一句
    //    断言而不是白屏 —— 那正是这条判据现在读到的那条红）。
    root.render(
      <HeytaUiProvider>
        <JoinSharedListDialog onClose={() => { closed += 1; }} />
      </HeytaUiProvider>,
    );
  });
};

/** 重新挂载 = 换一次会话进来（相位由 localStorage 那份记录重新算）。 */
const remount = async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
  await mount();
};

const press = (selector: string) => {
  const node = document.body.querySelector<HTMLElement>(selector);
  if (node === null) throw new Error(`DOM 里没有 ${selector}`);
  act(() => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const readConsent = (): Record<string, unknown> =>
  JSON.parse(localStorage.getItem(CONSENT_KEY) ?? '{}') as Record<string, unknown>;

beforeEach(() => {
  localStorage.clear();
  closed = 0;
  container = document.createElement('div');
  document.body.append(container);
  useSyncStore.setState({
    baseUrl: 'http://sync.test',
    token: 'tok-test',
    accountId: 'acct-test',
    authTransport: 'bearer',
  });
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = undefined;
  container?.remove();
  container = undefined;
});

describe('入群同意闸：初始相位由本机那份记录决定', () => {
  it('🔴 没有任何记录 ⇒ 先弹同意面，且此刻凭证表单根本不在（不是一条并排的提示）', async () => {
    await mount();
    expect(document.body.querySelector(MODAL), '没记录却没弹闸 = 没问过就共享').not.toBeNull();
    expect(document.body.querySelector(FORM), '同意面在场时表单已经能提交 = 闸形同虚设').toBeNull();
  });

  it('🔴 确认 + 勾「不再提示」⇒ 落盘，且下一次进来直接到表单', async () => {
    await mount();
    press(DONT_ASK);
    press(ACCEPT);
    const stored = readConsent();
    expect(typeof stored.consentAcceptedAt, '只勾了「不再提示」却没写确认时刻').toBe('number');
    expect(stored.dontAskAgain).toBe(true);
    await remount();
    expect(document.body.querySelector(MODAL), '已经说过"不再提示"还拦着 = 同意面变成长期路障').toBeNull();
    expect(document.body.querySelector(FORM), '跳过同意面却没画出表单 = 入群这条路断了').not.toBeNull();
  });

  it('确认但**没勾**「不再提示」⇒ 下一次仍然弹（复选框的价值所在）', async () => {
    await mount();
    press(ACCEPT);
    const stored = readConsent();
    expect(typeof stored.consentAcceptedAt).toBe('number');
    expect(stored.dontAskAgain, '没勾却替用户写上了 dontAskAgain').not.toBe(true);
    await remount();
    expect(document.body.querySelector(MODAL), '有记录就不弹 ⇒ 单独同意被降成了一次性提示').not.toBeNull();
  });

  it('🔴 取消不是同意：关闭宿主，且下一次仍然弹', async () => {
    await mount();
    press(CANCEL);
    expect(closed, '按取消没走宿主的关闭').toBe(1);
    expect(readConsent().consentAcceptedAt, '取消却留下了确认时刻 = fail-open').toBeUndefined();
    await remount();
    expect(document.body.querySelector(MODAL), '取消过一次之后闸就不弹了 = 把拒绝读成了同意').not.toBeNull();
  });
});

/**
 * 那枚键**只许有一处读写**。
 *
 * 读的是源码而不是运行时：这条要防的是"又有人在自己那一屏里 `JSON.parse` 一份自己的口径"——
 * 那种改动每一屏单看都是绿的，而磁盘上从此没有真相（通知路径读的记录与界面写的记录分家，
 * 正是 ADR-0071 之前那台"只入群、永不响"的浏览器的成因）。
 */
describe('常驻形状：同意态只由 share-consent-store.ts 一处读写', () => {
  it('apps/web/src 里出现那枚键字面量的文件只有 share-consent-store.ts', () => {
    const srcDir = join(__dirname, '..', 'src');
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { walk(path); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (readFileSync(path, 'utf8').includes(CONSENT_KEY)) hits.push(path.replace(`${srcDir}/`, ''));
      }
    };
    walk(srcDir);
    expect(hits.sort()).toEqual(['features/share/share-consent-store.ts']);
  });
});
