/**
 * 桌面更新纯运行体（`apps/desktop/src/app-update-core.ts`）。
 * ======================================================
 *
 * 只测**不依赖 electron 的那一半**：空 baseUrl 不查、可选/强制判定、失败收成 none。
 * 弹原生对话框那一步在 `app-update.ts`，不在这份测试里（它需要 electron 运行时）。
 */
import { describe, expect, it, vi } from 'vitest';

import { resolveUpdateBaseUrl, runDesktopUpdateCheck } from '../src/app-update-core.js';

function body(over: Record<string, unknown> = {}) {
  return {
    platform: 'desktop',
    channel: 'stable',
    latestVersion: '0.2.0',
    minSupportedVersion: '0.1.0',
    updateAvailable: true,
    forceUpdate: false,
    downloadUrl: 'https://heyta.waytofuture.cn/download',
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

describe('resolveUpdateBaseUrl', () => {
  it('未配置 ⇒ 空串（不查）', () => {
    expect(resolveUpdateBaseUrl({} as NodeJS.ProcessEnv)).toBe('');
  });
  it('配置并去空白', () => {
    expect(resolveUpdateBaseUrl({ HEYTA_UPDATE_BASE_URL: '  https://rel.example.com/ ' } as NodeJS.ProcessEnv)).toBe(
      'https://rel.example.com/',
    );
  });
});

describe('runDesktopUpdateCheck', () => {
  it('空 baseUrl ⇒ none，且不发请求', async () => {
    const fetchImpl = fetchOf(() => jsonResponse(body()));
    const r = await runDesktopUpdateCheck({ baseUrl: '', currentVersion: '0.1.0', fetchImpl });
    expect(r.prompt).toBe('none');
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('可选更新 ⇒ optional + 带版本与下载地址', async () => {
    const r = await runDesktopUpdateCheck({
      baseUrl: 'https://rel.example.com',
      currentVersion: '0.1.5',
      fetchImpl: fetchOf(() => jsonResponse(body())),
    });
    expect(r.prompt).toBe('optional');
    expect(r.latestVersion).toBe('0.2.0');
    expect(r.downloadUrl).toBe('https://heyta.waytofuture.cn/download');
  });

  it('强制更新 ⇒ force', async () => {
    const r = await runDesktopUpdateCheck({
      baseUrl: 'https://rel.example.com',
      currentVersion: '0.0.5',
      fetchImpl: fetchOf(() => jsonResponse(body({ forceUpdate: true }))),
    });
    expect(r.prompt).toBe('force');
  });

  it('非 2xx ⇒ none（不弹框打扰）', async () => {
    const r = await runDesktopUpdateCheck({
      baseUrl: 'https://rel.example.com',
      currentVersion: '0.1.5',
      fetchImpl: fetchOf(() => jsonResponse({}, { ok: false, status: 500 })),
    });
    expect(r.prompt).toBe('none');
  });

  it('网络异常 ⇒ none（不抛）', async () => {
    const r = await runDesktopUpdateCheck({
      baseUrl: 'https://rel.example.com',
      currentVersion: '0.1.5',
      fetchImpl: fetchOf(() => {
        throw new Error('offline');
      }),
    });
    expect(r.prompt).toBe('none');
  });
});
