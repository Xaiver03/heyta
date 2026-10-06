/**
 * AI 供给模式与出境目的地
 * ==========================
 *
 * 这个文件把 [ADR-0006](../../../docs/adr/0006-supply-modes.md) 的产品决策
 * 变成可被代码和测试使用的类型。**它是那个 ADR 的可执行版本。**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么"供给模式"必须是**三态**而不是布尔
 *
 * 产品负责人的要求是"自备与托管两种模式都要提供"。但落到代码里，
 * 真正决定隐私性质的**不是"谁的服务器"，而是"明文去哪了"**：
 *
 *   - 用户自备、端点是 `http://localhost:11434` → **明文没离开这台设备**。
 *     这在隐私上等价于端侧推理，**与云端托管是完全不同的东西**。
 *   - 用户自备、端点是远程的 → 明文的离开了设备，去了**用户自己选的**第三方。
 *   - heyta 托管 → 明文的去了**我们的**服务器。
 *
 * 把前两者合并成"自备"会丢掉最重要的那个区别：**前者根本不需要出境授权，
 * 后者需要。** 所以目的地由端点地址**推导**，而不是由模式声明
 * （见 `classifyDestination`）—— 声明可以被写错，推导不会。
 * ─────────────────────────────────────────────────────────────────────────
 */

/** 供给模式。与 ADR-0006 §3 的两种模式一一对应，加上"关闭"。 */
export type AiSupplyMode =
  /** 未启用。**默认值**，也是交付时的初始状态。 */
  | 'off'
  /** 用户自备：自己的 API Key 或自建端点（Ollama / vLLM / 自建网关）。 */
  | 'own'
  /** heyta 托管：走我们的云 AI。 */
  | 'managed';

/**
 * 明文实际去了哪里。
 *
 * 🔴 **由端点推导，不由模式声明** —— 见文件头。
 * ⚠️ `managed` 那一支过去**不看端点**（无条件返回 `heyta-cloud`），那是
 * [ADR-0056](../../../docs/adr/0056-endpoint-address-class-and-domestic-managed-allowlist.md) §3.3
 * 堵掉的洞：把 `mode` 写成 `managed` 不构成"明文到了我们手里"这个事实，
 * 那个事实只能由**端点落在境内白名单上**来证明。
 */
export type EgressDestination =
  /** 明文没有离开设备（端点在回环地址 / 本地进程）。**无需出境授权。** */
  | 'none'
  /** 明文去了用户自己指定的远端端点。 */
  | 'user-endpoint'
  /** 明文去了 heyta 云。 */
  | 'heyta-cloud';

// 地址类别这一维度住在 `endpoint-address.ts`（**唯一**一份判定），
// 托管白名单住在 `managed-endpoints.ts`（**唯一**一份境内判定）。
// 两者都从 `index.ts` 直接导出；本文件只留这份文件自己的历史兼容说明。
import { isLoopbackAddress } from './endpoint-address.js';
import { isDomesticManagedEndpoint, managedEndpointVerdict } from './managed-endpoints.js';

/*
 * 回环地址判定**原来定义在这个文件里**，现在住在 `endpoint-address.ts`。
 * 搬走的理由不是"文件太长"，而是它原来只回答一个二元问题（本机 / 非本机），
 * 而 ADR-0056 要把"链路本地 / 私网 / 公网 / 未定性"补进模型 ——
 * 一个返回 `boolean` 的函数没法长成分档判定还留在原地，因为消费者必须能拿到
 * 那个**形状**（`known` 可判别），而不是一句 `true / false`。
 *
 * 三条不许动摇的前提（原文与更多证据在 `endpoint-address.ts` 的文件头）：
 *
 *   1. **不做 DNS 解析**。"解析后是不是回环"只有真正发请求那一刻才知道，
 *      而我们必须在发请求**之前**决定要不要索取授权。拿一个可能在解析后才成立的
 *      宽松判断去换"少问用户一次"，换到的是"以为数据没出设备、其实出了"。**宁可多问一次。**
 *   2. 因此 `localhost` 之外的局域网主机名（`my-nas.lan`、`nas.local`）**都是未定性**，
 *      按最严的一档处理 —— 那是刻意的：它确实是一台我们无法证明是本机的机器。
 *      ✅ 这条有先例支持（不是保守偏好）：**Joplin 明确把 `.local` 当作"远程提供方"处理**，
 *      理由是 mDNS 名字可以指向当前网络里的任意一台主机，见 ADR-0006 §2.4 与
 *      [`docs/research/e2ee-apps-ai.md`](../../../docs/research/e2ee-apps-ai.md)（Joplin 段）。
 *   3. 🔴 **补进类别维度不等于放宽任何一档**：只有"字面量已定性且是回环"免授权，
 *      `private` / `link-local` 两档**照旧要授权**。这条由
 *      `packages/ai/tests/endpoint-address.spec.ts` 的那张"只紧不松"样本表钉住
 *      （表里冻着旧算法的一份副本，不是靠注释）。
 */

