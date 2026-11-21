/**
 * 移动端更新纯运行体（`apps/mobile/src/lib/app-update-core.ts`）。
 * ============================================================
 * 只测不依赖 react-native 的那一半：平台映射、空 serverUrl 不查、可选/强制判定、失败收成 none。
 */
import { describe, expect, it, vi } from 'vitest';

import { platformForOs, runMobileUpdateCheck } from '../src/lib/app-update-core.js';

function body(over: Record<string, unknown> = {}) {
  return {
    platform: 'ios',
    channel: 'stable',
    latestVersion: '0.2.0',
    minSupportedVersion: '0.1.0',
    updateAvailable: true,
    forceUpdate: false,
    downloadUrl: 'https://apps.apple.com/app/id000',
    releaseNotes: '',
    publishedAt: '',
    rolloutPercent: 100,
    ...over,
  };
}
function fetchOf(impl: () => Response | Promise<Response>) {
  return vi.fn(impl) as unknown as typeof fetch;
}
function jsonResponse(data: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => data } as unknown as Response;
}

describe('platformForOs', () => {
  it('ios / android / harmony 映射', () => {
    expect(platformForOs('ios')).toBe('ios');
    expect(platformForOs('android')).toBe('android');
    expect(platformForOs('harmony')).toBe('harmony');
    expect(platformForOs('harmonyos')).toBe('harmony');
  });
  it('未知平台 ⇒ null（不查）', () => {
    expect(platformForOs('web')).toBeNull();
  });
});

describe('runMobileUpdateCheck', () => {
  it('空 serverUrl ⇒ none，且不发请求', async () => {
    const fetchImpl = fetchOf(() => jsonResponse(body()));
    const r = await runMobileUpdateCheck({ serverUrl: '  ', platform: 'ios', currentVersion: '0.1.0', fetchImpl });
    expect(r.prompt).toBe('none');
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('可选更新 ⇒ optional + 版本/下载地址', async () => {
    const r = await runMobileUpdateCheck({
      serverUrl: 'https://sync.example.com',
      platform: 'android',
      currentVersion: '0.1.5',
      fetchImpl: fetchOf(() => jsonResponse(body({ platform: 'android', downloadUrl: 'https://dl/app.apk' }))),
    });
    expect(r.prompt).toBe('optional');
    expect(r.latestVersion).toBe('0.2.0');
    expect(r.downloadUrl).toBe('https://dl/app.apk');
  });

  it('强制 ⇒ force', async () => {
    const r = await runMobileUpdateCheck({
      serverUrl: 'https://sync.example.com',
      platform: 'ios',
      currentVersion: '0.0.5',
      fetchImpl: fetchOf(() => jsonResponse(body({ forceUpdate: true }))),
    });
    expect(r.prompt).toBe('force');
  });

  it('非 2xx ⇒ none', async () => {
    const r = await runMobileUpdateCheck({
      serverUrl: 'https://sync.example.com',
      platform: 'ios',
      currentVersion: '0.1.5',
      fetchImpl: fetchOf(() => jsonResponse({}, { ok: false, status: 500 })),
    });
    expect(r.prompt).toBe('none');
  });
});
