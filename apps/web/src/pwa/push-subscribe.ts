/**
 * 浏览器侧的 Web Push 订阅。
 * ============================
 *
 * 这是整条链的**最后一个缺口**：服务端（⑬–⑯）已经能"给某个用户的订阅发推送"，
 * 但浏览器还没把订阅**登记上去**，所以订阅表永远是空的。
 *
 * ## 🔴 六个会静默出错的点
 *
 * **（1）`userVisibleOnly: true` 是必需的。** Chrome 在没有它时**直接抛异常**
 *（"The push subscription does not support userVisibleOnly"）。这不是可选项 ——
 * 它意味着"收到推送必须有用户可见的后果"。heyta 的推送会唤醒页面刷新组件，
 * 那确实是用户可见的，所以声明它为 true 是诚实的。
 *
 * **（2）`applicationServerKey` 必须是 raw 的 65 字节，不是 base64 字符串。**
 * 浏览器接受 `ArrayBuffer` / `Uint8Array` / 数字数组；**传字符串会抛**。
 * 所以服务端给的 base64url 必须在这里解开 —— 见 `urlBase64ToUint8Array`。
 *
 * **（3）`pushManager` 在非安全上下文里是 `undefined`。**
 * `http://` 上（localhost 除外）没有 `serviceWorker`，也没有 `pushManager`。
 * 直接访问它会抛 `TypeError`，而那个报错完全指不到"你用的是 http"。
 *
 * **（4）服务端回 `503` 表示"这台服务器没开 Web Push"**（自托管默认形态）。
 * 那**不是错误**，是一个正常状态 —— 必须与"网络坏了"区分开，
 * 否则自托管用户会看到一个莫名其妙的失败提示。
 *
 * **（5）这个模块从不抛。** 它被 UI 调用（设置页的一个开关），
 * 而"推送订阅失败"绝不该让设置页白屏。
 *
 * **（6）`reason` 是码，不是一句话。** 它会被壳层插进**已翻译的**句子里
 * （`web.widgetPush.status.failed` = 「开启失败：{reason}」）。
 * 一句话渗进另一句话，翻译就永远做不完整 —— 英文界面上会出现半句中文，
 * 而门禁看不见（它只扫 JSX 属性与 JSX 文本，这里在 `.ts` 的对象字面量里）。
 * 所以这里只产出封闭的**原因码**，"怎么说这句话"归壳层的
 * `Record<PushFailureReason, MessageKey>`；数字（HTTP 状态、字节长度）与
 * 浏览器原始异常文本作为**参数**跟着码走，不当主文案。
 * 同一条纪律见 `packages/ui/src/sync/model.ts` 的 `message`：
 * **诊断数据不翻译，也不映射成词条。**
 */

/** `GET /api/push/vapid-public-key` 的响应。 */
export interface VapidKeyResponse {
  publicKey: string;
}

/**
 * 失败 / 不可用的原因码（封闭集合）。
 *
 * 🔴 新增一条**必须**同时给 `WidgetPushPanel.tsx` 的
 * `PUSH_REASON_MESSAGE_KEY` 加一项 —— 那份 `Record` 是穷尽的，
 * 忘了就会编译失败。这是刻意的：词条漏一条不该在运行时才发现。
 */
export type PushFailureReason =
  // ── 环境根本不支持（不画开关，只在日志里）
  | 'insecure-context'
  | 'no-service-worker'
  | 'no-notification-api'
  | 'permission-denied'
  | 'server-not-configured'
  | 'needs-login'
  // ── 订阅/注销/探测过程中的失败
  | 'vapid-key-http'
  | 'vapid-key-malformed'
  | 'vapid-key-length'
  | 'no-subscription'
  | 'incomplete-subscription'
  | 'register-http'
  | 'unregister-http'
  | 'probe-http'
  // ── 没被 `catch` 归类的意外异常（`detail` 是浏览器原话）
  | 'unexpected';

/** 插进词条的参数。键名必须与 `{...}` 占位符逐字一致。 */
export type PushReasonVars = Readonly<Record<string, string | number>>;

