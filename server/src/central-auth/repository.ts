/**
 * Durable ownership for OIDC requests. No provider call or HTTP input belongs here.
 * The future coordinator must verify OIDC and local reauthentication before calling
 * completeAuthorization; this persistence package does not claim those protocols exist.
 * All central writes serialize under one short DB advisory transaction lock, and user
 * rows are locked separately against existing local account operations. No network I/O
 * occurs under the lock. Time is read from PostgreSQL AFTER acquiring the lock.
 */
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { CredentialCipher, digest, randomSecret } from "./crypto";

export const PENDING_TTL_MS = 10 * 60_000;
export const LOCAL_PROOF_TTL_MS = 5 * 60_000;
export const DISPATCH_TTL_MS = 60_000;
export const REVOCATION_RETENTION_MS = 7 * 86400_000;
export const TERMINAL_RETENTION_MS = 86400_000;
type Tx = Prisma.TransactionClient;
async function dbNow(tx: Tx): Promise<Date> {
  const [clock] = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  return clock.now;
}
export type TokenMaterial = {
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: number;
};
export type LocalProof = {
  userId: number;
  sessionHash: string;
  tokenVersion: number;
  authenticatedAt: number;
};
type PendingSecrets = { nonce: string; verifier: string };
type AuthorizationRequest = PendingSecrets & {
  redirectUri: string;
  link: LocalProof | null;
};
export class CentralPersistenceError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
function fail(code: string): never {
  throw new CentralPersistenceError(code);
}
function text(value: string): string {
  if (!value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value))
    fail("invalid_input");
  return value;
}
function sessionId(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) fail("invalid_session_hash");
  return value;
}
function date(value: number): Date {
  if (
    !Number.isSafeInteger(value) ||
    !Number.isFinite(new Date(value).getTime())
  )
    fail("invalid_time");
  return new Date(value);
}

