/**
 * 浏览器侧 Web Push 订阅。
 * ==========================
 *
 * 这个文件要挡的是**"把不支持当成失败"**和**"把失败当成成功"**两种镜像错误。
 *
 * 前者会让人看到莫名其妙的报错（http 上、自托管没配 VAPID 时、没登录时都不是错误）；
 * 后者更糟 —— 开关显示"已开启"，而实际上什么都没有登记上去。
 */

import { describe, expect, it } from 'vitest';

import {
  probeWidgetPush,
  subscribeToWidgetPush,
  unsubscribeFromWidgetPush,
  urlBase64ToUint8Array,
  type PushEnvironment,
} from '../src/pwa/push-subscribe';

/** 65 字节的合法 VAPID 公钥，base64url 无 padding。 */
const PUBLIC_KEY_B64 = (() => {
  const bytes = new Uint8Array(65);
  bytes[0] = 4;
  for (let i = 1; i < 65; i += 1) bytes[i] = i;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
})();

function jsonResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** 一个记录调用的假环境。 */
function fakeEnv(overrides: Partial<PushEnvironment> = {}) {
  const calls: string[] = [];
  let subscribeOptions: { userVisibleOnly: boolean; applicationServerKey: Uint8Array } | null = null;
  let postedBody: Record<string, unknown> | null = null;

  const base: PushEnvironment = {
    isSecureContext: true,
    notification: {
      requestPermission: async () => {
        calls.push('requestPermission');
        return 'granted';
      },
    },
    serviceWorker: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: async () => {
            calls.push('getSubscription');
            return { endpoint: 'https://push.example/e1', unsubscribe: async () => true };
          },
          subscribe: async (options) => {
            calls.push('subscribe');
            subscribeOptions = options;
            return {
              toJSON: () => ({
                endpoint: 'https://push.example/e1',
                keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
              }),
            };
          },
        },
      }),
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`fetch:${url}`);
      if (url.includes('vapid-public-key')) {
        return jsonResponse(200, { publicKey: PUBLIC_KEY_B64 });
      }
      postedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return jsonResponse(201, { ok: true });
    }) as typeof fetch,
    ...overrides,
  };
  return { env: base, calls, getSubscribeOptions: () => subscribeOptions, getPostedBody: () => postedBody };
}

describe('urlBase64ToUint8Array', () => {
  it('解出 65 字节', () => {
    const bytes = urlBase64ToUint8Array(PUBLIC_KEY_B64);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
    expect(bytes[64]).toBe(64);
  });

  it('🔴 处理 base64url 的 `-` 与 `_`（atob 直接吃会抛或解错）', () => {
    // ⚠️ 我第一版把期望写成了 4 字节 —— 但 `-_8-` 是 4 个 base64 **字符**，
    //    base64 是 4 字符 → 3 字节，所以正确答案是 3 个。测试写错，不是代码错。
    //    `-/8-` 的标准字母表形式是 `+/8+`：
    //    `+`=62, `/`=63, `8`=60, `+`=62 → 111110 111111 111100 111110
    //                                  → 0xFB 0xFF 0x3E
    const bytes = urlBase64ToUint8Array('-_8-');
    expect(Array.from(bytes)).toEqual([0xfb, 0xff, 0x3e]);
    // 再验一个同时含 `-` 与 `_` 且需要补 padding 的：`-_-_` → `+/+/` → 3 字节
    expect(Array.from(urlBase64ToUint8Array('-_8-'))).toHaveLength(3);
    // 关键：**标准 base64 与 base64url 必须解出同一样东西**
    expect(Array.from(urlBase64ToUint8Array('-_8-'))).toEqual(
      Array.from(urlBase64ToUint8Array('+/8+')),
    );
  });

  it('🔴 处理缺失的 padding', () => {
    // 同一个字节串，带 padding 与不带必须解出一样的东西。
    const withPadding = urlBase64ToUint8Array('AQIDBA==');
    const withoutPadding = urlBase64ToUint8Array('AQIDBA');
    expect(Array.from(withPadding)).toEqual([1, 2, 3, 4]);
    expect(Array.from(withoutPadding)).toEqual([1, 2, 3, 4]);
  });

  it('空串报错（而不是解出一个空数组）', () => {
    // ⚠️ 这条文本是**诊断串**，永远不进界面 —— 所以它可以是英文的、内部格式。
    expect(() => urlBase64ToUint8Array('')).toThrow(/non-empty/);
    expect(() => urlBase64ToUint8Array(undefined as unknown as string)).toThrow(/non-empty/);
  });
});

