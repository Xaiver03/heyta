/** Real PostgreSQL, production repository, only synthetic credentials; no provider mock. */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  CredentialCipher,
  digest,
  randomSecret,
} from "../../src/central-auth/crypto";
import {
  CentralAuthRepository,
  LOCAL_PROOF_TTL_MS,
} from "../../src/central-auth/repository";
const url = process.env.HEYTA_CENTRAL_TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "Explicit HEYTA_CENTRAL_TEST_DATABASE_URL required; this suite must not silently skip",
  );
const target = new URL(url);
if (
  !["127.0.0.1", "localhost"].includes(target.hostname) ||
  !/^\/heyta_central_auth_[a-z0-9_]*test$/.test(target.pathname) ||
  target.search ||
  target.hash
)
  throw new Error("Unsafe test database");
const db = new PrismaClient({ datasources: { db: { url } } });
const cipher = new CredentialCipher("33".repeat(32));
const repo = new CentralAuthRepository(db, cipher);
const issuer = "https://identity.example.test",
  clientId = "heyta-test",
  browser = "synthetic-browser-secret";
const expires = () => Date.now() + 3600_000;
const input = () => ({
  issuer,
  clientId,
  redirectUri: "https://heyta.example.test/api/auth/oidc/callback",
  browser,
  nonce: randomSecret(),
  verifier: randomSecret(),
});
async function authorization(link?: {
  userId: number;
  sessionHash: string;
  tokenVersion: number;
  authenticatedAt: number;
}) {
  const p = await repo.prepare({ ...input(), link });
  const a = await repo.dispatchAuthorization(p.state, browser);
  await repo.recordResult(a.id, a.dispatchToken, {
    accessToken: `synthetic-at-${a.id}`,
    refreshToken: `synthetic-rt-${a.id}`,
    expiresAt: expires(),
  });
  return a;
}
async function login(
  subject = randomSecret(),
  email = `${randomSecret()}@central.test`,
) {
  const a = await authorization();
  const r = await repo.completeAuthorization({
    attemptId: a.id,
    subject,
    rootSid: "shared-root-sid",
    sessionHash: digest(randomSecret()),
    expiresAt: expires(),
    newUser: {
      email,
      termsAcceptedAt: Date.now(),
      termsDocumentVersion: "test@1",
    },
  });
  return {
    a,
    grant: await db.centralGrant.findUniqueOrThrow({
      where: { id: r.grantId },
    }),
  };
}
async function user() {
  const u = await db.user.create({
    data: {
      email: `${randomSecret()}@central.test`,
      isVerified: 1,
      isAdmin: false,
    },
  });
  const sessionHash = digest(randomSecret());
  await db.accessSession.create({
    data: {
      userId: u.id,
      tokenVersion: u.tokenVersion,
      jtiHash: sessionHash,
      createdAt: BigInt(Date.now()),
      lastSeenAt: BigInt(Date.now()),
    },
  });
  return { ...u, sessionHash };
}

beforeEach(async () => {
  // This exact DB is fixture-only; rows below belong exclusively to this suite.
  await db.centralRevocation.deleteMany();
  await db.centralGrant.deleteMany();
  await db.centralAttempt.deleteMany();
  await db.centralPending.deleteMany();
  await db.centralIdentity.deleteMany();
  await db.user.deleteMany({ where: { email: { endsWith: "@central.test" } } });
});
afterAll(() => db.$disconnect());