/** 订阅结果。**区分"不支持"与"失败"**是这里唯一重要的设计。 */
export type PushSubscribeResult =
  | { status: 'subscribed' }
  | { status: 'unsubscribed' }
  /** 这台设备/浏览器根本不支持（http、旧浏览器、没有 SW）。**不是错误。** */
  | { status: 'unsupported'; reason: PushFailureReason }
  /** 服务端没开这个能力（503）。**也不是错误。** 自托管默认形态。 */
  | { status: 'disabled' }
  /** 用户拒绝了通知权限。**不该反复问。** */
  | { status: 'denied' }
  /** 真的失败了。 */
  | { status: 'failed'; reason: PushFailureReason; vars?: PushReasonVars };

/**
 * base64url → `Uint8Array`。
 *
 * ⚠️ 不能用 `atob` 一把梭：base64url 用的是 `-` 和 `_`，而且**没有 padding**，
 * `atob` 对这两点都会抛或解错。必须先换成标准字母表再补 padding。
 *
 * ⚠️ 也**不能**用 `TextDecoder`（Hermes 里没有）—— 这里用的是 `apps/web`，
 * 但它与服务端共用一份契约，保持纯 `atob` + 手写循环最容易核对。
 */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  if (typeof base64Url !== 'string' || base64Url === '') {
    throw new Error('urlBase64ToUint8Array: expected a non-empty string');
  }
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

/** 只用到这几个成员，抽出来让测试能注入。 */
export interface PushEnvironment {
  /** `navigator.serviceWorker`（可能不存在）。 */
  serviceWorker?: {
    ready: Promise<{
      pushManager: {
        getSubscription(): Promise<unknown>;
        subscribe(options: {
          userVisibleOnly: boolean;
          applicationServerKey: Uint8Array;
        }): Promise<{ toJSON(): unknown } | null>;
      };
    }>;
  };
  /** `navigator.permissions`（可能不存在 —— Safari 就没有）。 */
  permissions?: {
    query(descriptor: { name: string }): Promise<{ state: string }>;
  };
  notification?: { requestPermission(): Promise<string> };
  /** 当前是否安全上下文。**默认 false** —— 宁可少支持，不要假装支持。 */
  isSecureContext?: boolean;
  fetch?: typeof fetch;
}

/** 解析出可用的环境，或者说明为什么不可用。 */
function resolveEnvironment(env: PushEnvironment): PushSubscribeResult | null {
  // 🔴 顺序很重要：先判安全上下文。非安全上下文里下面两个都是 undefined，
  //    而直接访问它们抛出的 `TypeError` 完全指不到"你用的是 http"。
  if (env.isSecureContext !== true) {
    return { status: 'unsupported', reason: 'insecure-context' };
  }
  if (!env.serviceWorker) {
    return { status: 'unsupported', reason: 'no-service-worker' };
  }
  if (typeof env.notification === 'undefined') {
    return { status: 'unsupported', reason: 'no-notification-api' };
  }
  return null;
}

/**
 * `unexpected` 那条码的参数：浏览器/运行时自己的那句话。
 *
 * 🔴 它是**诊断数据**，不是文案 —— 不翻译、不映射词条，只作为 `{detail}`
 * 插进壳层那句本地化好的话里（与 `packages/ui/src/sync/model.ts` 的
 * `message` 同一条纪律）。
 */
function exceptionVars(error: unknown): PushReasonVars {
  return { detail: error instanceof Error ? error.message : String(error) };
}

/**
 * 订阅。**从不抛。**
 *
 * 调用方（设置页的开关）只关心 `status`，不处理异常。
 */
