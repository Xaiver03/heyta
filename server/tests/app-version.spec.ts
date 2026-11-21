/**
 * 自动更新：版本策略接口（`GET /api/app-version`）与纯逻辑。
 * ==========================================================
 *
 * 这份文件钉住 [`docs/plans/app-auto-update.md`](../docs/plans/app-auto-update.md)「验收」一节
 * 的前四条（第 5 条 curl 由脚本另跑）：
 *
 * | 承诺 | 用例 |
 * |---|---|
 * | 版本**数字段**比较（`1.2.10 > 1.2.9`），build 整数比较 | `compareVersions` / `decideVersionPolicy` 组 |
 * | 强制：`current < minSupported` ⇒ forceUpdate；仅低于最新 ⇒ updateAvailable | `decideVersionPolicy` 组 |
 * | 灰度：同 deviceId 同桶；强制不受灰度影响；可选可被灰度挡下 | `stableBucket` / rollout 组 |
 * | 契约：字段齐全、`Cache-Control: no-store`、匿名 200、400 不静默 | 路由组 |
 *
 * 路由组直接 `app.inject` 打真 Fastify（不 mock 任何东西），因为这条通道没有 DB 依赖。
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { APP_VERSION_PATHS, appVersionResponseSchema } from '@heyta/shared-schema';

import {
  compareVersions,
  decideVersionPolicy,
  parseVersionSegments,
  stableBucket,
} from '../src/app-version/policy';
import {
  AppVersionConfigError,
  buildAppVersionResponse,
  downloadUrlFor,
  loadAppVersionPolicyConfig,
  type AppVersionPolicyConfig,
} from '../src/app-version/config';
import { APP_VERSION_RATE_LIMIT, appVersionRoutes } from '../src/app-version/app-version.routes';

// ── 纯逻辑：版本比较 ────────────────────────────────────────────────
describe('compareVersions（数字段比较）', () => {
  it('1.2.10 > 1.2.9（字符串比较会判反的那一例）', () => {
    expect(compareVersions('1.2.10', '1.2.9')).toBe(1);
    expect(compareVersions('1.2.9', '1.2.10')).toBe(-1);
  });

  it('缺段补 0：1.0 == 1.0.0 == 1.0.0.0', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0', '1.0.0.0')).toBe(0);
    expect(compareVersions('1', '1.0.0')).toBe(0);
  });

  it('逐段整数比较，不是按字符串长度', () => {
    expect(compareVersions('10.0.0', '9.9.9')).toBe(1);
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('0.1.0', '0.0.9')).toBe(1);
  });

  it('parseVersionSegments 拆段', () => {
    expect(parseVersionSegments('1.2.10')).toEqual([1, 2, 10]);
  });
});

// ── 纯逻辑：分桶 ────────────────────────────────────────────────────
describe('stableBucket（灰度分桶）', () => {
  it('同一 deviceId 恒定、落在 [0,100)', () => {
    const a = stableBucket('device-abc');
    expect(stableBucket('device-abc')).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(100);
  });

  it('不同 deviceId 通常不同桶（抽样对照，非恒真判据）', () => {
    const buckets = new Set(Array.from({ length: 50 }, (_, i) => stableBucket(`d-${i}`)));
    expect(buckets.size).toBeGreaterThan(10);
  });
});

// ── 纯逻辑：判定语义 ────────────────────────────────────────────────
describe('decideVersionPolicy（强制/可选/灰度）', () => {
  const base = {
    currentVersion: '0.1.0',
    latestVersion: '0.2.0',
    minSupportedVersion: '0.0.0',
    rolloutPercent: 100,
  } as const;

  it('仅低于最新 ⇒ updateAvailable=true, forceUpdate=false', () => {
    const d = decideVersionPolicy({ ...base });
    expect(d.updateAvailable).toBe(true);
    expect(d.forceUpdate).toBe(false);
  });

  it('current < minSupported ⇒ forceUpdate=true（同时 updateAvailable=true）', () => {
    const d = decideVersionPolicy({ ...base, minSupportedVersion: '0.1.5' });
    expect(d.forceUpdate).toBe(true);
    expect(d.updateAvailable).toBe(true);
  });

  it('等于最新 ⇒ 都 false', () => {
    const d = decideVersionPolicy({ ...base, currentVersion: '0.2.0' });
    expect(d.updateAvailable).toBe(false);
    expect(d.forceUpdate).toBe(false);
  });

  it('版本相同但 build 低于底线 ⇒ 强制（iOS 内测包靠它）', () => {
    const d = decideVersionPolicy({
      ...base,
      currentVersion: '0.2.0',
      minSupportedVersion: '0.2.0',
      minBuild: 5,
      currentBuild: 3,
    });
    expect(d.forceUpdate).toBe(true);
  });

  it('版本相同但 build 低于最新 ⇒ 可选', () => {
    const d = decideVersionPolicy({
      ...base,
      currentVersion: '0.2.0',
      latestVersion: '0.2.0',
      latestBuild: 9,
      currentBuild: 4,
    });
    expect(d.updateAvailable).toBe(true);
    expect(d.forceUpdate).toBe(false);
  });

  it('灰度挡下可选更新：bucket >= rolloutPercent ⇒ updateAvailable=false（未进灰度）', () => {
    // 找一个桶值 >= 10 的设备
    const deviceId = 'rollout-out-device';
    const bucket = stableBucket(deviceId);
    expect(bucket).toBeGreaterThanOrEqual(10); // 若恰好 <10 则本臂假设不成立，换设备名
    const d = decideVersionPolicy({ ...base, rolloutPercent: 10, deviceId });
    expect(d.inRollout).toBe(false);
    expect(d.updateAvailable).toBe(false);
  });

  it('灰度放进可选更新：bucket < rolloutPercent ⇒ updateAvailable=true', () => {
    // 找一个桶值 < 90 的设备（100 里绝大多数）
    const deviceId = 'rollout-in-device';
    const bucket = stableBucket(deviceId);
    if (bucket < 90) {
      const d = decideVersionPolicy({ ...base, rolloutPercent: 90, deviceId });
      expect(d.updateAvailable).toBe(true);
    }
  });

  it('🔴 强制更新不受灰度影响（哪怕本机未进灰度也强制）', () => {
    const deviceId = 'rollout-out-device';
    const d = decideVersionPolicy({
      ...base,
      minSupportedVersion: '0.1.5',
      rolloutPercent: 1,
      deviceId,
    });
    expect(d.forceUpdate).toBe(true);
    expect(d.updateAvailable).toBe(true);
  });
});

// ── 配置：env → 类型化配置 ─────────────────────────────────────────
describe('loadAppVersionPolicyConfig', () => {
  it('默认 latestVersion = 部署版本、minSupported=0.0.0、rollout=100', () => {
    const c = loadAppVersionPolicyConfig({} as NodeJS.ProcessEnv);
    expect(c.latestVersion).toBe('0.1.0'); // 根 package.json 生成常量
    expect(c.minSupportedVersion).toBe('0.0.0');
    expect(c.rolloutPercent).toBe(100);
    expect(c.downloadUrls).toEqual({});
  });

  it('env 覆盖各字段', () => {
    const c = loadAppVersionPolicyConfig({
      APP_LATEST_VERSION: '1.4.0',
      APP_MIN_SUPPORTED_VERSION: '1.2.0',
      APP_ROLLOUT_PERCENT: '25',
      APP_DOWNLOAD_URLS: JSON.stringify({ ios: 'https://apps.apple.com/x', 'android/apk': 'https://dl/x.apk' }),
    } as NodeJS.ProcessEnv);
    expect(c.latestVersion).toBe('1.4.0');
    expect(c.minSupportedVersion).toBe('1.2.0');
    expect(c.rolloutPercent).toBe(25);
    expect(downloadUrlFor(c, 'ios', 'stable')).toBe('https://apps.apple.com/x');
    expect(downloadUrlFor(c, 'android', 'apk')).toBe('https://dl/x.apk');
    expect(downloadUrlFor(c, 'web', 'stable')).toBe('');
  });

  it('非法版本形状 ⇒ 抛（不在运行时下发说不清的答案）', () => {
    expect(() => loadAppVersionPolicyConfig({ APP_LATEST_VERSION: 'v1.2' } as NodeJS.ProcessEnv)).toThrow(
      AppVersionConfigError,
    );
  });

  it('非法 rollout ⇒ 抛', () => {
    expect(() => loadAppVersionPolicyConfig({ APP_ROLLOUT_PERCENT: '120' } as NodeJS.ProcessEnv)).toThrow(
      AppVersionConfigError,
    );
  });

  it('非法 APP_DOWNLOAD_URLS ⇒ 抛', () => {
    expect(() => loadAppVersionPolicyConfig({ APP_DOWNLOAD_URLS: 'not-json' } as NodeJS.ProcessEnv)).toThrow(
      AppVersionConfigError,
    );
  });
});

describe('buildAppVersionResponse', () => {
  const config: AppVersionPolicyConfig = {
    latestVersion: '0.2.0',
    minSupportedVersion: '0.1.0',
    rolloutPercent: 100,
    releaseNotes: '新增四象限视图',
    publishedAt: '2026-11-21T00:00:00Z',
    downloadUrls: { web: 'https://heyta.waytofuture.cn/app/' },
  };

  it('响应体过契约 schema，且回显 platform/channel、带上 downloadUrl', () => {
    const body = buildAppVersionResponse(config, {
      platform: 'web',
      channel: 'stable',
      currentVersion: '0.1.5',
    });
    expect(appVersionResponseSchema.safeParse(body).success).toBe(true);
    expect(body.platform).toBe('web');
    expect(body.channel).toBe('stable');
    expect(body.updateAvailable).toBe(true);
    expect(body.forceUpdate).toBe(false);
    expect(body.downloadUrl).toBe('https://heyta.waytofuture.cn/app/');
    expect(body.releaseNotes).toBe('新增四象限视图');
  });
});

// ── 路由：真 Fastify，不 mock ──────────────────────────────────────
describe('GET /api/app-version（路由）', () => {
  let app: FastifyInstance;

  const config: AppVersionPolicyConfig = {
    latestVersion: '0.2.0',
    minSupportedVersion: '0.1.0',
    rolloutPercent: 100,
    releaseNotes: '',
    publishedAt: '',
    downloadUrls: { web: 'https://heyta.waytofuture.cn/app/' },
  };

  async function build(): Promise<FastifyInstance> {
    const inst = Fastify();
    await inst.register(appVersionRoutes, { prefix: '/api', config });
    await inst.ready();
    return inst;
  }

  afterEach(async () => {
    await app?.close();
  });

  it('匿名 200 + Cache-Control: no-store + 契约形状', async () => {
    app = await build();
    const res = await app.inject({ method: 'GET', url: `/api/${APP_VERSION_PATHS.public}?platform=web&currentVersion=0.1.5` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(appVersionResponseSchema.safeParse(body).success).toBe(true);
    expect(body.updateAvailable).toBe(true);
  });

  it('低于底线 ⇒ forceUpdate=true', async () => {
    app = await build();
    const res = await app.inject({ method: 'GET', url: `/api/${APP_VERSION_PATHS.public}?platform=ios&currentVersion=0.0.9` });
    expect(res.statusCode).toBe(200);
    expect(res.json().forceUpdate).toBe(true);
  });

  it('缺 currentVersion ⇒ 400 且 no-store（不静默当最新）', async () => {
    app = await build();
    const res = await app.inject({ method: 'GET', url: `/api/${APP_VERSION_PATHS.public}?platform=web` });
    expect(res.statusCode).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json().code).toBe('invalid_app_version_query');
  });

  it('非法版本形状 ⇒ 400', async () => {
    app = await build();
    const res = await app.inject({ method: 'GET', url: `/api/${APP_VERSION_PATHS.public}?platform=web&currentVersion=1.2.0-beta` });
    expect(res.statusCode).toBe(400);
  });

  it('platform 不在封闭词表 ⇒ 400', async () => {
    app = await build();
    const res = await app.inject({ method: 'GET', url: `/api/${APP_VERSION_PATHS.public}?platform=smartfridge&currentVersion=0.1.0` });
    expect(res.statusCode).toBe(400);
  });

  it('限流上限是常量，非装饰', () => {
    expect(APP_VERSION_RATE_LIMIT.max).toBeGreaterThan(0);
    expect(APP_VERSION_RATE_LIMIT.timeWindow).toBe('5 minutes');
  });
});
