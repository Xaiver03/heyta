/**
 * 通行密钥浏览器接线：转换层 + 归类层
 * ====================================
 *
 * 这一层的风险**不在"能不能跑通"**，而在"跑通了但字节是错的"：
 * `challenge` 传成字符串时，某些实现不报错、只是服务端验证必然失败。
 * 所以下面逐字段断言**真实字节**，而不是断言"调用了 create"。
 *
 * jsdom 里没有 `navigator.credentials`，所以能力探测与两个方法都是注入的 ——
 * 这正好让"用户在弹窗里取消""设备不支持"这些**真机上很难复现**的分支可测。
 */

import { describe, expect, it, vi } from 'vitest';

import {
  classifyCredentialError,
  createPasskeyCredential,
  detectPasskeyBrowser,
  fromBase64Url,
  getPasskeyCredential,
  serializeAuthentication,
  serializeRegistration,
  toBase64Url,
  toCreationOptions,
  toRequestOptions,
  type PasskeyBrowser,
} from '../src/features/auth/passkey-browser.js';

/** 已知向量：`"hi"` 的 base64url 是 `aGk`（无 padding）。 */
const CHALLENGE_B64 = 'aGk';
const CHALLENGE_BYTES = [0x68, 0x69];

/**
 * 取字节。
 *
 * ⚠️ 参数类型是 `BufferSource`，不是 `ArrayBuffer`：lib.dom 把
 * `challenge` / `user.id` / `excludeCredentials[].id` 都标成了 `BufferSource`，
 * 只接受 `ArrayBuffer` 的 helper 会在这里编译不过（而**运行期是好的**，
 * 所以这是那种"测试全绿但 typecheck 红"的错）。
 */
function bytes(value: ArrayBuffer | ArrayBufferView): number[] {
  const view = ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value as ArrayBuffer);
  return [...view];
}

