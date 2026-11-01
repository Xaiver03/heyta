/**
 * Web 上"钥匙放在设备里"的那一格（ADR-0080 §5.4）。
 *
 * ## 为什么是 `sessionStorage` 而不是 `localStorage`
 *
 * 两个都不是保险箱：XSS 都能读。区别在**存活多久**：
 * - `sessionStorage` 活到**标签页关闭**，刷新还在；
 * - `localStorage` 活到**被显式清掉**，等于把"能解开全部历史"的钥匙
 *   长期放在盘上，而本机那份明文库**本来就只在 IndexedDB 里**——
 *   多出来的这部分暴露没有任何收益。
 *
 * 所以这里刻意只碰 `sessionStorage`。要改，先改 ADR。
 *
 * ## 它保护的是**服务器**，不是这个浏览器
 *
 * 这句必须原样进用户文案：口令/钥匙在这一层的意义是"云上那份是密文"，
 * 而不是"本机被偷了也读不到"。对后者的承诺只有 OS 钥匙串能勉强给一半。
 */
import { decodeBase64, encodeBase64 } from '@heyta/sync-core';

const PREFIX = 'heyta.vault.root.v1';

/** 与 vault 会话同一套作用域：同一浏览器里两个账号/两个服务端互不可见。 */
export interface WebVaultRootScope {
  accountId: string;
  serverOrigin: string;
}

const storageKey = (scope: WebVaultRootScope): string =>
  `${PREFIX}:${scope.serverOrigin}\u0000${scope.accountId}`;

/**
 * 某个作用域是否可用。**读不到存储就当作没有** —— 隐私模式下
 * `sessionStorage` 会抛，而"抛"不应该让整个设置页打不开。
 */
function storage(): Storage | undefined {
  try {
    const candidate = globalThis.sessionStorage;
    // 触碰一次：某些环境里 getter 本身会抛。
    const probe = '__heyta_probe__';
    candidate.setItem(probe, '1');
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return undefined;
  }
}

/** 读出这台设备记住的 root；没有/读坏/形状不对一律 `undefined`。 */
export function readSessionVaultRoot(scope: WebVaultRootScope): Uint8Array | undefined {
  const store = storage();
  if (store === undefined) return undefined;
  try {
    const encoded = store.getItem(storageKey(scope));
    if (encoded === null || encoded === '') return undefined;
    const bytes = new Uint8Array(decodeBase64(encoded));
    // vault root 恒为 32 字节。长度不对就是坏数据，不猜。
    return bytes.length === 32 ? bytes : undefined;
  } catch {
    return undefined;
  }
}

/** 记住这把 root（只在用户成功解锁之后调用）。写不进去不算失败。 */
export function writeSessionVaultRoot(scope: WebVaultRootScope, rootKey: Uint8Array): void {
  const store = storage();
  if (store === undefined) return;
  try {
    store.setItem(storageKey(scope), encodeBase64(rootKey));
  } catch {
    // 配额/隐私模式：功能降级成"刷新后要重新输"，不是错误。
  }
}

export function clearSessionVaultRoot(scope: WebVaultRootScope): void {
  const store = storage();
  if (store === undefined) return;
  try {
    store.removeItem(storageKey(scope));
  } catch {
    // 同上：清不掉也不能把登出路径卡住。
  }
}
