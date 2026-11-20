import { describe, expect, it } from 'vitest';

import type { FeishuLoginConfig } from '../src/feishu/feishu-config';
import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchUserInfo,
  FeishuOAuthError,
  normalizeProfile,
} from '../src/feishu/feishu-oauth-client';

const config: FeishuLoginConfig = {
  appId: 'cli_test_app',
  appSecret: 'secret',
  origin: 'https://heyta.example.com',
  scope: '',
  authorizeEndpoint: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
  tokenEndpoint: 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
  userInfoEndpoint: 'https://open.feishu.cn/open-apis/authen/v1/user_info',
  redirectUri: 'https://heyta.example.com/api/auth/feishu/callback',
  adminOpenIds: [],
  tenantKey: null,
  autoProvision: true,
};

function fakeFetch(handler: (url: string, init: unknown) => { ok: boolean; json: () => Promise<unknown> }): typeof fetch {
  return (async (url: string, init: unknown) => handler(String(url), init)) as unknown as typeof fetch;
}

describe('feishu-oauth-client · buildAuthorizeUrl', () => {
  it('拼出带 client_id / redirect_uri / state 的授权地址', () => {
    const url = new URL(
      buildAuthorizeUrl(config, {
        redirectUri: config.redirectUri,
        state: 'st-123',
        scope: '',
      }),
    );
    expect(url.searchParams.get('client_id')).toBe('cli_test_app');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    expect(url.searchParams.get('state')).toBe('st-123');
    // 空 scope 不传 —— 否则未开通权限时授权页报 20027。
    expect(url.searchParams.has('scope')).toBe(false);
  });

  it('给了 scope 才带上', () => {
    const url = new URL(
      buildAuthorizeUrl(config, {
        redirectUri: config.redirectUri,
        state: 's',
        scope: 'contact:user.email:readonly',
      }),
    );
    expect(url.searchParams.get('scope')).toBe('contact:user.email:readonly');
  });
});

describe('feishu-oauth-client · exchangeCode', () => {
  it('成功返回 access_token', async () => {
    const token = await exchangeCode({
      config,
      code: 'auth-code',
      redirectUri: config.redirectUri,
      fetchImpl: fakeFetch(() => ({
        ok: true,
        json: async () => ({ code: 0, access_token: 'u-at', expires_in: 7200, scope: 'x' }),
      })),
    });
    expect(token.accessToken).toBe('u-at');
    expect(token.expiresIn).toBe(7200);
  });

  it('上游 code 非 0 ⇒ 抛 401 的 FeishuOAuthError', async () => {
    await expect(
      exchangeCode({
        config,
        code: 'bad',
        redirectUri: config.redirectUri,
        fetchImpl: fakeFetch(() => ({ ok: true, json: async () => ({ code: 20003 }) })),
      }),
    ).rejects.toBeInstanceOf(FeishuOAuthError);
  });

  it('没带 access_token 也算失败', async () => {
    await expect(
      exchangeCode({
        config,
        code: 'x',
        redirectUri: config.redirectUri,
        fetchImpl: fakeFetch(() => ({ ok: true, json: async () => ({ code: 0 }) })),
      }),
    ).rejects.toBeInstanceOf(FeishuOAuthError);
  });
});

describe('feishu-oauth-client · fetchUserInfo / normalizeProfile', () => {
  it('归一化 open_id / union_id / 姓名 / 邮箱 / tenant_key', async () => {
    const profile = await fetchUserInfo({
      accessToken: 'u-at',
      config,
      fetchImpl: fakeFetch(() => ({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            open_id: 'ou_1',
            union_id: 'on_1',
            name: '张三',
            email: 'zs@example.com',
            tenant_key: 'tk_1',
          },
        }),
      })),
    });
    expect(profile).toEqual({
      openId: 'ou_1',
      unionId: 'on_1',
      name: '张三',
      email: 'zs@example.com',
      tenantKey: 'tk_1',
    });
  });

  it('email 缺省时回落到 enterprise_email', () => {
    const profile = normalizeProfile({ open_id: 'ou_2', enterprise_email: 'e@corp.com' });
    expect(profile.email).toBe('e@corp.com');
    expect(profile.unionId).toBeNull();
  });

  it('没有 open_id ⇒ 抛错', () => {
    expect(() => normalizeProfile({ name: 'x' })).toThrow(FeishuOAuthError);
  });
});
