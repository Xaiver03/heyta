/**
 * `vitest` 的**最小替身**，好让 `packages/storage/tests/contract/*.contract.ts`
 * **一个字都不改**地跑进 Jint。
 *
 * 为什么值得这么做（而不是"照着契约再写一遍断言"）：
 *   契约的价值**全部**在于"同一套断言跑遍所有实现"。如果 C# 侧另写一套断言，
 *   测的是"实现者的假设"，不是接口本身 —— 那正是
 *   `packages/storage/tests/contract.spec.ts` 文件头明确禁止的事。
 *
 * 覆盖面是按**实测**选的，不是猜的：两个契约文件里用到的 API 只有
 *   `describe` / `it` / `expect`，
 * 匹配器只有 `toBe` / `toEqual` / `toHaveLength` / `toBeDefined` /
 * `toBeUndefined` / `toBeGreaterThanOrEqual` / `.not` / `resolves.toMatchObject(...)`,
 * `expect.any(...)`，外加 `rejects.toThrow(...)`。
 * **没有任何生命周期钩子**（无 beforeEach/afterEach），所以替身不需要它们。
 *
 * ⚠️ 这是替身，不是 vitest：断言失败时的报错文案与 vitest 不同。
 *    语义对齐的是**通过/不通过**，不是错误文本。
 */

export interface TestRecord {
  suite: string;
  name: string;
  ok: boolean;
  error: string | null;
}

const records: TestRecord[] = [];
const pending: Promise<void>[] = [];
const suiteStack: string[] = [];

export function resetResults(): void {
  records.length = 0;
  pending.length = 0;
  suiteStack.length = 0;
}

export function describe(name: string, fn: () => void): void {
  suiteStack.push(name);
  try {
    fn();
  } finally {
    suiteStack.pop();
  }
}

export function it(name: string, fn: () => unknown): void {
  const record: TestRecord = { suite: suiteStack.join(' > '), name, ok: false, error: null };
  records.push(record);
  try {
    const outcome = fn();
    if (outcome !== null && typeof outcome === 'object' && typeof (outcome as PromiseLike<unknown>).then === 'function') {
      pending.push(
        Promise.resolve(outcome).then(
          () => {
            record.ok = true;
          },
          (error: unknown) => {
            record.error = describeError(error);
          },
        ),
      );
    } else {
      record.ok = true;
    }
  } catch (error) {
    record.error = describeError(error);
  }
}

/** 等所有 `it` 的异步体跑完。**必须在两个 runner 都返回之后调用。** */
export function settle(): Promise<void[]> {
  return Promise.all(pending);
}

export function report(): {
  total: number;
  passed: number;
  failed: number;
  failures: Array<{ suite: string; name: string; error: string | null }>;
} {
  const failed = records.filter((r) => !r.ok);
  return {
    total: records.length,
    passed: records.length - failed.length,
    failed: failed.length,
    failures: failed.map((r) => ({ suite: r.suite, name: r.name, error: r.error })),
  };
}