export class CentralAuthRepository {
  constructor(
    private readonly db: PrismaClient,
    private readonly cipher: CredentialCipher,
  ) {}
  private async transaction<T>(
    run: (tx: Tx, now: Date) => Promise<T>,
  ): Promise<T> {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(684390126551::bigint)::text`;
      return run(tx, await dbNow(tx));
    });
  }
  private async localProof(
    tx: Tx,
    proof: LocalProof,
    now: Date,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${proof.userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT jti_hash FROM access_sessions WHERE jti_hash = ${proof.sessionHash} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: proof.userId } });
    const session = await tx.accessSession.findUnique({
      where: { jtiHash: proof.sessionHash },
    });
    now = await dbNow(tx);
    const age = now.getTime() - proof.authenticatedAt;
    if (
      !user ||
      user.tokenVersion !== proof.tokenVersion ||
      !session ||
      session.userId !== user.id ||
      session.tokenVersion !== user.tokenVersion ||
      age < 0 ||
      age >= LOCAL_PROOF_TTL_MS
    )
      fail("local_proof_invalid");
  }
  async prepare(input: {
    issuer: string;
    clientId: string;
    redirectUri: string;
    browser: string;
    nonce: string;
    verifier: string;
    link?: LocalProof;
  }) {
    const id = randomUUID(),
      state = randomSecret();
    return this.transaction(async (tx, now) => {
      if (input.link) await this.localProof(tx, input.link, now);
      await tx.centralPending.create({
        data: {
          id,
          stateHash: digest(state),
          browserHash: digest(text(input.browser)),
          issuer: text(input.issuer),
          clientId: text(input.clientId),
          redirectUri: text(input.redirectUri),
          secretsCipher: this.cipher.seal(`pending:${id}`, {
            nonce: text(input.nonce),
            verifier: text(input.verifier),
          }),
          linkUserId: input.link?.userId,
          linkSessionHash: input.link?.sessionHash,
          linkTokenVersion: input.link?.tokenVersion,
          linkProofAt: input.link ? date(input.link.authenticatedAt) : null,
          expiresAt: new Date(now.getTime() + PENDING_TTL_MS),
        },
      });
      return { state, id };
    });
  }
  async dispatchAuthorization(state: string, browser: string) {
    return this.transaction(async (tx, now) => {
      const pending = await tx.centralPending.findUnique({
        where: { stateHash: digest(text(state)) },
      });
      if (
        !pending ||
        pending.browserHash !== digest(text(browser)) ||
        pending.consumedAt ||
        !pending.secretsCipher ||
        pending.expiresAt <= now
      )
        fail("pending_unavailable");
      const secrets = this.cipher.open<PendingSecrets>(
        `pending:${pending.id}`,
        pending.secretsCipher,
      );
      const link: LocalProof | null =
        pending.linkUserId === null
          ? null
          : {
              userId: pending.linkUserId,
              sessionHash: pending.linkSessionHash!,
              tokenVersion: pending.linkTokenVersion!,
              authenticatedAt: pending.linkProofAt!.getTime(),
            };
      if (link) await this.localProof(tx, link, now);
      const id = randomUUID(),
        dispatchToken = randomSecret();
      const request: AuthorizationRequest = {
        ...secrets,
        redirectUri: pending.redirectUri,
        link,
      };
      await tx.centralAttempt.create({
        data: {
          id,
          kind: "authorization",
          pendingId: pending.id,
          issuer: pending.issuer,
          clientId: pending.clientId,
          dispatchHash: digest(dispatchToken),
          requestCipher: this.cipher.seal(`request:${id}`, request),
          deadline: new Date(now.getTime() + DISPATCH_TTL_MS),
        },
      });
      await tx.centralPending.update({
        where: { id: pending.id },
        data: { consumedAt: now, secretsCipher: null },
      });
      return {
        id,
        dispatchToken,
        issuer: pending.issuer,
        clientId: pending.clientId,
        request,
      };
    });
  }
  async beginRefresh(grantId: string) {
    return this.transaction(async (tx, now) => {
      const grant = await tx.centralGrant.findUnique({
        where: { id: grantId },
      });
      if (
        !grant ||
        grant.revokedAt ||
        !grant.tokensCipher ||
        grant.activeAttemptId ||
        grant.expiresAt <= now ||
        !grant.sessionHash
      )
        fail("grant_unavailable");
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${grant.userId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: grant.userId } });
      const session = await tx.accessSession.findUnique({
        where: { jtiHash: grant.sessionHash },
      });
      if (
        !user ||
        user.tokenVersion !== grant.tokenVersion ||
        !session ||
        session.userId !== user.id ||
        session.tokenVersion !== user.tokenVersion
      )
        fail("grant_unavailable");
      now = await dbNow(tx);
      if (grant.expiresAt <= now) fail("grant_unavailable");
      const tokens = this.cipher.open<TokenMaterial>(
        `grant:${grant.id}:${grant.version}`,
        grant.tokensCipher,
      );
      if (!tokens.refreshToken) fail("refresh_unavailable");
      const id = randomUUID(),
        dispatchToken = randomSecret();
      await tx.centralAttempt.create({
        data: {
          id,
          kind: "refresh",
          grantId: grant.id,
          expectedVersion: grant.version,
          issuer: grant.issuer,
          clientId: grant.clientId,
          dispatchHash: digest(dispatchToken),
          requestCipher: this.cipher.seal(`request:${id}`, {
            refreshToken: tokens.refreshToken,
          }),
          deadline: new Date(now.getTime() + DISPATCH_TTL_MS),
        },
      });
      await tx.centralGrant.update({
        where: { id: grant.id },
        data: { activeAttemptId: id },
      });
      return {
        id,
        dispatchToken,
        issuer: grant.issuer,
        clientId: grant.clientId,
        refreshToken: tokens.refreshToken,
      };
    });
  }
  /** The original dispatch owner may persist a late result, but never dispatch again. */
  async recordResult(id: string, dispatchToken: string, tokens: TokenMaterial) {
    const hash = digest(JSON.stringify(tokens));
    return this.transaction(async (tx) => {
      const attempt = await tx.centralAttempt.findUnique({ where: { id } });
      if (!attempt || attempt.dispatchHash !== digest(dispatchToken))
        fail("attempt_unavailable");
      if (attempt.resultHash) {
        if (attempt.resultHash !== hash) fail("result_conflict");
        return { status: attempt.status, grantId: attempt.grantId };
      }
      if (!["DISPATCHED", "UNKNOWN"].includes(attempt.status))
        fail("attempt_unavailable");
      await tx.centralAttempt.update({
        where: { id },
        data: {
          status: "RESULT",
          resultHash: hash,
          resultCipher: this.cipher.seal(`result:${id}`, tokens),
        },
      });
      return { status: "RESULT", grantId: attempt.grantId };
    });
  }
  /** Absence is unknown. A caller must NEVER compensate by revoking on absence/error. */
  async inspectAttempt(id: string) {
    const a = await this.db.centralAttempt.findUnique({ where: { id } });
    return a
      ? {
          id: a.id,
          status: a.status,
          grantId: a.grantId,
          resultHash: a.resultHash,
        }
      : null;
  }
  async readResult(
    id: string,
  ): Promise<{ tokens: TokenMaterial; issuer: string; clientId: string }> {
    const a = await this.db.centralAttempt.findUnique({ where: { id } });
    if (!a || a.status !== "RESULT" || !a.resultCipher)
      fail("result_unavailable");
    return {
      tokens: this.cipher.open<TokenMaterial>(`result:${id}`, a.resultCipher),
      issuer: a.issuer,
      clientId: a.clientId,
    };
  }
  /** Trusted verified OIDC output only. Never expose this method as an HTTP handler. */
  async completeAuthorization(input: {
    attemptId: string;
    subject: string;
    rootSid?: string;
    sessionHash: string;
    expiresAt: number;
    newUser?: {
      email: string;
      termsAcceptedAt: number;
      termsDocumentVersion: string;
    };
  }) {
    return this.transaction(async (tx, now) => {
      const a = await tx.centralAttempt.findUnique({
        where: { id: input.attemptId },
      });
      if (!a || a.kind !== "authorization") fail("attempt_unavailable");
      if (a.status === "APPLIED")
        return { grantId: a.grantId!, alreadyApplied: true };
      if (
        a.status !== "RESULT" ||
        !a.resultCipher ||
        !a.requestCipher ||
        a.deadline <= now
      )
        fail("result_unavailable");
      const request = this.cipher.open<AuthorizationRequest>(
        `request:${a.id}`,
        a.requestCipher,
      );
      const tokens = this.cipher.open<TokenMaterial>(
        `result:${a.id}`,
        a.resultCipher,
      );
      if (!tokens.accessToken || date(input.expiresAt) <= now)
        fail("invalid_grant");
      const subject = text(input.subject);
      const identity = await tx.centralIdentity.findUnique({
        where: { issuer_subject: { issuer: a.issuer, subject } },
      });
      let userId: number;
      if (request.link) {
        await this.localProof(tx, request.link, now);
        if (identity && identity.userId !== request.link.userId)
          fail("identity_conflict");
        userId = request.link.userId;
      } else if (identity) userId = identity.userId;
      else {
        if (!input.newUser) fail("onboarding_required");
        const email = text(input.newUser.email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          fail("onboarding_required");
        if (
          await tx.user.findFirst({
            where: { email: { equals: email, mode: "insensitive" } },
          })
        )
          fail("binding_required");
        const acceptedAt = date(input.newUser.termsAcceptedAt);
        if (
          acceptedAt > now ||
          now.getTime() - acceptedAt.getTime() >= PENDING_TTL_MS
        )
          fail("consent_required");
        userId = (
          await tx.user.create({
            data: {
              email,
              isVerified: 1,
              termsAcceptedAt: BigInt(acceptedAt.getTime()),
              termsDocumentVersion: text(input.newUser.termsDocumentVersion),
            },
          })
        ).id;
      }
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      now = await dbNow(tx);
      if (a.deadline <= now || date(input.expiresAt) <= now)
        fail("result_unavailable");
      if (!identity)
        await tx.centralIdentity.create({
          data: { id: randomUUID(), issuer: a.issuer, subject, userId },
        });
      const grantId = randomUUID();
      await tx.accessSession.create({
        data: {
          jtiHash: sessionId(input.sessionHash),
          userId,
          tokenVersion: user.tokenVersion,
          createdAt: BigInt(now.getTime()),
          lastSeenAt: BigInt(now.getTime()),
        },
      });
      await tx.centralGrant.create({
        data: {
          id: grantId,
          userId,
          sessionHash: input.sessionHash,
          tokenVersion: user.tokenVersion,
          issuer: a.issuer,
          subject,
          clientId: a.clientId,
          rootSid: input.rootSid === undefined ? null : text(input.rootSid),
          authorizationAttemptId: a.id,
          tokensCipher: this.cipher.seal(`grant:${grantId}:1`, tokens),
          expiresAt: date(input.expiresAt),
        },
      });
      await tx.centralAttempt.update({
        where: { id: a.id },
        data: {
          status: "APPLIED",
          grantId,
          requestCipher: null,
          resultCipher: null,
          finishedAt: now,
        },
      });
      return { grantId, alreadyApplied: false };
    });
  }
  async completeRefresh(attemptId: string, expiresAt: number) {
    return this.transaction(async (tx, now) => {
      const a = await tx.centralAttempt.findUnique({
        where: { id: attemptId },
      });
      if (!a || a.kind !== "refresh") fail("attempt_unavailable");
      if (a.status === "APPLIED")
        return { grantId: a.grantId!, alreadyApplied: true };
      if (a.status !== "RESULT" || !a.resultCipher) fail("result_unavailable");
      const grant = await tx.centralGrant.findUnique({
        where: { id: a.grantId! },
      });
      if (
        !grant ||
        grant.revokedAt ||
        grant.activeAttemptId !== a.id ||
        grant.version !== a.expectedVersion ||
        !grant.sessionHash ||
        grant.expiresAt <= now
      )
        fail("grant_unavailable");
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${grant.userId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: grant.userId } });
      const session = await tx.accessSession.findUnique({
        where: { jtiHash: grant.sessionHash },
      });
      if (
        !user ||
        user.tokenVersion !== grant.tokenVersion ||
        !session ||
        session.userId !== user.id ||
        session.tokenVersion !== user.tokenVersion
      )
        fail("grant_unavailable");
      const tokens = this.cipher.open<TokenMaterial>(
        `result:${a.id}`,
        a.resultCipher,
      );
      if (!tokens.accessToken || date(expiresAt) <= now) fail("invalid_grant");
      now = await dbNow(tx);
      if (date(expiresAt) <= now || grant.expiresAt <= now)
        fail("grant_unavailable");
      const previous = this.cipher.open<TokenMaterial>(
        `grant:${grant.id}:${grant.version}`,
        grant.tokensCipher!,
      );
      const next = {
        ...tokens,
        refreshToken: tokens.refreshToken ?? previous.refreshToken,
      };
      await tx.centralGrant.update({
        where: { id: grant.id },
        data: {
          version: { increment: 1 },
          activeAttemptId: null,
          tokensCipher: this.cipher.seal(
            `grant:${grant.id}:${grant.version + 1}`,
            next,
          ),
          expiresAt: date(expiresAt),
        },
      });
      await tx.centralAttempt.update({
        where: { id: a.id },
        data: {
          status: "APPLIED",
          requestCipher: null,
          resultCipher: null,
          finishedAt: now,
        },
      });
      return { grantId: grant.id, alreadyApplied: false };
    });
  }
  private async enqueue(
    tx: Tx,
    now: Date,
    input: {
      key: string;
      issuer: string;
      clientId: string;
      grantId?: string | null;
      tokens: TokenMaterial;
    },
  ) {
    const existing = await tx.centralRevocation.findUnique({
      where: { dedupeKey: input.key },
    });
    if (existing) return existing.id;
    const id = randomUUID();
    await tx.centralRevocation.create({
      data: {
        id,
        dedupeKey: input.key,
        issuer: input.issuer,
        clientId: input.clientId,
        grantId: input.grantId,
        tokensCipher: this.cipher.seal(`revoke:${id}`, input.tokens),
        nextAttemptAt: now,
        expiresAt: new Date(now.getTime() + REVOCATION_RETENTION_MS),
      },
    });
    return id;
  }
  private async revokeIn(tx: Tx, now: Date, grantId: string) {
    const grant = await tx.centralGrant.findUnique({ where: { id: grantId } });
    if (!grant || grant.revokedAt) return;
    if (grant.tokensCipher)
      await this.enqueue(tx, now, {
        key: `grant:${grant.id}:${grant.version}`,
        issuer: grant.issuer,
        clientId: grant.clientId,
        grantId: grant.id,
        tokens: this.cipher.open<TokenMaterial>(
          `grant:${grant.id}:${grant.version}`,
          grant.tokensCipher,
        ),
      });
    // Detach before deleting the local session. Never remove its pending refresh owner.
    await tx.centralGrant.update({
      where: { id: grant.id },
      data: { revokedAt: now, tokensCipher: null, sessionHash: null },
    });
    if (grant.sessionHash)
      await tx.accessSession.deleteMany({
        where: { jtiHash: grant.sessionHash, userId: grant.userId },
      });
  }
  async revokeGrant(grantId: string) {
    return this.transaction((tx, now) => this.revokeIn(tx, now, grantId));
  }
  private async rejectIn(tx: Tx, now: Date, attemptId: string) {
    const a = await tx.centralAttempt.findUnique({ where: { id: attemptId } });
    if (!a) fail("attempt_unavailable");
    if (a.status === "APPLIED") fail("result_already_owned");
    if (a.status === "REJECTED") return;
    if (a.status !== "RESULT" || !a.resultCipher) fail("result_unavailable");
    if (a.kind === "refresh" && a.grantId)
      await this.revokeIn(tx, now, a.grantId);
    await this.enqueue(tx, now, {
      key: `attempt:${a.id}`,
      issuer: a.issuer,
      clientId: a.clientId,
      grantId: a.grantId,
      tokens: this.cipher.open<TokenMaterial>(`result:${a.id}`, a.resultCipher),
    });
    await tx.centralAttempt.update({
      where: { id: a.id },
      data: {
        status: "REJECTED",
        requestCipher: null,
        resultCipher: null,
        finishedAt: now,
      },
    });
  }
  /** Explicit rejection only. An APPLIED result remains owned even after later rotation. */
  async rejectResult(attemptId: string) {
    return this.transaction((tx, now) => this.rejectIn(tx, now, attemptId));
  }
  /** Call inside the product closure coordinator BEFORE deleting User; does not delete the user. */
  async prepareUserClosure(
    userId: number,
    removeUser: (tx: Tx) => Promise<void>,
  ) {
    return this.transaction(async (tx, now) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      for (const grant of await tx.centralGrant.findMany({
        where: { userId },
      })) {
        await this.revokeIn(tx, now, grant.id);
        const results = await tx.centralAttempt.findMany({
          where: { grantId: grant.id, status: "RESULT" },
        });
        for (const a of results) {
          if (a.resultCipher)
            await this.enqueue(tx, now, {
              key: `attempt:${a.id}`,
              issuer: a.issuer,
              clientId: a.clientId,
              grantId: grant.id,
              tokens: this.cipher.open<TokenMaterial>(
                `result:${a.id}`,
                a.resultCipher,
              ),
            });
          await tx.centralAttempt.update({
            where: { id: a.id },
            data: {
              status: "REJECTED",
              requestCipher: null,
              resultCipher: null,
              finishedAt: now,
            },
          });
        }
        await tx.centralGrant.delete({ where: { id: grant.id } });
      }
      await removeUser(tx);
      if (await tx.user.findUnique({ where: { id: userId } }))
        fail("closure_not_completed");
      await tx.centralPending.deleteMany({ where: { linkUserId: userId } });
    });
  }
  async claimRevocation() {
    return this.transaction(async (tx, now) => {
      const row = await tx.centralRevocation.findFirst({
        where: {
          status: "PENDING",
          expiresAt: { gt: now },
          nextAttemptAt: { lte: now },
          OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
        },
        orderBy: { createdAt: "asc" },
      });
      if (!row || !row.tokensCipher) return null;
      const lease = randomSecret();
      await tx.centralRevocation.update({
        where: { id: row.id },
        data: {
          leaseHash: digest(lease),
          leaseUntil: new Date(now.getTime() + DISPATCH_TTL_MS),
          attempts: { increment: 1 },
        },
      });
      return {
        id: row.id,
        lease,
        issuer: row.issuer,
        clientId: row.clientId,
        tokens: this.cipher.open<TokenMaterial>(
          `revoke:${row.id}`,
          row.tokensCipher,
        ),
      };
    });
  }
  async finishRevocation(id: string, lease: string, confirmed: boolean) {
    return this.transaction(async (tx, now) => {
      const row = await tx.centralRevocation.findUnique({ where: { id } });
      if (
        !row ||
        row.status !== "PENDING" ||
        row.leaseHash !== digest(lease) ||
        !row.leaseUntil ||
        row.leaseUntil <= now ||
        row.expiresAt <= now
      )
        fail("lease_unavailable");
      await tx.centralRevocation.update({
        where: { id },
        data: confirmed
          ? {
              status: "CONFIRMED",
              tokensCipher: null,
              leaseHash: null,
              leaseUntil: null,
              finishedAt: now,
            }
          : {
              leaseHash: null,
              leaseUntil: null,
              nextAttemptAt: new Date(
                now.getTime() +
                  Math.min(3600_000, 1000 * 2 ** Math.min(row.attempts, 12)),
              ),
            },
      });
    });
  }
  async cleanup() {
    return this.transaction(async (tx, now) => {
      await tx.centralPending.deleteMany({
        where: { expiresAt: { lte: now } },
      });
      await tx.centralAttempt.updateMany({
        where: { status: "DISPATCHED", deadline: { lte: now } },
        data: { status: "UNKNOWN", requestCipher: null },
      });
      for (const result of await tx.centralAttempt.findMany({
        where: { status: "RESULT", deadline: { lte: now } },
        take: 100,
      }))
        await this.rejectIn(tx, now, result.id);
      for (const grant of await tx.centralGrant.findMany({
        where: { revokedAt: null, expiresAt: { lte: now } },
        take: 100,
      }))
        await this.revokeIn(tx, now, grant.id);
      const expired = await tx.centralRevocation.updateMany({
        where: { status: "PENDING", expiresAt: { lte: now } },
        data: {
          status: "EXPIRED_UNCONFIRMED",
          tokensCipher: null,
          leaseHash: null,
          leaseUntil: null,
          finishedAt: now,
        },
      });
      const cutoff = new Date(now.getTime() - TERMINAL_RETENTION_MS);
      await tx.centralRevocation.deleteMany({
        where: {
          finishedAt: { lt: cutoff },
          status: { in: ["CONFIRMED", "EXPIRED_UNCONFIRMED"] },
        },
      });
      await tx.centralGrant.deleteMany({
        where: { revokedAt: { lt: cutoff } },
      });
      await tx.centralAttempt.deleteMany({
        where: {
          finishedAt: { lt: cutoff },
          status: { in: ["APPLIED", "REJECTED"] },
        },
      });
      return { expiredUnconfirmed: expired.count };
    });
  }
}
