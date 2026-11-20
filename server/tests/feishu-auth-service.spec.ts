import { describe, expect, it } from 'vitest';

import type {
  FeishuAccountBinding,
  FeishuAccountRepository,
  FeishuAccountRow,
} from '../src/feishu/feishu-auth-service';
import { resolveFeishuLogin, feishuPlaceholderEmail } from '../src/feishu/feishu-auth-service';
import type { FeishuProfile } from '../src/feishu/feishu-oauth-client';

type Row = FeishuAccountRow;

class MemoryRepo implements FeishuAccountRepository {
  rows: Row[];
  created: Array<{ email: string; displayName: string; openId: string }> = [];
  constructor(rows: Row[] = []) {
    this.rows = rows;
  }
  async findByOpenId(openId: string) {
    return this.rows.find((r) => r.feishuOpenId === openId) ?? null;
  }
  async findByUnionId(unionId: string) {
    return this.rows.find((r) => r.feishuUnionId === unionId) ?? null;
  }
  async findByEmail(email: string) {
    return this.rows.find((r) => r.email === email) ?? null;
  }
  async findSoleAdmin() {
    const admins = this.rows.filter((r) => r.isAdmin);
    return admins.length === 1 ? admins[0]! : null;
  }
  async bindFeishu(userId: number, binding: FeishuAccountBinding) {
    this.rows = this.rows.map((r) =>
      r.id === userId
        ? { ...r, feishuOpenId: binding.openId, feishuUnionId: binding.unionId ?? r.feishuUnionId }
        : r,
    );
  }
  async createFromFeishu(input: { email: string; displayName: string; openId: string; unionId: string | null }) {
    this.created.push({ email: input.email, displayName: input.displayName, openId: input.openId });
    const row: Row = {
      id: 100 + this.created.length,
      email: input.email,
      isAdmin: false,
      feishuOpenId: input.openId,
      feishuUnionId: input.unionId,
    };
    this.rows.push(row);
    return row;
  }
  async touchLogin() {
    /* no-op */
  }
}

const digest = (value: string): string => value;

function profile(over: Partial<FeishuProfile> = {}): FeishuProfile {
  return {
    openId: 'ou_new',
    unionId: null,
    name: '飞书用户',
    email: null,
    tenantKey: null,
    ...over,
  };
}

const policy = { adminOpenIds: [] as string[], tenantKey: null as string | null, autoProvision: true };

