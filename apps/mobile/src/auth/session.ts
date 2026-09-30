/**
 * 登录成功之后的**落点**
 * =========================
 *
 * 规范 §3.2 的第 ③④ 步：**登录成功 → 拿到 token + user → 提示设置 E2EE 口令
 * → 保存并启用同步**。这一步的落点是 `openAppHost` 的 `getSyncConfig` ——
 * 见 `packages/app-host/src/host.ts:246-254` 与 `apps/mobile/src/db/open-host.ts:96`。
 *
 * ## 🔴 为什么要有这个文件，而不是让两个屏幕各写一遍
 *
 * 「拿到会话之后要做的三件事」是**规范的一部分**，不是某一个屏幕的界面细节：
 *
 *   1. 服务器地址 / 令牌 / 口令写进活配置（顺序不能反，理由在下面）；
 *   2. 记住这次登录的邮箱（**只放内存**）；
 *   3. 让同步立刻可用（调用方负责触发，见 `onSaved`）。
 *
 * 今天有两个调用点（欢迎页、我的页）。各写一份的后果是：改一处、
 * 另一处还按旧顺序 —— 而症状是"从欢迎页登录能同步、从我的页登录不能"，
 * 这种"只在一条入口上坏"的缺陷最难被发现。
 *
 * ## 顺序：**先写配置，再触发同步**
 *
 * 反了的话第一次同步用的还是上一次的凭据 —— 用户会看到
 * "第一次点没反应、第二次才成功"（`ProfileScreen.onSync` 的注释记着同一条）。
 *
 * ## 🔴 邮箱为什么只放内存
 *
 * 与 `sync/config.ts` 的取舍**一致**：凭据（含令牌）本来就不落盘，
 * 而邮箱是"跟着令牌走"的展示信息。把邮箱单独落盘会造出一个
 * "有邮箱、没令牌"的中间态 —— 界面上显示"已登录"，同步却报未配置。
 * 规范 §4 把持久化单列成 W4 那一刀，这里不抢跑。
 */

import { writeSyncConfig } from '../sync/config';

/** 本会话内已登录的账号邮箱。冷启动后回到 `undefined`（规范 §4 的已知代价）。 */
let signedInEmail: string | undefined;

export interface AuthSessionInput {
  serverUrl: string;
  token: string;
  /** E2EE 口令。空串 = 用户还没填 —— 同步会在 E2EE 那一步明确失败，不降级成明文。 */
  password: string;
  email: string;
}

/**
 * 把一次成功登录落成活配置。**返回写进去的值**，供界面立刻回填输入框。
 *
 * 🔴 回填输入框不是外观问题：`ProfileScreen` 的令牌输入框是它自己的 state
 * （初值取自 `readSyncConfig()`），登录成功不动它的话，用户随后点
 * 「立即同步」会用**空的输入框**把刚拿到的令牌覆盖掉 ——
 * 症状是"明明登录成功了，一同步就说未配置"。
 */
export function saveAuthSession(input: AuthSessionInput): {
  serverUrl: string;
  token: string;
  password: string;
} {
  const serverUrl = input.serverUrl.trim();
  const token = input.token.trim();
  writeSyncConfig({ serverUrl, token, password: input.password });
  /**
   * 🔴 **登录之后必须通知一次。**
   *
   * 两个后果，缺了它都不会发生：
   *   1. 立刻同步一次（这是本函数的文档写的契约）；
   *   2. **启动实时通道** —— 而它在此之前**一个调用点都没有**，
   *      `verify-mobile-ios` 第 7 步实测 `wsConnections` 一直是 0。
   */
  // 🔴 **动态 `import()`，不是顶部的静态 import。**
  //
  // `../sync/auto-sync` 会（经 `store` → `open-host`）拖进 `react-native` ——
  // 而 RN 的入口是 **Flow 源码**，node 测试环境直接解析失败
  //（实测：`RolldownError: Flow is not supported`，整个 `auth-flow.spec.ts`
  // 连加载都过不去）。这与 `sync/realtime.ts` 里那处惰性加载是同一个理由。
  //
  // ⚠️ 不把它挪到调用方（`AuthScreen`）：那样"**谁写凭据谁负责通知**"
  // 这条不变量就被拆到两个文件里了，而它恰恰是这一轮花了一整轮才修好的东西
  //（`notifyConfigured()` 曾经是个**死导出**，设备上实测 `wsConnections` 恒为 0）。
  void import('../sync/auto-sync').then((m) => {
    m.notifyConfigured();
  });
  signedInEmail = input.email.trim() === '' ? undefined : input.email.trim();
  return { serverUrl, token, password: input.password };
}

/** 界面上"当前账号"那一行读它。**没有登录时是 `undefined`**，不要回落到空串。 */
export function currentSignedInEmail(): string | undefined {
  return signedInEmail;
}

/** 清除本机凭据时一并忘掉账号（与 `clearSyncConfig` 成对）。 */
export function forgetSignedInUser(): void {
  signedInEmail = undefined;
}

/** 仅供测试：重置模块级状态。 */
export function resetAuthSessionForTests(): void {
  signedInEmail = undefined;
}
