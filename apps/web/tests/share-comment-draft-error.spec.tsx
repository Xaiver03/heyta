/**
 * 评论草稿的报错只在"用户刚按过发送"之后说话（2026-10-26 补的一格）
 * ==================================================================
 *
 * ## 这一格是怎么发现的
 *
 * `pnpm verify:mobile-collab:ios` 第 31 跑的 `14-信号驱动到的评论.png`：手机自己那条评论
 * **已经发出去了**（列表里画着它），而输入框下面同时挂着「评论内容不能为空」。
 * 成因在组件本身：报错是从 `validateCommentDraft(draft)` **派生**出来的，而发送成功的那一拍
 * 组件把草稿清空 —— 空草稿按定义就是非法的，于是回执与报错同屏，用户读到的是"没发出去"。
 * 同一形状的第二条来路：别人的评论同步进来、这一节重画时，那框本来就是空的。
 *
 * 既有判据一条都不会红：模型层用例判的是 `validateCommentDraft` 的**返回值**（那是对的），
 * 装置那侧判的是"评论出现在界面上"（也是真的）。**渲染树里谁该说话**这一层此前没人守
 * （`apps/web/src/features/share/ShareCommentsSection.tsx:7` 自己写着"全仓在此之前 0 处渲染它"）。
 *
 * ## 判什么
 *
 * | 判据 | 坏法 |
 * |---|---|
 * | 空框且没按过发送 ⇒ 那一行报错不画 | 把渲染条件改回 `draftError !== undefined`（＝截图那一版） |
 * | 按了发送而草稿是空的 ⇒ 报错**要**画，且宿主一次都没被调用 | 为了消掉截图那一形而把"发送时空草稿"这道嘴也一起删（那是另一头的谎） |
 * | 发送成功 ⇒ 草稿清空、报错不在、宿主收到 trim 过的正文 | 成功后不清 `emptyComplained`：上一次的空报误会一直挂着 |
 * | 非空而超限 ⇒ **实时**说话（对照臂：这条判据不是"任何报错都不许出现"） | 把整块报错删掉，超限也没人说了 |
 * | 按过一次之后再输入合法正文 ⇒ 报错让位 | 说过一次就赖着不走 |
 * | 两壳真渲染同一份组件 | 只修 web、移动那侧留一份自己的实现 |
 *
 * 渲染走 react-native-web + `HeytaUiProvider`（与 `./share-notif-prefs-affordance.spec.tsx`
 * 同一套台架）；输入必须走**原生 setter**（直接改 `.value` 会被 React 的 value 追踪器当成"没变"，
 * 症状是"组件没收到"，看着像组件坏了 —— 理由逐字写在该文件 104-113 行）。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { COMMENT_MAX_LENGTH } from '@heyta/domain';
import { translate, type MessageKey } from '@heyta/i18n';
import {
  CommentThread,
  HeytaUiProvider,
  resolveHeytaUiTheme,
  type CommentThreadLabels,
  type CommentThreadProps,
} from '@heyta/ui';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../../..');

const LIGHT = resolveHeytaUiTheme({ scheme: 'light' });
const t = (key: string, vars?: Record<string, string | number>) =>
  translate('zh-CN', key as MessageKey, vars as never);

const LABELS: CommentThreadLabels = {
  emptyThread: t('common.share.comment.emptyThread'),
  fallbackAuthor: (id: string) => t('common.share.comment.fallbackAuthor', { id }),
  composerPlaceholder: t('common.share.comment.composerPlaceholder'),
  sendButton: t('common.share.comment.send'),
  errorEmpty: t('common.share.comment.empty'),
  errorTooLong: t('common.share.comment.tooLong', { max: COMMENT_MAX_LENGTH }),
};

const TASK_ID = 't-1';

const comment = (id: string, authorUserId: string, body: string): CommentThreadProps['comments'][number] => ({
  id,
  taskId: TASK_ID,
  authorUserId,
  body,
  createdAt: 1_700_000_000_000,
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;
/** 宿主收到的正文（一次一发，用来判"这次到底有没有真发出去"）。 */
let submitted: string[] = [];
/** 宿主可控的成败：失败那一档留给下一条用例，别在这里演没发生的事。 */
let submitBehaviour: (body: string) => Promise<void> = async () => undefined;

function mount(comments: CommentThreadProps['comments'] = []): HTMLElement {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  container?.remove();
  container = document.createElement('div');
  document.body.append(container);
  act(() => {
    root = createRoot(container!);
    root.render(
      <HeytaUiProvider value={LIGHT}>
        <CommentThread
          taskId={TASK_ID}
          comments={comments}
          labels={LABELS}
          onSubmit={async (body) => {
            submitted.push(body);
            await submitBehaviour(body);
          }}
        />
      </HeytaUiProvider>,
    );
  });
  return container as HTMLDivElement;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  container?.remove();
  submitted = [];
  submitBehaviour = async () => undefined;
});