describe('feishu-auth-service · 管理面', () => {
  it('已绑定的管理员 ⇒ 登录成功', async () => {
    const repo = new MemoryRepo([{ id: 1, email: 'a@x', isAdmin: true, feishuOpenId: 'ou_a', feishuUnionId: null }]);
    const out = await resolveFeishuLogin({ profile: profile({ openId: 'ou_a' }), scope: 'admin', repo, policy, digest });
    expect(out).toEqual({ ok: true, userId: 1, created: false });
  });

  it('绑到的是非管理员 ⇒ not_admin', async () => {
    const repo = new MemoryRepo([{ id: 2, email: 'u@x', isAdmin: false, feishuOpenId: 'ou_u', feishuUnionId: null }]);
    const out = await resolveFeishuLogin({ profile: profile({ openId: 'ou_u' }), scope: 'admin', repo, policy, digest });
    expect(out).toEqual({ ok: false, code: 'not_admin' });
  });

  it('未绑定 + 唯一管理员未绑飞书 ⇒ 直接关联到该管理员（产品要求的"直接关联"）', async () => {
    const repo = new MemoryRepo([{ id: 7, email: 'boss@x', isAdmin: true, feishuOpenId: null, feishuUnionId: null }]);
    const out = await resolveFeishuLogin({ profile: profile({ openId: 'ou_boss' }), scope: 'admin', repo, policy, digest });
    expect(out).toEqual({ ok: true, userId: 7, created: false });
    expect(repo.rows[0]!.feishuOpenId).toBe('ou_boss');
  });

  it('唯一管理员已绑了另一枚飞书身份 ⇒ not_bound（不覆盖旧绑定）', async () => {
    const repo = new MemoryRepo([{ id: 7, email: 'boss@x', isAdmin: true, feishuOpenId: 'ou_old', feishuUnionId: null }]);
    const out = await resolveFeishuLogin({ profile: profile({ openId: 'ou_other' }), scope: 'admin', repo, policy, digest });
    expect(out).toEqual({ ok: false, code: 'not_bound' });
  });

  it('多个管理员（findSoleAdmin 返回 null）⇒ not_bound，不自动提权', async () => {
    const repo = new MemoryRepo([
      { id: 1, email: 'a@x', isAdmin: true, feishuOpenId: null, feishuUnionId: null },
      { id: 2, email: 'b@x', isAdmin: true, feishuOpenId: null, feishuUnionId: null },
    ]);
    const out = await resolveFeishuLogin({ profile: profile({ openId: 'ou_x' }), scope: 'admin', repo, policy, digest });
    expect(out).toEqual({ ok: false, code: 'not_bound' });
  });

  it('配了 adminOpenIds 白名单且不含这枚 open_id ⇒ not_bound', async () => {
    const repo = new MemoryRepo([{ id: 7, email: 'boss@x', isAdmin: true, feishuOpenId: null, feishuUnionId: null }]);
    const out = await resolveFeishuLogin({
      profile: profile({ openId: 'ou_stranger' }),
      scope: 'admin',
      repo,
      policy: { ...policy, adminOpenIds: ['ou_boss'] },
      digest,
    });
    expect(out).toEqual({ ok: false, code: 'not_bound' });
  });
});

describe('feishu-auth-service · 普通面', () => {
  it('已绑定 ⇒ 登录成功', async () => {
    const repo = new MemoryRepo([{ id: 3, email: 'u@x', isAdmin: false, feishuOpenId: 'ou_3', feishuUnionId: null }]);
    const out = await resolveFeishuLogin({ profile: profile({ openId: 'ou_3' }), scope: 'app', repo, policy, digest });
    expect(out).toEqual({ ok: true, userId: 3, created: false });
  });

  it('未绑定但飞书邮箱撞上已有账号 ⇒ email_taken（不认领）', async () => {
    const repo = new MemoryRepo([{ id: 4, email: 'taken@example.com', isAdmin: false, feishuOpenId: null, feishuUnionId: null }]);
    const out = await resolveFeishuLogin({
      profile: profile({ openId: 'ou_4', email: 'taken@example.com' }),
      scope: 'app',
      repo,
      policy,
      digest,
    });
    expect(out).toEqual({ ok: false, code: 'email_taken' });
  });

  it('未绑定、邮箱不撞车、无邮箱 ⇒ 自动建号（占位邮箱）', async () => {
    const repo = new MemoryRepo();
    const out = await resolveFeishuLogin({ profile: profile({ openId: 'ou_5' }), scope: 'app', repo, policy, digest });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.created).toBe(true);
    expect(repo.created[0]!.email).toBe(feishuPlaceholderEmail('ou_5', digest));
  });

  it('autoProvision=false ⇒ 未绑定不建号，回 not_bound', async () => {
    const repo = new MemoryRepo();
    const out = await resolveFeishuLogin({
      profile: profile({ openId: 'ou_6' }),
      scope: 'app',
      repo,
      policy: { ...policy, autoProvision: false },
      digest,
    });
    expect(out).toEqual({ ok: false, code: 'not_bound' });
  });

  it('tenantKey 限制不匹配 ⇒ tenant_denied', async () => {
    const repo = new MemoryRepo();
    const out = await resolveFeishuLogin({
      profile: profile({ openId: 'ou_7', tenantKey: 'tk_other' }),
      scope: 'app',
      repo,
      policy: { ...policy, tenantKey: 'tk_wanted' },
      digest,
    });
    expect(out).toEqual({ ok: false, code: 'tenant_denied' });
  });
});