/** 由配置推导"明文去哪了"。 */
export function classifyDestination(config: {
  mode: AiSupplyMode;
  endpoint?: string;
}): EgressDestination {
  if (config.mode === 'off') return 'none';

  if (config.mode === 'managed') {
    // 🔴 托管的目的地**也从端点推导**：只有落在境内白名单上的端点，
    // 才配被说成"明文到了 heyta 的服务器"。推导不出来时按 `user-endpoint` 处理 ——
    // 它同样需要授权（不会放宽），但它不再撒谎说数据在我们手里。
    // 那个"不看端点"的形状是 ADR-0056 §3.3 点名的洞。
    return isDomesticManagedEndpoint(config.endpoint) ? 'heyta-cloud' : 'user-endpoint';
  }

  // mode === 'own'：连端点都没配 → 还没到"能出境"的状态，视为 none。
  // （provider 层会在调用时报"未配置"，那是一个配置错误，不是隐私事件。）
  if (config.endpoint === undefined || config.endpoint === '') return 'none';
  return isLoopbackAddress(config.endpoint) ? 'none' : 'user-endpoint';
}

/** 目的地是否需要用户显式授权出境。 */
export function requiresEgressConsent(destination: EgressDestination): boolean {
  return destination !== 'none';
}

/**
 * 出境的**结构化**披露 —— "这条路径的性质是什么"，**不含任何措辞**。
 *
 * 🔴 为什么要有它：`describeDestination()` 返回的是一句**中文**，而它会被三个壳渲染
 * （web / mobile / 将来的桌面）。界面要中英双语之后，"怎么说"必须归壳 ——
 * 否则英文界面上这句话仍然是中文，而它恰恰是整个产品里**最不能出错的一句**
 * （ADR-0006 的基石）。
 *
 * 判断只有一份：`describeDestination` 现在**建立在它之上**，
 * 所以"结构化结论"与"中文句子"对同一个目的地永远一致，不会各自漂移。
 *
 * ⚠️ `heyta-cloud-managed` 这个 kind 本身就在陈述"明文到了我们手里"，
 * 它是 ADR-0006 §3.2 第 5 条要保护的那个事实。**不要给它起一个听起来更温和的名字。**
 */
export type DestinationDisclosure =
  /** 明文没离开这台设备。 */
  | { kind: 'local' }
  /** 明文去了用户自己选的第三方端点 —— 我们无权代表它做任何承诺。 */
  | { kind: 'third-party-endpoint' }
  /** 明文去了 heyta 自己的服务器。**不受端到端加密保护。** */
  | { kind: 'heyta-cloud-managed' };

/** 结构化披露：目的地 → 性质。与 {@link describeDestination} 同源。 */
export function destinationDisclosure(destination: EgressDestination): DestinationDisclosure {
  switch (destination) {
    case 'none':
      return { kind: 'local' };
    case 'user-endpoint':
      return { kind: 'third-party-endpoint' };
    case 'heyta-cloud':
      return { kind: 'heyta-cloud-managed' };
  }
}

/**
 * 保留策略的**结构化**披露。
 *
 * 🔴 2026-10-05 之前这里有一个 `undecided`，它同时是"还没定案"的载体和
 * "不许启用"的闸门（`assertEnableable` 靠它抛 `retention-undecided`）。
 * 裁决落进 [ADR-0054](../../../docs/adr/0054-managed-ai-retention-and-selling-preconditions.md)
 * 之后那个成员没有构造点了，于是**整个删掉** —— 留着一个到不了的状态，
 * 下一个读代码的人会以为"未定案"仍然是可选项，然后照它写文案。
 */
