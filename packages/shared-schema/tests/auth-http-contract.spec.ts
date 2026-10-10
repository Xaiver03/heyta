import { describe, expect, it } from 'vitest';
import {
  AUTH_PASSWORD_MAX_CODE_POINTS,
  AUTH_PASSWORD_MIN_CODE_POINTS,
  AUTH_PASSWORD_PATHS,
  PASSWORD_AUTH_ERROR_CODES,
  PASSWORD_POLICY_CODES,
} from '../src/auth-http-contract';

/**
 * 这份契约的被保护对象不是"这些字符串写对了"，而是**服务端与四个宿主认得同一批码**。
 * 客户端按 `code` 选句子、选按钮，服务端按 `code` 选状态码 —— 两边各写一遍时，
 * 漂移的表现是"同一种失败在一端说得通、另一端是一句笼统的登录失败"，
 * 而且没有任何一层会报错。所以下面每条断言钉的都是**词表的封闭性**，不是拼写。
 */
describe('口令那条路的机器码词表', () => {
  it('八个码，逐字锁定（新增一个码要在这里显式承认）', () => {
    expect(PASSWORD_AUTH_ERROR_CODES).toEqual([
      'invalid_credentials',
      'email_not_verified',
      'account_locked',
      'password_policy_violation',
      'password_backend_busy',
      'invalid_reset_link',
      'no_password_set',
      'password_already_set',
    ]);
  });

  it('四个策略码，逐字锁定', () => {
    expect(PASSWORD_POLICY_CODES).toEqual([
      'too_short',
      'too_long',
      'too_common',
      'breached',
    ]);
  });

  /**
   * 词表内部不许重合。`invalid_credentials` 与 `invalid_reset_link` 曾经只差一个后缀，
   * 一个拼错的码会被 `includes` 之类的宽松检查放过去，而它的表现是"两句相反的话各对一半人"。
   */
  it('两张表无交集，且每张表内部无重复', () => {
    const all = [...PASSWORD_AUTH_ERROR_CODES, ...PASSWORD_POLICY_CODES];
    expect(new Set(all).size).toBe(all.length);
  });

  /**
   * 码必须能当**对象键**用（客户端的白名单是 `Record<string, reason>`）。
   * 带空格或大写的话，白名单查不到就静默退回按状态码分类 —— 那是一条
   * 永远不会红的漏映射。
   */
  it('每个码都是小写下划线形状（白名单查表的前提）', () => {
    for (const code of [...PASSWORD_AUTH_ERROR_CODES, ...PASSWORD_POLICY_CODES]) {
      expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

describe('口令长度界限', () => {
  /**
   * 🔴 8 是对 NIST 单因子 ≥15 的**有意偏离**（产品负责人 2026-10-01 拍板）。
   * 这条断言把数字钉死，是为了让"谁顺手改成 12 或 6"必须同时改这里 ——
   * 而那意味着他要先看见文件头那段补偿控制的理由。
   */
  it('下限 8、上限 256', () => {
    expect(AUTH_PASSWORD_MIN_CODE_POINTS).toBe(8);
    expect(AUTH_PASSWORD_MAX_CODE_POINTS).toBe(256);
  });

  it('下限 < 上限（两者相等就是没人能设口令）', () => {
    expect(AUTH_PASSWORD_MIN_CODE_POINTS).toBeLessThan(AUTH_PASSWORD_MAX_CODE_POINTS);
  });
});

describe('路径', () => {
  /**
   * 服务端注册的是**相对**形状（它挂在 `prefix: '/api'` 下）。这里不许出现 `/api`：
   * 出现了就等于两边各持有一份完整路径，而换挂载点时只有客户端会跟着改。
   */
  it('所有口令路径都是相对路径，不带 /api 前缀、不带结尾斜杠', () => {
    const values = Object.values(AUTH_PASSWORD_PATHS);
    expect(values).toHaveLength(9);
    for (const path of values) {
      expect(path.startsWith('/api')).toBe(false);
      expect(path.startsWith('/')).toBe(true);
      expect(path.endsWith('/')).toBe(false);
    }
  });

  it('路径互不相同', () => {
    const values = Object.values(AUTH_PASSWORD_PATHS);
    expect(new Set(values).size).toBe(values.length);
  });

  /**
   * `set` 与 `change` 必须**是两个不同的值**。
   *
   * 这条看起来是废话，它防的是很实际的一种改法：有人觉得"设第一个口令"
   * 只是 `change` 的一个特例（省一个 currentPassword 字段），于是把两条路径
   * 合并 —— 而这两条路的后果不同（`change` bump `tokenVersion` 会把其余设备
   * 全踢下线，`set` 不 bump）。合并的症状不是报错，是"给账号加了个密码，
   * 手机和笔记本一起掉线"。
   */
  it('set 与 change 是两条独立的路由', () => {
    expect(AUTH_PASSWORD_PATHS.set).not.toBe(AUTH_PASSWORD_PATHS.change);
    expect(AUTH_PASSWORD_PATHS.set).toBe('/password/set');
    expect(AUTH_PASSWORD_PATHS.change).toBe('/password/change');
  });
});
