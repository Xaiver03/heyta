/**
 * TOTP 的本机绑定状态（本地验证性实现）
 * ===================================
 *
 * 🔴 **边界（如实写在代码里）**：真正的两步验证绑定与校验应由**服务端**裁决 ——
 * 服务端要保存密钥、在校验时比对、并决定"这条账号是否强制 2FA"。当前这一步还没接服务端，
 * 所以这里只是**本机**存一个绑定，用于验证 TOTP 算法与整条绑定流程走不通。
 * 面板的 `?` 里对用户说的是同一句话（`web.totp.lead`），没有假装"已经生效到账号"。
 *
 * 存储是设备本地的（`localStorage`）。严格来说密钥属于敏感信息，接服务端后这份本地副本应删除；
 * 本期它只服务"本机验证"，登记在 `docs/reference/client-persistence-keys.md` 的 C 档。
 */

export interface TotpBinding {
  /** 是否已启用（本机）。 */
  readonly enabled: boolean;
  /** base32 密钥（本机验证用；接服务端后改为服务端保管）。 */
  readonly secret: string;
}

/** 存储键。🔴 只导出给判据用。 */
export const TOTP_STORAGE_KEY = 'heyta.totp.local';

/** 读本机绑定；脏值 / 缺字段一律当"没绑定"。 */
export function loadTotp(): TotpBinding | null {
  try {
    const raw = localStorage.getItem(TOTP_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { enabled?: unknown }).enabled === 'boolean' &&
      typeof (parsed as { secret?: unknown }).secret === 'string' &&
      (parsed as { secret: string }).secret !== ''
    ) {
      return { enabled: (parsed as TotpBinding).enabled, secret: (parsed as TotpBinding).secret };
    }
  } catch {
    // 隐私模式 / 脏 JSON：当没绑定。
  }
  return null;
}

/** 写本机绑定。写不上不致命。 */
export function saveTotp(binding: TotpBinding): void {
  try {
    localStorage.setItem(TOTP_STORAGE_KEY, JSON.stringify(binding));
  } catch {
    // ignore
  }
}

/** 清掉本机绑定。 */
export function clearTotp(): void {
  try {
    localStorage.removeItem(TOTP_STORAGE_KEY);
  } catch {
    // ignore
  }
}
