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

import { OFFICIAL_SITE_ORIGIN, type SyncConfig } from '@heyta/app-host';
import { deleteDevicePref, readDevicePref, writeDevicePref } from '../prefs/device-prefs';

/**
 * 当前的活凭据。`undefined` = 尚未配置。
 *
 * 模块级可变状态，因为 `openAppHost` 只接受一个**取值函数**
 * （`getSyncConfig`）而不是一份快照 —— 它必须在每次同步时重新读。
 */
let current: SyncConfig | undefined;

/**
 * 🔴 2026-11-20（W4）：**会话**（服务器地址 + 访问令牌 + accountId）持久化到设备本地，
 * 冷启动读回 —— 用户不再每次冷启动都被要求重登。
 *
 * 安全取舍：持久化的只有**会话**（serverUrl / token / accountId），让"已登录、可同步"
 * 跨重启成立；**E2EE 口令仍然不落盘**（那才是"服务端看不到明文"的承诺所系，落盘即作废）。
 * 于是加密账号冷启动后可能仍需输入一次口令解锁，但**不需要重新登录**。
 */
const PREF_KEY_SYNC_SESSION = 'sync.session';
/** 登出时一并清掉的账号邮箱键（与 `auth/session.ts` 的 `auth.email` 对应）。 */
const PREF_KEY_AUTH_EMAIL = 'auth.email';
let hydrated = false;

function hydrateFromDevice(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = readDevicePref(PREF_KEY_SYNC_SESSION);
    if (raw === undefined) return;
    const parsed = JSON.parse(raw) as { serverUrl?: unknown; token?: unknown; accountId?: unknown };
    if (typeof parsed.serverUrl !== 'string' || typeof parsed.token !== 'string' || parsed.token === '') {
      return;
    }
    current = {
      serverUrl: parsed.serverUrl,
      token: parsed.token,
      ...(typeof parsed.accountId === 'string' && parsed.accountId !== ''
        ? { accountId: parsed.accountId }
        : {}),
    };
  } catch {
    /* 读盘坏了一律当"没登录"，绝不抛（与 prefs 同一条纪律）。 */
  }
}

/** 把当前会话写进设备本地（失败不影响本次会话，不抛）。 */
function persistCurrent(): void {
  try {
    if (current === undefined || current.token === undefined || current.token === '') {
      deleteDevicePref(PREF_KEY_SYNC_SESSION);
      return;
    }
    writeDevicePref(
      PREF_KEY_SYNC_SESSION,
      JSON.stringify({
        serverUrl: current.serverUrl,
        token: current.token,
        ...(current.accountId !== undefined ? { accountId: current.accountId } : {}),
      }),
    );
  } catch {
    /* 见上：落盘失败只影响"下次启动"，不影响本次。 */
  }
}

/** 供 `openAppHost` 的 `getSyncConfig` 使用。**每次同步都会被调用。** */
export function readSyncConfig(): SyncConfig | undefined {
  hydrateFromDevice();
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
  persistCurrent();
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
  hydrated = true;
  deleteDevicePref(PREF_KEY_SYNC_SESSION);
  deleteDevicePref(PREF_KEY_AUTH_EMAIL);
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

/** Official hosted service is the product default; development servers are explicit overrides. */
export const DEFAULT_SERVER_URL = OFFICIAL_SITE_ORIGIN;
