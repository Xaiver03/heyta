/**
 * 端点地址的**类别**（纯字面量判定）
 * ===================================
 *
 * [ADR-0053](../../../docs/adr/0053-endpoint-address-class-and-domestic-managed-allowlist.md)
 * 的第一条裁决落在这里。它补的是一个**类型上就缺的维度**：
 * `classifyDestination` 过去只有两样输入（`mode` 与 `endpoint` 字符串），
 * 判出来的目的地只有"没出设备 / 出了设备"这一档粗细 ——
 * 于是"这个端点指的是链路本地、私网、公网，还是一个**必须解析才知道**的名字"
 * 在模型里根本不存在，`BLOCKED.md` 的 B34 那条"蜂窝算不算远程"因此**无法表达**
 * （不是没答，是问句里的主语不在类型里）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件只做**字面量层**的判定，绝不做 DNS 解析
 *
 * 三条理由，缺一不可：
 *
 *   1. **不可复现**：同一个配置在咖啡店、在家里、在蜂窝网络上解析结果不同。
 *      隐私判定必须"同一个输入永远得到同一个结论"，否则判据无法被测试钉住。
 *   2. **会把"未知"悄悄变成"可信"**：一旦在库里解析，"解析出来是 127.0.0.1"
 *      就成了免授权的理由 —— 而攻击者控制的是 DNS，不是我们的代码。
 *      （`localhost.evil.com` 之所以今天不会被当成本机，正是因为判的是**字面量相等**。）
 *   3. **顺序**：我们必须在**发请求之前**决定要不要索取授权，而"解析后落在哪"
 *      只有发请求那一刻才知道。
 *
 * 所以域名一律落到 `unknown`，并按**最严的一档**处理（见 `requiresEgressConsent`：
 * 只有 `known && loopback` 才免授权）。`unknown` 不是"判不出来所以随便"，
 * 它是一个**有内容的结论**：这台机器我们无法从字面量证明它在哪。
 *
 * 返回形状因此是**可判别联合**：`known: true` 的分支带类别，`known: false` 的分支
 * 带 `reason`。消费者**没法**把"未定性"误当成本机 —— 那个字段在另一个分支上不存在。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ **补上这个维度不等于放宽任何判定。**
 * `private` / `link-local` 两档**不**免出境授权：私网字面量照样可能指向
 * 网络里任意一台机器（Joplin 对 `.local` 的处理是同一立场，见 ADR-0006 §2.4），
 * 而设备在蜂窝网/VPN 上时那个字面量指向的根本是不可知的东西。
 * 类别是**描述**，免不免授权是**另一条规则** —— 分成两件事，才是这次裁决的实质。
 */

/** 端点地址的类别。**封闭词表**：加一项要同时改 `endpointAddressTests` 的样本表。 */
export type EndpointAddressCategory =
  /** 明文不离开这台设备：`localhost` 字面量、`127.0.0.0/8`、`::1`。 */
  | 'loopback'
  /** 链路本地：`169.254.0.0/16`（RFC 3927）、`fe80::/10`（RFC 4291）。**只在同一条链路上可达。** */
  | 'link-local'
  /** 私网/不可全局路由：RFC 1918 三段、CGNAT `100.64.0.0/10`（RFC 6598）、ULA `fd00::/8`。 */
  | 'private'
  /** 公网**字面量** IP —— 已定性，不需要解析就知道它在公网上。 */
  | 'public'
  /** 🔴 无法从字面量定性：域名、mDNS/局域网名字、保留段、无法解析的写法。按最严的一档处理。 */
  | 'unknown';