const describeError = (error: unknown): string => {
  if (error === null || error === undefined) return String(error);
  if (typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(error);
};

const show = (value: unknown): string => {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/**
 * vitest 的 `toEqual` 语义：**忽略值为 `undefined` 的键**（`{a:1}` 等于 `{a:1,b:undefined}`）。
 * 这个细节在该契约里是真的会碰到的 —— 记录里带不带 `deletedAt` 之类的可选字段
 * 取决于写入路径，如果按"键集合必须完全相等"实现，会报一堆假失败。
 */
const deepEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;

  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (aIsArray) {
    const left = a as unknown[];
    const right = b as unknown[];
    if (left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
    if (a.length !== b.length) return false;
    return a.every((byte, index) => byte === b[index]);
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keysOf = (o: Record<string, unknown>) =>
    Object.keys(o).filter((k) => o[k] !== undefined);
  const leftKeys = keysOf(left);
  const rightKeys = keysOf(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]));
};

const fail = (message: string): never => {
  throw new Error(message);
};

const ASYMMETRIC = Symbol('vitest-shim-asymmetric');
type AsymmetricMatcher = {
  readonly [ASYMMETRIC]: (actual: unknown) => boolean;
  readonly description: string;
};

function isAsymmetricMatcher(value: unknown): value is AsymmetricMatcher {
  return typeof value === 'object' && value !== null && ASYMMETRIC in value;
}

/** `toMatchObject` 的递归子集语义，另支持 `expect.any(...)`。 */
function matchesObject(actual: unknown, expected: unknown): boolean {
  if (isAsymmetricMatcher(expected)) return expected[ASYMMETRIC](actual);
  if (Object.is(actual, expected)) return true;
  if (expected === null || typeof expected !== 'object' || actual === null || typeof actual !== 'object') {
    return false;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((item, index) => matchesObject(actual[index], item));
  }
  if (Array.isArray(actual)) return false;
  const expectedRecord = expected as Record<string, unknown>;
  const actualRecord = actual as Record<string, unknown>;
  return Object.keys(expectedRecord).every(
    (key) => Object.hasOwn(actualRecord, key) && matchesObject(actualRecord[key], expectedRecord[key]),
  );
}

function asymmetricAny(expectedType: unknown): AsymmetricMatcher {
  if (typeof expectedType !== 'function') {
    throw new TypeError(`expect.any 需要构造器，实得 ${show(expectedType)}`);
  }
  const name = (expectedType as { name?: unknown }).name;
  return {
    [ASYMMETRIC]: (actual: unknown) => {
      if (expectedType === Number) return typeof actual === 'number' || actual instanceof Number;
      if (expectedType === String) return typeof actual === 'string' || actual instanceof String;
      if (expectedType === Boolean) return typeof actual === 'boolean' || actual instanceof Boolean;
      return actual instanceof (expectedType as abstract new (...args: never[]) => unknown);
    },
    description: `Any<${typeof name === 'string' ? name : 'unknown'}>`,
  };
}

export function expect(actual: unknown): Record<string, unknown> {
  const expectAny = actual as never;

  const matchers: Record<string, unknown> = {
    toBe(expected: unknown) {
      if (!Object.is(actual, expected)) {
        fail(`toBe 失败：期望 ${show(expected)}，实得 ${show(actual)}`);
      }
    },
    toEqual(expected: unknown) {
      if (!deepEqual(actual, expected)) {
        fail(`toEqual 失败：期望 ${show(expected)}，实得 ${show(actual)}`);
      }
    },
    toBeDefined() {
      if (actual === undefined) fail('toBeDefined 失败：实得 undefined');
    },
    toBeUndefined() {
      if (actual !== undefined) fail(`toBeUndefined 失败：实得 ${show(actual)}`);
    },
    toHaveLength(expected: number) {
      const length = (actual as { length?: unknown } | null | undefined)?.length;
      if (length !== expected) {
        fail(`toHaveLength 失败：期望 ${expected}，实得 ${show(length)}（值 ${show(actual)}）`);
      }
    },
    toBeGreaterThanOrEqual(expected: number) {
      if (typeof actual !== 'number' || !(actual >= expected)) {
        fail(`toBeGreaterThanOrEqual 失败：期望 >= ${expected}，实得 ${show(actual)}`);
      }
    },
    toMatchObject(expected: unknown) {
      if (!matchesObject(actual, expected)) {
        fail(`toMatchObject 失败：期望包含 ${show(expected)}，实得 ${show(actual)}`);
      }
    },
  };

  /** `expect(value).not.matcher(...)`：先运行原断言，成功则反转为失败。 */
  Object.defineProperty(matchers, 'not', {
    get() {
      const negated: Record<string, unknown> = {};
      for (const [name, matcher] of Object.entries(matchers)) {
        if (name === 'not' || name === 'rejects' || name === 'resolves') continue;
        negated[name] = (...args: unknown[]) => {
          try {
            (matcher as (...values: unknown[]) => unknown)(...args);
          } catch {
            return;
          }
          fail(`not.${name} 失败：实值满足了被否定的断言`);
        };
      }
      return negated;
    },
  });

  const promiseMatchers = (mode: 'resolves' | 'rejects') => {
    const resolved: Record<string, unknown> = {};
    for (const [name, matcher] of Object.entries(matchers)) {
      if (name === 'not' || name === 'rejects' || name === 'resolves') continue;
      resolved[name] = (...args: unknown[]) => Promise.resolve(expectAny).then(
        (value) => {
          if (mode === 'rejects') {
            throw new Error(`rejects.${name} 失败：期望 Promise 被拒绝，但它兑现了`);
          }
          return (expect(value) as Record<string, (...values: unknown[]) => unknown>)[name]!(...args);
        },
        (error: unknown) => {
          if (mode === 'resolves') {
            throw new Error(`resolves.${name} 失败：期望 Promise 兑现，但它被拒绝：${describeError(error)}`);
          }
          throw new Error(`rejects.${name} 未实现：只允许使用 rejects.toThrow(...)`);
        },
      );
    }
    return resolved;
  };

  Object.defineProperty(matchers, 'resolves', {
    get() {
      const resolved = promiseMatchers('resolves');
      Object.defineProperty(resolved, 'not', {
        get() {
          const negated: Record<string, unknown> = {};
          for (const [name, matcher] of Object.entries(resolved)) {
            if (name === 'not') continue;
            negated[name] = (...args: unknown[]) => Promise.resolve(expectAny).then(
              (value) => {
                try {
                  (expect(value) as Record<string, (...values: unknown[]) => unknown>)[name]!(...args);
                } catch {
                  return;
                }
                fail(`resolves.not.${name} 失败：实值满足了被否定的断言`);
              },
              (error: unknown) => {
                throw new Error(`resolves.not.${name} 失败：Promise 被拒绝：${describeError(error)}`);
              },
            );
          }
          return negated;
        },
      });
      return resolved;
    },
  });

  /**
   * `await expect(promise).rejects.toThrow(msg?)`
   *
   * 关键是 `toThrow()` 要返回一个 **thenable** —— `await` 拿到的是它的返回值，
   * 所以"promise 到底有没有被拒"这件事必须在 `then` 里判定，不能在 `toThrow` 里同步判定
   * （同步判定时 promise 还是 pending，永远看不到拒绝）。
   */
  Object.defineProperty(matchers, 'rejects', {
    get() {
      return {
        toThrow(expectedSubstring?: string) {
          return {
            then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
              Promise.resolve(expectAny).then(
                () => reject(new Error('rejects.toThrow 失败：期望 Promise 被拒绝，但它兑现了')),
                (error: unknown) => {
                  const message = describeError(error);
                  if (expectedSubstring !== undefined && !message.includes(expectedSubstring)) {
                    reject(
                      new Error(
                        `rejects.toThrow 失败：拒绝理由不含 ${show(expectedSubstring)}，实得 ${show(message)}`,
                      ),
                    );
                    return;
                  }
                  resolve(undefined);
                },
              );
            },
          };
        },
      };
    },
  });

  return matchers;
}

export namespace expect {
  export const any = asymmetricAny;
}