describe("中央身份持久层（真实PG）", () => {
  it("pending错误浏览器拒绝且不消费，两路并发只有一次DISPATCHED", async () => {
    const p = await repo.prepare(input());
    await expect(
      repo.dispatchAuthorization(p.state, "wrong"),
    ).rejects.toMatchObject({ code: "pending_unavailable" });
    const results = await Promise.allSettled([
      repo.dispatchAuthorization(p.state, browser),
      repo.dispatchAuthorization(p.state, browser),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.centralAttempt.count()).toBe(1);
    expect(
      (await db.centralPending.findUniqueOrThrow({ where: { id: p.id } }))
        .secretsCipher,
    ).toBeNull();
  });
  it("过期pending不能派发，清理移除秘密", async () => {
    const p = await repo.prepare(input());
    await db.centralPending.update({
      where: { id: p.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      repo.dispatchAuthorization(p.state, browser),
    ).rejects.toMatchObject({ code: "pending_unavailable" });
    await repo.cleanup();
    expect(
      await db.centralPending.findUnique({ where: { id: p.id } }),
    ).toBeNull();
  });
  it("未知结果不可重新派发，同一owner迟到可存result，错owner拒绝", async () => {
    const p = await repo.prepare(input()),
      a = await repo.dispatchAuthorization(p.state, browser);
    await db.centralAttempt.update({
      where: { id: a.id },
      data: { deadline: new Date(0) },
    });
    await repo.cleanup();
    expect((await repo.inspectAttempt(a.id))?.status).toBe("UNKNOWN");
    await expect(
      repo.dispatchAuthorization(p.state, browser),
    ).rejects.toMatchObject({ code: "pending_unavailable" });
    await expect(
      repo.recordResult(a.id, "wrong", { accessToken: "synthetic" }),
    ).rejects.toMatchObject({ code: "attempt_unavailable" });
    await repo.recordResult(a.id, a.dispatchToken, {
      accessToken: "synthetic",
    });
    await expect(
      repo.completeAuthorization({
        attemptId: a.id,
        subject: "sub",
        sessionHash: "hash",
        expiresAt: expires(),
      }),
    ).rejects.toMatchObject({ code: "result_unavailable" });
    await repo.rejectResult(a.id);
    expect(await db.centralRevocation.count()).toBe(1);
  });
  it("同一结果可重读；不同结果不能覆写，加密持久化不含原文", async () => {
    const a = await authorization(),
      result = await repo.readResult(a.id);
    await repo.recordResult(a.id, a.dispatchToken, result.tokens);
    await expect(
      repo.recordResult(a.id, a.dispatchToken, { accessToken: "different" }),
    ).rejects.toMatchObject({ code: "result_conflict" });
    const row = await db.centralAttempt.findUniqueOrThrow({
      where: { id: a.id },
    });
    expect(JSON.stringify(row)).not.toContain(result.tokens.accessToken);
  });
  it("首次建号保留numeric id，不自动管理员；相同subject复用同一user", async () => {
    const first = await login("same-subject");
    const second = await login("same-subject");
    expect(first.grant.userId).toBe(second.grant.userId);
    expect(first.grant.id).not.toBe(second.grant.id);
    expect(await db.centralIdentity.count()).toBe(1);
    const u = await db.user.findUniqueOrThrow({
      where: { id: first.grant.userId },
    });
    expect(u.isAdmin).toBe(false);
    expect(u.passwordHash).toBeNull();
    expect(u.termsDocumentVersion).toBe("test@1");
  });
  it("相同邮箱不接管旧账号，缺邮箱要求补录", async () => {
    const u = await user(),
      a = await authorization();
    await expect(
      repo.completeAuthorization({
        attemptId: a.id,
        subject: "new-subject",
        sessionHash: digest(randomSecret()),
        expiresAt: expires(),
        newUser: {
          email: u.email,
          termsAcceptedAt: Date.now(),
          termsDocumentVersion: "test@1",
        },
      }),
    ).rejects.toMatchObject({ code: "binding_required" });
    await expect(
      repo.completeAuthorization({
        attemptId: a.id,
        subject: "new-subject",
        sessionHash: digest(randomSecret()),
        expiresAt: expires(),
      }),
    ).rejects.toMatchObject({ code: "onboarding_required" });
    expect(await db.centralIdentity.count()).toBe(0);
  });
  it("双证明绑定保持旧id、管理员和条款，不自动覆盖资料", async () => {
    const u = await user();
    const a = await authorization({
      userId: u.id,
      sessionHash: u.sessionHash,
      tokenVersion: u.tokenVersion,
      authenticatedAt: Date.now(),
    });
    const r = await repo.completeAuthorization({
      attemptId: a.id,
      subject: "linked",
      sessionHash: digest(randomSecret()),
      expiresAt: expires(),
    });
    expect(
      (await db.centralGrant.findUniqueOrThrow({ where: { id: r.grantId } }))
        .userId,
    ).toBe(u.id);
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.email).toBe(u.email);
    expect(after.isAdmin).toBe(false);
    expect(after.termsAcceptedAt).toBeNull();
  });
  it("旧session错归属、旧证明、版本变化全部拒绝", async () => {
    const u = await user(),
      other = await user();
    await expect(
      repo.prepare({
        ...input(),
        link: {
          userId: u.id,
          sessionHash: other.sessionHash,
          tokenVersion: 0,
          authenticatedAt: Date.now(),
        },
      }),
    ).rejects.toMatchObject({ code: "local_proof_invalid" });
    await expect(
      repo.prepare({
        ...input(),
        link: {
          userId: u.id,
          sessionHash: u.sessionHash,
          tokenVersion: 0,
          authenticatedAt: Date.now() - LOCAL_PROOF_TTL_MS,
        },
      }),
    ).rejects.toMatchObject({ code: "local_proof_invalid" });
    const a = await authorization({
      userId: u.id,
      sessionHash: u.sessionHash,
      tokenVersion: 0,
      authenticatedAt: Date.now(),
    });
    await db.user.update({ where: { id: u.id }, data: { tokenVersion: 1 } });
    await expect(
      repo.completeAuthorization({
        attemptId: a.id,
        subject: "linked",
        sessionHash: digest(randomSecret()),
        expiresAt: expires(),
      }),
    ).rejects.toMatchObject({ code: "local_proof_invalid" });
  });
  it("绑定主体不能抢走已经映射到其他用户的subject", async () => {
    await login("occupied");
    const u = await user();
    const a = await authorization({
      userId: u.id,
      sessionHash: u.sessionHash,
      tokenVersion: 0,
      authenticatedAt: Date.now(),
    });
    await expect(
      repo.completeAuthorization({
        attemptId: a.id,
        subject: "occupied",
        sessionHash: digest(randomSecret()),
        expiresAt: expires(),
      }),
    ).rejects.toMatchObject({ code: "identity_conflict" });
  });
  it("共享root sid的A/B，撤A不撤B，先持久outbox再删A会话", async () => {
    const a = await login("shared"),
      b = await login("shared");
    await repo.revokeGrant(a.grant.id);
    expect(
      await db.accessSession.findUnique({
        where: { jtiHash: a.grant.sessionHash! },
      }),
    ).toBeNull();
    expect(
      await db.accessSession.findUnique({
        where: { jtiHash: b.grant.sessionHash! },
      }),
    ).not.toBeNull();
    expect(await db.centralRevocation.count()).toBe(1);
    expect(
      (await db.centralGrant.findUniqueOrThrow({ where: { id: b.grant.id } }))
        .revokedAt,
    ).toBeNull();
  });
  it("两路刷新只有一个owner，UNKNOWN不因租约到期重派", async () => {
    const { grant } = await login();
    const rs = await Promise.allSettled([
      repo.beginRefresh(grant.id),
      repo.beginRefresh(grant.id),
    ]);
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const a = await db.centralAttempt.findFirstOrThrow({
      where: { kind: "refresh" },
    });
    await db.centralAttempt.update({
      where: { id: a.id },
      data: { deadline: new Date(0) },
    });
    await repo.cleanup();
    await expect(repo.beginRefresh(grant.id)).rejects.toMatchObject({
      code: "grant_unavailable",
    });
  });
  it("COMMIT成功回执丢失可查APPLIED，下一次轮换不能改变旧attempt所有权", async () => {
    const { grant } = await login();
    const a = await repo.beginRefresh(grant.id);
    await repo.recordResult(a.id, a.dispatchToken, {
      accessToken: "new-at",
      refreshToken: "new-rt",
    });
    const lost = new CentralAuthRepository(
      new Proxy(db, {
        get(target, prop) {
          if (prop === "$transaction")
            return async (cb: Parameters<PrismaClient["$transaction"]>[0]) => {
              await (target.$transaction as Function)(cb);
              throw new Error("synthetic commit response lost");
            };
          return Reflect.get(target, prop);
        },
      }),
      cipher,
    );
    await expect(lost.completeRefresh(a.id, expires())).rejects.toThrow(
      "synthetic commit response lost",
    );
    expect((await repo.inspectAttempt(a.id))?.status).toBe("APPLIED");
    const b = await repo.beginRefresh(grant.id);
    await repo.recordResult(b.id, b.dispatchToken, {
      accessToken: "latest-at",
      refreshToken: "latest-rt",
    });
    await repo.completeRefresh(b.id, expires());
    expect(await repo.completeRefresh(a.id, expires())).toMatchObject({
      alreadyApplied: true,
    });
    await expect(repo.rejectResult(a.id)).rejects.toMatchObject({
      code: "result_already_owned",
    });
    expect(
      (await db.centralGrant.findUniqueOrThrow({ where: { id: grant.id } }))
        .version,
    ).toBe(3);
    expect(await db.centralRevocation.count()).toBe(0);
  });
  it("撤销后迟到刷新不能复活，结果能单独进入outbox", async () => {
    const { grant } = await login();
    const a = await repo.beginRefresh(grant.id);
    await repo.revokeGrant(grant.id);
    await repo.recordResult(a.id, a.dispatchToken, {
      accessToken: "late-at",
      refreshToken: "late-rt",
    });
    await expect(repo.completeRefresh(a.id, expires())).rejects.toMatchObject({
      code: "grant_unavailable",
    });
    await repo.rejectResult(a.id);
    expect(await db.centralRevocation.count()).toBe(2);
    expect(
      await db.accessSession.findUnique({
        where: { jtiHash: grant.sessionHash! },
      }),
    ).toBeNull();
  });
  it("直接删账号/会话被FK拒绝；编排注销后outbox保留且迟到refresh仍有所有权", async () => {
    const { grant } = await login(),
      a = await repo.beginRefresh(grant.id);
    await expect(
      db.user.delete({ where: { id: grant.userId } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      db.accessSession.delete({ where: { jtiHash: grant.sessionHash! } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await repo.prepareUserClosure(grant.userId, async (tx) => {
      await tx.user.delete({ where: { id: grant.userId } });
    });
    expect(
      await db.user.findUnique({ where: { id: grant.userId } }),
    ).toBeNull();
    expect(await db.centralRevocation.count()).toBe(1);
    await repo.recordResult(a.id, a.dispatchToken, {
      accessToken: "post-close-at",
      refreshToken: "post-close-rt",
    });
    await expect(repo.completeRefresh(a.id, expires())).rejects.toMatchObject({
      code: "grant_unavailable",
    });
    await repo.rejectResult(a.id);
    expect(await db.centralRevocation.count()).toBe(2);
  });
  it("注销本地事务失败全部回滚，不会先吞会话或授权", async () => {
    const { grant } = await login();
    await expect(
      repo.prepareUserClosure(grant.userId, async () => {
        throw new Error("synthetic tombstone write failed");
      }),
    ).rejects.toThrow("synthetic tombstone write failed");
    expect(await db.centralRevocation.count()).toBe(0);
    expect(
      (await db.centralGrant.findUniqueOrThrow({ where: { id: grant.id } }))
        .revokedAt,
    ).toBeNull();
    expect(
      await db.accessSession.findUnique({
        where: { jtiHash: grant.sessionHash! },
      }),
    ).not.toBeNull();
  });
  it("撤销worker租约CAS，错owner及过期确认拒绝，成功清密文", async () => {
    const { grant } = await login();
    await repo.revokeGrant(grant.id);
    const a = await repo.claimRevocation();
    expect(a).not.toBeNull();
    expect(await repo.claimRevocation()).toBeNull();
    await expect(
      repo.finishRevocation(a!.id, "wrong", true),
    ).rejects.toMatchObject({ code: "lease_unavailable" });
    await db.centralRevocation.update({
      where: { id: a!.id },
      data: { leaseUntil: new Date(0) },
    });
    const b = await repo.claimRevocation();
    await expect(
      repo.finishRevocation(a!.id, a!.lease, true),
    ).rejects.toMatchObject({ code: "lease_unavailable" });
    await repo.finishRevocation(b!.id, b!.lease, true);
    expect(
      await db.centralRevocation.findUnique({ where: { id: b!.id } }),
    ).toMatchObject({ status: "CONFIRMED", tokensCipher: null });
  });
  it("七日撤销到期清密文并标未确认，24小时终态清理，缺记录不等于失败", async () => {
    const { grant, a } = await login();
    await repo.revokeGrant(grant.id);
    await db.centralRevocation.updateMany({ data: { expiresAt: new Date(0) } });
    expect(await repo.cleanup()).toEqual({ expiredUnconfirmed: 1 });
    const r = await db.centralRevocation.findFirstOrThrow();
    expect(r.status).toBe("EXPIRED_UNCONFIRMED");
    expect(r.tokensCipher).toBeNull();
    await db.centralRevocation.update({
      where: { id: r.id },
      data: { finishedAt: new Date(0) },
    });
    await db.centralAttempt.update({
      where: { id: a.id },
      data: { finishedAt: new Date(0) },
    });
    await db.centralGrant.update({
      where: { id: grant.id },
      data: { revokedAt: new Date(0) },
    });
    await repo.cleanup();
    expect(await repo.inspectAttempt(a.id)).toBeNull();
    expect(
      await db.centralGrant.findUnique({ where: { id: grant.id } }),
    ).toBeNull();
    await expect(repo.rejectResult(a.id)).rejects.toMatchObject({
      code: "attempt_unavailable",
    });
    expect(await db.centralRevocation.count()).toBe(0);
  });
  it("授权事务失败保留RESULT，重试可完成；过期未处理RESULT自动排撤销", async () => {
    const u = await user(),
      a = await authorization();
    const valid = {
      attemptId: a.id,
      subject: "retry-subject",
      sessionHash: u.sessionHash,
      expiresAt: expires(),
      newUser: {
        email: `${randomSecret()}@central.test`,
        termsAcceptedAt: Date.now(),
        termsDocumentVersion: "test@1",
      },
    };
    await expect(repo.completeAuthorization(valid)).rejects.toMatchObject({
      code: "P2002",
    });
    expect((await repo.inspectAttempt(a.id))?.status).toBe("RESULT");
    expect(await db.centralIdentity.count()).toBe(0);
    await repo.completeAuthorization({
      ...valid,
      sessionHash: digest(randomSecret()),
    });
    const orphan = await authorization();
    await db.centralAttempt.update({
      where: { id: orphan.id },
      data: { deadline: new Date(0) },
    });
    await repo.cleanup();
    expect((await repo.inspectAttempt(orphan.id))?.status).toBe("REJECTED");
    expect(await db.centralRevocation.count()).toBe(1);
  });
  it("等待用户锁跨越本地重新认证有效期后拒绝绑定", async () => {
    const u = await user();
    const a = await authorization({
      userId: u.id,
      sessionHash: u.sessionHash,
      tokenVersion: 0,
      authenticatedAt: Date.now() - LOCAL_PROOF_TTL_MS + 350,
    });
    let locked!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${u.id} FOR UPDATE`;
      locked();
      await hold;
    });
    await ready;
    const pending = repo.completeAuthorization({
      attemptId: a.id,
      subject: "late-proof",
      sessionHash: digest(randomSecret()),
      expiresAt: expires(),
    });
    const rejection = expect(pending).rejects.toMatchObject({
      code: "local_proof_invalid",
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    release();
    await blocker;
    await rejection;
    expect(await db.centralIdentity.count()).toBe(0);
  });
  it("刷新结果等待用户锁跨过派发期限后不能应用，材料留给清理", async () => {
    const { grant } = await login();
    const a = await repo.beginRefresh(grant.id);
    await repo.recordResult(a.id, a.dispatchToken, {
      accessToken: "late-after-lock",
    });
    await db.centralAttempt.update({
      where: { id: a.id },
      data: { deadline: new Date(Date.now() + 800) },
    });
    let locked!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${grant.userId} FOR UPDATE`;
      locked();
      await hold;
    });
    await ready;
    const result = repo.completeRefresh(a.id, expires()).then(
      () => ({ applied: true }),
      (error: { code: string }) => ({ applied: false, code: error.code }),
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    release();
    await blocker;
    expect(await result).toEqual({
      applied: false,
      code: "result_unavailable",
    });
    expect((await repo.inspectAttempt(a.id))?.status).toBe("RESULT");
    expect(
      (await db.centralGrant.findUniqueOrThrow({ where: { id: grant.id } }))
        .version,
    ).toBe(grant.version);
    await repo.rejectResult(a.id);
    expect(await db.centralRevocation.count()).toBeGreaterThan(0);
  });
  it("已应用刷新跨过期限仍保持永久归属，不因重读而撤销", async () => {
    const { grant } = await login();
    const a = await repo.beginRefresh(grant.id);
    await repo.recordResult(a.id, a.dispatchToken, {
      accessToken: "applied-before-deadline",
    });
    await repo.completeRefresh(a.id, expires());
    await db.centralAttempt.update({
      where: { id: a.id },
      data: { deadline: new Date(0) },
    });
    expect(await repo.completeRefresh(a.id, expires())).toEqual({
      grantId: grant.id,
      alreadyApplied: true,
    });
    expect(await db.centralRevocation.count()).toBe(0);
  });
  it("刷新时用户版本改变不能应用结果，缺省RT保留前次RT但不复制旧AT", async () => {
    const { grant } = await login();
    const a = await repo.beginRefresh(grant.id);
    await repo.recordResult(a.id, a.dispatchToken, {
      accessToken: "only-new-at",
    });
    await repo.completeRefresh(a.id, expires());
    const b = await repo.beginRefresh(grant.id);
    expect(b.refreshToken).toMatch(/^synthetic-rt-/);
    await repo.recordResult(b.id, b.dispatchToken, {
      accessToken: "too-late-at",
    });
    await db.user.update({
      where: { id: grant.userId },
      data: { tokenVersion: { increment: 1 } },
    });
    await expect(repo.completeRefresh(b.id, expires())).rejects.toMatchObject({
      code: "grant_unavailable",
    });
    await repo.rejectResult(b.id);
    expect(
      (await db.centralGrant.findUniqueOrThrow({ where: { id: grant.id } }))
        .revokedAt,
    ).not.toBeNull();
  });
  it("上游结果首次落库失败仍为DISPATCHED，不能误补偿；原owner可重存", async () => {
    const p = await repo.prepare(input());
    const a = await repo.dispatchAuthorization(p.state, browser);
    const failing = new CentralAuthRepository(
      new Proxy(db, {
        get(target, prop) {
          if (prop === "$transaction")
            return async (cb: (tx: unknown) => Promise<unknown>) =>
              target.$transaction(async (tx) => {
                await cb(tx);
                throw new Error("synthetic database commit failure");
              });
          return Reflect.get(target, prop);
        },
      }),
      cipher,
    );
    const tokens = {
      accessToken: "synthetic-already-issued-at",
      refreshToken: "synthetic-already-issued-rt",
    };
    await expect(
      failing.recordResult(a.id, a.dispatchToken, tokens),
    ).rejects.toThrow("synthetic database commit failure");
    expect((await repo.inspectAttempt(a.id))?.status).toBe("DISPATCHED");
    await expect(repo.rejectResult(a.id)).rejects.toMatchObject({
      code: "result_unavailable",
    });
    expect(await db.centralRevocation.count()).toBe(0);
    await repo.recordResult(a.id, a.dispatchToken, tokens);
    await repo.rejectResult(a.id);
    expect(await db.centralRevocation.count()).toBe(1);
  });
});
