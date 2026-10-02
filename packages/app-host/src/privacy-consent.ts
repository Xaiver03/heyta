/**
 * 隐私同意闸门（**任何出站请求之前的那道闸**）
 * =============================================
 *
 * ## 要解决的那条缺口
 *
 * 《App 违法违规收集使用个人信息行为认定方法》第二类把"未公开收集使用规则""未经
 * 用户同意即开始收集"直接认定为违法违规；PIPL 第 13/14 条要求处理建立在"充分知情
 * 前提下自愿、明确作出"的同意之上。而 heyta 此前的界面只有一句写在注册勾选框旁边的
 * 「我同意该服务端提供的服务条款与隐私政策」，**首启没有任何人向用户征求过同意**，
 * 而 Service Worker 注册与实时同步通道在启动序列里**先于任何同意**发生。
 * 计划里那两条编号是 **G-11**（首启未弹隐私政策）与 **G-12**（同意前不得发起任何请求），
 * 见 `docs/plans/legal-compliance-before-filing.md`。
 *
 * ## 🔴 为什么默认是**关**而不是**开**
 *
 * 这个模块的每一条读路径都 fail-closed：读不到、JSON 坏了、词表外的取值、
 * 存储不可用 —— 一律当作"没有同意"。反过来写才是要论证的那一侧：
 * 把"读不到"当成"同意过"，等于在存储抖动时**擅自**替用户作出同意，
 * 而那正是这条规则要拦的事。这个方向的代价也要对齐：它坏成"网络功能不亮"，
 * 而不是坏成"用户数据受损" —— 本地优先意味着闸门关闭时产品**仍然是完整的**
 * （见下面"三条裁决"的第 2 条）。
 *
 * ## 三条裁决
 *
 * 1. **同意是一个"档"，不是一个布尔值。** 只有两个合法取值：
 *    `accepted`（同意，允许与该服务端通信）与 `local-only`（不同意，只用本机）。
 *    把它们收成 `true | false` 会丢掉一件必须能回答的事：**用户是明确拒绝过，
 *    还是我们从来没问过** —— 前者不该再弹、后者必须弹（G-11）。
 * 2. **`local-only` 不是"降级模式"，是一个完整的产品决定。**
 *    PIPL 第 16 条禁止"因个人不同意……拒绝提供产品或服务"（除非处理该信息是提供
 *    服务所必需）。heyta 的数据**先落本地**，云端只是同步通道，所以"不同意"完全可以
 *    保留全部核心功能 —— 这就是这条合规要求能被满足的**结构原因**，不是文案技巧。
 *    同步、登录、提醒推送、托管 AI 这些"要出门"的能力才是要关的那部分。
 * 3. **撤回必须比同意容易做到。** {@link PrivacyConsentGate.revoke} 把状态清回
 *    "没问过"（而不是 `local-only`），因为撤回同意之后界面要重新给用户一次选择的
 *    机会；PIPL 第 15 条要求"应当提供便捷的撤回同意的方式"，而设置页里那一个入口
 *    就是那个方式。
 *
 * ## 🔴 为什么这里**不**记法务文本的版本号
 *
 * 留痕要写"同意的是哪一份文本"才有意义，而**客户端说不出那个名字**：文本集由
 * 运营者的服务端发布（链 3 的 `server/src/legal-consent.ts` 已经把版本写进账户），
 * 而客户端连的可能是任何一台 host。本机写一个自己编的 `v1` 只会造出第二个事实源，
 * 并与服务端那条对不上。所以本机只记**决定本身与决定时间**，
 * 版本化留痕由服务端那一侧承担 —— 这条分工写在链 3 的文件头里。
 *
 * ## 🔴 为什么是注入式端口而不是直接用 `localStorage`
 *
 * AGENTS.md §3.5：`apps/*` 只允许一处平台差异。"同意之后才准出门"是产品语义，
 * 而 `localStorage` / op-sqlite / 内存 Map 是平台事实。所以本模块**不碰任何全局量**：
 * 存储由宿主注入（{@link PrivacyConsentPort}），四个壳共用同一套判定。
 * 端口只有三个方法，是因为撤回需要 `remove` —— 少它就只能写空串，
 * 把"用户撤回了"和"值被写坏了"混成同一种字节，而这两件事在界面上的说法不同。
 *
 * ## 写不进去时**这一轮**仍然算同意过
 *
 * {@link PrivacyConsentGate.decide} 会返回 `persisted: false`，闸门在本次会话内
 * 放行，但**下次冷启动会重新问**。理由有两条：
 *
 * - 用户确实作出了明确同意，只是这台设备的存储没记住 —— 把它当成"没同意"会让
 *   他"点了同意，同步永远不开始"，那是本仓库反复记过的那类静默失效；
 * - `persisted` 是**界面必须说出口**的事实（与 `apps/mobile` 的
 *   `markWelcomeSeen()` 返回 `false` 同一条纪律），不许静默假装成功。
 *
 * 会话优先于磁盘：`current()` 先看本次会话的值与撤回标记，都没有才去读端口。
 * 理由见 {@link createPrivacyConsentGate} 内部那段（写盘会失败，而磁盘上躺着的是**上一次**的决定）。
 */