export async function subscribeToWidgetPush(
  env: PushEnvironment = globalThis as unknown as PushEnvironment,
): Promise<PushSubscribeResult> {
  try {
    const blocked = resolveEnvironment(env);
    if (blocked) return blocked;

    // 🔴 **先问权限，再拿 SW。** 反过来的话，用户点了"拒绝"之后
    //    我们仍然已经做了一次 SW 就绪等待 —— 在慢网络上那是几秒的卡顿，
    //    而结果必然是失败。
    //
    // ⚠️ 已经 granted 时**不要**再问：部分浏览器会重新弹窗，
    //    而"我明明授权过了怎么又弹"是最容易被吐槽的体验。
    let permission: string;
    if (env.permissions) {
      const current = await env.permissions.query({ name: 'notifications' });
      permission = current.state;
    } else {
      permission = 'default';
    }
    if (permission === 'denied') return { status: 'denied' };
    if (permission !== 'granted') {
      permission = await env.notification!.requestPermission();
      if (permission === 'denied') return { status: 'denied' };
      if (permission !== 'granted') {
        // 'default' = 用户把弹窗关掉了。**也当成拒绝** —— 反复问会让人烦。
        return { status: 'denied' };
      }
    }

    const fetcher = env.fetch ?? globalThis.fetch;

    // 先问服务端要公钥。⚠️ 这一步同时是"这个能力开没开"的探测：
    //    没配 VAPID 时它回 503，而**那不该被当成失败**。
    const keyResponse = await fetcher('/api/push/vapid-public-key', {
      credentials: 'same-origin',
    });
    if (keyResponse.status === 503) return { status: 'disabled' };
    if (keyResponse.status === 401) {
      // 没登录。**不是失败** —— 是"还没到能订阅的时候"。
      return { status: 'unsupported', reason: 'needs-login' };
    }
    if (!keyResponse.ok) {
      return { status: 'failed', reason: 'vapid-key-http', vars: { status: keyResponse.status } };
    }
    const body = (await keyResponse.json()) as VapidKeyResponse;
    let applicationServerKey: Uint8Array;
    try {
      applicationServerKey = urlBase64ToUint8Array(body.publicKey);
    } catch {
      return { status: 'failed', reason: 'vapid-key-malformed' };
    }
    if (applicationServerKey.length !== 65) {
      // ⚠️ 长度不对时**不要**拿它去 `subscribe` —— 浏览器会抛一个
      //    与真实原因（服务端配置错了）毫无关联的报错。
      return {
        status: 'failed',
        reason: 'vapid-key-length',
        vars: { length: applicationServerKey.length },
      };
    }

    const registration = await env.serviceWorker!.ready;
    const subscription = await registration.pushManager.subscribe({
      // 🔴 必需，见文件头（1）。Chrome 没有它会直接抛。
      userVisibleOnly: true,
      applicationServerKey,
    });
    if (subscription === null) {
      return { status: 'failed', reason: 'no-subscription' };
    }

    const raw = subscription.toJSON() as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    if (!raw.endpoint || !raw.keys?.p256dh || !raw.keys.auth) {
      return { status: 'failed', reason: 'incomplete-subscription' };
    }

    const response = await fetcher('/api/push/subscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint: raw.endpoint,
        p256dh: raw.keys.p256dh,
        auth: raw.keys.auth,
      }),
    });
    if (response.status === 503) return { status: 'disabled' };
    if (!response.ok) {
      return { status: 'failed', reason: 'register-http', vars: { status: response.status } };
    }
    return { status: 'subscribed' };
  } catch (error) {
    // 见文件头（5）：从不抛。
    return { status: 'failed', reason: 'unexpected', vars: exceptionVars(error) };
  }
}

/**
 * 注销。**从不抛。**
 *
 * ⚠️ 先告诉服务端，再退掉浏览器侧的订阅 —— 反过来的话，如果"告诉服务端"
 * 失败了，那条订阅就变成了一个**永远删不掉的死行**（浏览器已经不再持有它，
 * 所以再也不会有人用它来注销），而它每次同步都会被重试一次。
 */