export type RetentionDisclosure =
  /** 没离开设备，不存在服务端保留问题。 */
  | { kind: 'not-applicable' }
  /** 保留策略由用户自己的端点决定，我们无从知晓。 */
  | { kind: 'third-party-decides' }
  /**
   * 托管路径：**只留元数据，不留内容**。
   *
   * `contentDays = 0` 不是"忘了填"：请求体与响应体只在一次代理调用的内存里存在，
   * 调用返回即丢弃，服务端那张表**装不下内容**（没有正文列，见 ADR-0054 §2 的列集合断言）。
   *
   * ⚠️ 成员名上一版叫 `counts-only`（"只记计数"）。那是**错的命名，并且错在真话的位置上**：
   * 除了计数表，每次调用还有一行运维审计日志（见
   * {@link MANAGED_AI_METADATA_RETENTION_DAYS} 那张两载体表）。"元数据"覆盖两者，
   * "计数"只覆盖一个 —— 而披露少说一个载体就是少说一个真实存在的数据。
   */
  | { kind: 'metadata-only'; contentDays: number; metadataDays: number };

/**
 * 托管路径上，用户正文在服务端存活的天数。
 *
 * 🔴 `0` 是**裁决**不是近似：ADR-0054 §3 判的是"一次调用之内"，
 * 而调用之内不叫保留。任何把这里改成正数的改动，都必须同时改掉
 * 《隐私政策》《个人信息清单》里那句"不留存正文"，否则那句话立刻变成假话。
 */
export const MANAGED_AI_CONTENT_RETENTION_DAYS = 0;

/**
 * 托管路径计数表的保留天数。
 *
 * 🔴 这个数字**只覆盖那张计数表**，表里的元数据就是四列：
 * `user_id`、`period_anchor`（哪一个计费周期）、`requests`（用了几次）、`updated_at`。
 * 表里没有功能名、没有结果状态、没有字节数（列集合由
 * `server/tests/ai-metering.pglite.spec.ts` 断言"等于这四个"，多一列就红）。
 *
 * ⚠️ **但"服务端只留这四列"这句话是假的**，而且假在我自己写的那一版里
 * （2026-10-05 复核发现）：托管代理每次调用还往 `Logger.audit` 写**一行**运维审计
 * 日志，字段是时间、账号、功能名、结果状态、请求/响应字节数、耗时
 * （`server/src/ai/managed-proxy.routes.ts` 的 `recordManagedAiAttempt` ——
 * 它的参数表就是 ADR-0054 §4 那份元数据清单）。所以披露必须说**两个载体**：
 *
 * | 载体 | 装什么 | 上限 | 上限是什么性质 |
 * |---|---|---|---|
 * | 计数表 | 四列 | {@link MANAGED_AI_METADATA_RETENTION_DAYS} 天，且该计费周期已结束 | **定时**删除，有人执行 |
 * | 每次调用一行的审计日志 | 时间/账号/功能名/结果/字节数/耗时 | 容器日志按**容量**滚动（我们自己的部署 10 MB × 30） | 不是定时，自托管者自己定 |
 *
 * 两个载体都不含正文，而守这件事的不是形容词：托管代理那组用例把标记串塞进请求与
 * 响应，断言它**既不在捕获到的全部日志输出里，也不在库里任何一张表的任何一行里**。
 * 反过来说，任何把这一句改回"只记计数"的改动都会让界面少说一个真实存在的数据载体 ——
 * `check:ai-coverage` 有一条臂专门拦它。
 *
 * 45 **不是拍脑袋**：计费周期是 30 天（`Subscription.currentPeriodEnd`），
 * 客服要对账一个跨月的周期需要 15 天余量 ⇒ 30 + 15（ADR-0054 §4）。
 *
 * ✅ 这个数字**有人执行**：`purgeExpiredAiUsageCounters`（`server/src/ai/metering.ts`）
 * 挂在每日清理任务 `server/src/sync/cleanup.ts` 第 8 段上，删掉"过期且周期已结束"的行。
 * 后面那半个条件是必须的 —— 只按 `updated_at` 删会把**还在生效**的那一期的额度清零
 * （付了钱、用了 1 次、之后 50 天没碰的用户），那不是清理，是白送额度。
 * ⚠️ 但它**只在代码里**：线上生效要等服务端镜像重建（部署不在本批授权范围内）。
 */
export const MANAGED_AI_METADATA_RETENTION_DAYS = 45;

/**
 * 结构化披露：目的地 → 保留策略。与 {@link describeRetention} 同源。
 *
 * 🔴 `metadata-only` 的两个天数**只能从这里出**：壳渲染时从披露对象取，
 * 不许在词条表或界面里各抄一份字面量。理由与 ADR-0023 那条"数字只有一个源"同一条。
 */
