/**
 * 通行密钥的**浏览器那一步**
 * ==========================
 *
 * `@heyta/app-host` 的 `hosted-auth.ts` 已经提供了协议的两端（取 options / 交
 * credential），中间那一步平台调用 —— `navigator.credentials.create()/.get()` ——
 * 按设计留在宿主里。这个文件就是 Web 宿主的那一步。
 *
 * ## 为什么这一层必须单独存在，而不是塞进 app-host
 *
 * app-host 刻意把 options / credential 都当成 `Record<string, unknown>` 原样透传，
 * 就是为了**不引入 `@simplewebauthn` 依赖**（那要过 AGENTS.md §3.1–3.2 两道门）。
 * 而 `navigator.credentials` 只存在于浏览器，移动端是 Hermes/原生。
 * 所以：**协议在 app-host，平台调用在各宿主**。这里属于 Web 宿主。
 *
 * ## 这一层真正做的事情：JSON ↔ ArrayBuffer
 *
 * 🔴 WebAuthn 有两套不兼容的表示，而这个坑**不会以类型错误的形式出现**：
 *
 * | 位置 | 表示 |
 * |---|---|
 * | 服务端下发的 options（JSON） | `challenge` / `user.id` / `excludeCredentials[].id` 都是 **base64url 字符串** |
 * | `navigator.credentials.create()` 要的 | 同名字段必须是 **`ArrayBuffer`** |
 * | 服务端要回验的 credential（JSON） | `clientDataJSON` / `attestationObject` / `signature` / `userHandle` 都要 **base64url 字符串** |
 *
 * 直接把 JSON 丢给 `navigator.credentials` 会得到
 * `TypeError: Failed to execute 'create' on 'CredentialsContainer'`，
 * 而 `challenge` 传成字符串**在某些实现上不报错、只是验证必然失败** —— 更难查。
 * 所以转换写成两个**纯函数**，由 `tests/passkey-browser.spec.ts` 逐字段钉住。
 *
 * ## 失败是结果，不是异常
 *
 * 🔴 `navigator.credentials.create()` 在用户点"取消"时**抛 `NotAllowedError`**。
 * 如果让它冒出去，界面上就是白屏或未捕获异常。这里全部接住并归类成
 * `HostedAuthFailureReason` 的封闭集合（谁取消、谁不支持、谁已注册过，
 * 是**三句不同的、不能互相顶替的话**）。
 *
 * ## 可注入
 *
 * `navigator.credentials` 在 jsdom 里不存在，所以能力探测与两个方法都通过
 * `PasskeyBrowser` 注入；不传时才去拿真的 `navigator.credentials`。
 * 测试因此能覆盖"用户在弹窗里取消""设备不支持"这些**真机上很难复现**的分支。
 */

import type {
  HostedAuthFailureReason,
  HostedAuthOutcome,
  HostedPasskeyCredential,
  HostedPasskeyOptions,
} from '@heyta/app-host';

/** `navigator.credentials` 里我们真正用到的那两个方法 + 能力探测结果。 */
export interface PasskeyBrowser {
  /**
   * 设备是否支持通行密钥。`false` 时两个方法都不会被调用，
   * 直接判 `passkey-unsupported`（**一个请求都不发**）。
   */
  readonly supported: boolean;
  create: (publicKey: PublicKeyCredentialCreationOptions) => Promise<unknown>;
  get: (publicKey: PublicKeyCredentialRequestOptions) => Promise<unknown>;
}

// ── base64url 编解码（RFC 4648 §5，无 padding）──────────────────

/**
 * base64url → 字节。**不做"看起来像不像 base64"的猜测**：
 * 解不出来就抛，由调用方归类成 `malformed-response` —— 服务端给了坏 options
 * 是协议问题，不是用户问题。
 */
export function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = normalized.length % 4;
  if (remainder === 1) throw new Error('invalid base64url length');
  const padded = normalized + '='.repeat(remainder === 0 ? 0 : 4 - remainder);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 字节 → base64url，**去掉 `=` padding**（SimpleWebAuthn 与规范都是无 padding 的）。 */
export function toBase64Url(value: ArrayBuffer | Uint8Array): string {
  // 同样避开 `instanceof`（见 isArrayBuffer 的注释）。
  const view = toBytes(value) ?? new Uint8Array(0);
  let binary = '';
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i] as number);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 复制到一个**独立**的 `ArrayBuffer`。
 *
 * 🔴 不是多余的：`Uint8Array` 的底层可能是 `SharedArrayBuffer`，
 * 而 WebAuthn 的 `BufferSource` 不接受它；而 `new Uint8Array(view)` 会把
 * 整个底层 buffer 带上（带偏移时会多传字节）。必须按视图长度精确拷一份。
 */
function toBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(view.byteLength);
  new Uint8Array(copy).set(view);
  return copy;
}

/**
 * 跨 realm 的 `ArrayBuffer` 判定。
 *
 * 🔴 **不能用 `instanceof ArrayBuffer`**：它比较的是"哪个 realm 的构造函数"，
 * 而不是"是不是 ArrayBuffer"。jsdom 与 Node 混用（也就是我们的测试环境）时，
 * `new TextEncoder().encode('x').buffer` 是 **Node realm 的** ArrayBuffer，
 * 而 `instanceof` 右边是 **jsdom realm 的** `ArrayBuffer` ⇒ **假阴性**，
 * 于是所有凭据都被判成"缺字段"。WebView / iframe / worker 之间同理。
 *
 * `Object.prototype.toString` 走的是内部槽 `[[ArrayBufferData]]`，与 realm 无关。
 * 这一条是被 `tests/passkey-browser.spec.ts` 真的抓出来的（8 条一起红），
 * 不是预防性写法。
 */
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

/** 把任何一种二进制载体统一成 `Uint8Array`；不是二进制就返回 undefined。 */
function toBytes(value: unknown): Uint8Array | undefined {
  if (isArrayBuffer(value)) return new Uint8Array(value);
  // `ArrayBuffer.isView` 同样基于内部槽，跨 realm 安全 —— 它覆盖 TypedArray 与 DataView。
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);
  }
  return undefined;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

// ── options：服务端 JSON → WebAuthn 需要的形状 ──────────────────

/**
 * 注册 options → `PublicKeyCredentialCreationOptions`。
 *
 * 需要转 `ArrayBuffer` 的三个字段：`challenge`、`user.id`、`excludeCredentials[].id`。
 * 其余（`rp`、`pubKeyCredParams`、`authenticatorSelection`、`timeout`…）原样透传 ——
 * 我们**不解读**它们，服务端才是决定者。
 */
export function toCreationOptions(options: HostedPasskeyOptions): PublicKeyCredentialCreationOptions {
  const challenge = readString(options, 'challenge');
  const user = asRecord(options['user']);
  const userId = user === undefined ? undefined : readString(user, 'id');
  if (challenge === undefined || user === undefined || userId === undefined) {
    throw new Error('creation options missing challenge/user.id');
  }

  const excludeCredentials = Array.isArray(options['excludeCredentials'])
    ? options['excludeCredentials'].map((entry) => {
        const record = asRecord(entry);
        const id = record === undefined ? undefined : readString(record, 'id');
        if (record === undefined || id === undefined) {
          throw new Error('excludeCredentials entry missing id');
        }
        return { ...record, id: toBuffer(fromBase64Url(id)) };
      })
    : undefined;

  return {
    ...options,
    challenge: toBuffer(fromBase64Url(challenge)),
    user: { ...user, id: toBuffer(fromBase64Url(userId)) },
    ...(excludeCredentials === undefined ? {} : { excludeCredentials }),
  } as PublicKeyCredentialCreationOptions;
}

/**
 * 登录 options → `PublicKeyCredentialRequestOptions`。
 *
 * 只有 `challenge` 与 `allowCredentials[].id` 需要转。
 * ⚠️ 服务端**刻意不下发 `allowCredentials`**（可发现凭据，让系统弹窗列出
 * 该 RP 下所有通行密钥），所以这条分支经常是 undefined —— 它不是错误路径。
 */
export function toRequestOptions(
  options: HostedPasskeyOptions,
): PublicKeyCredentialRequestOptions {
  const challenge = readString(options, 'challenge');
  if (challenge === undefined) throw new Error('request options missing challenge');

  const allowCredentials = Array.isArray(options['allowCredentials'])
    ? options['allowCredentials'].map((entry) => {
        const record = asRecord(entry);
        const id = record === undefined ? undefined : readString(record, 'id');
        if (record === undefined || id === undefined) {
          throw new Error('allowCredentials entry missing id');
        }
        return { ...record, id: toBuffer(fromBase64Url(id)) };
      })
    : undefined;

  return {
    ...options,
    challenge: toBuffer(fromBase64Url(challenge)),
    ...(allowCredentials === undefined ? {} : { allowCredentials }),
  } as PublicKeyCredentialRequestOptions;
}

