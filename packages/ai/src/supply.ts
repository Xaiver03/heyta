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
 */
export type EgressDestination =
  /** 明文没有离开设备（端点在回环地址 / 本地进程）。**无需出境授权。** */
  | 'none'
  /** 明文去了用户自己指定的远端端点。 */
  | 'user-endpoint'
  /** 明文去了 heyta 云。 */
  | 'heyta-cloud';

/**
 * 回环地址判定。
 *
 * ⚠️ 只认**字面上的**回环/本地地址，不做 DNS 解析 ——
 * 因为"解析后是不是回环"这件事**只有真正发请求的那一刻才知道**，
 * 而我们必须在**发请求之前**就决定要不要索取出境授权。
 * 拿一个可能在解析后才成立的宽松判断去换取"少问用户一次"，
 * 换到的是"以为数据没出设备、其实出了"。**宁可多问一次。**
 *
 * 因此 `localhost` 之外的局域网主机名（`my-nas.lan`）**会被判成远端** ——
 * 那是刻意的：它确实是一台我们无法证明是本机的机器。
 *
 * ✅ **这个选择现在有先例支持（不再只是我的保守偏好）**：
 * **Joplin 明确把 `.local` 当作"远程提供方"处理**，理由是
 * **mDNS 名字可以指向当前网络里的任意一台主机** ——
 * 也就是说 `.local` 并不能证明"这是你这台机器"。
 * 见 [ADR-0006](../../../docs/adr/0006-supply-modes.md) §2.4 与
 * [`docs/research/e2ee-apps-ai.md`](../../../docs/research/e2ee-apps-ai.md)（Joplin 段）。
 * **本函数与该先例取同一条线：只信字面回环。**
 *
 * 🔴 **副作用（必须写下来）**：如果用户在**另一台机器**上自建 Ollama
 * 并通过局域网访问，本函数会要求出境授权，即使数据始终没出用户自己的网络。
 * 这是"宁可多问"的代价，接受它 —— 与本项目对 Joplin 先例的取舍一致。
 * 见 `describeDestination` 的文案处理（它会对 `user-endpoint` 明说
 * "heyta 无法审计该端点"，用户至少知道自己在批什么）。
 */
export function isLoopbackEndpoint(endpoint: string): boolean {
  let host: string;
  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    // 解析不出主机名 → **当作远端**（保守方向）。
    return false;
  }

  // IPv6 回环在 URL 里是 `[::1]`，hostname 拿到的是去掉方括号的 `::1`。
  if (host === '::1' || host === '[::1]') return true;
  if (host === 'localhost') return true;
  // 127.0.0.0/8 整个段都是回环。
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
  return false;
}

/** 由配置推导"明文去哪了"。 */
export function classifyDestination(config: {
  mode: AiSupplyMode;
  endpoint?: string;
}): EgressDestination {
  if (config.mode === 'off') return 'none';
  if (config.mode === 'managed') return 'heyta-cloud';
  // mode === 'own'：连端点都没配 → 还没到"能出境"的状态，视为 none。
  // （provider 层会在调用时报"未配置"，那是一个配置错误，不是隐私事件。）
  if (config.endpoint === undefined || config.endpoint === '') return 'none';
  return isLoopbackEndpoint(config.endpoint) ? 'none' : 'user-endpoint';
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
 * `undecided` 是刻意的一个 kind、不是缺省值：ADR-0006 §5 未决项 4/6 还没定案，
 * 而"没定案"与"不需要保留"是两件完全不同的事。壳拿到 `undecided` 时
 * **不许自己编一个数字**，只许照实说"还没定"。
 */
export type RetentionDisclosure =
  /** 没出境，不存在服务端保留问题。 */
  | { kind: 'not-applicable' }
  /** 保留策略由用户自己的端点决定，我们无从知晓。 */
  | { kind: 'third-party-decides' }
  /** 🔴 产品尚未定案 —— 照实说，不许编。 */
  | { kind: 'undecided' };

/** 结构化披露：目的地 → 保留策略。与 {@link describeRetention} 同源。 */
export function retentionDisclosure(destination: EgressDestination): RetentionDisclosure {
  switch (destination) {
    case 'none':
      return { kind: 'not-applicable' };
    case 'user-endpoint':
      return { kind: 'third-party-decides' };
    case 'heyta-cloud':
      return { kind: 'undecided' };
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
 * 目前只有 `none` 与 `user-endpoint` 的文案是**可以诚实写出来的**：
 *   - `none`：没出境，不存在保留问题。
 *   - `user-endpoint`：**我们不知道** —— 那是用户自己的服务，保留策略由它定。
 *   - `heyta-cloud`：🔴 **尚未定案**（ADR-0006 §5 未决项 4/6）。
 *     这里**不许编一个听起来合理的数字**，所以返回 `undefined`，
 *     由调用方决定是否阻止启用。见 `describeRetention`。
 */
export function describeRetention(destination: EgressDestination): string | undefined {
  // ⚠️ 同上：兼容路径，结论与 `retentionDisclosure()` 同源。
  // `undecided` → `undefined` 这个映射**必须保持** —— 它是 ADR-0006 §5 未决项的载体。
  switch (retentionDisclosure(destination).kind) {
    case 'not-applicable':
      return '未离开设备，不涉及服务端保留。';
    case 'third-party-decides':
      return '保留策略由你自己的端点决定，heyta 无从知晓。';
    case 'undecided':
      // 🔴 故意留空：产品尚未确定托管 AI 的数据保留策略（ADR-0006 §5）。
      // 在它定案之前，`managed` 模式**不允许被启用** —— 见 assertEnableable。
      return undefined;
  }
}

/** 配置无法启用时抛出的错误。 */
export class AiConfigError extends Error {
  constructor(
    message: string,
    readonly reason: 'retention-undecided' | 'endpoint-required' | 'endpoint-invalid' | 'consent-required',
  ) {
    super(message);
    this.name = 'AiConfigError';
  }
}

/**
 * 能否启用这份配置。
 *
 * 🔴 **`managed` 目前一定会失败**，因为它的数据保留策略还没定（ADR-0006 §5 未决项 4/6），
 * 而 `describeRetention` 拒绝编造一个数字。**这是刻意的失败，不是未完成的占位。**
 *
 * 它保证的是：**只要产品还没想清楚"托管 AI 的数据留多久"，
 * 用户就无法把它打开。** 一旦产品定案，填入 `describeRetention` 并放宽这里即可 ——
 * 而在此之前，任何试图启用托管 AI 的代码路径都会在**开发期**就撞到这条断言，
 * 而不是在用户已经上传了任务数据之后才被发现。
 */
export function assertEnableable(config: { mode: AiSupplyMode; endpoint?: string }): void {
  if (config.mode === 'off') return;

  if (config.mode === 'managed') {
    // 🔴 问的是**结构化的 kind**，不是"字符串是不是 undefined" ——
    // 前者是产品事实（未定案），后者只是它在旧接口上的投影。
    if (retentionDisclosure('heyta-cloud').kind === 'undecided') {
      throw new AiConfigError(
        '托管 AI 的数据保留策略尚未定案（ADR-0006 §5 未决项），因此当前不允许启用。' +
          '这不影响"自备端点"模式。',
        'retention-undecided',
      );
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