describe('🔴 不支持 ≠ 失败', () => {
  it('非安全上下文 → unsupported，且一次 fetch 都不做', async () => {
    const { env, calls } = fakeEnv({ isSecureContext: false });
    const result = await subscribeToWidgetPush(env);
    expect(result).toMatchObject({ status: 'unsupported' });
    // 🔴 reason 是**码**，不是一句话（句子在 packages/i18n，由面板按当前语言拼）。
    expect(result.status === 'unsupported' && result.reason).toBe('insecure-context');
    expect(calls).toEqual([]);
  });

  it('没有 Service Worker → unsupported', async () => {
    const { env } = fakeEnv({ serviceWorker: undefined });
    expect(await subscribeToWidgetPush(env)).toMatchObject({ status: 'unsupported' });
  });

  it('没有 Notification API → unsupported', async () => {
    const { env } = fakeEnv({ notification: undefined });
    expect(await subscribeToWidgetPush(env)).toMatchObject({ status: 'unsupported' });
  });

  it('🔴 服务端回 503 → disabled（自托管没配 VAPID 是正常状态，不是错误）', async () => {
    const { env } = fakeEnv({
      fetch: (async () => jsonResponse(503, { error: 'web_push_disabled' })) as typeof fetch,
    });
    expect(await subscribeToWidgetPush(env)).toEqual({ status: 'disabled' });
  });

  it('🔴 401 → unsupported「需要先登录」，不是 failed', async () => {
    const { env } = fakeEnv({
      fetch: (async () => jsonResponse(401, {})) as typeof fetch,
    });
    const result = await subscribeToWidgetPush(env);
    expect(result).toMatchObject({ status: 'unsupported' });
    expect(result.status === 'unsupported' && result.reason).toBe('needs-login');
  });
});

describe('🔴 权限', () => {
  it('已经 denied 时直接返回，**不**去拿 SW、**不**发请求', async () => {
    const { env, calls } = fakeEnv({
      permissions: { query: async () => ({ state: 'denied' }) },
    });
    expect(await subscribeToWidgetPush(env)).toEqual({ status: 'denied' });
    // 反过来的话，用户点了「拒绝」之后我们仍然等了一次 SW 就绪 ——
    // 慢网络上那是几秒卡顿，而结果必然是失败。
    expect(calls).toEqual([]);
  });

  it('🔴 already granted 时**不再**弹窗（「我明明授权过了怎么又弹」）', async () => {
    const { env, calls } = fakeEnv({
      permissions: { query: async () => ({ state: 'granted' }) },
    });
    const result = await subscribeToWidgetPush(env);
    expect(result).toEqual({ status: 'subscribed' });
    expect(calls).not.toContain('requestPermission');
  });

  it('用户把弹窗关掉（default）也当成 denied，不反复问', async () => {
    const { env } = fakeEnv({
      permissions: { query: async () => ({ state: 'default' }) },
      notification: { requestPermission: async () => 'default' },
    });
    expect(await subscribeToWidgetPush(env)).toEqual({ status: 'denied' });
  });

  it('没有 permissions API（Safari）时退化成直接 requestPermission', async () => {
    const { env } = fakeEnv({ permissions: undefined });
    expect(await subscribeToWidgetPush(env)).toEqual({ status: 'subscribed' });
  });
});

describe('🔴 公钥校验：坏公钥不能拿去 subscribe', () => {
  it('长度不是 65 字节 → failed，且**不**调用 subscribe', async () => {
    const { env, calls } = fakeEnv({
      fetch: (async () =>
        jsonResponse(200, { publicKey: urlBase64ToUint8Array.length ? 'AQIDBA' : '' })) as typeof fetch,
    });
    const result = await subscribeToWidgetPush(env);
    expect(result).toMatchObject({ status: 'failed' });
    // 浏览器对长度错的 key 会抛一个与真实原因（服务端配错了）无关的报错。
    expect(calls).not.toContain('subscribe');
  });

  it('公钥不是合法 base64url → failed', async () => {
    const { env } = fakeEnv({
      fetch: (async () => jsonResponse(200, { publicKey: '!!!not-base64!!!' })) as typeof fetch,
    });
    const result = await subscribeToWidgetPush(env);
    expect(result).toMatchObject({ status: 'failed' });
  });

  it('取公钥回 500 → failed', async () => {
    const { env } = fakeEnv({ fetch: (async () => jsonResponse(500, {})) as typeof fetch });
    const result = await subscribeToWidgetPush(env);
    expect(result).toMatchObject({ status: 'failed' });
    expect(result.status === 'failed' && result.reason).toBe('vapid-key-http');
    // 状态码作为**数据**随 vars 一起给，界面把它插进词条的 {status} 里。
    expect(result.status === 'failed' && result.vars).toEqual({ status: 500 });
  });
});