const byTestId = (el: ParentNode, id: string): Element | null =>
  el.querySelector(`[data-testid="${id}"]`);

const composerOf = (el: ParentNode): HTMLTextAreaElement => {
  const node = byTestId(el, 'comment-composer-input');
  if (node === null) throw new Error('DOM 里没有评论输入框（组件没渲染出来）');
  return node as HTMLTextAreaElement;
};

/** 🔴 原生 setter：直接 `textarea.value = …` 再派发 `input`，React 会认为"值没变"。 */
const typeInto = (el: ParentNode, next: string): void => {
  const textarea = composerOf(el);
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('拿不到 textarea 的原生 value setter');
  act(() => {
    setter.call(textarea, next);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const pressSend = (el: ParentNode): void => {
  const node = byTestId(el, 'comment-send');
  if (node === null) throw new Error('DOM 里没有「发送」');
  act(() => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

/** 异步 `onSubmit` 走完一拍（成功相位要等 `setDraft('')` 落回树上）。 */
const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('评论草稿的报错什么时候说话', () => {
  it('空框且没按过发送 ⇒ 不画「评论内容不能为空」（第 31 跑那张图照出的那一形）', () => {
    const el = mount([comment('c-1', '86', 'owner 写的那条')]);
    expect(byTestId(el, 'comment-draft-error'), '一进来就没发过任何东西，却已经在报错').toBeNull();
    // 对照臂：线程真渲染了（否则"没有报错"只是因为整块没画）。
    expect(byTestId(el, 'comment-c-1'), '评论本身没渲染 ⇒ 这棵树不是我要看的那棵树').not.toBeNull();
    expect(el.textContent).toContain('owner 写的那条');
  });

  it('按了发送而草稿是空的 ⇒ 报错要出现，且宿主一次都没被调用', () => {
    const el = mount();
    pressSend(el);
    const err = byTestId(el, 'comment-draft-error');
    expect(err, '用户按了发送而界面一声不出 ⇒ 那一下石沉大海').not.toBeNull();
    expect(err?.textContent).toContain(LABELS.errorEmpty);
    expect(submitted, '空草稿被发出去了 ⇒ 领域校验没守住').toEqual([]);
  });

  it('发送成功 ⇒ 草稿清空、报错不在、宿主收到 trim 过的正文（同一棵树上的三格）', async () => {
    const el = mount();
    typeInto(el, '  手机这条要发出去  ');
    pressSend(el);
    await settle();
    expect(submitted, '宿主没收到正文').toEqual(['手机这条要发出去']);
    expect(composerOf(el).value, '发送成功后草稿没清空').toBe('');
    expect(byTestId(el, 'comment-draft-error'), '发出去了还挂着「评论内容不能为空」＝向用户谎称失败').toBeNull();
  });

  it('按过一次空发送、再输入合法正文 ⇒ 报错让位（说过一次不许赖着）', async () => {
    const el = mount();
    pressSend(el);
    expect(byTestId(el, 'comment-draft-error')).not.toBeNull();
    typeInto(el, '现在是有内容的');
    expect(byTestId(el, 'comment-draft-error'), '草稿已经不空了，那句空报错还占着这一行').toBeNull();
    pressSend(el);
    await settle();
    expect(submitted).toEqual(['现在是有内容的']);
  });

  it('对照臂：非空而超限 ⇒ 实时说话（这条判据不是"任何报错都不许出现"）', () => {
    const el = mount();
    typeInto(el, 'x'.repeat(COMMENT_MAX_LENGTH + 1));
    const err = byTestId(el, 'comment-draft-error');
    expect(err, '超限实时那一半被删掉了').not.toBeNull();
    expect(err?.textContent).toContain(LABELS.errorTooLong);
  });

  it('两壳真渲染同一份组件（修在共享层不等于只修了一端）', () => {
    const web = readFileSync(join(REPO, 'apps/web/src/features/share/ShareCommentsSection.tsx'), 'utf8');
    const mobile = readFileSync(join(REPO, 'apps/mobile/src/screens/ShareSpaceScreen.tsx'), 'utf8');
    for (const [shell, src] of [
      ['apps/web', web],
      ['apps/mobile', mobile],
    ] as const) {
      expect(src.includes('<CommentThread'), `${shell} 没有真渲染 @heyta/ui 的 CommentThread`).toBe(true);
    }
  });
});
