import { argon2idAsync as argon2idNobleJs } from '@noble/hashes/argon2.js';
import { argon2id as argon2idWasm } from 'hash-wasm';
import { KEY_LENGTH, SALT_LENGTH, getRandomBytes } from './web-crypto';

// These parameters (and the salt|iv|ciphertext wire format in encryption.ts)
// are a cross-platform contract: every device that derives a key from the same
// password must get the same bytes, or it cannot read what another device wrote.
// If you change them, update the known-answer vector in
// `tests/argon2-known-answer.spec.ts` **in the same PR** — that test is what
// makes this contract enforced instead of merely documented.
const DEFAULT_ARGON2_PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 65536, // 64 MB - memorySize is in KiB
};

let _argon2Params = { ...DEFAULT_ARGON2_PARAMS };

/**
 * Returns a snapshot of the current Argon2 parameters.
 * Tests can override via `setArgon2ParamsForTesting()`.
 */
export const getArgon2Params = (): typeof DEFAULT_ARGON2_PARAMS => ({
  ..._argon2Params,
});

/**
 * Override Argon2 parameters for testing (use weak params to speed up tests).
 * Pass `undefined` to restore defaults.
 *
 * Throws when called in a Node-side production build (`NODE_ENV === 'production'`).
 * The check is a no-op in browser bundles where `process` is undefined; the
 * function name itself is the contract for those environments.
 */
export const setArgon2ParamsForTesting = (
  params?: Partial<typeof DEFAULT_ARGON2_PARAMS>,
): void => {
  const env = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env
    ?.NODE_ENV;
  if (env === 'production') {
    throw new Error('setArgon2ParamsForTesting must not be called in production');
  }
  _argon2Params = params
    ? { ...DEFAULT_ARGON2_PARAMS, ...params }
    : { ...DEFAULT_ARGON2_PARAMS };
};

// ============================================================================
// 后端选择：WASM 优先，纯 JS 兜底
// ============================================================================
/**
 * 🔴 **为什么这里必须有两条实现。**
 *
 * Argon2id 原来只有一条实现：`hash-wasm` —— 一个 **WebAssembly** 模块。
 * 而 **Hermes（React Native 的 JS 引擎）不支持 WebAssembly**。真机实测，
 * 移动端点「立即同步」得到的是：
 *
 *     WebAssembly is not supported in this environment!
 *
 * 于是移动端**一条数据都同步不出去** —— 而界面完全正常，报错又长得像基础设施
 * 问题，很容易被误判成同步协议的事。见 `AGENTS.md` §7 第 26 条。
 *
 * 这和 `web-crypto.ts` 里 AES-GCM 的处理是**同一个形状**：那边也是
 * 「有 `crypto.subtle` 就用，没有就退到 `@noble/ciphers` 的纯 JS 实现」。
 * 这里只是把同样的写法补到 KDF 上。少了一条腿的那条腿，就是所有设备里
 * 唯独不支持 WebAssembly 的那一类会踩到的坑。
 *
 * ## 为什么纯 JS 是**正确**的兜底，而不是"降级后可能算错"
 *
 * 两种实现已在生产参数下比对过**逐字节相同**：
 *
 *     6ad10af97f1744119bd7135c85121dc589794f9c5d646200b8ad4d6becf15084
 *
 * 这条向量被 `tests/argon2-known-answer.spec.ts` 钉住，**两种后端都要过它**。
 * 所以兜底换掉的是**速度**，不是**语义**。
 *
 * ## 兜底换掉的速度是多少（这是真实代价，不要粉饰）
 *
 * 实测（V8 / Apple Silicon）：64 MiB、3 轮下纯 JS 要 **3.9–6.8 秒**。
 * Hermes 没有 JIT，同样的循环会慢一个数量级 → **手机上数十秒量级**。
 *
 * 因此这条路径：
 *   1. 走 `argon2idAsync` 而不是同步版 —— 它在内部 `await` 让出事件循环，
 *      **界面不会冻住**（同步版会把 JS 线程占满，那才是真正的 ANR 形状）；
 *   2. 通过 `onProgress` 把进度报给调用方，可以显示真实进度条。
 *
 * ⚠️ **不要把"有兜底"读成"手机上性能没问题"。** 能在手机上跑完且不冻结，
 * 与"体验可接受"是两件事。真机耗时必须实测，不能估算。
 */
