/**
 * 账号级"重新确认"闸门：**改版之后，数据先别出去**
 * ==============================================
 *
 * ## 它兑现的是哪一句承诺
 *
 * `packages/legal/src/documents/terms.ts` s10 对外写着：涉及数据用途、责任范围或退款
 * 政策的重大变更，"我们需要你在应用内**重新确认**"。服务端那一侧的裁决已经成立
 * （`server/src/legal-recheck.ts`：指纹不等 ⇒ `needsReconfirm`），但**裁决没有人执行**
 * 就等于没有 —— 客户端照旧同步，那句话仍然只是那句话。本文件是执行的那一层。
 *
 * ## 🔴 与链 5 那道闸的分工（两条闸，不是一个闸的两份）
 *
 * | | `privacy-consent.ts`（链 5） | 本文件（G-27） |
 * |---|---|---|
 * | 问的是 | **这台设备**准不准与那个服务端通信 | **这个账号**同意的还是不是现在这一版文本 |
 * | 事实源 | 本机存储（决定就在这台设备上作出） | 服务端（只有它知道自己发布的是哪一版） |
 * | 默认 | **关**（没问过 = 没有同意） | **不拦**（见下面"为什么问不到时放行"） |
 * | 拦的射程 | 全进程一切出站 | **数据出站**（同步 + 实时通道） |
 *
 * 两条闸**串联而不是互相替代**：链 5 那四处出站闸一条都没动、判定也没并进来 ——
 * 把它们合成一个布尔会丢掉"这台设备同意过，但账号需要补签"这个真实存在的状态。
 *
 * ## 🔴 为什么问不到时**放行**，而链 5 是关闭
 *
 * 这不是双标，是两者的**默认值含义不同**：
 *
 * - 链 5 的"读不到"是一个**真实存在**的状态（我们从来没问过），把它读成"同意过"
 *   等于擅自替用户作出同意 —— 那正是那条规则要拦的事。
 * - 这里的"读不到"是**拿不到答案**：离线、令牌过期、服务端 5xx。这些状态下
 *   "需要重新确认"这件事既没成立也没不成立。把它当成成立，界面就要对用户说
 *   "你需要同意的条款"，而**我们从没把任何条款指给他看** —— 那是本仓库反复记过的
 *   "界面在说谎"那一类（同 `sendJson` 里那句"闸门拦下不等于网络故障"的镜像）。
 *   而且失败方向不对：离线时同步本来就发不出去，多拦一次不改变任何结果，
 *   却会把"网络抖一下"变成"数据永久出不去"。
 *
 * ⚠️ 代价必须说出口：这条放行使本机制成为**客户端侧**的保证 —— 一个从不询问的服务端
 * 请求路径不会因此停下。服务端在 `/api/sync/ops` 上拒掉未补签账号是**下一步**，
 * 本轮不做，理由与判据缺口写在台账 G-27 行。
 *
 * ## 为什么"问"要排在放行之前（`checking` 存在的唯一理由）
 *
 * 自动同步在启动序列里就会跑。如果闸门在拿到答案前是"放行"，那么**每次冷启动**都会
 * 先把数据推出去、再收到"你要补签"——这条闸就只剩下"事后弹个窗"，而它存在的理由
 * 是"改版与确认之间那段时间里数据不出门"。所以 `checking` 是**拦**的。
 *
 * 🔴 由此得出一条宿主必须守住的顺序：**先 `refresh()`，再放行任何数据出站**。
 * 这条顺序不是可选的优化，判据（`tests/legal-recheck.spec.ts`）里有对应的一条。
 */

import {
  confirmLegalConsent,
  getLegalConsentStatus,
  type LegalConsentReason,
  type LegalConsentStatus,
} from './hosted-auth.js';

/** 闸门的五种状态。`phase` 是给界面的，`dataEgressAllowed()` 是给接线层的。 */
export type LegalRecheckPhase =
  /** 没有凭据（未登录 / 未配服务端）。不判、不拦 —— 也没有东西可同步。 */
  | 'anonymous'
  /** 正在问。**拦**（见文件头"为什么 `checking` 是拦的"）。 */
  | 'checking'
  /** 服务端说这一版他已经同意过。**不拦，且界面一个弹窗都不许出现。** */
  | 'clear'
  /** 服务端说要补签。拦，直到用户看完并确认。 */
  | 'needs-reconfirm'
  /** 问不到。不拦（理由见文件头那条分工）。 */
  | 'unavailable';