/** `unknown` 的原因。**封闭词表**，每一条都是一个真实的判定缺口。 */
export type UnknownAddressReason =
  /** 端点根本没配。 */
  | 'empty'
  /** URL 解析不出主机名（含非规范 IPv6 与带 zone id 的写法 —— `new URL()` 直接抛）。 */
  | 'unparseable'
  /** 需要 DNS 才能定性、且没有任何局域网线索的名字。 */
  | 'domain'
  /**
   * **可命名的局域网形态**：`.local`（RFC 6762 mDNS）、`.home.arpa`（RFC 8375）、
   * `.internal`（ICANN 保留给私有使用）、`.lan` / `.home`（事实标准）。
   *
   * 🔴 它**类别上像局域网，但不是已定性的字面量**：这类名字可以指向当前网络里的
   * **任意一台主机**（Joplin 把 `.local` 按远程处理就是这个理由），所以它进 `unknown`
   * 而不是 `private`。把它单独列出来，是为了让"这是局域网形态"这件事**在形状里可见**，
   * 而不是只写在注释里 —— B34 要的正是这一档能被说出口。
   */
  | 'lan-name'
  /** 单标签主机名（`myhost`）：要靠搜索域才能展开，同样不可证明落在哪。 */
  | 'unqualified-name'
  /** IANA 保留/特殊用途段（`0/8`、组播、`240/4`、文档段、基准测试段、`::`、`fc00::/8` …）。 */
  | 'reserved'
  /**
   * IPv4 映射的 IPv6 字面量（`[::ffff:7f00:1]`）。
   *
   * 🔴 它**实际会连到回环**，而 `new URL()` 不会把它折回点分十进制，
   * 所以字面量层看不穿。旧判定把它算远端（要授权）——本轮**保持**那个结论：
   * 收紧可以，放宽不行（见 ADR-0053 §3.2 的"只紧不松"）。
   * 它是本文件里唯一一个"**类别其实更宽松、但我们故意不采纳**"的取值，
   * 所以必须留在这里而不是被悄悄修掉。
   */
  | 'ipv4-mapped-ipv6';

/** 类别是**怎么**得出的（`known: true` 分支才有意义）。 */
export type AddressDecider =
  /** 点分十进制 / IPv6 字面量 —— 不需要任何解析就是事实。 */
  | 'ip-literal'
  /**
   * 精确字面量 `localhost`。
   *
   * ⚠️ 严格说它是个**名字**，也要解析。把它算"已定性"是一次明确的让步：
   * 它在本轮之前就一直是本机（`isLoopbackEndpoint` 认它），改成未定性会让每个
   * 用 Ollama 的人重新被问一次授权，而 RFC 6761 把 `localhost` 留给了回环。
   * 🔴 让步**只到这一个精确字面量**：`a.localhost`、`localhost.evil.com`、
   * `localhost.` 全部不是本机 —— 判的是字面量相等，不是后缀。
   */
  | 'localhost-literal';

/**
 * 一份端点地址的字面量定性结果。
 *
 * 🔴 用**可判别联合**而不是一个 `category` 枚举，是为了让"字面量已定性"与
 * "未定性"在**类型上**分开：想读 `category` 里的具体类别必须先证明 `known === true`，
 * 于是"把未定性当成本机"这类错误过不了编译，也不靠人读注释。
 */
export type EndpointAddressClass =
  | {
      readonly known: true;
      readonly host: string;
      readonly category: Exclude<EndpointAddressCategory, 'unknown'>;
      readonly decidedBy: AddressDecider;
    }
  | {
      readonly known: false;
      readonly category: 'unknown';
      readonly reason: UnknownAddressReason;
      readonly host?: string;
    };

/**
 * mDNS / 私有-use 的保留后缀。
 *
 * ⚠️ 只用于**命名形态**的识别（进 `unknown` 的 `reason`），**不参与**任何放宽。
 * 刻意不含 `.test`、`.example`、`.invalid`（RFC 6761 保留给文档与测试）：
 * 它们不是局域网，把它们说成局域网形态是**错的**，而错误的 reason 比笼统的 `domain` 更坏。
 */
const LAN_NAME_SUFFIXES: readonly string[] = ['.local', '.home.arpa', '.internal', '.lan', '.home'];

/** 取端点的主机名（小写）。解析不出主机名就返回 undefined。 */
function hostnameOf(endpoint: string): string | undefined {
  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return undefined;
  }
  // `localhost:11434` 这种"缺协议"的写法会被 WHATWG 解析成 protocol=`localhost:`、
  // hostname=`''` —— 没有主机名就是没有主机名，别让它落到任何一个类别里去。
  if (host === '') return undefined;
  return host.toLowerCase();
}

/** 去掉 IPv6 主机外面的方括号。 */
function unwrapIpv6(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/** 点分十进制 IPv4 的**字面**形状（不校验取值，取值交给调用处）。 */
function splitIpv4(host: string): readonly string[] | undefined {
  const parts = host.split('.');
  if (parts.length !== 4) return undefined;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
  }
  return parts;
}

function octet(parts: readonly string[], index: number): number {
  const raw = parts[index];
  return raw === undefined ? Number.NaN : Number(raw);
}

/**
 * IPv6 前两个 16 位段的数值（`fe80::1` → [0xfe80, 0]）。
 *
 * ⚠️ 以 `::` 打头时**空串就是 0**（`::2` 的第一段是全零），
 * 不能把它当"读不出来"，否则一个 `::/96` 的废弃段地址会被误标成 `unparseable`。
 * 第二个段读不到时同样按 0（`2001:db8::1` 的序列化里第二段就是 `db8`，
 * 而 `fe80::1` 的第二段是空 —— 两者都要能算对）。
 */
