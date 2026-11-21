/**
 * 自动更新：客户端检查核心（`packages/app-host/src/app-update.ts`）。
 * ================================================================
 *
 * 钉三件事：
 * 1. 请求 URL 拼得对（baseUrl 的几种填法都覆盖）；
 * 2. 响应按契约校验，坏形状/非 2xx/网络异常一律收成 `failed`（绝不静默当成"已最新"）；
 * 3. 「同一版本不重复打扰」与「强制不被抑制」的提示判定。
 *
 * 另有一条**匿名**判据：请求头不许带 `authorization` / cookie —— 这条通道的合法性
 * 押在"载荷零身份维度"上，客户端塞一个 token 进去就把它变成按人下发了。
 */
import { describe, expect, it, vi } from 'vitest';

import type { AppVersionResponse } from '@heyta/shared-schema';

import {
  APP_UPDATE_INTERVAL_MS,
  APP_UPDATE_START_DELAY_MS,
  buildAppVersionUrl,
  checkAppUpdate,
  decideAppUpdatePrompt,
} from '../src/app-update.js';

function body(over: Partial<AppVersionResponse> = {}): AppVersionResponse {
  return {
    platform: 'web',
    channel: 'stable',
    latestVersion: '0.2.0',
    minSupportedVersion: '0.1.0',
    updateAvailable: true,
    forceUpdate: false,
    downloadUrl: 'https://heyta.waytofuture.cn/app/',
    releaseNotes: '',
    publishedAt: '',
    rolloutPercent: 100,
    ...over,
  };
}

function fakeFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(impl) as unknown as typeof fetch;
}

function jsonResponse(data: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => data,
  } as unknown as Response;
}

// ── URL 拼接 ────────────────────────────────────────────────────────
describe('buildAppVersionUrl', () => {
  it('空 baseUrl ⇒ 同源相对路径', () => {
    const url = buildAppVersionUrl({ baseUrl: '', platform: 'web', currentVersion: '0.1.0' });
    expect(url.startsWith('/api/app-version?')).toBe(true);
    expect(url).toContain('platform=web');
    expect(url).toContain('currentVersion=0.1.0');
    expect(url).toContain('channel=stable');
  });

  it('带末尾斜杠的 baseUrl 不拼出双斜杠', () => {
    const url = buildAppVersionUrl({ baseUrl: 'https://sync.example.com/', platform: 'ios', currentVersion: '1.2' });
    expect(url.startsWith('https://sync.example.com/api/app-version?')).toBe(true);
    expect(url).not.toContain('//api');
  });

  it('带上 currentBuild 与 deviceId', () => {
    const url = buildAppVersionUrl({
      baseUrl: '',
      platform: 'android',
      channel: 'apk',
      currentVersion: '1.0',
      currentBuild: 7,
      deviceId: 'dev-7',
    });
    expect(url).toContain('channel=apk');
    expect(url).toContain('currentBuild=7');
    expect(url).toContain('deviceId=dev-7');
  });
});

// ── 发请求 + 校验 ──────────────────────────────────────────────────
describe('checkAppUpdate', () => {
  it('合法响应 ⇒ ok + 解析后的 info', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(body()));
    const r = await checkAppUpdate({ baseUrl: '', platform: 'web', currentVersion: '0.1.0', fetchImpl });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.info.latestVersion).toBe('0.2.0');
  });

  it('🔴 匿名：请求不带 authorization / cookie', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(body()));
    await checkAppUpdate({ baseUrl: '', platform: 'web', currentVersion: '0.1.0', fetchImpl });
    const fetchMock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const keys = Object.keys(headers).map((k) => k.toLowerCase());
    expect(keys).not.toContain('authorization');
    expect(keys).not.toContain('cookie');
  });

  it('非 2xx ⇒ failed（不当成已最新）', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({}, { ok: false, status: 503 }));
    const r = await checkAppUpdate({ baseUrl: '', platform: 'web', currentVersion: '0.1.0', fetchImpl });
    expect(r.kind).toBe('failed');
  });

  it('坏形状 ⇒ failed（不当成已最新）', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ platform: 'web' }));
    const r = await checkAppUpdate({ baseUrl: '', platform: 'web', currentVersion: '0.1.0', fetchImpl });
    expect(r.kind).toBe('failed');
  });

  it('网络异常 ⇒ failed（不抛）', async () => {
    const fetchImpl = fakeFetch(() => {
      throw new Error('offline');
    });
    const r = await checkAppUpdate({ baseUrl: '', platform: 'web', currentVersion: '0.1.0', fetchImpl });
    expect(r.kind).toBe('failed');
  });
});

// ── 提示判定 ────────────────────────────────────────────────────────
describe('decideAppUpdatePrompt', () => {
  it('没更新 ⇒ none', () => {
    expect(decideAppUpdatePrompt(body({ updateAvailable: false }))).toBe('none');
  });

  it('强制 ⇒ force（即便已提示过同一版本也不抑制）', () => {
    expect(decideAppUpdatePrompt(body({ forceUpdate: true }), '0.2.0')).toBe('force');
  });

  it('可选、首次 ⇒ optional', () => {
    expect(decideAppUpdatePrompt(body(), null)).toBe('optional');
  });

  it('可选、已提示过同一版本 ⇒ none（不重复打扰）', () => {
    expect(decideAppUpdatePrompt(body(), '0.2.0')).toBe('none');
  });

  it('可选、上次提示的是别的版本 ⇒ optional', () => {
    expect(decideAppUpdatePrompt(body(), '0.1.9')).toBe('optional');
  });
});

describe('检查时机常量', () => {
  it('启动延迟 15s、定时 6 小时', () => {
    expect(APP_UPDATE_START_DELAY_MS).toBe(15_000);
    expect(APP_UPDATE_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
  });
});