export async function unsubscribeFromWidgetPush(
  env: PushEnvironment = globalThis as unknown as PushEnvironment,
): Promise<PushSubscribeResult> {
  try {
    if (env.isSecureContext !== true || !env.serviceWorker) {
      return { status: 'unsupported', reason: 'no-service-worker' };
    }
    const fetcher = env.fetch ?? globalThis.fetch;
    const registration = await env.serviceWorker.ready;
    const subscription = (await registration.pushManager.getSubscription()) as {
      endpoint?: string;
      unsubscribe(): Promise<boolean>;
    } | null;
    if (!subscription || !subscription.endpoint) return { status: 'unsubscribed' };

    const response = await fetcher('/api/push/subscribe', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    // ⚠️ 服务端说"没这条订阅"（200 + removed: 0）或 503 都**继续**退订：
    //    目标是"让这台设备不再收到推送"，而本地退订就能达到它。
    if (!response.ok && response.status !== 503) {
      return { status: 'failed', reason: 'unregister-http', vars: { status: response.status } };
    }
    await subscription.unsubscribe();
    return { status: 'unsubscribed' };
  } catch (error) {
    return { status: 'failed', reason: 'unexpected', vars: exceptionVars(error) };
  }
}

/** 探测结果。**`available` 为假时不要画开关** —— 见下。 */
export interface WidgetPushProbe {
  /** 环境支持 + 服务端开着这个能力。只有它为真才画开关。 */
  available: boolean;
  /** 当前是否已经订阅。 */
  subscribed: boolean;
  /** 不可用时的**原因码**（只用于日志 / 排查，不画给用户；措辞归壳层的词条表）。 */
  reason?: PushFailureReason;
  /** 跟着码走的参数（HTTP 状态、字节长度、浏览器原话）。 */
  vars?: PushReasonVars;
}

/**
 * 探测这台设备能不能收 Web Push，**且不触发任何权限弹窗**。
 *
 * 🔴 **为什么需要它：一个点了没反应的开关比没有开关更糟。**
 *
 * 与 iOS 侧 `readWidgetPrivacy()` 返回 `null` 时**省略**开关是同一条纪律
 *（见证据块里那条"一个会静默关掉自己的安全开关比没有更糟"）：
 * 在 `http://` 上、在没配 VAPID 的自托管实例上，这个能力**根本不存在** ——
 * 而画一个开关让用户点，点了必然失败，用户只会以为应用坏了。
 *
 * ⚠️ **绝不调用 `requestPermission`**：探测一个能力不该消耗用户的一次授权机会。
 * 权限这里只看**已知状态**；未知（`default`）算作"可以订阅"，
 * 因为真正需要授权的动作在用户点开关时发生。
 */
export async function probeWidgetPush(
  env: PushEnvironment = globalThis as unknown as PushEnvironment,
): Promise<WidgetPushProbe> {
  try {
    const blocked = resolveEnvironment(env);
    if (blocked) {
      // ⚠️ **把具体原因原样带出去**，不要在这里糊成一句"环境不支持"——
      //    "没有 SW"和"用的是 http"是两件用户能自己解决、而提示完全不同的事。
      return {
        available: false,
        subscribed: false,
        reason: blocked.status === 'unsupported' ? blocked.reason : 'unexpected',
      };
    }

    // 已知被拒绝时：能力在，但开关没有意义（点了也只会再被拒）。
    // ⚠️ 这里返回 available:false 是**刻意的** —— 权限被拒之后用户该做的是
    //    去浏览器设置里改，而不是在我们的开关上再点一次。
    if (env.permissions) {
      try {
        const current = await env.permissions.query({ name: 'notifications' });
        if (current.state === 'denied') {
          return { available: false, subscribed: false, reason: 'permission-denied' };
        }
      } catch {
        // ⚠️ 某些浏览器不支持 `notifications` 这个 descriptor。
        //    那不是"能力不可用"，继续往下探测。
      }
    }

    // 服务端开没开这个能力。⚠️ 这一步**要请求**，但它是只读的、
    // 不消耗授权机会，且 503 是明确的"没开"信号。
    const response = await (env.fetch ?? globalThis.fetch)('/api/push/vapid-public-key', {
      credentials: 'same-origin',
    });
    if (response.status === 503) {
      return { available: false, subscribed: false, reason: 'server-not-configured' };
    }
    if (!response.ok) {
      return {
        available: false,
        subscribed: false,
        reason: 'probe-http',
        vars: { status: response.status },
      };
    }

    const registration = await env.serviceWorker!.ready;
    const subscription = await registration.pushManager.getSubscription();
    return { available: true, subscribed: subscription !== null };
  } catch (error) {
    // 探测失败**不画开关** —— 探测不出来能力在不在，比探测出来"不在"更该保守。
    return {
      available: false,
      subscribed: false,
      reason: 'unexpected',
      vars: exceptionVars(error),
    };
  }
}
