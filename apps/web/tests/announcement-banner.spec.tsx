/**
 * 用户侧那一横条公告的判据（ADR-0075）。
 * ======================================
 *
 * 这一条的风险不在"画没画"，在**谁在判**：
 *
 *   1. 🔴 **界面不判有效期。** 用一个"时间戳已经过期"的响应体来证它照样画出来 ——
 *      因为"有效"只有服务端那一查询说了算。一旦这里加了一句
 *      `expiresAt > Date.now()`，运营在下架与过期之间那道缝里就失去唯一的真相，
 *      症状是"后台说挂着、用户看不见"（或反过来）。
 *   2. 🔴 **只画最新的一条**，第二条不许同时出现：三条一起挂会把这个告知变成故障现场。
 *      关掉一条之后下一条顶上来 —— 那才是 `dismissed` 唯一的可见后果。
 *   3. 忽略记在**这台设备**上（localStorage），不是账号维度：
 *      服务端记阅读史是一次新增的个人信息处理，ADR-0075 §3.5 明确不要它。
 *   4. 🔴 拉不到 ⇒ **什么都不画**，不许画一条"服务器出错了"的红条。
 *      未登录时更是**一个请求都不发**。
 *
 * ⚠️ 这些不是安全判据；它们钉的是"界面不许替服务端说话"。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';

import { AnnouncementBanner } from '../src/features/announcements/AnnouncementBanner.js';
import { privacyConsentActions } from '../src/features/privacy/consent-gate.js';
import { __resetAnnouncementsForTests } from '../src/features/announcements/store.js';
import { useSyncStore } from '../src/features/sync/store.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const NOW = Date.now();
const DAY = 86_400_000;

/** 同一棵树里再挂一层会把上一棵的更新留在 act 外面，所以先拆干净。 */
async function teardown(): Promise<void> {
  if (root !== undefined) {
    act(() => {
      root!.unmount();
    });
    root = undefined;
  }
  container?.remove();
  container = undefined;
}

/** 服务端已经裁过的那两条（顺序 = `publishedAt DESC`）。 */
function activeBody(items: unknown[]): unknown {
  return { announcements: items };
}

const INFO = { id: 2, title: '邀请码上线', body: '新账号需要邀请码。', level: 'info', publishedAt: NOW - DAY, expiresAt: NOW + DAY };
const WARNING = { id: 1, title: '今晚维护', body: '同步暂停约 20 分钟。', level: 'warning', publishedAt: NOW, expiresAt: null };

function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      json: () => Promise.resolve(body),
    } as unknown as Response),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderBanner(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <I18nProvider locale="zh-CN">
        <AnnouncementBanner />
      </I18nProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container;
}

beforeEach(() => {
  __resetAnnouncementsForTests();
  // 默认是"还没同意"，而闸门挡住的是整个 `window.fetch`（见 `use-network-allowed.ts`）。
  // 这里先把同意答掉，让每一格测的是它自己的主题。
  privacyConsentActions.accept();
  useSyncStore.setState({ baseUrl: 'https://example.test', token: 'tok' });
});

afterEach(() => {
  teardown();
  privacyConsentActions.revoke();
});