export function retentionDisclosure(destination: EgressDestination): RetentionDisclosure {
  switch (destination) {
    case 'none':
      return { kind: 'not-applicable' };
    case 'user-endpoint':
      return { kind: 'third-party-decides' };
    case 'heyta-cloud':
      return {
        kind: 'metadata-only',
        contentDays: MANAGED_AI_CONTENT_RETENTION_DAYS,
        metadataDays: MANAGED_AI_METADATA_RETENTION_DAYS,
      };
  }
}

/**
 * 隐私文案。
 *
 * 🔴🔴 **`heyta-cloud` 这一条是本文件存在的主要理由之一。**
 *
 * ADR-0006 §3.2 第 5 条要求：**不得宣称托管模式是 E2EE。**
 * ADR-0006 §2.1 记录了原因：E2EE 的定义就是"服务端到不了明文"，
 * 而托管 AI 必须把明文送到服务端 —— 两者在定义上互斥。
 *
 * ✅ **这条结论已被调研确证**（`docs/research/e2ee-apps-ai.md`）：
 * 在所有 E2EE / 本地优先产品样本中，**"厂商托管 AI 且维持 E2EE" 一个都没有**。
 * 唯一正面回答此问的厂商 **Proton Lumo** 明确说做不到，并给出技术原因 ——
 * 同态加密实测"响应要一天以上"，所以它只能
 * 「**The server decrypts the message temporarily to process it through the language model**」，
 * 并**主动改名以免误解**：「we acknowledge this is **not the regular definition of
 * end-to-end encryption**, which is why we prefer to call it **user-to-Lumo (U2L)** encryption」。
 * （它的静态对话历史仍是真 E2EE —— 这与我们的处境完全相同：
 * 同步仍然加密，出境的只是 AI 那条路径。）
 *
 * 所以这里给托管模式写的是**明确承认这件事**的文案。
 * 有测试（`tests/egress.spec.ts`）把它变成可失败的检查 —— 因为这种事靠人记是记不住的，
 * 而说错一次的代价是不可逆的信任损失。规则是**按目的地分开**的：
 *
 *   - 托管模式**必须**出现"不受端到端加密"这个确切否定；而把这句话挖掉后，
 *     **不许再出现任何**"端到端加密" —— 即只许否认，不许在别处顺口提一句。
 *     这条比我最初想写的严格（我原本还想补一句"同步仍然加密"），但严格是对的：
 *     在一段讲"这条路径不加密"的话里夹一句"但另一条路径加密"，
 *     扫读的人只会记住自己看到的那个词。
 *   - 本地与自备端点**一个加密承诺都不许有** —— 本地不必说，
 *     自备端点我们无权代表它承诺。
 *   - 英文缩写（`E2EE` / `end-to-end`）在任何模式下都不出现。
 *
 * ⚠️ 想说"同步不受影响"时，用**不含这个词**的说法（见下面的返回值）。
 */
export function describeDestination(destination: EgressDestination): string {
  // ⚠️ **兼容路径**：返回中文句子，结论与 `destinationDisclosure()` 同源
  // （这里 switch 的就是它的 kind，所以两者不可能各说一套）。
  // 三个壳切到结构化版本 + 词条表之后，它会只剩测试在用 —— 那时再删。
  switch (destinationDisclosure(destination).kind) {
    case 'local':
      return '数据不离开这台设备（端点在本地）。';
    case 'third-party-endpoint':
      return '数据会发送到你自己配置的 AI 端点。该端点由你提供，heyta 不参与，也无法审计它的日志与保留策略。';
    case 'heyta-cloud-managed':
      return '数据会发送到 heyta 的云 AI 服务，由 heyta 处理后返回结果。⚠️ 这条路径上 heyta 能看到明文，该功能不受端到端加密保护。任务同步走的是另一条通道，不受此影响。';
  }
}

