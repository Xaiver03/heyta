/**
 * 用户侧的公告读面（ADR-0075）。
 * ==============================
 *
 * 与 `admin-client.ts` 是同一条纪律下的两个客户端，**刻意不共用一个请求助手**：
 *
 *   · admin 那一份要把 `403` 折成"权限被撤"并驱动整个面板消失，失败词表是九项；
 *   · 这一份只回答一件事 —— "现在有没有挂着的话"。它没有权限维度，
 *     拉不到就是**不画那一横条**。
 *
 * 把两者并成一个"通用 admin/inbox 客户端"会让这一份背上九种失败码，
 * 而它的界面只对其中一种有反应 —— 那是一层没有消费者的错误处理。
 *
 * 🔴 与 admin 那一份**相同**的短路规则（这条是共享的立场，不是共享的代码）：
 * 没配服务器地址、没有令牌 ⇒ **一个请求都不发**。
 * 判据在 `packages/app-host/tests/announcement-client.spec.ts`。
 */

export interface AnnouncementClientOptions {
  /** 中心服务器的基址（与同步客户端用的同一枚）。空串 = 没配服务器。 */
  readonly baseUrl: string;
  /** 取当前会话令牌。返回空 ⇒ 不发请求。 */
  readonly getToken: () => Promise<string | undefined | ''>;
  readonly fetchImpl?: typeof fetch;
}

/** 一条当前挂着的公告。 */
export interface ActiveAnnouncement {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  /** 语义档位（`info` / `warning`），界面按它画形状。不是颜色名。 */
  readonly level: 'info' | 'warning';
  readonly publishedAt: number;
  readonly expiresAt: number | null;
}

export type AnnouncementsResult =
  | { readonly ok: true; readonly announcements: readonly ActiveAnnouncement[] }
  | { readonly ok: false; readonly reason: 'unconfigured' | 'no-token' | 'network' | 'server' };

/**
 * 拉当前有效的公告。
 *
 * ⚠️ **"有效"不在这里判，也不在界面判** —— 服务端那条查询是唯一裁决者
 * （ADR-0075 §3.4）。这一侧不许拿 `Date.now()` 去比 `publishedAt` / `expiresAt`：
 * 两处的差表现为"运营以为已经下架了，用户还看得见"。
 */
export async function fetchActiveAnnouncements(
  options: AnnouncementClientOptions,
): Promise<AnnouncementsResult> {
  if (options.baseUrl.trim() === '') return { ok: false, reason: 'unconfigured' };

  const token = await options.getToken();
  if (token === undefined || token === '') return { ok: false, reason: 'no-token' };

  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    response = await fetchImpl(
      `${options.baseUrl.replace(/\/+$/, '')}/api/announcements/active`,
      { headers: { authorization: `Bearer ${token}` } },
    );
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (!response.ok) return { ok: false, reason: 'server' };

  try {
    const body = (await response.json()) as { announcements?: ActiveAnnouncement[] };
    return { ok: true, announcements: body.announcements ?? [] };
  } catch {
    return { ok: false, reason: 'server' };
  }
}
