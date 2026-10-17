/**
 * 托管 AI 的**宿主通道**：把同步会话（服务器基址 + 访问令牌）接成
 * `@heyta/ai` 的 `RoutedDeps.managedTransport` 要的那一个函数。
 *
 * ## 🔴 为什么它必须只有一份
 *
 * 这个函数的形状被 **7 处** `deps.routed` 用到（`apps/web` 6 处 + `apps/mobile` 1 处：
 * AiCapture / AiBreakdown / AiDuration / AiPrioritize / AiToolRun / AssistantPanel / chat-controller）。
 * 各写一遍的结果不是"多几行"，而是：
 *
 * - **某一处忘了传** ⇒ 那个功能在托管档上**不走代理**，用户点下去拿到一句
 *   "AI 不可用"，而没有任何一层能说清是哪一处漏了；
 * - 各处对"空串算不算没配"的判断漂移 ⇒ 同一个账号在 A 面板能用、在 B 面板不能用。
 *
 * 所以组装只有这一份，形状照 `host.ts` 已有的那一对
 * （`{ baseUrl: config.serverUrl, getToken: async () => readSyncConfig().token }`）。
 *
 * ## 🔴 它为什么**不**自己去读同步配置
 *
 * `packages/app-host` 里读同步配置需要一份 `SyncConfig` 或一个 store，
 * 而这两样在 web / 移动 / node-host 三种壳里完全不同。
 * 这里只接受**两个活取值器**（`getServerUrl` / `getToken`）——
 * 与 `entitlement.ts` / `checkout.ts` / `device-management.ts` 的 `getToken` 同一手法：
 * **运行时可变**的凭据一律现取，不缓存。
 *
 * ## ⚠️ 取不到时返回 `undefined`，不是抛
 *
 * `undefined` 会让路由层给出 `not-configured`（"这台设备还没有可用的托管通道"），
 * 那是一句用户能据以行动的话。抛出去则会让一次 AI 调用变成一次**未捕获异常** ——
 * 而"取令牌失败"（网络抖动、钥匙串锁着）与"没登录"对用户是**同一件事**：
 * 现在走不了。两种情况的区别该由同步那一层自己去报，不该在这里分叉。
 */

/** 托管通道的两个来源。两者**都**必须给出非空值，否则算"现在走不了"。 */
export interface ManagedTransportSource {
  /** 同步服务器地址。空串 / 未配置一律当"没有"。 */
  readonly getServerUrl: () => string | undefined;
  /** 当前访问令牌的**活取值器**（会轮换，不许缓存）。 */
  readonly getToken: () => Promise<string | undefined>;
}

/** `managedTransport` 的签名 —— 与 `@heyta/ai` 的 `RoutedDeps.managedTransport` 逐字一致。 */
export type ManagedTransport = () => Promise<
  { readonly baseUrl: string; readonly token: string } | undefined
>;

/**
 * 组装那一个函数。
 *
 * 🔴 **不做任何 URL 校验**：基址合不合格由 `@heyta/ai` 判（境内白名单 + 与披露端点同主机），
 * 在这里再判一遍就是第二套判据 —— 而两套判据迟早会分叉，
 * 分叉的表现是"这里放行、那里拒发"。
 */
export function createManagedTransport(source: ManagedTransportSource): ManagedTransport {
  return async () => {
    const baseUrl = source.getServerUrl()?.trim() ?? '';
    if (baseUrl === '') return undefined;

    let token: string | undefined;
    try {
      token = await source.getToken();
    } catch {
      // 见文件头：取不到 = 现在走不了，不许把异常抛穿一次 AI 调用。
      return undefined;
    }
    if (token === undefined || token.trim() === '') return undefined;

    return { baseUrl, token };
  };
}
