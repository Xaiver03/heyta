/**
 * 「记住密码」的**壳侧存储**（2026-10-10，产品负责人需求）
 * =====================================================
 *
 * 分层：共享表单只把"用户勾了没"随登录交回来；store 不持久化任何口令；
 * **落盘只发生在这一层** —— web 壳的 localStorage。哪个端接了存储，哪个端
 * 才有资格渲染那个勾选框（labels 由宿主给）。
 *
 * 🔴 两个安全边界，都是刻意的：
 *   1. **明示才存**：只有用户勾选且这次登录**真的成功**才写；取消勾选、没勾、
 *      登录失败，都清掉旧值。绝没有"替用户记住"这个选项。
 *   2. **localStorage 只在本机**：这是浏览器里能给的最低承诺（不是加密保险箱，
 *      共用电脑的人可以读到）。产品裁决接受了这个取舍换"不用每次打密码"；
 *      要升级（WebAuthn 包裹 / OS 钥匙串）是另一轮的事，这里不假装做到了。
 */

const KEY = 'heyta.auth.remembered.v1';

export interface RememberedCredentials {
  readonly email: string;
  readonly password: string;
}

export function readRememberedCredentials(): RememberedCredentials | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as { email?: unknown; password?: unknown };
    if (typeof parsed.email !== 'string' || typeof parsed.password !== 'string') return undefined;
    if (parsed.email === '' || parsed.password === '') return undefined;
    return { email: parsed.email, password: parsed.password };
  } catch {
    // 损坏的旧数据按"没有"处理 —— 不能因为一坨坏 JSON 把登录面板挡住。
    return undefined;
  }
}

/** `remember=false` 就是显式清除（包括用户取消勾选那一刻之后的下一次成功登录）。 */
export function rememberCredentials(email: string, password: string, remember: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (!remember) {
      window.localStorage.removeItem(KEY);
      return;
    }
    window.localStorage.setItem(KEY, JSON.stringify({ email, password }));
  } catch {
    // 隐私模式等场景写不进去：记住失败不该让登录失败。
  }
}