describe('那一横条公告', () => {
  it('服务端给一条 ⇒ 画出来（标题、正文、role=status）', async () => {
    stubFetch(200, activeBody([INFO]));
    const el = await renderBanner();

    const banner = el.querySelector('[data-testid="announcement-banner"]');
    expect(banner).not.toBeNull();
    expect(banner!.getAttribute('role')).toBe('status');
    expect(banner!.textContent).toContain('邀请码上线');
    expect(banner!.textContent).toContain('新账号需要邀请码。');
  });

  it('🔴 界面不判有效期：服务端说挂着的那条，时间戳"看起来"早该过期也照样画', async () => {
    // `expiresAt` 在**过去**、`publishedAt` 在**未来**：任何一处本地比时钟的实现
    // 都会把它滤掉（或延后画），而服务端把它算成 active 发回来了。
    stubFetch(
      200,
      activeBody([
        { ...INFO, title: '服务端说还挂着', publishedAt: NOW + DAY, expiresAt: NOW - DAY },
      ]),
    );
    const el = await renderBanner();

    expect(el.querySelector('[data-testid="announcement-banner"]')).not.toBeNull();
    expect(el.textContent).toContain('服务端说还挂着');
  });

  it('🔴 只画最新一条：第二条不许同时出现在这一格里', async () => {
    stubFetch(200, activeBody([WARNING, INFO]));
    const el = await renderBanner();

    expect(el.querySelectorAll('[data-testid="announcement-banner"]')).toHaveLength(1);
    expect(el.textContent).toContain('今晚维护');
    expect(el.textContent).not.toContain('邀请码上线');
  });

  it('关掉一条 ⇒ 下一条顶上来，且忽略记在本机 localStorage 里', async () => {
    stubFetch(200, activeBody([WARNING, INFO]));
    const el = await renderBanner();

    const dismiss = el.querySelector<HTMLButtonElement>('[aria-label="知道了"]');
    expect(dismiss).not.toBeNull();
    await act(async () => {
      dismiss!.click();
    });

    expect(el.textContent).not.toContain('今晚维护');
    expect(el.textContent).toContain('邀请码上线');
    // 🔴 只落本机。这一枚 key 的存在就是"没有回服务端一笔阅读史"的证据。
    expect(JSON.parse(localStorage.getItem('heyta.announcements.dismissed') ?? '[]')).toEqual([WARNING.id]);
    expect(localStorage.getItem('heyta.announcements.dismissed')).not.toContain('read');
  });

  it('warning 档位带它自己的形状，info 不带', async () => {
    stubFetch(200, activeBody([WARNING]));
    const el = await renderBanner();
    expect(el.querySelector('.ht-main__announcement')).not.toBeNull();
    expect(el.querySelector('.ht-main__announcement--warning')).not.toBeNull();

    await teardown();
    __resetAnnouncementsForTests();
    stubFetch(200, activeBody([INFO]));
    const infoEl = await renderBanner();
    expect(infoEl.querySelector('.ht-main__announcement')).not.toBeNull();
    expect(infoEl.querySelector('.ht-main__announcement--warning')).toBeNull();
  });

  it('🔴 服务端 500 ⇒ 什么都不画（不许把告知条变成故障现场）', async () => {
    stubFetch(500, { error: 'boom' });
    const el = await renderBanner();

    expect(el.querySelector('[data-testid="announcement-banner"]')).toBeNull();
    expect(el.textContent).toBe('');
  });

  it('🔴 未登录 ⇒ 一个请求都不发，界面是空的', async () => {
    useSyncStore.setState({ baseUrl: 'https://example.test', token: '' });
    const fetchMock = stubFetch(200, activeBody([INFO]));
    const el = await renderBanner();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="announcement-banner"]')).toBeNull();
  });

it('🔴 还没同意联网 ⇒ 不发请求、什么都不画；答完同意自动拉一次', async () => {
    // 这一条钉的是刚修的那个洞：挂载时拉一次被闸门挡下 ⇒ `items: []` ⇒ 静默，
    // 而"静默不画"在这里是对失败的正确处理，所以**没有任何其它判据能发现它**。
    // 症状是"这个部署从来不显示公告"，而后台确实发着一条。
    privacyConsentActions.revoke();
    const fetchMock = stubFetch(200, activeBody([INFO]));
    const el = await renderBanner();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="announcement-banner"]')).toBeNull();

    await act(async () => {
      privacyConsentActions.accept();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('邀请码上线');
  });

  it('🔴 凭据在挂载之后才回来 ⇒ 仍然会拉（首启后登录的那条路）', async () => {
    useSyncStore.setState({ baseUrl: '', token: undefined });
    const fetchMock = stubFetch(200, activeBody([WARNING]));
    const el = await renderBanner();
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      useSyncStore.setState({ baseUrl: 'https://example.test', token: 'late-token' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('今晚维护');
  });

  it('未配服务器 ⇒ 一个请求都不发', async () => {
    useSyncStore.setState({ baseUrl: '', token: 'tok' });
    const fetchMock = stubFetch(200, activeBody([INFO]));
    await renderBanner();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
