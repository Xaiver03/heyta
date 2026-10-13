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

  it('重新作出选择走同一个 consent sheet store，并标记为 settings', () => {
    render();
    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-testid="privacy-choose-again"]')?.click();
    });

    expect(usePrivacyStore.getState().open).toBe(true);
    expect(usePrivacyStore.getState().reason).toBe('settings');
  });

  it('只用本机时主动重选不撤回原选择，也不提前允许网络', () => {
    privacyConsentActions.localOnly();
    render();
    const previous = privacyConsent.current();
    expect(container?.querySelector('[data-testid="privacy-revoke"]')).toBeNull();
    expect(container?.textContent).not.toContain('撤回后这台设备');
    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-testid="privacy-choose-again"]')?.click();
    });
    expect(usePrivacyStore.getState()).toMatchObject({ open: true, reason: 'settings' });
    expect(privacyConsent.current()).toEqual(previous);
    expect(privacyConsent.networkAllowed()).toBe(false);
    act(() => usePrivacyStore.getState().closeSheet());
    expect(privacyConsent.current()).toEqual(previous);
  });

  it('重新显示面板时读回隐藏期间改变的联网选择', () => {
    privacyConsentActions.accept();
    render(false);
    act(() => privacyConsentActions.localOnly());
    render(true);
    expect(container?.querySelector('[data-testid="privacy-state"]')?.textContent).toContain('只用本机');
    expect(container?.querySelector('[data-testid="privacy-revoke"]')).toBeNull();
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

  it('后续成功决定会清除旧警告，但再次写盘失败时警告仍保留', () => {
    privacyConsentActions.accept();
    render();

    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => undefined);
    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-testid="privacy-revoke"]')?.click();
    });
    expect(container?.querySelector('[data-testid="privacy-revoke-not-persisted"]')).not.toBeNull();
    removeSpy.mockRestore();

    act(() => privacyConsentActions.accept());
    expect(container?.querySelector('[data-testid="privacy-revoke-not-persisted"]')).toBeNull();

    const writeSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
    act(() => privacyConsentActions.localOnly());
    expect(container?.querySelector('[data-testid="privacy-revoke-not-persisted"]')).not.toBeNull();
    writeSpy.mockRestore();
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

  it('面板隐藏期间成功重新选择后，重新显示时清除旧的未持久化警告', () => {
    privacyConsentActions.accept();
    render();

    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => undefined);
    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-testid="privacy-revoke"]')?.click();
    });
    expect(container?.querySelector('[data-testid="privacy-revoke-not-persisted"]')).not.toBeNull();
    removeSpy.mockRestore();

    render(false);
    act(() => privacyConsentActions.accept());
    render(true);

    expect(container?.querySelector('[data-testid="privacy-revoke-not-persisted"]')).toBeNull();
    expect(container?.querySelector('[data-testid="privacy-state"]')?.textContent).toContain('已同意');
  });

  it('仅切换设置分组不能清除失败，隐藏期间再次失败也保持警告', () => {
    privacyConsentActions.accept();
    render();
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => undefined);
    act(() => container?.querySelector<HTMLButtonElement>('[data-testid="privacy-revoke"]')?.click());
    removeSpy.mockRestore();
    render(false);
    render(true);
    expect(container?.querySelector('[data-testid="privacy-revoke-not-persisted"]')).not.toBeNull();

    render(false);
    const writeSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
    act(() => privacyConsentActions.localOnly());
    writeSpy.mockRestore();
    render(true);
    expect(container?.querySelector('[data-testid="privacy-revoke-not-persisted"]')).not.toBeNull();
    expect(privacyConsent.networkAllowed()).toBe(false);
  });
});