// ── credential：浏览器结果 → 服务端要回验的 JSON ────────────────

function readExtensions(credential: Record<string, unknown>): Record<string, unknown> {
  const getExtensions = credential['getClientExtensionResults'];
  if (typeof getExtensions !== 'function') return {};
  const result = (getExtensions as () => unknown).call(credential);
  return asRecord(result) ?? {};
}

function readAttachment(credential: Record<string, unknown>): string | undefined {
  const value = credential['authenticatorAttachment'];
  return typeof value === 'string' ? value : undefined;
}

function readRawId(credential: Record<string, unknown>): Uint8Array | undefined {
  return toBytes(credential['rawId']);
}

function readBuffer(record: Record<string, unknown>, key: string): Uint8Array | undefined {
  return toBytes(record[key]);
}

/**
 * 注册结果 → `RegistrationResponseJSON`。
 *
 * `id` 用 `base64url(rawId)`（不是 `credential.id`）：两者在新实现里相同，
 * 但**只有 rawId 是权威的**，而且服务端按它查库。
 * `transports` 从 `getTransports()` 取，服务端会存下来给后续登录提示用。
 */
export function serializeRegistration(credential: unknown): HostedPasskeyCredential {
  const record = asRecord(credential);
  const response = record === undefined ? undefined : asRecord(record['response']);
  if (record === undefined || response === undefined) {
    throw new Error('registration credential missing response');
  }

  const rawId = readRawId(record);
  const clientDataJSON = readBuffer(response, 'clientDataJSON');
  const attestationObject = readBuffer(response, 'attestationObject');
  if (rawId === undefined || clientDataJSON === undefined || attestationObject === undefined) {
    throw new Error('registration credential missing rawId/clientDataJSON/attestationObject');
  }

  const getTransports = response['getTransports'];
  const transports =
    typeof getTransports === 'function'
      ? (getTransports as () => unknown).call(response)
      : undefined;

  const attachment = readAttachment(record);
  return {
    id: toBase64Url(rawId),
    rawId: toBase64Url(rawId),
    type: typeof record['type'] === 'string' ? record['type'] : 'public-key',
    response: {
      clientDataJSON: toBase64Url(clientDataJSON),
      attestationObject: toBase64Url(attestationObject),
      ...(Array.isArray(transports) ? { transports } : {}),
    },
    clientExtensionResults: readExtensions(record),
    ...(attachment === undefined ? {} : { authenticatorAttachment: attachment }),
  };
}

/**
 * 登录结果 → `AuthenticationResponseJSON`。
 *
 * ⚠️ `userHandle` 只有可发现凭据才有，且**必须原样带回**（服务端用它做
 * "用户选的是哪个账号"的交叉校验）。`null` 与"不存在"要区分：这里统一
 * 只在拿到字节时才写字段，避免把 `null` 序列化成字符串 `"null"`。
 */
export function serializeAuthentication(credential: unknown): HostedPasskeyCredential {
  const record = asRecord(credential);
  const response = record === undefined ? undefined : asRecord(record['response']);
  if (record === undefined || response === undefined) {
    throw new Error('authentication credential missing response');
  }

  const rawId = readRawId(record);
  const clientDataJSON = readBuffer(response, 'clientDataJSON');
  const authenticatorData = readBuffer(response, 'authenticatorData');
  const signature = readBuffer(response, 'signature');
  if (
    rawId === undefined ||
    clientDataJSON === undefined ||
    authenticatorData === undefined ||
    signature === undefined
  ) {
    throw new Error('authentication credential missing rawId/clientDataJSON/authenticatorData/signature');
  }

  const userHandle = readBuffer(response, 'userHandle');
  const attachment = readAttachment(record);
  return {
    id: toBase64Url(rawId),
    rawId: toBase64Url(rawId),
    type: typeof record['type'] === 'string' ? record['type'] : 'public-key',
    response: {
      clientDataJSON: toBase64Url(clientDataJSON),
      authenticatorData: toBase64Url(authenticatorData),
      signature: toBase64Url(signature),
      ...(userHandle === undefined ? {} : { userHandle: toBase64Url(userHandle) }),
    },
    clientExtensionResults: readExtensions(record),
    ...(attachment === undefined ? {} : { authenticatorAttachment: attachment }),
  };
}

// ── 能力探测与错误归类 ─────────────────────────────────────────

