import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';

import { PrivacyPanel } from '../src/features/settings/PrivacyPanel.js';
import {
  privacyConsent,
  privacyConsentActions,
} from '../src/features/privacy/consent-gate.js';
import { usePrivacyStore } from '../src/features/privacy/store.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  localStorage.clear();
  privacyConsentActions.revoke();
  usePrivacyStore.setState({ open: false, reason: 'first-launch', notPersisted: false });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
});

function render(active = true): void {
  act(() => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <PrivacyPanel active={active} />
      </I18nProvider>,
    );
  });
}

describe('设置 → 隐私同意', () => {
  it('撤回后立即显示未作出选择，并打开同一张同意面板的入口', () => {
    privacyConsentActions.accept();
    render();

    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-testid="privacy-revoke"]')?.click();
    });

    expect(container?.querySelector('[data-testid="privacy-state"]')?.textContent).toContain('还没有作出选择');
    expect(container?.querySelector('[data-testid="privacy-choose-again"]')).not.toBeNull();
    expect(privacyConsent.undecided()).toBe(true);
  });

  it('重新作出选择走同一个 consent sheet store，并标记为 revoked', () => {
    render();
    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-testid="privacy-choose-again"]')?.click();
    });

    expect(usePrivacyStore.getState().open).toBe(true);
    expect(usePrivacyStore.getState().reason).toBe('revoked');
  });

  it('撤回无法持久化时保留可见警告，不假装已经记住', () => {
    privacyConsentActions.accept();
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => undefined);
    render();

    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-testid="privacy-revoke"]')?.click();
    });

    expect(container?.querySelector('[data-testid="privacy-revoke-not-persisted"]')).not.toBeNull();
    expect(privacyConsent.networkAllowed()).toBe(false);
    spy.mockRestore();
  });

  it('隐藏时不订阅后续状态变化，也不发网络请求', () => {
    privacyConsentActions.accept();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(false);

    act(() => {
      privacyConsentActions.revoke();
    });

    expect(container?.querySelector('[data-testid="privacy-state"]')?.textContent).toContain('已同意与服务器通信');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
