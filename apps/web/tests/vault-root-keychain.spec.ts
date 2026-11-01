import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearDeviceVaultRoot,
  deviceVaultKeychain,
  loadDeviceVaultRoot,
  saveDeviceVaultRoot,
} from '../src/lib/vault-root-keychain.js';

/**
 * 壳侧钥匙串那一层（ADR-0080 §5.4 / §5.5）。
 *
 * 它只回答一个问题：**"这台设备记没记住钥匙"该问谁**。
 * 问错了不会有异常 —— 只会在 macOS 壳里表现为"关掉 App 就要重新输口令"，
 * 而那正是 S5 要消灭的那个东西。所以这里的判据要能**红**：
 * 少一条、把半座桥当真、长度不校验、读失败当成"没有"，每一种都有对应用例。
 */

const SCOPE = { accountId: 'acct-1', serverOrigin: 'https://sync.example.test' };
const ROOT = new Uint8Array(32).fill(0x5a);
const ROOT_BASE64 = 'WlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlo=';

interface FakeBridge {
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
}

function installBridge(overrides: Partial<FakeBridge> = {}): FakeBridge {
  const bridge: FakeBridge = {
    load: vi.fn(async () => ROOT_BASE64),
    save: vi.fn(async () => true),
    clear: vi.fn(async () => true),
    ...overrides,
  };
  (globalThis as { heytaVaultKeychain?: unknown }).heytaVaultKeychain = bridge as unknown as
    Record<string, unknown>;
  return bridge;
}

afterEach(() => {
  delete (globalThis as { heytaVaultKeychain?: unknown }).heytaVaultKeychain;
});

describe('壳的钥匙串桥：认不认这座桥', () => {
  it('没有桥（普通浏览器）⇒ 三个动作都"不归我管"，调用方自己退 sessionStorage', async () => {
    expect(deviceVaultKeychain()).toBeUndefined();
    expect(await loadDeviceVaultRoot(SCOPE)).toBeUndefined();
    expect(await saveDeviceVaultRoot(SCOPE, ROOT)).toBe(false);
    expect(await clearDeviceVaultRoot(SCOPE)).toBe(false);
  });

  it('🔴 半座桥（缺 clear）⇒ 当作没有桥，不许当成"有"', async () => {
    // 半座桥的后果很具体：钥匙写得进去、清不掉 —— 用户点了锁定，重开又自己开了。
    (globalThis as { heytaVaultKeychain?: unknown }).heytaVaultKeychain = {
      load: async () => ROOT_BASE64,
      save: async () => true,
    };
    expect(deviceVaultKeychain()).toBeUndefined();
    expect(await loadDeviceVaultRoot(SCOPE)).toBeUndefined();
  });
});

describe('读：三种结果必须能分开', () => {
  it('设备上记住了 ⇒ 拿到 32 字节，且入参是 (serverOrigin, accountId)', async () => {
    const bridge = installBridge();
    const loaded = await loadDeviceVaultRoot(SCOPE);
    expect(loaded).toBeInstanceOf(Uint8Array);
    expect(loaded).toHaveLength(32);
    expect([...(loaded as Uint8Array)]).toEqual([...ROOT]);
    expect(bridge.load).toHaveBeenCalledWith(SCOPE.serverOrigin, SCOPE.accountId);
  });

  it('设备上没记住（null）⇒ 回 null，回的不是 undefined（那会叫调用方去问 sessionStorage）', async () => {
    installBridge({ load: vi.fn(async () => null) });
    expect(await loadDeviceVaultRoot(SCOPE)).toBeNull();
  });

  it('🔴 长度不是 32 字节 ⇒ 当没有，不猜', async () => {
    // 16 字节也是合法 base64、也解得开 —— 但 vault root 恒为 32 字节。
    installBridge({ load: vi.fn(async () => 'AAAAAAAAAAAAAAAAAAAAAA==') });
    expect(await loadDeviceVaultRoot(SCOPE)).toBeNull();
  });

  it('桥抛了 ⇒ 回 null（要口令），不许把异常放出去', async () => {
    installBridge({ load: vi.fn(async () => { throw new Error('locked'); }) });
    await expect(loadDeviceVaultRoot(SCOPE)).resolves.toBeNull();
  });
});

describe('写 / 清', () => {
  it('写进去的是 base64（32 字节），返回值就是桥的答案', async () => {
    const bridge = installBridge();
    await expect(saveDeviceVaultRoot(SCOPE, ROOT)).resolves.toBe(true);
    expect(bridge.save).toHaveBeenCalledWith(SCOPE.serverOrigin, SCOPE.accountId, ROOT_BASE64);
  });

  it('桥上写失败 ⇒ 回 false（调用方据此退 sessionStorage），不抛', async () => {
    installBridge({ save: vi.fn(async () => false) });
    await expect(saveDeviceVaultRoot(SCOPE, ROOT)).resolves.toBe(false);
  });

  it('🔴 长度不是 32 的 root 一律不写 —— 写进去也读不出来，等于骗了"记住"', async () => {
    const bridge = installBridge();
    await expect(saveDeviceVaultRoot(SCOPE, new Uint8Array(16))).resolves.toBe(false);
    expect(bridge.save).not.toHaveBeenCalled();
  });

  it('清理按同一套作用域走', async () => {
    const bridge = installBridge();
    await expect(clearDeviceVaultRoot(SCOPE)).resolves.toBe(true);
    expect(bridge.clear).toHaveBeenCalledWith(SCOPE.serverOrigin, SCOPE.accountId);
  });
});
