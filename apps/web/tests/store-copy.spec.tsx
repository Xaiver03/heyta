/**
 * 「store 只带数据，句子在壳里拼」
 * ==================================
 *
 * 🔴 这个文件存在的理由：**状态与措辞混在一处，英文界面会永远漏出中文。**
 *
 * 两个 store 原先各自把中文句子塞进 state：
 *   - `features/sync/store.ts`：`{ kind: 'error', message: '未配置同步服务' }`
 *   - `features/focus/store.ts`：`` error: `专注记录保存失败：${...}` ``
 *
 * 句子由组件直接渲染，于是无论界面语言是什么，用户看到的都是那句中文。
 * 现在 state 只带**数据**：
 *   - sync 的失败 → `{ reason }`（`SyncFailureReason`，结构化；"没配置"只是其中一种）；
 *   - focus 的落盘失败 → `{ reason }`（底层实现的原始文本）。
 *
 * ⚠️ sync 这一条在第 13 轮**又收紧了一次**：原来"没配置"是塞在 `message` 里的一个
 * 哨兵字符串（`SYNC_NOT_CONFIGURED`）—— 那只是"类型里没有结构化原因"的绕路，
 * 而且 `message` 是 `string` 字段，拿它当码用没有任何类型保护。
 * 现在 `SyncStatus` 有了必需的 `reason`，哨兵整个删掉。
 *
 * 这个文件同时钉住两端：
 *   1. store 里**不是句子**（`reason` 都不含汉字）；
 *   2. 壳里**真的把它翻出来了**（en 渲染出英文、且一个汉字都不漏）。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { I18nProvider, type Locale } from '@heyta/i18n';

import { FocusTimer } from '../src/features/focus/FocusTimer.js';
import { useFocusStore } from '../src/features/focus/store.js';
import { SyncBar } from '../src/features/sync/SyncBar.js';
import { useSyncStore } from '../src/features/sync/store.js';

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF]/;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(node: React.ReactNode, locale: Locale): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<I18nProvider locale={locale}>{node}</I18nProvider>);
  });
  return container;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  useSyncStore.setState({
    status: { kind: 'idle' },
    conflictDialogOpen: false,
    baseUrl: '',
    token: undefined,
    password: undefined,
  });
  useFocusStore.setState({ error: undefined });
});

describe('sync store 只带数据', () => {
  it('🔴 未配置同步服务时，state 里是错误码，不是句子', async () => {
    useSyncStore.setState({ baseUrl: '', token: undefined, password: undefined });
    const status = await useSyncStore.getState().syncNow();

    expect(status).toEqual({ kind: 'error', reason: 'not-configured', retryable: false });
    // 整个 state **一个汉字都不许有** —— 一旦有人把句子写回 store，这条会红。
    expect(JSON.stringify(status)).not.toMatch(CJK);
    // 而且原因必须是结构化的，不是"随便一个字符串"。
    expect(status).toHaveProperty('reason', 'not-configured');
  });

  it('🔴 英文界面把「没配置」翻成英文，一个汉字都不漏', () => {
    useSyncStore.setState({
      status: { kind: 'error', reason: 'not-configured', retryable: false },
    });
    const el = render(<SyncBar />, 'en');
    expect(el.textContent).toContain('Sync is not configured yet');
    expect(el.textContent).not.toMatch(CJK);
  });

  it('🔴 每一种已知失败原因都翻成英文，且与中文**不同**（跨包中文不许漏进来）', () => {
    // 🔴 这一条钉的是"门禁扫不到的通道"：`status.message` 是
    // `packages/sync-client` 里的中文，壳原来把它整句插进英文句子里，
    // 于是英文界面出现 `Sync error: 未设置端到端加密口令…`（中英混排）。
    // 原因结构化之后，每种失败都必须有**自己的**英文句子。
    const reasons = [
      'not-configured',
      'not-signed-in',
      'no-encryption-password',
      'local-op-missing',
      'remote-version-unavailable',
    ] as const;

    const seenEn = new Set<string>();
    for (const reason of reasons) {
      useSyncStore.setState({ status: { kind: 'error', reason, retryable: false } });
      const zhText = render(<SyncBar />, 'zh-CN').textContent ?? '';
      const enText = render(<SyncBar />, 'en').textContent ?? '';

      expect(enText).not.toMatch(CJK);
      expect(enText).not.toBe(zhText);
      // 五种原因必须互相区分得开：全都一样就等于没结构
      expect(seenEn.has(enText)).toBe(false);
      seenEn.add(enText);
    }
  });

  it('其他错误把原始技术信息带进句子里（不吞也不编）', () => {
    useSyncStore.setState({
      status: { kind: 'error', reason: 'unexpected', message: 'boom', retryable: true },
    });
    const el = render(<SyncBar />, 'en');
    expect(el.textContent).toContain('Sync error: boom');
  });
});

describe('focus store 只带原因', () => {
  it('🔴 落盘失败：store 里是 `{ reason }`，句子在 FocusTimer 里拼（en）', () => {
    useFocusStore.setState({ error: { reason: 'boom' } });
    const el = render(<FocusTimer />, 'en');

    expect(el.textContent).toContain('Could not save the focus record: boom');
    expect(el.textContent).not.toMatch(CJK);
  });

  it('中文界面拿到同一份数据，拼出中文句子', () => {
    useFocusStore.setState({ error: { reason: 'boom' } });
    const el = render(<FocusTimer />, 'zh-CN');

    expect(el.textContent).toContain('专注记录保存失败：boom');
  });

  it('没有错误时不渲染错误行（reason 不会被当成 falsy 而漏掉空串检查）', () => {
    useFocusStore.setState({ error: undefined });
    const el = render(<FocusTimer />, 'zh-CN');
    expect(el.textContent).not.toContain('保存失败');
  });
});