export interface LegalRecheckView {
  readonly phase: LegalRecheckPhase;
  readonly reason: LegalConsentReason | null;
  /** 服务端当前那一版 —— 也就是**界面必须展示给用户看**的那一版。 */
  readonly currentVersion: string | null;
  /** 服务端据以裁决的那一版（"他上次同意的是这个"）。 */
  readonly recordedVersion: string | null;
  /**
   * 确认提交失败过一次的**结构化原因**（不是文案）。
   *
   * 🔴 它存在是因为"点了没反应"是本仓库记过最多次的一类缺陷。有值时界面必须
   * 说出来并把按钮留着，**绝不**把面板收起来当作已经确认过了。
   */
  readonly confirmFailure: 'network' | 'unauthorized' | 'rejected' | null;
}

export interface LegalRecheckPorts {
  /** **活的**取值器：登录/登出/换令牌之后要拿到的是新值，不是启动那一刻的快照。 */
  getToken(): string | undefined;
  /** 服务端根地址，同样活的（用户可以在设置里改）。空串 = 未配置。 */
  getBaseUrl(): string;
  /** 注入 `fetch`（web 传带链 5 闸门的那个，移动端传平台 fetch，测试传替身）。 */
  fetchImpl?: typeof fetch;
  /** 收据时间。不参与任何裁决，只作为 `acceptedAt` 发给服务端。 */
  now?: () => number;
}

const IDLE: LegalRecheckView = {
  phase: 'anonymous',
  reason: null,
  currentVersion: null,
  recordedVersion: null,
  confirmFailure: null,
};

const view = (
  phase: LegalRecheckPhase,
  status?: Partial<LegalConsentStatus>,
  confirmFailure: LegalRecheckView['confirmFailure'] = null,
): LegalRecheckView => ({
  phase,
  reason: status?.reason ?? null,
  currentVersion: status?.currentVersion ?? null,
  recordedVersion: status?.recordedVersion ?? null,
  confirmFailure,
});

