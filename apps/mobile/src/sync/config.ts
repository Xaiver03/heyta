/**
 * 移动端的**运行时同步凭据**
 * ============================
 *
 * 🔴 这个文件存在的唯一理由，是 `openAppHost()` 在**应用启动时**就跑完了，
 * 而服务器地址 / 访问令牌 / E2EE 口令只能由用户在启动**之后**输入。
 *
 * 实测的功能缺口：`apps/mobile` 此前把 `serverUrl` 硬编码传给 `openAppHost`，
 * 却**从不调用 `sync()`** —— 因为即使调了也永远缺令牌。
 * 表现是"能建任务、能勾选、能删除，但一条都同步不出去"，
 * 而界面上看不出任何异常。
 *
 * ---
 *
 * 🔴 **凭据只放内存，刻意不落盘。**
 *
 * E2EE 口令落盘就等于把"服务端看不到明文"这个承诺作废 ——
 * 攻击者不再需要攻破服务端，只要拿到设备上的那个文件。
 * 所以口令重启后必须重新输入。
 *
 * 代价是真实的：每次冷启动都要重填。这是**有意的取舍**，
 * 想改善它应该去接系统钥匙串（iOS Keychain / Android Keystore），
 * 而不是把口令写进我们自己的 SQLite —— 两者在安全性上不是一回事。
 *
 * ⚠️ 服务器地址不是秘密，将来可以持久化；本轮**一律不落盘**，
 * 因为"哪些字段算秘密"是个产品判断，不该由这里顺手决定。
 */

import type { SyncConfig } from '@heyta/app-host';

/**
 * 当前的活凭据。`undefined` = 尚未配置。
 *
 * 模块级可变状态，因为 `openAppHost` 只接受一个**取值函数**
 * （`getSyncConfig`）而不是一份快照 —— 它必须在每次同步时重新读。
 */
let current: SyncConfig | undefined;

/** 供 `openAppHost` 的 `getSyncConfig` 使用。**每次同步都会被调用。** */
export function readSyncConfig(): SyncConfig | undefined {
  return current;
}

/**
 * 写入凭据。
 *
 * 空字符串会被规整成 `undefined` —— 表单里"用户把令牌清空了"和
 * "用户从没填过"在行为上必须一致，否则会留下一个空令牌的配置，
 * 表现为请求带着 `Authorization: Bearer ` 出去，服务端回 401，
 * 而界面显示"已配置"。**清空字段要写 `null`，不能写 `undefined`** 的同一条纪律。
 */
export function writeSyncConfig(input: {
  serverUrl: string;
  token: string;
  password: string;
  /** Stable id returned by the authenticated session; never infer from clientId. */
  accountId?: string;
}): void {
  const token = input.token.trim();
  const password = input.password;
  const serverUrl = input.serverUrl.trim();
  const accountId = input.accountId?.trim() ?? '';
  // An account id is bound to the authenticated server session represented by
  // this exact server/token pair. Form edits omit accountId on purpose, so
  // preserve it only while that pair is unchanged; changing either value must
  // force a fresh authenticated binding instead of carrying a root key across
  // accounts or endpoints.
  const sameAuthenticatedSession =
    input.accountId === undefined &&
    current !== undefined &&
    current.serverUrl === serverUrl &&
    (current.token ?? '') === token;
  current = {
    serverUrl,
    ...(token === '' ? {} : { token }),
    ...(password === '' ? {} : { password }),
    ...(input.accountId === undefined
      ? (sameAuthenticatedSession && current?.accountId !== undefined ? { accountId: current.accountId } : {})
      : (accountId === '' ? {} : { accountId })),
  };
}

type ClearedListener = () => void;
const clearedListeners = new Set<ClearedListener>();

/**
 * 订阅"本机凭据被清空"。返回退订函数。
 *
 * 🔴 **只有清空有信号，写入没有**，这不是偏心：写入的时机是**逐键**的
 * （`credential-form.ts` 一个字符写一次活配置），在那里挂通知会让补签闸门
 * 每敲一个字符发一次询问；而清空只有一次，就是登出那一刻。
 *
 * 为什么另开这一层而不是让 `legal-recheck/gate.ts` 直接被本模块 import：
 * 那边要读 `readSyncConfig()`（活取值），反过来引就是模块循环 ——
 * 与本壳 `write-signal.ts` 处理的是同一个形状。
 */
export function onCredentialsCleared(listener: ClearedListener): () => void {
  clearedListeners.add(listener);
  return () => {
    clearedListeners.delete(listener);
  };
}

export function clearSyncConfig(): void {
  current = undefined;
  for (const listener of clearedListeners) {
    // 🔴 一个订阅者抛错不许把登出的**其余部分**吞掉：清凭据是安全动作，
    // 它比"通知到位"优先级高（同 `privacy/consent-gate.ts` 里 `notify()` 那条理由）。
    try {
      listener();
    } catch (error: unknown) {
      console.warn('[sync] 凭据清空的订阅者抛错（凭据本身已经清掉了）：', error);
    }
  }
}

/**
 * Android 模拟器上的默认服务端地址。
 *
 * 🔴 **`127.0.0.1` 在模拟器里指的是模拟器自己**，不是运行服务端的这台 Mac。
 * 模拟器把宿主机的回环地址映射到 `10.0.2.2`。
 * 这是"地址填对了、服务也在跑、就是连不上"最常见的原因。
 * 真机调试要换成局域网 IP。
 */
export const DEFAULT_SERVER_URL = 'http://10.0.2.2:3000';