function bufferOf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function fakeBrowser(overrides: Partial<PasskeyBrowser> = {}): PasskeyBrowser {
  return {
    supported: true,
    create: vi.fn().mockResolvedValue(null),
    get: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('base64url 编解码', () => {
  it('解码无 padding 的 base64url', () => {
    expect([...fromBase64Url(CHALLENGE_B64)]).toEqual(CHALLENGE_BYTES);
  });

  it('解码含 - 与 _ 的 base64url（而不是把它们当成非法字符）', () => {
    // 真值取自 `Buffer.from([0xfb,0xff,0xbf,0xbf]).toString('base64url')` → `-_-_vw`。
    // 这两个字符正是 base64url 与标准 base64 的唯一差别所在。
    expect([...fromBase64Url('-_-_vw')]).toEqual([0xfb, 0xff, 0xbf, 0xbf]);
  });

  it('编码结果不含 + / = —— 带了就不再是 base64url', () => {
    const encoded = toBase64Url(new Uint8Array([0xfb, 0xff, 0xbf, 0xbf]));
    expect(encoded).toBe('-_-_vw');
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('无 padding：标准 base64 的 = 必须被去掉', () => {
    // `Buffer.from([0x68,0x69]).toString('base64')` === 'aGk='，url 变体是 'aGk'
    expect(toBase64Url(new Uint8Array([0x68, 0x69]))).toBe('aGk');
  });

  it('往返一致', () => {
    const raw = new Uint8Array([0, 1, 2, 250, 251, 255]);
    expect([...fromBase64Url(toBase64Url(raw))]).toEqual([...raw]);
  });

  it('长度为 4k+1 的输入直接抛，而不是悄悄解出错误的字节', () => {
    expect(() => fromBase64Url('a')).toThrow();
  });
});

describe('toCreationOptions：JSON 字符串 → ArrayBuffer', () => {
  const options = {
    challenge: CHALLENGE_B64,
    rp: { id: 'example.com', name: 'heyta' },
    user: { id: 'dXNlcg', name: 'a@b.c', displayName: 'A' },
    pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
    excludeCredentials: [{ id: 'b2xk', type: 'public-key', transports: ['internal'] }],
    timeout: 60_000,
  };

  it('challenge 变成 ArrayBuffer 且字节正确（这是最容易错的一个）', () => {
    const converted = toCreationOptions(options);
    expect(converted.challenge).toBeInstanceOf(ArrayBuffer);
    expect(bytes(converted.challenge)).toEqual(CHALLENGE_BYTES);
  });

  it('user.id 变成 ArrayBuffer，user 的其它字段原样保留', () => {
    const converted = toCreationOptions(options);
    expect(converted.user.id).toBeInstanceOf(ArrayBuffer);
    expect(bytes(converted.user.id)).toEqual([...fromBase64Url('dXNlcg')]);
    expect(converted.user.name).toBe('a@b.c');
    expect(converted.user.displayName).toBe('A');
  });

  it('excludeCredentials[].id 变成 ArrayBuffer，transports 原样保留', () => {
    const converted = toCreationOptions(options);
    const excluded = converted.excludeCredentials ?? [];
    expect(excluded).toHaveLength(1);
    expect(excluded[0]?.id).toBeInstanceOf(ArrayBuffer);
    expect([...(new Uint8Array(excluded[0]?.id as ArrayBuffer) as Uint8Array)]).toEqual([
      ...fromBase64Url('b2xk'),
    ]);
    expect((excluded[0] as { transports?: string[] }).transports).toEqual(['internal']);
  });

  it('我们不解读的字段原样透传（rp / pubKeyCredParams / timeout）', () => {
    const converted = toCreationOptions(options) as unknown as Record<string, unknown>;
    expect(converted['rp']).toEqual({ id: 'example.com', name: 'heyta' });
    expect(converted['pubKeyCredParams']).toEqual([{ alg: -7, type: 'public-key' }]);
    expect(converted['timeout']).toBe(60_000);
  });

  it('缺 challenge 或 user.id 时抛（坏 options 是协议问题，不许猜）', () => {
    expect(() => toCreationOptions({ user: { id: 'dXNlcg' } })).toThrow();
    expect(() => toCreationOptions({ challenge: CHALLENGE_B64, user: {} })).toThrow();
  });
});

describe('toRequestOptions', () => {
  it('challenge 变 ArrayBuffer', () => {
    const converted = toRequestOptions({ challenge: CHALLENGE_B64, rpId: 'example.com' });
    expect(bytes(converted.challenge)).toEqual(CHALLENGE_BYTES);
    expect((converted as { rpId?: string }).rpId).toBe('example.com');
  });

  it('🔴 没有 allowCredentials 是**正常路径**（可发现凭据），不是错误', () => {
    const converted = toRequestOptions({ challenge: CHALLENGE_B64 }) as unknown as Record<
      string,
      unknown
    >;
    expect('allowCredentials' in converted).toBe(false);
  });

  it('有 allowCredentials 时逐个转 ArrayBuffer', () => {
    const converted = toRequestOptions({
      challenge: CHALLENGE_B64,
      allowCredentials: [{ id: 'b2xk', type: 'public-key' }],
    });
    const allowed = converted.allowCredentials ?? [];
    expect(allowed[0]?.id).toBeInstanceOf(ArrayBuffer);
  });
});

describe('serializeRegistration', () => {
  const rawId = new Uint8Array([0x01, 0x02, 0x03]);

  function registrationCredential(overrides: Record<string, unknown> = {}): unknown {
    return {
      id: 'ignored-because-rawId-is-authoritative',
      rawId: rawId.buffer,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      getClientExtensionResults: () => ({ credProps: { rk: true } }),
      response: {
        clientDataJSON: bufferOf('client-data'),
        attestationObject: bufferOf('attestation'),
        getTransports: () => ['internal', 'hybrid'],
      },
      ...overrides,
    };
  }

  it('id 用 base64url(rawId)，**不是** credential.id', () => {
    const serialized = serializeRegistration(registrationCredential());
    expect(serialized['id']).toBe(toBase64Url(rawId));
    expect(serialized['rawId']).toBe(toBase64Url(rawId));
    expect(serialized['id']).not.toBe('ignored-because-rawId-is-authoritative');
  });

  it('三个二进制字段都序列化成 base64url 字符串', () => {
    const serialized = serializeRegistration(registrationCredential());
    const response = serialized['response'] as Record<string, unknown>;
    expect(typeof response['clientDataJSON']).toBe('string');
    expect(fromBase64Url(response['clientDataJSON'] as string)).toEqual(
      new Uint8Array(bufferOf('client-data')),
    );
    expect(fromBase64Url(response['attestationObject'] as string)).toEqual(
      new Uint8Array(bufferOf('attestation')),
    );
  });

  it('transports 与 clientExtensionResults 带回去（服务端要存它们）', () => {
    const serialized = serializeRegistration(registrationCredential());
    expect((serialized['response'] as Record<string, unknown>)['transports']).toEqual([
      'internal',
      'hybrid',
    ]);
    expect(serialized['clientExtensionResults']).toEqual({ credProps: { rk: true } });
  });

  it('缺 attestationObject 时抛，而不是序列化出半个凭据', () => {
    expect(() =>
      serializeRegistration(
        registrationCredential({
          response: { clientDataJSON: bufferOf('x'), getTransports: () => [] },
        }),
      ),
    ).toThrow();
  });
});

describe('serializeAuthentication', () => {
  const rawId = new Uint8Array([0x09, 0x08]);

  function assertionCredential(response: Record<string, unknown>): unknown {
    return {
      rawId: rawId.buffer,
      type: 'public-key',
      getClientExtensionResults: () => ({}),
      response: {
        clientDataJSON: bufferOf('cd'),
        authenticatorData: bufferOf('ad'),
        signature: bufferOf('sig'),
        ...response,
      },
    };
  }

  it('四个二进制字段都变成 base64url', () => {
    const serialized = serializeAuthentication(
      assertionCredential({ userHandle: bufferOf('handle') }),
    );
    const response = serialized['response'] as Record<string, unknown>;
    expect(typeof response['authenticatorData']).toBe('string');
    expect(typeof response['signature']).toBe('string');
    expect(fromBase64Url(response['signature'] as string)).toEqual(new Uint8Array(bufferOf('sig')));
  });

  it('🔴 userHandle 为 null 时**不写该字段**（写成字符串 "null" 会让服务端解不出来）', () => {
    const serialized = serializeAuthentication(assertionCredential({ userHandle: null }));
    const response = serialized['response'] as Record<string, unknown>;
    expect('userHandle' in response).toBe(false);
  });

  it('userHandle 有值时原样带回', () => {
    const serialized = serializeAuthentication(
      assertionCredential({ userHandle: bufferOf('handle') }),
    );
    const response = serialized['response'] as Record<string, unknown>;
    expect(fromBase64Url(response['userHandle'] as string)).toEqual(
      new Uint8Array(bufferOf('handle')),
    );
  });
});

describe('classifyCredentialError：三句不同的话不能互相顶替', () => {
  it('NotAllowedError（用户取消）→ passkey-cancelled', () => {
    expect(classifyCredentialError({ name: 'NotAllowedError' })).toBe('passkey-cancelled');
  });

  it('InvalidStateError（本机已注册过）→ passkey-already-registered，**不是** cancelled', () => {
    expect(classifyCredentialError({ name: 'InvalidStateError' })).toBe(
      'passkey-already-registered',
    );
  });

  it('NotSupportedError → passkey-unsupported', () => {
    expect(classifyCredentialError({ name: 'NotSupportedError' })).toBe('passkey-unsupported');
  });

  it('🔴 未知错误不冒充"用户取消"（否则界面会说你取消了，其实你没取消）', () => {
    expect(classifyCredentialError({ name: 'UnknownError' })).toBe('request-rejected');
    expect(classifyCredentialError(new Error('boom'))).toBe('request-rejected');
    expect(classifyCredentialError(undefined)).toBe('request-rejected');
  });
});

describe('createPasskeyCredential / getPasskeyCredential', () => {
  const options = { challenge: CHALLENGE_B64, user: { id: 'dXNlcg' } };

  it('🔴 设备不支持时判 passkey-unsupported，且**一次都不调用** create', async () => {
    const browser = fakeBrowser({ supported: false });
    const outcome = await createPasskeyCredential(options, browser);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toBe('passkey-unsupported');
    expect(browser.create).not.toHaveBeenCalled();
  });

  it('没有 browser（jsdom / 旧 WebView）时同样不调用、不抛', async () => {
    const outcome = await createPasskeyCredential(options, undefined);
    expect(outcome.ok === false && outcome.reason).toBe('passkey-unsupported');
  });

  it('用户取消（create 抛 NotAllowedError）时是结果，不是未捕获异常', async () => {
    const browser = fakeBrowser({
      create: vi.fn().mockRejectedValue({ name: 'NotAllowedError' }),
    });
    const outcome = await createPasskeyCredential(options, browser);
    expect(outcome.ok === false && outcome.reason).toBe('passkey-cancelled');
  });

  it('create 返回 null（用户关掉弹窗）→ passkey-cancelled', async () => {
    const outcome = await createPasskeyCredential(options, fakeBrowser());
    expect(outcome.ok === false && outcome.reason).toBe('passkey-cancelled');
  });

  it('坏 options 判 malformed-response，且不调用 create', async () => {
    const browser = fakeBrowser();
    const outcome = await createPasskeyCredential({ user: { id: 'dXNlcg' } }, browser);
    expect(outcome.ok === false && outcome.reason).toBe('malformed-response');
    expect(browser.create).not.toHaveBeenCalled();
  });

  it('成功路径把 challenge 真的转成了 ArrayBuffer 再交给平台', async () => {
    const create = vi.fn().mockResolvedValue({
      rawId: new Uint8Array([1]).buffer,
      type: 'public-key',
      getClientExtensionResults: () => ({}),
      response: {
        clientDataJSON: bufferOf('cd'),
        attestationObject: bufferOf('ao'),
        getTransports: () => [],
      },
    });
    const outcome = await createPasskeyCredential(options, fakeBrowser({ create }));
    expect(outcome.ok).toBe(true);
    const passed = create.mock.calls[0]?.[0] as PublicKeyCredentialCreationOptions;
    expect(passed.challenge).toBeInstanceOf(ArrayBuffer);
    expect(bytes(passed.challenge)).toEqual(CHALLENGE_BYTES);
  });

  it('登录同理：不支持时不调用 get；成功时 challenge 是 ArrayBuffer', async () => {
    const unsupported = fakeBrowser({ supported: false });
    expect((await getPasskeyCredential(options, unsupported)).ok).toBe(false);
    expect(unsupported.get).not.toHaveBeenCalled();

    const get = vi.fn().mockResolvedValue({
      rawId: new Uint8Array([1]).buffer,
      type: 'public-key',
      getClientExtensionResults: () => ({}),
      response: {
        clientDataJSON: bufferOf('cd'),
        authenticatorData: bufferOf('ad'),
        signature: bufferOf('sig'),
      },
    });
    const outcome = await getPasskeyCredential(options, fakeBrowser({ get }));
    expect(outcome.ok).toBe(true);
    const passed = get.mock.calls[0]?.[0] as PublicKeyCredentialRequestOptions;
    expect(bytes(passed.challenge)).toEqual(CHALLENGE_BYTES);
  });
});

describe('detectPasskeyBrowser', () => {
  it('jsdom 里（没有 navigator.credentials）返回 undefined 而不是抛', () => {
    expect(detectPasskeyBrowser()).toBeUndefined();
  });
});
