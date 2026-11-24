/**
 * 入群这一侧的 PIPL 同意闸：**代码在，这里给它牙齿**
 * =================================================
 *
 * ## 位置（2026-11-24 挪过）
 *
 * `JoinSharedListDialog` 开场给的是**凭证表单**，同意闸挪到点「加入」那一下：
 * `submit` 里先校凭证（空的不该先弹），再 `shouldShowConsent(consentStore).show`，
 * 需要就停到同意面，答应了才 `doAccept`（`acceptInvitation`）。ADR-0071 裁决三不变 ——
 * 入群侧也要过闸，因为**通知路径读的就是这份本地记录**：一台只走过「贴链接入群」的浏览器
 * 若没有同意记录，按 fail-closed 的口径它一条共享活动都收不到。
 *
 * 🔴 为什么当时非挪不可：旧形状把同意面当第一屏，用户还没贴凭证、表单还没出场就先撞上一句
 * "加入后你能看到这份清单里的内容"，而共享清单在服务端**没有名字**（名字由加入者自己起，
 * `web.share.join.nameLabel`＝「清单名称（仅本机显示）」）⇒ 那一屏在数据上就说不出"是哪个清单"，
 * 真实用户看到的是"莫名其妙的加入清单"。现在先走完旅程、填好本机名，同意面才带名字出现。
 *
 * 既有判据各管一段，中间这一段是空的：
 *   · `packages/ui/tests/share-consent-model.spec.ts` 钉**模型**（四种记录的该不该弹），
 *     它不认识任何界面；
 *   · `e2e/tests/collab-journey.spec.ts` 钉**这一次旅程**：全新浏览器 ⇒ 填凭证 ⇒ 点加入 ⇒
 *     弹⇒点确认⇒落盘。它只走"没记录"那一档，所以两种真坏法都是绿的：
 *       ① 把同意面写死成永远弹（拦路）——旅程照过；
 *       ② 把「取消」也写成同意（fail-open）——旅程只点确认，看不见。
 *
 * ## 五判据各挡一种坏法
 *
 * | 判据 | 坏法 |
 * |---|---|
 * | 刚打开 ⇒ 凭证表单在场、同意面不在 | 又回到"开场弹同意面"（无上下文的拦路） |
 * | 填凭证点「加入」⇒ 弹同意面，且正文带清单名 | 闸被摘掉／同意面说不出"加的是哪一份" |
 * | 确认+勾「不再提示」⇒ 记录落盘，**重开提交不再弹** | "点了同意没落盘"，或"说过不再提示还弹" |
 * | 确认但没勾 ⇒ 下次提交仍然弹 | "只要有任何记录就不弹"那种放松 |
 * | 🔴 取消 ⇒ 回到表单（不关窗）、不落盘、再点仍弹 | ②（取消被当成同意 = fail-open） |
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
const TOKEN = '[data-testid="share-join-token"]';
const NAME = '[data-testid="share-join-name"]';

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

/** 往受控 `<input>` 里写字（React 监听 `input`；直接改 `value` 不会触发 onChange）。 */
const setValue = (selector: string, value: string) => {
  const el = document.body.querySelector<HTMLInputElement>(selector);
  if (el === null) throw new Error(`DOM 里没有 ${selector}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

/** 提交表单 = 点「加入」那一下（React 的 onSubmit 挂在 form 上）。 */
const submitForm = () => {
  const form = document.body.querySelector<HTMLFormElement>(FORM);
  if (form === null) throw new Error('DOM 里没有入群表单');
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
};

const readConsent = (): Record<string, unknown> =>
  JSON.parse(localStorage.getItem(CONSENT_KEY) ?? '{}') as Record<string, unknown>;

beforeEach(() => {
  localStorage.clear();
  closed = 0;
  container = document.createElement('div');
  document.body.append(container);
  // 🔴 baseUrl 留空 ⇒ `api` 为 undefined ⇒ 同意之后的 `doAccept` 在"未配服务端"那一步就收口，
  //    不打网络。这一份判据只钉「同意闸接在哪、录了什么」，不跑真接口（那是 e2e 的活）。
  useSyncStore.setState({
    baseUrl: '',
    token: undefined,
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

describe('入群同意闸：开场给表单，点「加入」才过闸', () => {
  it('🔴 刚打开：凭证表单在场、同意面不在（旅程先可见，闸不拦在开场）', async () => {
    await mount();
    expect(document.body.querySelector(FORM), '开场就该看到凭证表单（旅程先可见）').not.toBeNull();
    expect(document.body.querySelector(MODAL), '还没提交就弹同意面 = 又回到"对着没有上下文的同意面发懵"').toBeNull();
  });

  it('🔴 填好凭证点「加入」⇒ 先弹同意面，且正文写出你要加入的清单名', async () => {
    await mount();
    setValue(TOKEN, 'tok-abc-123');
    setValue(NAME, '家庭装修（合伙）');
    submitForm();
    const modal = document.body.querySelector(MODAL);
    expect(modal, '点了「加入」却没弹同意闸 = 没问过就共享').not.toBeNull();
    expect(document.body.querySelector(FORM), '同意面在场时表单仍然能提交 = 闸形同虚设').toBeNull();
    expect(modal?.textContent ?? '', '同意面没说出"加的是哪一份" —— 用户不知道自己在加哪个清单').toContain(
      '家庭装修（合伙）',
    );
  });

  it('🔴 确认 + 勾「不再提示」⇒ 落盘 {consentAcceptedAt, dontAskAgain:true}，重开提交不再弹', async () => {
    await mount();
    setValue(TOKEN, 'tok-abc-123');
    submitForm();
    press(DONT_ASK);
    press(ACCEPT);
    const stored = readConsent();
    expect(typeof stored.consentAcceptedAt, '只勾了「不再提示」却没写确认时刻').toBe('number');
    expect(stored.dontAskAgain).toBe(true);
    await remount();
    expect(document.body.querySelector(FORM), '重开后应直接回凭证表单').not.toBeNull();
    expect(document.body.querySelector(MODAL), '重开就弹 = 同意面变成长期路障').toBeNull();
    setValue(TOKEN, 'tok-abc-123');
    submitForm();
    expect(document.body.querySelector(MODAL), '已经说过"不再提示"还弹 = 复选框是装饰').toBeNull();
  });

  it('确认但**没勾**「不再提示」⇒ 下次提交仍然弹（复选框的价值所在）', async () => {
    await mount();
    setValue(TOKEN, 'tok-abc-123');
    submitForm();
    press(ACCEPT);
    const stored = readConsent();
    expect(typeof stored.consentAcceptedAt).toBe('number');
    expect(stored.dontAskAgain, '没勾却替用户写上了 dontAskAgain').not.toBe(true);
    await remount();
    setValue(TOKEN, 'tok-abc-123');
    submitForm();
    expect(document.body.querySelector(MODAL), '有记录就不弹 ⇒ 单独同意被降成了一次性提示').not.toBeNull();
  });

  it('🔴 取消不是同意：回到表单（不关窗）、不落盘、再点仍然弹', async () => {
    await mount();
    setValue(TOKEN, 'tok-abc-123');
    submitForm();
    press(CANCEL);
    expect(closed, '取消同意不该把整只对话框关掉').toBe(0);
    expect(readConsent().consentAcceptedAt, '取消却留下了确认时刻 = fail-open').toBeUndefined();
    expect(document.body.querySelector(MODAL), '按了取消，同意面还在').toBeNull();
    expect(document.body.querySelector(FORM), '取消后应回到填好的表单（token 不丢）').not.toBeNull();
    submitForm();
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
