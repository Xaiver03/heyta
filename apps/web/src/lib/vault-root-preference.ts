/**
 * ADR-0080 §5.5 的**第二个轴**：钥匙放在哪。
 *
 * - `device`（默认）：这台设备记住 root，刷新/重开都不用再输口令；
 * - `ask`：每次都要输，`sessionStorage` 里那份也不留。
 *
 * ## 为什么它是一个**独立**的偏好，而不是"加密开/关"的一个子选项
 *
 * 两个轴管的是完全不同的两件事：加密开/关决定**谁能读**（服务端能不能读），
 * 钥匙放在哪只决定**麻烦程度**（要不要每次输入），一个字都不改变隐私边界。
 * 混在一起，用户会以为"记住解锁"就等于"不加密" —— 那正是 ADR-0080 要消灭的误解。
 *
 * ## 存哪儿
 *
 * 只存这个**非秘密**的偏好，键与值都不含密钥；root 本身仍由 `vault-root-cache.ts`
 * 管（`sessionStorage`，活到标签页关闭）。读不到一律按 `device`（默认值）。
 */
const PREF_KEY = 'heyta.vault.keyPlacement.v1';

export type VaultKeyPlacement = 'device' | 'ask';

const storage = (): Storage | undefined => {
  try {
    const candidate = globalThis.localStorage;
    const probe = '__heyta_probe__';
    candidate.setItem(probe, '1');
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return undefined;
  }
};

export function readVaultKeyPlacement(): VaultKeyPlacement {
  const store = storage();
  if (store === undefined) return 'device';
  try {
    return store.getItem(PREF_KEY) === 'ask' ? 'ask' : 'device';
  } catch {
    return 'device';
  }
}

export function writeVaultKeyPlacement(placement: VaultKeyPlacement): void {
  const store = storage();
  if (store === undefined) return;
  try {
    store.setItem(PREF_KEY, placement);
  } catch {
    // 写不进去就退回默认（device）；这不影响任何安全性质。
  }
}