describe('🔴 成功路径：两个必需项缺一不可', () => {
  it('subscribe 时 userVisibleOnly 必须是 true（Chrome 缺它会直接抛）', async () => {
    const { env, getSubscribeOptions } = fakeEnv();
    const result = await subscribeToWidgetPush(env);
    expect(result).toEqual({ status: 'subscribed' });
    const options = getSubscribeOptions();
    expect(options?.userVisibleOnly).toBe(true);
    // applicationServerKey 必须是**字节**，不是字符串。
    expect(options?.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(options?.applicationServerKey).toHaveLength(65);
  });

  it('登记时带上 endpoint 与两个密钥', async () => {
    const { env, getPostedBody } = fakeEnv();
    await subscribeToWidgetPush(env);
    expect(getPostedBody()).toEqual({
      endpoint: 'https://push.example/e1',
      p256dh: 'p256dh-value',
      auth: 'auth-value',
    });
  });

  it('登记回 503 → disabled（能力在服务端被关掉了）', async () => {
    let n = 0;
    const { env } = fakeEnv({
      fetch: (async () => {
        n += 1;
        return n === 1 ? jsonResponse(200, { publicKey: PUBLIC_KEY_B64 }) : jsonResponse(503, {});
      }) as typeof fetch,
    });
    expect(await subscribeToWidgetPush(env)).toEqual({ status: 'disabled' });
  });

  it('浏览器返回 null 订阅 → failed', async () => {
    const { env } = fakeEnv({
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: async () => null,
            subscribe: async () => null,
          },
        }),
      },
    });
    expect(await subscribeToWidgetPush(env)).toMatchObject({ status: 'failed' });
  });

  it('订阅缺少 auth 密钥 → failed（不能把半条订阅登记上去）', async () => {
    const { env } = fakeEnv({
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: async () => null,
            subscribe: async () => ({
              toJSON: () => ({ endpoint: 'https://push.example/e1', keys: { p256dh: 'p' } }),
            }),
          },
        }),
      },
    });
    expect(await subscribeToWidgetPush(env)).toMatchObject({ status: 'failed' });
  });
});

describe('🔴 从不抛异常', () => {
  it('subscribe 抛异常 → failed，不是把异常漏出去', async () => {
    const { env } = fakeEnv({
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: async () => null,
            subscribe: async () => {
              throw new Error('The push subscription does not support userVisibleOnly');
            },
          },
        }),
      },
    });
    const result = await subscribeToWidgetPush(env);
    expect(result).toMatchObject({ status: 'failed' });
    // 浏览器抛的东西我们认不出来 ⇒ 只有 'unexpected' 这一个码，
    // 原始文本走 vars.detail（是唯一线索），**不**当码用。
    expect(result.status === 'failed' && result.reason).toBe('unexpected');
    expect(String(result.status === 'failed' && result.vars?.detail)).toMatch(/userVisibleOnly/);
  });

  it('fetch 抛异常（离线）→ failed', async () => {
    const { env } = fakeEnv({
      fetch: (async () => {
        throw new TypeError('Failed to fetch');
      }) as typeof fetch,
    });
    expect(await subscribeToWidgetPush(env)).toMatchObject({ status: 'failed' });
  });

  it('permissions.query 抛异常 → failed，不外漏', async () => {
    const { env } = fakeEnv({
      permissions: {
        query: async () => {
          throw new Error('nope');
        },
      },
    });
    await expect(subscribeToWidgetPush(env)).resolves.toMatchObject({ status: 'failed' });
  });
});

