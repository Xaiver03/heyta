import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AUTH_PASSWORD_PATHS,
  PASSWORD_AUTH_ERROR_CODES,
  PASSWORD_POLICY_CODES,
} from '@heyta/shared-schema';
import { passwordAuthResponseOf } from '../src/api';
import { PasswordAuthError } from '../src/password/service';

/**
 * 共享契约 ↔ 服务端映射的**对账**（计划 W5）。
 *
 * 与 `password-auth-routes.spec.ts` 的分工：那份起 Fastify、钉的是端到端的 HTTP 行为；
 * 这一份**不起服务**，只把 `@heyta/shared-schema` 那张词表逐项喂给映射函数
 * （`passwordAuthResponseOf` 是纯函数，这是它能这样用的原因）。
 *
 * 它抓的是那一类**没有任何一层会报错**的漂移：词表加了码，而服务端的状态码表没跟上。
 * 客户端那边是按字符串查白名单的，查不到就静默退回"按状态码分类" —— 于是
 * "新码"在四个宿主上表现成一句笼统的失败，测试全绿。
 */
describe('共享错误词表的每一项都有 HTTP 表达', () => {
  it('八个码逐个都映射出一个状态码，且原样回显 code', () => {
    for (const code of PASSWORD_AUTH_ERROR_CODES) {
      const res = passwordAuthResponseOf(new PasswordAuthError(code, 'internal detail'));
      // 🔴 没有映射时 switch **返回 undefined**（那条 switch 刻意不写 default）。
      // 断言"是对象"而不是"不是 500"，才能抓住"漏了一整条"。
      expect(res, `码 ${code} 没有 HTTP 表达`).toBeDefined();
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(600);
      expect(res.body.code).toBe(code);
      // 句子由服务端给（唯一真源在 `PASSWORD_*_MESSAGE`），不许是空串。
      expect(res.body.message.length).toBeGreaterThan(0);
      // 🔴 内部细节不许透传。这里喂的就是那句"哪个闸门满了"级别的话。
      expect(res.body.message).not.toContain('internal detail');
    }
  });

  /**
   * 词表长度单独钉一次：上面那个循环在词表**为空**时会全绿。
   * 这正是 §7 第 33 条说的"永远通过的判据"。
   */
  it('词表确实有八条（循环不是对着空数组跑的）', () => {
    expect(PASSWORD_AUTH_ERROR_CODES).toHaveLength(8);
    expect(PASSWORD_POLICY_CODES).toHaveLength(4);
  });

  it('两个"要等多久"的码带正数 Retry-After，其余不带', () => {
    for (const code of PASSWORD_AUTH_ERROR_CODES) {
      const res = passwordAuthResponseOf(new PasswordAuthError(code, 'x'));
      if (code === 'account_locked' || code === 'password_backend_busy') {
        expect(res.retryAfterSeconds, `${code} 该给 Retry-After`).toBeGreaterThan(0);
      } else {
        expect(res.retryAfterSeconds, `${code} 不该给 Retry-After`).toBeUndefined();
      }
    }
  });

  /**
   * 策略码是 `password_policy_violation` 的**下一层**判别，丢了它界面只能说一句
   * "口令不符合要求" —— 而四种拒绝的用户动作各不相同（加长度 / 换一句 / 这句泄露过）。
   */
  it('四个策略码逐个都能透传到响应体', () => {
    for (const policyCode of PASSWORD_POLICY_CODES) {
      const res = passwordAuthResponseOf(
        new PasswordAuthError('password_policy_violation', 'x', undefined, policyCode),
      );
      expect(res.status).toBe(400);
      expect(res.body.policyCode).toBe(policyCode);
    }
  });
});

describe('路径只有一份写法', () => {
  /**
   * 六条路由的注册现在用 `AUTH_PASSWORD_PATHS.*`（本文件上面那处改动）。这条断言
   * 防的是**以后有人把某条改回字面量** —— 那在 TypeScript 上完全合法，而且当天不会
   * 有任何症状，直到换挂载点或改名时其中一端漏改。
   *
   * 按字符串字面量匹配，注释里那些 `/api/password/forgot` 之类的叙述不算。
   */
  it('api.ts 不再用字符串字面量注册这六条路由', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/api.ts', import.meta.url)),
      'utf8',
    );
    for (const path of Object.values(AUTH_PASSWORD_PATHS)) {
      expect(source).not.toContain(`'${path}'`);
      expect(source).not.toContain(`"${path}"`);
    }
    // 🔴 阳性对照：只看"字面量不见了"是不够的 —— 那条路由被删掉时上面同样全绿。
    // 所以六条必须**各自**以常量形式出现一次。
    for (const key of Object.keys(AUTH_PASSWORD_PATHS)) {
      expect(source).toContain(`AUTH_PASSWORD_PATHS.${key},`);
    }
  });
});