/**
 * 拿真的 `navigator.credentials`。**两个条件都要满足**：
 *
 * 🔴 只看 `navigator.credentials` 不够 —— 某些 WebView 与旧 Safari 有
 * `credentials` 但没有 `PublicKeyCredential`，只判前者会在点下按钮之后
 * 才炸在 `create()` 里。而且这里判 `undefined` **不发任何请求**（fail-safe，
 * 与 app-host 里 `baseUrl` 为空时不发请求同一形状）。
 */
export function detectPasskeyBrowser(): PasskeyBrowser | undefined {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  const credentials = nav === undefined ? undefined : nav.credentials;
  if (credentials === undefined || credentials === null) return undefined;
  if (typeof (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential === 'undefined') {
    return undefined;
  }
  return {
    supported: true,
    create: (publicKey) => credentials.create({ publicKey }),
    get: (publicKey) => credentials.get({ publicKey }),
  };
}

/**
 * 把 WebAuthn 抛出来的 `DOMException` 归类成封闭集合里的一条。
 *
 * 这几条**不能互相顶替**，所以逐个映射：
 *   - `NotAllowedError` / `AbortError` → 用户取消或超时；
 *   - `InvalidStateError` → 这台设备已经注册过（`excludeCredentials` 命中）；
 *   - `NotSupportedError` / `SecurityError` → 算法/环境不支持
 *     （`SecurityError` 常见于 RP ID 与当前域不匹配 —— 那是配置问题，
 *     但用户在设备上能做的动作与"不支持"相同：换一条路）；
 *   - `UnknownError` / 其它 → 保守归到"取消"这一侧？
 *     ❌ 不行。归到"取消"会把"设备内部出错"说成"你取消了"。
 *     归到 `passkey-unsupported`—— 也不准确。
 *     这两条都会让界面说假话，所以默认落到**确实说不出更具体的话**的那条：
 *     `request-rejected`（面板的 `default` 分支兜底成中性文案）。
 */
export function classifyCredentialError(error: unknown): HostedAuthFailureReason {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  if (name === 'InvalidStateError') return 'passkey-already-registered';
  if (name === 'NotAllowedError' || name === 'AbortError') return 'passkey-cancelled';
  if (name === 'NotSupportedError' || name === 'SecurityError') return 'passkey-unsupported';
  return 'request-rejected';
}

// ── 对外的两个动作 ─────────────────────────────────────────────

/** 取注册 options → 让系统弹窗创建 → 序列化成服务端能回验的 JSON。 */
export async function createPasskeyCredential(
  options: HostedPasskeyOptions,
  browser: PasskeyBrowser | undefined = detectPasskeyBrowser(),
): Promise<HostedAuthOutcome<{ credential: HostedPasskeyCredential }>> {
  if (browser === undefined || !browser.supported) {
    return { ok: false, reason: 'passkey-unsupported' };
  }

  let creationOptions: PublicKeyCredentialCreationOptions;
  try {
    creationOptions = toCreationOptions(options);
  } catch {
    return { ok: false, reason: 'malformed-response' };
  }

  let credential: unknown;
  try {
    credential = await browser.create(creationOptions);
  } catch (error) {
    return { ok: false, reason: classifyCredentialError(error) };
  }
  if (credential === null || credential === undefined) {
    return { ok: false, reason: 'passkey-cancelled' };
  }

  try {
    return { ok: true, credential: serializeRegistration(credential) };
  } catch {
    return { ok: false, reason: 'malformed-response' };
  }
}

/** 取登录 options → 让系统弹窗选一把 → 序列化成服务端能回验的 JSON。 */
export async function getPasskeyCredential(
  options: HostedPasskeyOptions,
  browser: PasskeyBrowser | undefined = detectPasskeyBrowser(),
): Promise<HostedAuthOutcome<{ credential: HostedPasskeyCredential }>> {
  if (browser === undefined || !browser.supported) {
    return { ok: false, reason: 'passkey-unsupported' };
  }

  let requestOptions: PublicKeyCredentialRequestOptions;
  try {
    requestOptions = toRequestOptions(options);
  } catch {
    return { ok: false, reason: 'malformed-response' };
  }

  let credential: unknown;
  try {
    credential = await browser.get(requestOptions);
  } catch (error) {
    return { ok: false, reason: classifyCredentialError(error) };
  }
  if (credential === null || credential === undefined) {
    return { ok: false, reason: 'passkey-cancelled' };
  }

  try {
    return { ok: true, credential: serializeAuthentication(credential) };
  } catch {
    return { ok: false, reason: 'malformed-response' };
  }
}
