import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const switcher = vi.hoisted(() => ({ clear: vi.fn() }));

vi.mock('../src/features/settings/ExportPanel.js', () => ({
  ExportPanel: ({ onlyJson, onJsonExported }: { onlyJson: boolean; onJsonExported: () => void }) => (
    <button type="button" data-testid="test-json-export" data-json-only={String(onlyJson)} onClick={onJsonExported}>导出 JSON</button>
  ),
}));
vi.mock('../src/features/auth/central-account-switch.js', () => ({
  clearLocalDataForCentralAccountSwitch: switcher.clear,
}));

import { CentralAccountConflictPanel } from '../src/features/auth/CentralAccountConflictPanel.js';
import { useSyncStore } from '../src/features/sync/store.js';
import { CENTRAL_ACCOUNT_BINDING_KEY } from '../src/lib/central-account-binding.js';

const BASE_URL = 'https://heyta.example.test';
const OLD_BINDING = JSON.stringify({ origin: BASE_URL, subject: '12' });
let root: Root | undefined;
let element: HTMLDivElement | undefined;

beforeEach(() => {
  localStorage.setItem(CENTRAL_ACCOUNT_BINDING_KEY, OLD_BINDING);
  switcher.clear.mockReset().mockResolvedValue('erasure-incomplete');
  useSyncStore.setState({
    centralBindingConflict: 'mismatch',
    centralBindingTarget: { origin: BASE_URL, subject: '13' },
    centralAccountSwitching: false,
  });
  element = document.createElement('div');
  document.body.appendChild(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  element?.remove();
  root = undefined;
  element = undefined;
});

describe('中央账号冲突面板', () => {
  it('JSON 导出与用户确认完成前不允许清除本地数据', async () => {
    act(() => { root?.render(<CentralAccountConflictPanel baseUrl={BASE_URL} onClose={() => undefined} />); });
    const exportButton = element!.querySelector<HTMLButtonElement>('[data-testid="test-json-export"]')!;
    const confirm = element!.querySelector<HTMLInputElement>('[data-testid="central-switch-confirm"]')!;
    const clear = element!.querySelector<HTMLButtonElement>('[data-testid="central-switch-clear"]')!;
    expect(exportButton.dataset['jsonOnly']).toBe('true');
    expect(confirm.disabled).toBe(true);
    expect(clear.disabled).toBe(true);

    act(() => { exportButton.click(); });
    expect(confirm.disabled).toBe(false);
    expect(clear.disabled).toBe(true);
    act(() => { confirm.click(); });
    expect(clear.disabled).toBe(false);
    act(() => { clear.click(); });
    await vi.waitFor(() => expect(switcher.clear).toHaveBeenCalledWith(BASE_URL, OLD_BINDING));
  });
});