function ipv6Groups(host: string, count: number): number[] {
  const parts = host.split(':');
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const raw = parts[i] ?? '';
    if (raw === '') {
      out.push(0);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/.test(raw)) {
      out.push(Number.NaN);
      continue;
    }
    out.push(Number.parseInt(raw, 16));
  }
  return out;
}

function groupAt(groups: readonly number[], index: number): number {
  return groups[index] ?? Number.NaN;
}

function known(
  host: string,
  category: Exclude<EndpointAddressCategory, 'unknown'>,
  decidedBy: AddressDecider,
): EndpointAddressClass {
  return { known: true, host, category, decidedBy };
}

function undecided(host: string | undefined, reason: UnknownAddressReason): EndpointAddressClass {
  return host === undefined
    ? { known: false, category: 'unknown', reason }
    : { known: false, category: 'unknown', reason, host };
}

/**
 * IPv4 字面量 → 类别。
 *
 * ⚠️ `new URL()` 已经把 `127.1` / `2130706433` / `0177.0.0.1` 这些**非规范写法**
 * 规范化成点分十进制（实测），所以这里看不到那些花样 —— 它们和它们的规范写法
 * 得到同一个类别，这与旧判定的行为**逐字一致**，不是新学到的东西。
 */
function classifyIpv4(host: string, parts: readonly string[]): EndpointAddressClass {
  const a = octet(parts, 0);
  const b = octet(parts, 1);
  const c = octet(parts, 2);
  const d = octet(parts, 3);
  if ([a, b, c, d].some((n) => Number.isNaN(n) || n > 255)) {
    // 形状像 IPv4 但取值越界（`999.0.0.1`）：不是地址，按名字走 `domain`。
    return undecided(host, 'domain');
  }

  if (a === 127) return known(host, 'loopback', 'ip-literal');
  if (a === 169 && b === 254) return known(host, 'link-local', 'ip-literal');
  if (a === 10) return known(host, 'private', 'ip-literal');
  if (a === 172 && b >= 16 && b <= 31) return known(host, 'private', 'ip-literal');
  if (a === 192 && b === 168) return known(host, 'private', 'ip-literal');
  // CGNAT（RFC 6598）：运营商在蜂窝/宽带网络上发给用户侧的地址，不可全局路由。
  // 它落进 `private` 是有意的 —— **这一档就是 B34 那条问题的落点**：
  // 设备挂在蜂窝网络上时它自己往往就在 100.64/10，"这个端点是不是公网"
  // 从此是一个能问、能答的问题，而不是只能靠网络类型猜。
  if (a === 100 && b >= 64 && b <= 127) return known(host, 'private', 'ip-literal');

  // 保留/特殊用途段：说它们是"公网"是假话，说它们是本机更是假话 ⇒ 未定性。
  // 逐段写全名，不合并成区间 —— 合并过一次的写法在这里错过一次（192.88.99/24
  // 曾被写进 `b === 0` 那一条里，于是 6to4 relay 段被判成公网）。
  if (a === 0) return undecided(host, 'reserved'); // 0.0.0.0/8「本网络本主机」
  if (a >= 224 && a <= 239) return undecided(host, 'reserved'); // 224.0.0.0/4 组播
  if (a >= 240) return undecided(host, 'reserved'); // 240.0.0.0/4 保留（含 255.255.255.255）
  if (a === 192 && b === 0 && c === 0) return undecided(host, 'reserved'); // 192.0.0.0/24 IANA 特殊用途
  if (a === 192 && b === 0 && c === 2) return undecided(host, 'reserved'); // 192.0.2.0/24 TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return undecided(host, 'reserved'); // 192.88.99.0/24 6to4 relay（已废弃）
  if (a === 198 && (b === 18 || b === 19)) return undecided(host, 'reserved'); // 198.18.0.0/15 基准测试
  if (a === 198 && b === 51 && c === 100) return undecided(host, 'reserved'); // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return undecided(host, 'reserved'); // 203.0.113.0/24 TEST-NET-3

  return known(host, 'public', 'ip-literal');
}

