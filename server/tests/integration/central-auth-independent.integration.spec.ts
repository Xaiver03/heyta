import { sessionIssuer } from "../fixtures/central-session-issuer";
/** Independent lock/expiry counterexamples against real PostgreSQL. */
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, it, expect } from "vitest";
import { CentralAuthRepository } from "../../src/central-auth/repository";
import {
  CredentialCipher,
  digest,
  randomSecret,
} from "../../src/central-auth/crypto";
const url = process.env.HEYTA_CENTRAL_TEST_DATABASE_URL;
if (
  !url ||
  !/^postgresql:\/\/postgres@127\.0\.0\.1:\d+\/heyta_central_auth_review_test$/.test(
    url,
  )
)
  throw new Error("Independent local fixture required");
const db = new PrismaClient({ datasources: { db: { url } } });
const repo = new CentralAuthRepository(
  db,
  new CredentialCipher("51".repeat(32)),
  sessionIssuer,
);
const input = () => ({
  issuer: "https://identity.example.test",
  clientId: "review",
  redirectUri: "https://heyta.example.test/callback",
  browser: randomSecret(),
  nonce: randomSecret(),
  verifier: randomSecret(),
});
afterAll(() => db.$disconnect());
describe("独立持久层期限反例", () => {
  it("刷新迟到结果不能越过派发deadline应用，即使清理尚未运行", async () => {
    const i = input(),
      p = await repo.prepare(i),
      a = await repo.dispatchAuthorization(p.state, i.browser);
    await repo.recordResult(a.id, a.dispatchToken, {
      accessToken: "synthetic-at",
      refreshToken: "synthetic-rt",
    });
    const r = await repo.completeAuthorization({
      attemptId: a.id,
      accessExpiresAt: Date.now() + 300_000,
      subject: randomSecret(),
      expiresAt: Date.now() + 3600000,
      newUser: {
        email: randomSecret() + "@independent.test",
        termsAcceptedAt: Date.now(),
        termsDocumentVersion: "test",
      },
    });
    const f = await repo.beginRefresh(r.grantId);
    await db.centralAttempt.update({
      where: { id: f.id },
      data: { deadline: new Date(0) },
    });
    await repo.recordResult(f.id, f.dispatchToken, {
      accessToken: "synthetic-late-at",
    });
    await expect(
      repo.completeRefresh(f.id, Date.now() + 3600000, Date.now() + 300_000),
    ).rejects.toMatchObject({ code: "result_unavailable" });
    expect((await repo.inspectAttempt(f.id))?.status).toBe("RESULT");
    await repo.rejectResult(f.id);
  });
  it("pending等待旧账户行锁跨过expiresAt，不能再派发", async () => {
    const u = await db.user.create({
        data: { email: randomSecret() + "@independent.test" },
      }),
      sessionHash = digest(randomSecret());
    await db.accessSession.create({
      data: {
        jtiHash: sessionHash,
        userId: u.id,
        tokenVersion: u.tokenVersion,
        createdAt: BigInt(Date.now()),
        lastSeenAt: BigInt(Date.now()),
      },
    });
    const i = input(),
      p = await repo.prepare({
        ...i,
        link: {
          userId: u.id,
          sessionHash,
          tokenVersion: u.tokenVersion,
          authenticatedAt: Date.now(),
        },
      });
    await db.centralPending.update({
      where: { id: p.id },
      data: { expiresAt: new Date(Date.now() + 800) },
    });
    let locked!: () => void, release!: () => void;
    const ready = new Promise<void>((r) => (locked = r)),
      hold = new Promise<void>((r) => (release = r));
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${u.id} FOR UPDATE`;
      locked();
      await hold;
    });
    await ready;
    const result = repo.dispatchAuthorization(p.state, i.browser).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    );
    await new Promise((r) => setTimeout(r, 1000));
    release();
    await blocker;
    expect(await result).toMatchObject({
      ok: false,
      error: { code: "pending_unavailable" },
    });
    expect(await db.centralAttempt.count({ where: { pendingId: p.id } })).toBe(
      0,
    );
  });
});