export function createLegalRecheckGate(ports: LegalRecheckPorts) {
  let state: LegalRecheckView = IDLE;
  /**
   * 🔴 代际计数：晚到的旧答案不许覆盖新状态。
   *
   * 具体形态不是假想的：令牌刷新会触发一次 `refresh()`，而上一轮 `refresh()` 可能
   * 还在路上（慢网络）；`confirm()` 成功后紧跟的 `refresh()` 更要压住
   * 确认之前那次读侧的响应，否则它会按旧版本把面板再弹起来。
   * 与 `apps/mobile/src/sync/auto-sync.ts` 的"代际计数防丢写"是同一条纪律。
   */
  let generation = 0;
  const listeners = new Set<() => void>();

  const set = (next: LegalRecheckView): void => {
    // 只有真的变了才通知：这道闸的订阅者会重建实时连接，
    // 一次无变化的通知就是一次无意义的断连重连。
    const changed =
      next.phase !== state.phase ||
      next.currentVersion !== state.currentVersion ||
      next.recordedVersion !== state.recordedVersion ||
      next.confirmFailure !== state.confirmFailure;
    state = next;
    if (!changed) return;
    for (const listener of listeners) {
      // 一个订阅者抛错不许影响其余的（同 web `consent-gate.ts` 里那条理由）。
      try {
        listener();
      } catch (error: unknown) {
        console.warn('[legal-recheck] 订阅者抛错（不影响闸门本身）：', error);
      }
    }
  };

  /** 真正去问一次。调用方负责它拿到的 Promise（内部已把所有失败归成状态）。 */
  const ask = async (gen: number): Promise<void> => {
    const token = ports.getToken()?.trim() ?? '';
    const baseUrl = ports.getBaseUrl().trim();
    if (token === '' || baseUrl === '') {
      if (gen === generation) set(IDLE);
      return;
    }
    const authOptions = { baseUrl, ...(ports.fetchImpl ? { fetchImpl: ports.fetchImpl } : {}) };
    const result = await getLegalConsentStatus(authOptions, token);
    if (gen !== generation) return;
    if (!result.ok) {
      // 令牌不被认得 = 这个身份下无从裁决（同步那边会各自给出"要重新登录"）。
      const phase: LegalRecheckPhase = result.reason === 'unauthorized' ? 'anonymous' : 'unavailable';
      set(view(phase));
      return;
    }
    set(view(result.needsReconfirm ? 'needs-reconfirm' : 'clear', result));
  };

  /**
   * 问一次。**幂等靠代际，不靠"已经在问就不问"**：
   * 令牌刚换过的时候必须能立刻重问，而"在途"标志会把那次重问吃掉。
   */
  const refresh = (): Promise<void> => {
    const gen = ++generation;
    // `checking` 期间界面不许继续显示旧版本，也不许弹面板
    // （`shouldShowSheet()` 为假），所以清空是安全的。
    set(view('checking'));
    return ask(gen);
  };

  return {
    current(): LegalRecheckView {
      return state;
    },

    /**
     * 数据现在许不许出门。**唯一**给接线层用的判据。
     *
     * 只有 `checking` 与 `needs-reconfirm` 返回 `false`，而这两条都是从**状态**推出来的 ——
     * 不写 `phase === 'needs-reconfirm'` 那种两处各判一遍的形状，因为漏掉 `checking`
     * 正是"启动竞态"的落点（见文件头）。
     */
    dataEgressAllowed(): boolean {
      return state.phase !== 'checking' && state.phase !== 'needs-reconfirm';
    },

    /** 界面要不要弹。与"拦不拦"刻意分开：`checking` 时不许弹一个可能永远不消失的面板。 */
    shouldShowSheet(): boolean {
      return state.phase === 'needs-reconfirm';
    },

    refresh,
    /**
     * 用户点了"我已看完并确认"。**只有这个动作能调它。**
     *
     * 🔴 发给服务端的是**读侧带回的** `currentVersion`（= 界面刚展示的那一版），
     * 不是本机另存的一份；两者为 `null` 时直接返回，连请求都不发 ——
     * 发一个空版本只会拿到 400，而那条 400 会被记成"提交失败"，
     * 把一个"我们还没问过"的状态伪装成"服务端拒绝了"。
     */
    async confirm(): Promise<void> {
      const token = ports.getToken()?.trim() ?? '';
      const version = state.currentVersion;
      if (token === '' || version === null) return;
      const gen = generation;
      const authOptions = {
        baseUrl: ports.getBaseUrl().trim(),
        ...(ports.fetchImpl ? { fetchImpl: ports.fetchImpl } : {}),
      };
      const result = await confirmLegalConsent(
        authOptions,
        token,
        version,
        // 服务端要求它是**正整数**（那条判据在 `recordLegalReconfirm`：epoch 0 与负数
        // 会渲染成"1970 年同意过"，那是一条会让人当真的假收据）。
        Math.max(1, Math.floor(ports.now?.() ?? Date.now())),
      );
      if (gen !== generation) return;
      if (result.ok) {
        set(view('clear', { reason: 'current', currentVersion: result.recordedVersion, recordedVersion: result.recordedVersion }));
        return;
      }
      // 服务端在回答的这段时间里又改版了：本机那份 `currentVersion` 已经过期，
      // 唯一正确的动作是**重新问一次**（让界面展示新那一版），而不是把旧的再发一遍。
      if (result.code === 'version_mismatch') {
        // 🔴 **等**这一轮重问完成再返回：调用方（界面的按钮）于是有一个确定的时刻
        // —— "点确认"这件事要么落成了 `clear`，要么仍然拦着。
        // 用 `void` 会留下一个"按钮已经消失、新那一版还没问回来"的窗口。
        await refresh();
        return;
      }
      // 这台实例说不出版本 ⇒ 本机制对它整体不适用（与读侧 `not-applicable` 同义）。
      if (result.code === 'instance_cannot_name_text') {
        set(view('clear', { reason: 'not-applicable' }));
        return;
      }
      const confirmFailure: LegalRecheckView['confirmFailure'] =
        result.reason === 'network' || result.reason === 'unconfigured'
          ? 'network'
          : result.reason === 'unauthorized'
            ? 'unauthorized'
            : 'rejected';
      // 🔴 闸门**保持** `needs-reconfirm`：确认没成功就不许把数据放开。
      set({ ...state, confirmFailure });
    },

    /** 登出/凭据变了：当场回到"没身份可判"，不许留着上一个人的答案。 */
    reset(): void {
      generation++;
      set(IDLE);
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type LegalRecheckGate = ReturnType<typeof createLegalRecheckGate>;