/**
 * 数据保留声明。
 *
 * ⚠️ 这是**产品承诺的一半**：只说"发给谁"不够，必须同时说"留多久"。
 * ADR-0006 §3.2 第 2 条要求披露"哪些字段、发给谁、保留多久"。
 * 三档**都能诚实写出来**（托管那一档以前写不出，因为策略没定；
 * 定案见 [ADR-0054](../../../docs/adr/0054-managed-ai-retention-and-selling-preconditions.md)）：
 *   - `none`：没离开设备，不存在保留问题。
 *   - `user-endpoint`：**我们不知道** —— 那是用户自己的服务，保留策略由它定。
 *   - `heyta-cloud`：只留元数据、不留正文；两个载体（计数表 + 每次调用一行的运维日志）
 *     都要出现在这一句里，天数只给那张表（日志那一侧的上限是容量不是时间）。
 *
 * 🔴 这里的**两个数字不许写字面量**。它们和结构化披露共用同一对常量，
 * 而界面渲染的是结构化那一份 —— 两边各写一遍就是两套承诺。
 */
export function describeRetention(destination: EgressDestination): string {
  // ⚠️ 同上：兼容路径，结论与 `retentionDisclosure()` 同源。
  // 🔴 这里**必须先绑定一次**再 switch：`switch (retentionDisclosure(d).kind)` 里那个
  //   调用是第二个表达式，TS 不会把它窄化成 `metadata-only`，于是 `metadata-only` 分支里
  //   取不到两个天数（TS2339）。而这条只在 **`pnpm build` 的 dts 阶段**才现形 ——
  //   vitest 直接跑源码、不做类型检查，所以 `pnpm --filter @heyta/ai test` 是绿的。
  const disclosure = retentionDisclosure(destination);
  switch (disclosure.kind) {
    case 'not-applicable':
      return '未离开设备，不涉及服务端保留。';
    case 'third-party-decides':
      return '保留策略由你自己的端点决定，heyta 无从知晓。';
    case 'metadata-only': {
      const { contentDays, metadataDays } = disclosure;
      // 🔴 这一句说**两个载体**，不是一个。上一版只说"服务端只记调用计数"，
      //   那是一句**少说了真存在的数据**的假话：托管代理每次调用还写一行运维审计
      //   日志（功能名/结果/字节数/耗时），见 `MANAGED_AI_METADATA_RETENTION_DAYS`
      //   那一节的两载体表。披露少说一个载体，和多说一个一样是披露失败 ——
      //   少说的那一个不会被任何人发现，除了这条注释和 `check:ai-coverage` 的臂。
      // ⚠️ 只有**表**有天数（45）；日志那一侧的上限是**容量**不是时间，所以这句
      //   绝不给它写一个天数（写了就是关于一个不存在的定时删除的承诺）。
      return `正文不留存，只在一次调用的内存里存在（存活 ${String(contentDays)} 天）；` +
        `服务端留两样元数据，都不含正文：一张计数表（账号、计费周期、次数、最后使用时间），` +
        `自最后一次使用起保留 ${String(metadataDays)} 天且该计费周期结束后删除；` +
        `以及每次调用一行的运维日志（时间、功能名、结果、字节数、耗时），` +
        `它按日志容量滚动清除，没有定时删除。`;
    }
  }
}

/**
 * 配置无法启用时抛出的错误。
 *
 * ⚠️ 这里曾经并列过一个 `consent-required`。它**从未被构造过**：真正的抛错点
 * 只有那几处，全仓也没有别的地方构造它。出境授权的"缺少同意"是 `egress.ts` 的
 * `consent-missing`，与"配置能不能启用"是两件事 —— 把两者的词混在一个联合里，
 * 只会让读的人以为启用流程也要处理授权缺失。已收敛掉。
 *
 * 🔴 2026-10-05 删掉过另一个成员 `retention-undecided`。它**曾经有构造点**，
 * 但在 [ADR-0054](../../../docs/adr/0054-managed-ai-retention-and-selling-preconditions.md)
 * 把托管路径的保留策略定案之后它到不了了 —— 与上面那条同一个理由：
 * **没有构造点的成员必须删掉**，留着它，下一个读代码的人会以为"保留策略还没定"
 * 仍然是当前事实，然后照它写对外文案（那句会立刻变成假话）。
 *
 * 🔴 新增的 `managed-endpoint-not-domestic` **不是凭注释预留的死成员**：它有构造点
 * （下面的 `assertEnableable`）、有可达的调用路径（`classifyDestination` 与单测直接打它），
 * 而 `packages/ai/tests/managed-allowlist.spec.ts` 逐条钉住它。
 * 加成员的代价是刻意的：每一个 reason 都对应**一个不同的用户修复动作**。
 */
export class AiConfigError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'endpoint-required'
      | 'endpoint-invalid'
      /** 🔴 托管档的端点不在**境内**白名单上（ADR-0056 §3.3）。 */
      | 'managed-endpoint-not-domestic',
  ) {
    super(message);
    this.name = 'AiConfigError';
  }
}

