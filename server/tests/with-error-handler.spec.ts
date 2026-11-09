import { describe, expect, it, vi } from 'vitest';

import { Logger } from '../src/logger';
import { withErrorHandler } from '../src/util/with-error-handler';

/**
 * `withErrorHandler` 的契约测试。
 *
 * 重点不在「能兜住错误」这一条显然的事，而在**它不许做什么**：
 * 不改变返回值、不改变异常传播、不在不该记日志时记日志、
 * 不在 `shouldHandle` 拒绝时执行 `onError`。这几条是本次重构
 * 「行为不变」的判据 —— 任何一条塌掉，说明这个 helper 不能用来承载
 * `sync/services` 里那些有语义的 catch。
 */
describe('withErrorHandler', () => {
  describe('正常路径', () => {
    it('返回被包装函数的原值', async () => {
      const wrapped = withErrorHandler(async (n: number) => n * 2, { fallback: -1 });
      await expect(wrapped(21)).resolves.toBe(42);
    });

    it('原样转发全部参数与 this 无关的调用形态', async () => {
      const fn = vi.fn(async (a: string, b: number, c: boolean) => `${a}${b}${c}`);
      const wrapped = withErrorHandler(fn, { fallback: 'x' });
      await wrapped('a', 1, true);
      expect(fn).toHaveBeenCalledWith('a', 1, true);
    });

    it('正常路径不记任何日志', async () => {
      const seen: string[] = [];
      const wrapped = withErrorHandler(async () => 'ok', {
        fallback: 'no',
        logger: (m) => seen.push(m),
      });
      await wrapped();
      expect(seen).toEqual([]);
    });

    it('正常路径不执行 onError', async () => {
      const onError = vi.fn();
      const wrapped = withErrorHandler(async () => 'ok', { fallback: 'no', onError });
      await wrapped();
      expect(onError).not.toHaveBeenCalled();
    });

    it('同步函数同样可用', async () => {
      const wrapped = withErrorHandler((n: number) => n + 1, { fallback: 0 });
      await expect(wrapped(1)).resolves.toBe(2);
    });

    it('保留 undefined 与 null 这类合法返回值', async () => {
      const u = withErrorHandler(async () => undefined, { fallback: 'fallback' });
      await expect(u()).resolves.toBeUndefined();
      const n = withErrorHandler(async () => null, { fallback: 'fallback' });
      await expect(n()).resolves.toBeNull();
    });
  });

  describe('兜底路径', () => {
    it('默认吞掉异常并返回 fallback', async () => {
      const wrapped = withErrorHandler(async () => {
        throw new Error('boom');
      }, { fallback: 'safe' });
      await expect(wrapped()).resolves.toBe('safe');
    });

    it('日志文案与错误消息一起记录', async () => {
      const seen: string[] = [];
      const wrapped = withErrorHandler(async () => {
        throw new Error('boom');
      }, { fallback: 'safe', message: 'read failed', logger: (m) => seen.push(m) });
      await wrapped();
      expect(seen).toEqual(['read failed']);
    });

    it('message 可以是函数，由错误派生文案', async () => {
      const seen: string[] = [];
      const wrapped = withErrorHandler(async () => {
        throw new Error('boom');
      }, {
        fallback: 'safe',
        message: (e) => `derived:${(e as Error).message}`,
        logger: (m) => seen.push(m),
      });
      await wrapped();
      expect(seen).toEqual(['derived:boom']);
    });

    it('label 在未给 message 时作为文案', async () => {
      const seen: string[] = [];
      const wrapped = withErrorHandler(async () => {
        throw new Error('x');
      }, { fallback: 'safe', label: 'my label', logger: (m) => seen.push(m) });
      await wrapped();
      expect(seen).toEqual(['my label']);
    });

    it('onError 在返回 fallback 之前执行，且可异步', async () => {
      const order: string[] = [];
      const wrapped = withErrorHandler(async () => {
        throw new Error('boom');
      }, {
        fallback: 'safe',
        logger: () => order.push('log'),
        onError: async () => {
          await Promise.resolve();
          order.push('cleanup');
        },
      });
      const result = await wrapped();
      expect(result).toBe('safe');
      expect(order).toEqual(['log', 'cleanup']);
    });

    it('非 Error 抛出物也能兜住并记日志', async () => {
      const seen: string[] = [];
      const wrapped = withErrorHandler(async () => {
        throw 'plain string';
      }, { fallback: 'safe', message: 'oops', logger: (m) => seen.push(m) });
      await expect(wrapped()).resolves.toBe('safe');
      expect(seen).toEqual(['oops']);
    });

    it('fallback 为 false / 0 这类假值时照样返回它', async () => {
      const f = withErrorHandler(async () => {
        throw new Error('x');
      }, { fallback: false });
      await expect(f()).resolves.toBe(false);
      const z = withErrorHandler(async () => {
        throw new Error('x');
      }, { fallback: 0 });
      await expect(z()).resolves.toBe(0);
    });
  });

  describe('不改变异常传播路径（铁律 1）', () => {
    it('shouldHandle 返回 false 时原样重抛同一个错误对象', async () => {
      const original = new Error('must propagate');
      const wrapped = withErrorHandler(async () => {
        throw original;
      }, { fallback: 'safe', shouldHandle: () => false });
      await expect(wrapped()).rejects.toBe(original);
    });

    it('shouldHandle 返回 false 时不记日志、不跑 onError', async () => {
      const seen: string[] = [];
      const onError = vi.fn();
      const wrapped = withErrorHandler(async () => {
        throw new Error('x');
      }, {
        fallback: 'safe',
        shouldHandle: () => false,
        onError,
        logger: (m) => seen.push(m),
      });
      await expect(wrapped()).rejects.toThrow();
      expect(seen).toEqual([]);
      expect(onError).not.toHaveBeenCalled();
    });

    it('只兜 P2002 —— 其他 Prisma 错误必须冒泡', async () => {
      const p2002 = Object.assign(new Error('unique'), { code: 'P2002' });
      const p2003 = Object.assign(new Error('fk'), { code: 'P2003' });

      const handle = (e: unknown) => (e as { code?: string }).code === 'P2002';

      const ok = withErrorHandler(async () => {
        throw p2002;
      }, { fallback: null, shouldHandle: handle });
      await expect(ok()).resolves.toBeNull();

      const bad = withErrorHandler(async () => {
        throw p2003;
      }, { fallback: null, shouldHandle: handle });
      await expect(bad()).rejects.toBe(p2003);
    });

    it('shouldHandle 自身抛错时重抛原错误，而不是把它当兜底', async () => {
      const original = new Error('original');
      const wrapped = withErrorHandler(async () => {
        throw original;
      }, {
        fallback: 'safe',
        shouldHandle: () => {
          throw new Error('predicate bug');
        },
      });
      await expect(wrapped()).rejects.toBe(original);
    });
  });

  describe('日志级别可显式指定（不改变可观测性）', () => {
    it('level=debug 时错误对象作为第二个参数透传', async () => {
      const debugSpy = vi.spyOn(Logger, 'debug').mockImplementation(() => {});
      const err = new Error('boom');
      const wrapped = withErrorHandler(async () => {
        throw err;
      }, { fallback: 'safe', level: 'debug', label: 'closing failed' });
      await wrapped();
      expect(debugSpy).toHaveBeenCalledWith('closing failed: boom', err);
      debugSpy.mockRestore();
    });

    it('level=warn 时走 Logger.warn 而不是 error', async () => {
      const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => {});
      const wrapped = withErrorHandler(async () => {
        throw new Error('boom');
      }, { fallback: 'safe', level: 'warn', label: 'l' });
      await wrapped();
      expect(warnSpy).toHaveBeenCalledWith('l: boom');
      expect(errorSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('默认级别为 error', async () => {
      const errorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => {});
      const wrapped = withErrorHandler(async () => {
        throw new Error('boom');
      }, { fallback: 'safe', label: 'l' });
      await wrapped();
      expect(errorSpy).toHaveBeenCalledWith('l: boom');
      expect(warnSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });
});
