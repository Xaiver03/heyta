interface AuthCacheEntry {
  userId: number;
  /**
   * 线协议上的会话身份（`jti` 的 SHA-256）。`null` = 本轮之前签的、**没有 `jti`** 的令牌，
   * 它们只能靠 `tokenVersion` 整体作废（`sessions-revocable-contract` 那条过渡）。
   */
  sessionId: string | null;
  tokenVersion: number;
  isVerified: boolean;
  expiresAt: number;
}

/**
 * 🔴 **缓存的键必须和它替掉的那次判定同粒度。**
 *
 * 原来这里按 `userId` 存一格 `{tokenVersion, isVerified}`，而 `verifyToken` 的缓存命中
 * **整段跳过 DB 读** —— 问题是那次判定读的不只是账号行，还有「这一枚会话还活着吗」
 * （`sessionIsLive`，ADR-0063 §2.5）。一格按人存的"合法"结论被同账号的**另一枚**令牌命中时，
 * 那一枚就免查了会话边界。实测形状（2026-10-09，`research/tools/account-email-sessions-http-probe.mjs`
 * 判据 25）：撤销 C 那台之后，只要 B 那台还在同步，C 的令牌照样回 **200** ——
 * 撤销变成"只有当别人恰好没把缓存焐热时才生效"，而界面上那句
 * "退出哪一台，它的下一次请求就要重新登录"就成了假话。撤销时那一次
 * `authCache.invalidate(userId)` 挡不住它：B 的下一次请求又把这一格写回来。
 *
 * 修法是把**会话身份放进键**：每一枚令牌只命中自己那一格，
 * 别人焐不热它。撤销一枚会话时连同该账号全部格一起丢（撤销很少发生，
 * 一次 O(条目数) 的扫描换"少一处会说谎的边界"）。
 */
const keyOf = (userId: number, sessionId: string | null): string =>
  `${userId}:${sessionId ?? 'no-jti'}`;

const AUTH_CACHE_TTL_MS = 30 * 1000;
/** 现在按**会话**数上限，不再按人数（一格 = 一枚令牌；一台设备多标签页也只有一枚）。 */
const AUTH_CACHE_MAX_ENTRIES = 10_000;

class AuthCache {
  private entries = new Map<string, AuthCacheEntry>();
  private invalidationVersions = new Map<number, number>();

  get(userId: number, sessionId: string | null): AuthCacheEntry | null {
    const key = keyOf(userId, sessionId);
    const entry = this.entries.get(key);
    if (!entry) return null;

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  getInvalidationVersion(userId: number): number {
    return this.invalidationVersions.get(userId) ?? 0;
  }

  setIfCurrent(
    userId: number,
    sessionId: string | null,
    tokenVersion: number,
    isVerified: boolean,
    expectedInvalidationVersion: number,
  ): boolean {
    if (this.getInvalidationVersion(userId) !== expectedInvalidationVersion) {
      return false;
    }

    const key = keyOf(userId, sessionId);
    this.entries.delete(key);
    this.entries.set(key, {
      userId,
      sessionId,
      tokenVersion,
      isVerified,
      expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
    });

    while (this.entries.size > AUTH_CACHE_MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
    return true;
  }

  set(userId: number, sessionId: string | null, tokenVersion: number, isVerified: boolean): void {
    this.setIfCurrent(
      userId,
      sessionId,
      tokenVersion,
      isVerified,
      this.getInvalidationVersion(userId),
    );
  }

  invalidate(userId: number): void {
    const nextVersion = this.getInvalidationVersion(userId) + 1;
    // Re-insert at the tail so the just-invalidated user is the MOST recently
    // used. invalidationVersions must persist after entries.delete() so a
    // verifyToken whose DB read raced this invalidate fails its setIfCurrent CAS
    // and does not cache stale-valid data. Bounding the map is required (it
    // otherwise grows one entry per lifetime-invalidated user, unbounded on a
    // long-lived single replica). Evicting the OLDEST invalidations is safe: an
    // invalidation only needs to survive until the racing in-flight read's
    // setIfCurrent (bounded by one DB round trip). A freshly-invalidated user
    // sits at the MRU tail, so it can only be evicted after every other of the
    // 10k tracked invalidations are newer than it — far beyond any read window.
    this.invalidationVersions.delete(userId);
    this.invalidationVersions.set(userId, nextVersion);
    // 🔴 这个账号的**每一枚**会话都要掉：键里带了 sessionId，所以不能再按一个 key 删。
    for (const [key, entry] of this.entries) {
      if (entry.userId === userId) this.entries.delete(key);
    }

    while (this.invalidationVersions.size > AUTH_CACHE_MAX_ENTRIES) {
      const oldestKey = this.invalidationVersions.keys().next().value;
      if (oldestKey === undefined) break;
      this.invalidationVersions.delete(oldestKey);
    }
  }

  clear(): void {
    this.entries.clear();
    this.invalidationVersions.clear();
  }
}

// Safe while Helm caps SuperSync at one replica. A future multi-instance rollout
// needs shared invalidation or a lower revocation-lag design.
//
// `isVerified` currently has no verified -> unverified transition; unverified
// passkey registrations are deleted on failure. If verification revocation is
// added later, invalidate this cache beside that write.
export const authCache = new AuthCache();