/**
 * 能否启用这份配置。
 *
 * 🔴 **它是 `managed` 的安全闸门，不是"顺手写的一个校验"。** 今天的调用点有三类：
 *   1. `provider.ts` 的 `createProvider()`（单端点 / 本地 / 测试与历史路径）；
 *   2. 门禁 `scripts/check-ai-coverage.mjs` —— 它在**运行时真的调一次**，
 *      钉住"托管档接境外端点必须以 `managed-endpoint-not-domestic` 被拒"；
 *   3. 本包与界面的测试。
 *
 * 也就是说：**它现在的生产可达性依赖第 2 类**，而删除它等于拆掉一扇门
 * （"托管的明文只能交给我们自己、且只能交给境内的模型供应商"）。
 *
 * ⚠️ 顺带说清一件容易被误读的事：`invokeRouted` 走的是 `AiRoutingConfig`，
 * 而那份配置**没有 `mode` 字段** —— 目的地由端点地址推导
 * （`classifyDestination({ mode: 'own', ... })`），只可能是 `none` /
 * `user-endpoint`，**推不出 `heyta-cloud`**。所以"托管云到不了"是**结构上**成立的，
 * 而不是靠这个函数拦住的；本函数拦的是"把 `mode` 写成 `managed`"那条入口。
 *
 * 🔴 结构上到不了 ≠ 那条路是对的：如果将来把托管档接到 `invokeRouted` 上，
 * 我们的自建端点会被推导成 `user-endpoint`，于是披露变成"该端点由你提供、heyta 不参与"
 * —— **那句是假的**。那一档必须先为新 ADR 把目的地词表与路由配置对齐，
 * 见 ADR-0056 §5 第 1 条登记的边界。
 *
 * 🟢 **`managed` 从 2026-10-05 起可以启用了**，条件是端点落在境内白名单上。
 * 挡着它的那条"保留策略未定案"已由 ADR-0054 定案（正文不保留、元数据 45 天），
 * 定案的内容同时写进了 `describeRetention` 与对外法务文本 ——
 * **这两处必须一起成立**：`disclosure-shape.spec.ts` 钉的是"结构化披露与中文句子
 * 对同一个目的地取值一致"，而 `check:legal-copy` 钉的是对外文本与真源一致。
 *
 * ✅ 这条闸门**没有因为开档而放宽**：境内白名单是**必要条件**，不是放行牌。
 * 一个接了境外供应商的托管配置仍然以 `managed-endpoint-not-domestic` 被拒
 * （`managed-allowlist.spec.ts` + 门禁 8e 逐条钉住），而**没配端点**是另一件事 ——
 * 那是配置缺口（`endpoint-required`），修复动作是"去设置里填地址"，
 * 不是"换一家供应商"。两个 reason 各对应一个不同的用户动作，所以不许合并成一条。
 */
export function assertEnableable(config: { mode: AiSupplyMode; endpoint?: string }): void {
  if (config.mode === 'off') return;

  if (config.mode === 'managed') {
    // 🔴 这两支的顺序**不是随手写的**：一个**已经确定的拒绝事实**（端点是境外的）
    // 必须排在"缺一个输入"（还没填端点）之前。反过来写会把"你该换供应商"这件事
    // 说成"你还没填地址"，用户的修复动作就错了。
    const verdict = managedEndpointVerdict(config.endpoint);
    if (!verdict.ok && verdict.reason !== 'empty') {
      throw new AiConfigError(
        `托管 AI 只能接境内的模型供应商，而这个端点不合格：${verdict.message}`,
        'managed-endpoint-not-domestic',
      );
    }
    if (!verdict.ok) {
      throw new AiConfigError('托管模式必须提供端点地址（境内白名单见 `managed-endpoints.ts`）。', 'endpoint-required');
    }
    return;
  }

  // mode === 'own'
  if (config.endpoint === undefined || config.endpoint === '') {
    throw new AiConfigError('自备模式必须提供端点地址。', 'endpoint-required');
  }
  let parsed: URL;
  try {
    parsed = new URL(config.endpoint);
  } catch {
    throw new AiConfigError(`端点地址无法解析：${config.endpoint}`, 'endpoint-invalid');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AiConfigError(
      `端点协议必须是 http 或 https，收到 ${parsed.protocol}`,
      'endpoint-invalid',
    );
  }
}