/** IPv6 字面量 → 类别。 */
function classifyIpv6(host: string): EndpointAddressClass {
  const bare = unwrapIpv6(host);
  if (bare === '::1') return known(host, 'loopback', 'ip-literal');
  if (bare === '::') return undecided(host, 'reserved'); // 未指定地址
  // IPv4 映射段：见 `UnknownAddressReason` 里那条注释 —— 故意按最严处理。
  if (bare.startsWith('::ffff:')) return undecided(host, 'ipv4-mapped-ipv6');

  const groups = ipv6Groups(bare, 2);
  const head = groupAt(groups, 0);
  const second = groupAt(groups, 1);
  if (Number.isNaN(head)) return undecided(host, 'unparseable'); // 不是合法 IPv6 字面量
  // 第一段全零但不是 `::1` / `::` / `::ffff:` —— 落在已废弃的 `::/96`（IPv4 兼容）区。
  if (head === 0) return undecided(host, 'reserved');
  if (head >= 0xfe80 && head <= 0xfebf) return known(host, 'link-local', 'ip-literal'); // fe80::/10
  if (head >= 0xfd00 && head <= 0xfdff) return known(host, 'private', 'ip-literal'); // ULA 本地分配段
  if (head >= 0xfc00 && head <= 0xfcff) return undecided(host, 'reserved'); // fc00::/8 未分配
  if (head === 0x2001 && second === 0x0db8) return undecided(host, 'reserved'); // 2001:db8::/32 文档段

  return known(host, 'public', 'ip-literal');
}

/** 名字（既不是 IPv4 也不是 IPv6 字面量）→ 未定性的哪一种。 */
function classifyName(host: string): EndpointAddressClass {
  // 🔴 只有**这一个精确字面量**算本机。`a.localhost` / `localhost.evil.com` /
  // `localhost.` 都不是 —— 判的是字面量相等，不是后缀匹配。
  if (host === 'localhost') return known(host, 'loopback', 'localhost-literal');
  const bare = host.endsWith('.') ? host.slice(0, -1) : host;
  if (!bare.includes('.')) return undecided(host, 'unqualified-name');
  for (const suffix of LAN_NAME_SUFFIXES) {
    if (bare.endsWith(suffix)) return undecided(host, 'lan-name');
  }
  return undecided(host, 'domain');
}

/**
 * 对一个端点做**纯字面量**的定性。不抛异常、不解析名字、不读网络。
 *
 * `undefined` / 空串是给"还没配"用的：它们返回 `unknown` + `reason: 'empty'`，
 * 而不是被当成"本机"——把"没配"读成"不出设备"是 `classifyDestination` 里
 * 一个专门被讨论过的分支，别再从这里长第二遍。
 */
export function classifyEndpointAddress(endpoint: string | undefined): EndpointAddressClass {
  if (endpoint === undefined || endpoint.trim() === '') return undecided(undefined, 'empty');
  const host = hostnameOf(endpoint);
  if (host === undefined) return undecided(undefined, 'unparseable');

  const v4 = splitIpv4(host);
  if (v4 !== undefined) return classifyIpv4(host, v4);
  if (host.includes(':')) return classifyIpv6(host);
  return classifyName(host);
}

/**
 * 这个地址**能不能被字面量证明是本机**。
 *
 * 🔴 整个出境判定里只有这一处读类别，而它只认 `known && loopback`：
 * `private` / `link-local` / `unknown` 全都算"离开本机"。
 * 这一行就是"只紧不松"的物理落点 —— 想放宽必须先改这里，而这里有测试盯着。
 */
export function isLoopbackAddress(endpoint: string | undefined): boolean {
  const classified = classifyEndpointAddress(endpoint);
  return classified.known && classified.category === 'loopback';
}

/**
 * 兼容名：入参是**完整端点 URL**（历史上 `supply.ts` 的导出）。
 *
 * ⚠️ 它是 `isLoopbackAddress` 的**别名**，不是第二套实现。
 * 保留这个名字是因为 `diagnose.ts` 与 `apps/web` 已经在用它，
 * 而 `check:layering` 明令 `apps/**` 不许自己再判一次回环。
 */
export function isLoopbackEndpoint(endpoint: string): boolean {
  return isLoopbackAddress(endpoint);
}

/**
 * 一句**中性描述**（给诊断与测试用，不进界面 —— 界面文案归 `packages/i18n`，
 * 由 `check:ui-language` 拦）。它把 `unknown` 的 reason 展开成可读的一句话。
 */
export function describeEndpointAddress(classified: EndpointAddressClass): string {
  if (classified.known) {
    return `字面量已定性：${classified.category}（${classified.decidedBy}，host=${classified.host}）`;
  }
  return `未定性（按最严处理）：reason=${classified.reason}${classified.host === undefined ? '' : `，host=${classified.host}`}`;
}