/** 存储里那一条记录的键。**宿主不许自己拼字符串** —— 拼第二遍就会漂移。 */
export const PRIVACY_CONSENT_KEY = 'privacy.consent';

/** 合法的两种决定。词表封闭：解析时**表外一律判无效**，不做模糊匹配。 */
export const PRIVACY_DECISIONS = ['accepted', 'local-only'] as const;

/** 用户作出的决定（见文件头第 1 条：为什么不是一个布尔值）。 */
export type PrivacyDecision = (typeof PRIVACY_DECISIONS)[number];

/** 落在本机的那一条记录。`decidedAt` 只用于展示与留痕，**不参与任何裁决**。 */
export interface PrivacyConsentRecord {
  readonly decision: PrivacyDecision;
  /** ISO 8601 字符串。墙上时钟不能裁决因果（AGENTS.md §7 第 19 条），这里只当收据时间。 */
  readonly decidedAt: string;
}

/**
 * 宿主注入的最小存储端口。
 *
 * 🔴 三个方法都**不许抛**：调用点之一是应用启动路径。抛在那里的代价是"应用起不来"，
 * 而它本来只该影响"这次同意有没有被记住"。与 `apps/mobile/src/prefs/device-prefs.ts`
 * 的「契约：永不抛」同一条纪律，宿主实现负责把异常降级成 `undefined` / `false`。
 */
export interface PrivacyConsentPort {
  /** 读一个值。没有 / 读不到 → `undefined`（**不要**猜默认值）。 */
  read(key: string): string | undefined;
  /** 写一个值。返回**是否真的写进去了**。 */
  write(key: string, value: string): boolean;
  /** 删掉一个值（撤回同意用）。返回是否真的删掉了（或本来就没有）。 */
  remove(key: string): boolean;
}

/** {@link PrivacyConsentGate.decide} 的回执：记录 + 这台设备有没有记住它。 */
export interface PrivacyConsentReadout {
  readonly record: PrivacyConsentRecord;
  readonly persisted: boolean;
}

const DECISIONS: ReadonlySet<string> = new Set<string>(PRIVACY_DECISIONS);

/**
 * 把存储里的字符串解析成记录。**任何不确定的形状都返回 `null`**（见文件头"为什么默认是关"）。
 *
 * ⚠️ 接受**多余字段**：这是刻意的向前兼容 —— 以后往这条记录里加字段时，
 * 旧版界面读到新记录不该把用户的同意判没（那会把一个合规状态变成故障）。
 */
export function parsePrivacyConsent(raw: string | undefined): PrivacyConsentRecord | null {
  if (raw === undefined) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const { decision, decidedAt } = value as { decision?: unknown; decidedAt?: unknown };
  if (typeof decision !== 'string' || !DECISIONS.has(decision)) return null;
  // 时间只要求"是个非空字符串"：它的唯一用途是展示与留痕。
  // 在这里做日历校验会造出第二套日期解析，而且失败方向不对 ——
  // 一个时间戳写坏不该让用户已经给出的同意作废。
  if (typeof decidedAt !== 'string' || decidedAt === '') return null;

  return { decision: decision as PrivacyDecision, decidedAt };
}

/** 把记录写成存储里的字符串。 */
export function serializePrivacyConsent(record: PrivacyConsentRecord): string {
  return JSON.stringify({ decision: record.decision, decidedAt: record.decidedAt });
}