describe('注销顺序', () => {
  it('🔴 先告诉服务端，再退本地的 —— 反了会留下永远删不掉的死行', async () => {
    const order: string[] = [];
    const { env } = fakeEnv({
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: async () => ({
              endpoint: 'https://push.example/e1',
              unsubscribe: async () => {
                order.push('local-unsubscribe');
                return true;
              },
            }),
            subscribe: async () => null,
          },
        }),
      },
      fetch: (async () => {
        order.push('server-delete');
        return jsonResponse(200, { ok: true, removed: 1 });
      }) as typeof fetch,
    });
    expect(await unsubscribeFromWidgetPush(env)).toEqual({ status: 'unsubscribed' });
    // 浏览器已经不再持有 endpoint ⇒ 再也没人能拿它来注销 ⇒ 那条服务端记录
    // 会变成**永远删不掉的死行**，而它每次同步都会被重试一次。
    expect(order).toEqual(['server-delete', 'local-unsubscribe']);
  });

  it('服务端说没这条订阅（removed: 0）时仍继续本地退订', async () => {
    const { env } = fakeEnv({
      fetch: (async () => jsonResponse(200, { ok: true, removed: 0 })) as typeof fetch,
    });
    expect(await unsubscribeFromWidgetPush(env)).toEqual({ status: 'unsubscribed' });
  });

  it('服务端 503 时仍继续本地退订（目标是「这台设备不再收推送」）', async () => {
    const { env } = fakeEnv({ fetch: (async () => jsonResponse(503, {})) as typeof fetch });
    expect(await unsubscribeFromWidgetPush(env)).toEqual({ status: 'unsubscribed' });
  });

  it('没有订阅时直接返回 unsubscribed', async () => {
    const { env } = fakeEnv({
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: { getSubscription: async () => null, subscribe: async () => null },
        }),
      },
    });
    expect(await unsubscribeFromWidgetPush(env)).toEqual({ status: 'unsubscribed' });
  });

  it('注销时服务端 400 → failed，且**不**退本地（否则留下死行）', async () => {
    let unsubscribed = false;
    const { env } = fakeEnv({
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: async () => ({
              endpoint: 'https://push.example/e1',
              unsubscribe: async () => {
                unsubscribed = true;
                return true;
              },
            }),
            subscribe: async () => null,
          },
        }),
      },
      fetch: (async () => jsonResponse(400, {})) as typeof fetch,
    });
    expect(await unsubscribeFromWidgetPush(env)).toMatchObject({ status: 'failed' });
    // 本地退掉但服务端没删 ⇒ 死行。所以这里必须**不**退。
    expect(unsubscribed).toBe(false);
  });

  it('非安全上下文 → unsupported', async () => {
    const { env } = fakeEnv({ isSecureContext: false });
    expect(await unsubscribeFromWidgetPush(env)).toMatchObject({ status: 'unsupported' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// probeWidgetPush：决定「开关画不画」
// ─────────────────────────────────────────────────────────────────────────────

describe('🔴 探测：能力不存在时**不画开关**', () => {
  it('非安全上下文 → available:false', async () => {
    const { env, calls } = fakeEnv({ isSecureContext: false });
    const probe = await probeWidgetPush(env);
    expect(probe.available).toBe(false);
    expect(calls).toEqual([]);
  });

  it('服务端 503 → available:false（自托管，面板整个不画）', async () => {
    const { env } = fakeEnv({ fetch: (async () => jsonResponse(503, {})) as typeof fetch });
    const probe = await probeWidgetPush(env);
    expect(probe.available).toBe(false);
    expect(probe.reason).toBe('server-not-configured');
  });

  it('🔴 权限已被拒 → available:false（留一个永远失败的开关只会让人反复点）', async () => {
    const { env, calls } = fakeEnv({
      permissions: { query: async () => ({ state: 'denied' }) },
    });
    const probe = await probeWidgetPush(env);
    expect(probe.available).toBe(false);
    // ⚠️ 而且**不该**再去问服务端 —— 权限已经没戏了。
    expect(calls).toEqual([]);
  });

  it('🔴 探测**绝不**调用 requestPermission（不能消耗用户的一次授权机会）', async () => {
    const { env, calls } = fakeEnv({
      permissions: { query: async () => ({ state: 'default' }) },
    });
    await probeWidgetPush(env);
    expect(calls).not.toContain('requestPermission');
  });

  it('已订阅时 subscribed:true', async () => {
    const { env } = fakeEnv();
    const probe = await probeWidgetPush(env);
    expect(probe).toEqual({ available: true, subscribed: true });
  });

  it('可用但未订阅时 subscribed:false', async () => {
    const { env } = fakeEnv({
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: { getSubscription: async () => null, subscribe: async () => null },
        }),
      },
    });
    const probe = await probeWidgetPush(env);
    expect(probe).toEqual({ available: true, subscribed: false });
  });

  it('🔴 探测失败时保守地不画（探测不出「在不在」比探测出「不在」更该保守）', async () => {
    const { env } = fakeEnv({
      fetch: (async () => {
        throw new Error('offline');
      }) as typeof fetch,
    });
    const probe = await probeWidgetPush(env);
    expect(probe.available).toBe(false);
  });

  it('permissions.query 不支持 notifications 时继续探测（那不是能力不可用）', async () => {
    const { env } = fakeEnv({
      permissions: {
        query: async () => {
          throw new Error('unsupported descriptor');
        },
      },
    });
    expect(await probeWidgetPush(env)).toEqual({ available: true, subscribed: true });
  });
});
