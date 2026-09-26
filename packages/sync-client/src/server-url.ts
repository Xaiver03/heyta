/**
 * 服务器地址的**传输安全等级**判定。
 * =====================================
 *
 * 为什么这是共享逻辑而不是各宿主自己写
 * ------------------------------------
 * heyta 是自建/自托管的：用户会把服务端跑在 NAS、树莓派、家里的容器里，
 * 那些场景**就是局域网明文 HTTP**。同时又不能对公网明文视而不见。
 * "这个地址算不算危险"是一个**产品规则**，三个宿主（Web / Android / iOS / 鸿蒙）
 * 必须给出同一个答案 —— 所以它属于 `sync-client`，不属于任何 `apps/*`（见 AGENTS.md §3.5）。
 *
 * 这与 E2EE 的关系要说清楚，否则容易被理解成"明文也无所谓"：
 *   - 任务内容**始终端到端加密**，服务端从头到尾看不到明文，明文信道不会泄露内容；
 *   - 但**访问令牌**是明文的。拿到令牌就能读写密文、能看到元数据（数量/时间/体积），
 *     并且可以**删掉用户的全部数据**。所以它不是"无所谓"，而是"需要知情"。
 *
 * 于是策略是：**不禁止，但一定告诉用户**。禁止会让自建用户直接不可用；
 * 静默放行会让公网明文用户以为自己安全。
 */

/** 传输安全等级。 */
export type TransportSecurity =
  /** HTTPS —— 正常状态，界面不需要提示。 */
  | 'secure'
  /** 明文，但目标是本机/私有网段。自建的常态。 */
  | 'plaintext-local'
  /** 明文，且目标看起来不是私有地址。公网上这样用是危险的。 */
  | 'plaintext';

/**
 * 私有 / 本机地址判定（IPv4 与 IPv6 各一段）。
 *
 * 覆盖：回环、RFC1918 三段、链路本地、IPv6 回环与 ULA/链路本地。
 * 注意 `10.0.2.2`（Android 模拟器指向宿主机的别名）落在 `10/8` 里，天然被覆盖。
 */
export function isPrivateHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '' ) return false;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local')) return true; // mDNS，典型家庭/办公局域网
  if (h === '::1') return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // IPv6 ULA fc00::/7
  if (h.startsWith('fe80:')) return true; // IPv6 链路本地

  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m === null) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127) return true; // 回环
  if (a === 10) return true; // 10/8（含模拟器的 10.0.2.2）
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 169 && b === 254) return true; // 链路本地
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  return false;
}

/**
 * 判定一个服务器地址的传输安全等级。
 *
 * 无法解析或没有 scheme 时返回 `'plaintext'` —— **宁可多提醒一次**：
 * 地址写错时用户需要看到提示，而不是因为"解析不出来所以当它安全"而得到静默。
 */
export function classifyTransportSecurity(rawUrl: string): TransportSecurity {
  const raw = rawUrl.trim();
  if (raw === '') return 'plaintext';
  if (/^https:\/\//i.test(raw)) return 'secure';
  if (!/^http:\/\//i.test(raw)) return 'plaintext';

  // 去掉 scheme、userinfo、端口、路径、查询，只留 host
  let rest = raw.replace(/^http:\/\//i, '');
  rest = rest.split('/')[0] ?? '';
  rest = rest.split('?')[0] ?? '';
  const at = rest.lastIndexOf('@');
  if (at >= 0) rest = rest.slice(at + 1);
  // IPv6 字面量形如 [::1]:3000
  const host = rest.startsWith('[')
    ? (rest.slice(1, rest.indexOf(']')) || rest)
    : (rest.split(':')[0] ?? '');

  return isPrivateHost(host) ? 'plaintext-local' : 'plaintext';
}