export type Argon2Backend = 'wasm' | 'js';

/** 当前运行时实际会用的后端。不需要真的派生一次就能问出来。 */
export const getArgon2Backend = (): Argon2Backend =>
  typeof WebAssembly === 'undefined' ? 'js' : 'wasm';

/** 纯 JS 兜底预计很慢 —— 调用方可以据此先给用户一个提示。 */
export const isArgon2SlowBackend = (): boolean => getArgon2Backend() === 'js';

/** 传给后端的全部输入。后端实现只能看这个对象，不得依赖模块内部状态。 */
export interface Argon2Input {
  password: string;
  salt: Uint8Array;
  hashLength: number;
  parallelism: number;
  iterations: number;
  memorySize: number;
  onProgress?: (progress: number) => void;
}

export type Argon2Provider = (input: Argon2Input) => Promise<Uint8Array>;

let _provider: Argon2Provider | undefined;

/**
 * 注入自定义后端（宿主有原生实现时可以覆盖默认选择）。
 *
 * 传 `undefined` 恢复默认（WASM 优先、纯 JS 兜底）。
 *
 * ⚠️ 被注入的实现**同样要过已知答案向量**。这条接缝存在的意义就是"换实现"，
 * 而换实现正是最容易静默破坏跨设备兼容的操作 —— 换错了不会报错，
 * 只会让别的设备解不开数据。
 */
export const setArgon2Provider = (provider: Argon2Provider | undefined): void => {
  _provider = provider;
};

export const getArgon2Provider = (): Argon2Provider | undefined => _provider;

/**
 * 让出事件循环。
 *
 * 纯 JS 的 `argon2idAsync` 内部会 `await`，但进入它之前先让一次，
 * 能保证调用方画的"正在派生密钥…"有机会先渲染出来 —— 否则用户看到的是
 * 一段没有任何反馈的等待。
 */
const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const deriveKeyBytesArgon = async (
  password: string,
  salt: Uint8Array,
  onProgress?: (progress: number) => void,
): Promise<Uint8Array> => {
  const input: Argon2Input = {
    password,
    salt,
    hashLength: KEY_LENGTH,
    parallelism: _argon2Params.parallelism,
    iterations: _argon2Params.iterations,
    memorySize: _argon2Params.memorySize,
    onProgress,
  };

  if (_provider) {
    return _provider(input);
  }

  if (getArgon2Backend() === 'wasm') {
    // WASM 很快（数十到数百毫秒），报进度反而增加噪音。
    return argon2idWasm({
      password,
      salt,
      hashLength: input.hashLength,
      parallelism: input.parallelism,
      iterations: input.iterations,
      memorySize: input.memorySize,
      outputType: 'binary',
    });
  }

  await yieldToEventLoop();
  // `m` 是 KiB、`t` 是轮数、`p` 是并行度 —— 与上面的参数逐一对应。
  // 这个映射不是猜的：它由已知答案向量钉住（见本文件顶部）。
  return argon2idNobleJs(password, salt, {
    t: input.iterations,
    m: input.memorySize,
    p: input.parallelism,
    dkLen: input.hashLength,
    onProgress,
  });
};

/**
 * A key derived from a password via Argon2id, plus the salt used to derive it.
 * Reusable across many encrypt/decrypt calls (only IVs need to be unique).
 */
export interface DerivedKey {
  keyBytes: Uint8Array;
  salt: Uint8Array;
}

/**
 * Derives a key from password using Argon2id. Returns the derived bytes plus
 * the salt for reuse across multiple encrypt operations.
 *
 * @param password The encryption password
 * @param salt Optional salt; if not provided, generates a random 16-byte salt
 * @param options Optional progress reporting. Only the pure-JS fallback reports
 *   meaningful intermediate values; the WASM path finishes in one step.
 */
export const deriveKeyFromPassword = async (
  password: string,
  salt?: Uint8Array,
  options?: { onProgress?: (progress: number) => void },
): Promise<DerivedKey> => {
  const actualSalt = salt ?? getRandomBytes(SALT_LENGTH);
  const keyBytes = await deriveKeyBytesArgon(password, actualSalt, options?.onProgress);
  return { keyBytes, salt: actualSalt };
};