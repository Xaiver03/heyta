/**
 * 版本策略的**纯逻辑**：数字段比较、强制/可选判定、灰度分桶。
 * ============================================================
 *
 * 这里不碰 Fastify、不碰 env、不碰 IO —— 全是可单测的纯函数（`server/tests/app-version.spec.ts`）。
 * 路由（`app-version.routes.ts`）只负责「解析查询串 → 调这里 → 加 `no-store` 头」。
 *
 * ## 🔴 为什么版本比较必须是「数字段」
 *
 * 字符串比较下 `"1.2.10" < "1.2.9"`（因为逐字符 `'1' < '9'`），于是发版到 `1.2.10` 后，
 * 所有 `1.2.9` 的客户端都会被判「已是最新」，**永远检测不到这次更新**。
 * 这是这条机制最容易踩、且踩了不报错的坑，所以比较逻辑只住在这里一份，客户端不碰。
 */

/** 把 `1.2.10` 拆成 `[1,2,10]`。调用方必须先用契约的 `isValidAppVersion` 校验过形状。 */
export function parseVersionSegments(version: string): number[] {
  return version.split('.').map((s) => Number.parseInt(s, 10));
}

/**
 * 数字段比较：`a<b` 返回 -1，`a==b` 返回 0，`a>b` 返回 1。
 * 缺段补 0（`1.0` ≡ `1.0.0`）。调用前须保证两参都是合法版本形状。
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersionSegments(a);
  const pb = parseVersionSegments(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * 灰度分桶：稳定 hash → `[0,100)`。同一 `deviceId` 每次落同一桶（FNV-1a 32 位，取模 100）。
 *
 * 🔴 必须**稳定**：用会变的东西（随机数、时间、内存地址）分桶，会让同一台设备在
 * 「进了灰度」与「没进」之间反复横跳 —— 表现为「更新提示时有时无」。
 */
export function stableBucket(deviceId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < deviceId.length; i += 1) {
    hash ^= deviceId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

export interface VersionPolicyInput {
  /** 客户端上报的当前版本（已过契约形状校验）。 */
  currentVersion: string;
  /** 客户端上报的 build 号（整数，可空）。同一 `currentVersion` 下的内测包靠它区分。 */
  currentBuild?: number;
  /** 部署方配置的最新版本。 */
  latestVersion: string;
  /** 强制底线版本。 */
  minSupportedVersion: string;
  /** 最新版本对应的 build（可空）。 */
  latestBuild?: number;
  /** 强制底线版本对应的 build（可空）。 */
  minBuild?: number;
  /** 灰度比例 0–100。 */
  rolloutPercent: number;
  /** 设备稳定标识（仅用于分桶）。 */
  deviceId?: string;
}

export interface VersionPolicyDecision {
  updateAvailable: boolean;
  forceUpdate: boolean;
  /** 本设备是否进入灰度（强制更新不看它）。 */
  inRollout: boolean;
  /** 本设备的分桶值；无 `deviceId` 时为 null。 */
  bucket: number | null;
}

/**
 * 判定（服务端唯一一处）。语义：
 *
 * - `current < minSupported` ⇒ 强制（同时可选为真）。
 * - 版本相同但 `currentBuild < minBuild` ⇒ 强制。
 * - 否则 `current < latestVersion`（或同版本 `currentBuild < latestBuild`）⇒ 可选。
 * - 可选更新再经灰度过滤：`bucket >= rolloutPercent` ⇒ 本机未进灰度 ⇒ `updateAvailable=false`。
 *   **强制更新不受灰度影响**。
 */
export function decideVersionPolicy(input: VersionPolicyInput): VersionPolicyDecision {
  const cmpMin = compareVersions(input.currentVersion, input.minSupportedVersion);
  const buildBelowMin =
    cmpMin === 0 &&
    input.currentBuild != null &&
    input.minBuild != null &&
    input.currentBuild < input.minBuild;
  const forceUpdate = cmpMin < 0 || buildBelowMin;

  const cmpLatest = compareVersions(input.currentVersion, input.latestVersion);
  const buildBelowLatest =
    cmpLatest === 0 &&
    input.currentBuild != null &&
    input.latestBuild != null &&
    input.currentBuild < input.latestBuild;
  const wantsUpdate = cmpLatest < 0 || buildBelowLatest;

  // 分桶：只在需要判可选更新时才有意义，但这里总是算出来（供观测/测试）。
  const bucket = input.deviceId ? stableBucket(input.deviceId) : null;

  if (forceUpdate) {
    return { updateAvailable: true, forceUpdate: true, inRollout: true, bucket };
  }
  if (!wantsUpdate) {
    return { updateAvailable: false, forceUpdate: false, inRollout: true, bucket };
  }

  // 可选更新的灰度：100% ⇒ 全量；无 deviceId ⇒ 无法分桶，按「可见」处理（宁可提示，不静默吞掉）。
  const inRollout =
    input.rolloutPercent >= 100 || input.deviceId == null || bucket! < input.rolloutPercent;

  return { updateAvailable: inRollout, forceUpdate: false, inRollout, bucket };
}