/**
 * `decidedAt` 给用户看的那一行。**四个壳共用这一份实现。**
 *
 * ## 为什么这个纯展示的东西要放在共享层
 *
 * 它是**收据**，不是排版：同一个决定在 web 上显示 `2026-09-30 21:04`、
 * 在移动端显示成别的形状（本地时区、12 小时制、只有日期），用户就会以为
 * 那是两次不同的决定。§3.5 拦的是"同一个判断写两遍"，而"什么时候作的决定"
 * 这句话怎么说出来也是一个判断 —— 抄第二遍就会漂移。
 *
 * ## 🔴 刻意不用 `Intl` / `toLocaleString`
 *
 * 两个理由，缺一不可：
 *
 * - **移动端**：Hermes 的 `Intl` 是可选编译进去的（见 `apps/mobile/src/lib/date.ts` 文件头），
 *   拿不到时 `new Intl.DateTimeFormat()` 直接抛 —— 抛在设置页 = 那一页打不开。
 * - **判据**：`Intl` 的输出随运行环境（时区、ICU 版本）变，写进测试就等于
 *   把一条断言挂在开发机的配置上。这条要能失败。
 *
 * ⚠️ 代价必须说出口：这一行**不带时区信息**，`HH:mm` 是 ISO 串里的那个
 * **UTC** 时刻。权威留痕在服务端那一份（`server/src/legal-consent.ts`），
 * 这里只回答"大概什么时候点的"。要显示本地时间就得连时区一起记，
 * 而那会把"墙上时钟不能裁决因果"（AGENTS §7 第 19 条）引进展示层。
 */
export function formatPrivacyDecisionTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/**
 * 这条决定允不允许**与任何服务端通信**。
 *
 * `null`（没问过）与 `local-only`（明确不同意）都返回 `false` —— 两者在"能不能发请求"
 * 上必须给出**同一个答案**，而在"界面要不要弹"上给出不同的答案，
 * 所以这是一个独立的方法，不是 `record !== null` 的别名。
 */
export function privacyNetworkAllowed(record: PrivacyConsentRecord | null): boolean {
  return record !== null && record.decision === 'accepted';
}

/**
 * 创建一道闸门。**每个宿主只建一个**，把它交给需要判"能不能出门"的地方。
 *
 * 用闭包而不是模块级可变状态：会话内的回落值跟着这道闸，测试之间不会互相污染
 * （本仓库吃过"跨测试残留状态"的红），也让桌面/移动多个入口拿到同一个实例时
 * 由宿主显式传递 —— 隐式全局是"到底谁同意了"最难查的形态。
 */
export function createPrivacyConsentGate(
  port: PrivacyConsentPort,
  /** 注入时钟：只在调用方没给 `nowIso` 时兜底，测试里固定它。 */
  now: () => string = () => new Date().toISOString(),
) {
  let session: PrivacyConsentRecord | null = null;
  let revoked = false;

  /**
   * 本次会话里的决定**优先于**磁盘值，而撤回过则磁盘值也不作数。
   *
   * 🔴 为什么不是"磁盘优先"：写盘会失败（配额、隐私模式、原生库没起来），
   * 那时磁盘上躺着的是**上一次**的决定。按磁盘优先，用户点了「同意并继续」
   * 却一个请求都发不出去 —— 那是本仓库反复记过的"界面按了没反应"那一类静默失效。
   * 撤回落盘失败同理必须压住磁盘值，否则"已撤回"与"请求照发"会同时成立。
   *
   * ⚠️ 代价要说清：同一台设备上**另一个标签页**之后写的决定，本页要等冷启动才认。
   * 选这一侧是因为它只在"同一设备、多个页面、并发改同意"这种场景里落后，
   * 而那场景下两个页面本来就属于同一个用户、同一个法律主体。
   */
  const readCurrent = (): PrivacyConsentRecord | null => {
    if (revoked) return null;
    if (session !== null) return session;
    return parsePrivacyConsent(port.read(PRIVACY_CONSENT_KEY));
  };

  return {
    /** 当前生效的记录（`null` = 没问过 / 已撤回）。 */
    current: readCurrent,

    /** 允不允许发起请求。 */
    networkAllowed(): boolean {
      return privacyNetworkAllowed(readCurrent());
    },

    /** 尚未作出决定（G-11：这种情况下界面必须弹）。 */
    undecided(): boolean {
      return readCurrent() === null;
    },

    /**
     * 记下一次决定。**只有明确的一次用户动作才该调用它** ——
     * 任何"顺手替用户点上"的路径都让整件事失去意义。
     */
    decide(decision: PrivacyDecision, nowIso?: string): PrivacyConsentReadout {
      // 词表在运行时再验一遍：TypeScript 挡不住 JS 调用方与原生壳（本仓库的固定纪律）。
      if (!DECISIONS.has(decision)) {
        throw new Error(
          `未知的隐私决定：${String(decision)}。可选：${PRIVACY_DECISIONS.join(' / ')}。`,
        );
      }
      const record: PrivacyConsentRecord = { decision, decidedAt: nowIso ?? now() };
      const persisted = port.write(PRIVACY_CONSENT_KEY, serializePrivacyConsent(record));
      // 写不进也要在**本次会话**里认这次同意（见文件头那条理由）。
      session = record;
      revoked = false;
      return { record, persisted };
    },

    /**
     * 撤回同意：清回"没问过"，闸门当场关闭。
     *
     * 🔴 撤回落盘失败时，本次会话也必须关闭 —— 否则"界面上说已撤回、请求照发"，
     * 那是比不撤回更坏的状态。所以这里**无条件**压住磁盘值，
     * 并把 `persisted` 交回调用方去说明"下次启动可能还会带着这个问题"。
     */
    revoke(): { persisted: boolean } {
      const persisted = port.remove(PRIVACY_CONSENT_KEY);
      session = null;
      revoked = true;
      return { persisted };
    },

    /** 仅供测试：清掉本次会话的痕迹（磁盘不动）。 */
    __resetSessionForTests(): void {
      session = null;
      revoked = false;
    },
  };
}

export type PrivacyConsentGate = ReturnType<typeof createPrivacyConsentGate>;

/**
 * 出站请求的**兜底闸门**：把闸门套在一个 `fetch` 实现外面。
 *
 * ## 为什么需要它，而"启动序列里挡一下"不够
 *
 * 启动序列的门挡的是"没人去调"。但同步客户端、认证客户端、收件箱、权益探测
 * 都接受 `fetchImpl` 注入（见 `packages/sync-client/src/client.ts` 与
 * `packages/app-host/src/hosted-auth.ts`），也就是说**每个壳都要记得传对**才算数 ——
 * 而"新加一个调用点忘了传"的症状是"合规前提悄悄失效"，没有任何一层会报错。
 * 套一层就把它变成结构性保证：**没有同意就没有请求能离开这个进程**，
 * 判据也只需要在这一处断言。
 *
 * ## 🔴 拒绝的方式是**同步抛**，不是"返回一个假响应"
 *
 * 造一个 `new Response(...)` 会让上层把它当成"服务端答了"，进而渲染出
 * "同步失败/离线"这类**与事实无关**的句子（本仓库反复记过"界面在说谎"那一类）。
 * 抛一个带 {@link PRIVACY_CONSENT_BLOCKED_MARKER} 的错误，上层按结构化原因归类，
 * 界面就能说清"是因为还没有同意"。
 *
 * ⚠️ 用 `async` 而不是同步 `throw`：真 `fetch` 从不同步抛错，而调用点里有
 * `fetchImpl(...).catch(...)` 这种写法 —— 同步抛会**逃过**那个 `.catch()`，
 * 把一个可控的拒绝变成未捕获异常。替换别人的东西时，形状必须跟着那个东西。
 *
 * ⚠️ 而这条路径**正常情况下不该被走到**：界面应当先弹同意面板。
 * 走到它说明某个调用点绕过了检查，那是要响的信号，不是一个静默的降级。
 */
export const PRIVACY_CONSENT_BLOCKED_MARKER = 'privacy-consent-not-granted';

/** 被闸门拦下时抛出的错误。用 `instanceof` 判，不靠字符串匹配。 */
export class PrivacyConsentBlockedError extends Error {
  constructor(url: string) {
    super(
      `${PRIVACY_CONSENT_BLOCKED_MARKER}: 用户尚未同意隐私规则，拒绝发起任何请求（${url}）。`,
    );
    this.name = 'PrivacyConsentBlockedError';
  }
}

/**
 * 包一层 `fetch`：闸门关闭时**一个字节都不发**。
 *
 * ⚠️ 参数是"取闸门的函数"而不是闸门本身，因为宿主可能在启动早期还没装配好闸门；
 * 传 `() => true` 那种写法等于关掉这一层，调用点自己负责。
 */
export function createConsentGatedFetch(
  fetchImpl: typeof fetch,
  isAllowed: () => boolean,
): typeof fetch {
  // 🔴 判据在**调用底层 fetch 之前**，所以关闭时底层调用次数必须是 0
  //（`tests/privacy-consent.spec.ts` 数的就是次数，不是"有没有报错"）。
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (isAllowed()) return fetchImpl(input as RequestInfo, init);

    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    throw new PrivacyConsentBlockedError(url);
  }) as typeof fetch;
}

/** 一个永远拒绝的端口：宿主拿不到任何持久化能力时用（比"没有闸门"诚实）。 */
export const UNAVAILABLE_PRIVACY_CONSENT_PORT: PrivacyConsentPort = {
  read: () => undefined,
  write: () => false,
  remove: () => false,
};
